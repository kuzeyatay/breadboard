import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-google-export-executor-"));
process.env.BREADBOARD_DATA_DIR = root;
const { default: db } = await import("../src/lib/db.ts");
const { getCalendarStore } = await import("../src/lib/calendar/instance.ts");
after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
const userId = Number(db.prepare("INSERT INTO users (username, email, password_hash) VALUES ('export-test','export@example.com','x')").run().lastInsertRowid);
const store = getCalendarStore();
const [calendar] = store.listCalendarsEnsuringDefault(userId);
store.createEvent(userId, { calendarId: calendar.id, title: "Appointment", startsAt: "2026-09-08T09:00", endsAt: "2026-09-08T10:00" });

test("the connected-app executor routes natural-language bulk actions into the real calendar exporter", async () => {
  const output = path.join(root, "executor.mjs");
  await build({ entryPoints: [fileURLToPath(new URL("../src/lib/composio/executor.ts", import.meta.url))],
    outfile: output, bundle: true, platform: "node", format: "esm", packages: "external",
    plugins: [{ name: "google-provider-fixture", setup(builder) {
      builder.onResolve({ filter: /^server-only$/ }, () => ({ path: "empty", namespace: "provider-test" }));
      builder.onResolve({ filter: /^\.\/(client|service)\.ts$/ }, ({ path }) => ({ path, namespace: "provider-test" }));
      builder.onResolve({ filter: /^\.\.\/(garden-transfer\/mail|hermes\/route-core|calendar\/(instance|store|google-export))\.ts$/ }, ({ path: relative, resolveDir }) => ({ path: pathToFileURL(path.resolve(resolveDir, relative)).href, external: true }));
      builder.onLoad({ filter: /.*/, namespace: "provider-test" }, ({ path }) => ({ contents: path === "empty" ? ""
        : path.includes("client") ? "export const composioClient = () => ({ tools: { proxyExecute: globalThis.googleExportProxy } });"
          : "export const resolveComposioConnection = async (userId, slug) => ({ userId, slug, connectionId: 'account-' + userId });" }));
    } }],
  });
  const { executeComposioAction } = await import(pathToFileURL(output).href);
  const requests = [], remote = new Map();
  globalThis.googleExportProxy = async (request) => {
    requests.push(request);
    assert.equal(request.connectedAccountId, `account-${userId}`);
    assert.match(request.endpoint, /^https:\/\/www\.googleapis\.com\/calendar\/v3\//);
    assert.doesNotMatch(request.endpoint, /\/breadboard\//, "the internal operation must never be proxied to Google");
    if (request.endpoint.endsWith("/calendarList")) return { status: 200, data: { kind: "calendar#calendarList", items: [] } };
    if (request.endpoint.includes("/calendarList/")) return { status: 200, data: { id: "target@example.com", summary: "Target", accessRole: "writer" } };
    if (request.method === "POST") {
      if (!request.body.id) return { status: 200, data: { ...request.body, id: "google-created-event" } };
      if (remote.has(request.body.id)) return { status: 409, data: {} };
      remote.set(request.body.id, request.body);
      return { status: 200, data: request.body };
    }
    return { status: 200, data: remote.get(request.endpoint.split("/").at(-1)) };
  };
  try {
    const calendars = await executeComposioAction({ userId, action: "google_calendar_list_calendars", args: {} });
    assert.equal(calendars.data.kind, "calendar#calendarList");
    const created = await executeComposioAction({ userId, action: "google_calendar_create_event", args: {
      summary: "Appointment", start: "2026-09-08T09:00", end: "2026-09-08T10:00",
    } });
    assert.equal(created.data.id, "google-created-event");
    assert.equal(created.data.start.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    const preview = await executeComposioAction({ userId, action: "google_calendar_preview_breadboard_export", args: {} });
    assert.equal(preview.connection, "google-calendar");
    assert.equal(preview.data.totalEvents, 1); assert.equal(remote.size, 0);
    const input = { userId, action: "google_calendar_export_breadboard_events", args: preview.data.exportArgs };
    const copied = await executeComposioAction(input);
    assert.equal(copied.data.created, 1); assert.equal(copied.data.complete, true);
    const repeated = await executeComposioAction(input);
    assert.equal(repeated.data.created, 0); assert.equal(repeated.data.alreadyPresent, 1); assert.equal(remote.size, 1);
    const before = requests.length;
    await assert.rejects(executeComposioAction({ ...input, args: { userId: userId + 1 } }), /Unknown/);
    assert.equal(requests.length, before);
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(executeComposioAction({ ...input, signal: cancelled.signal }), /abort/i);
    assert.equal(requests.length, before, "a cancelled turn cannot start another export batch");
    globalThis.googleExportProxy = async () => ({ status: 200, data: {} });
    await assert.rejects(executeComposioAction({ userId, action: "google_calendar_create_event", args: {
      summary: "Appointment", start: "2026-09-08T09:00Z", end: "2026-09-08T10:00Z",
    } }), /could not be confirmed/);
  } finally { delete globalThis.googleExportProxy; }
});
