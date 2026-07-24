import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const badge = fs.readFileSync(
  new URL("../src/app/components/openharness/gbrain-status-badge.tsx", import.meta.url),
  "utf8",
);
const chat = fs.readFileSync(
  new URL("../src/app/components/openharness/garden-agent-chat.tsx", import.meta.url),
  "utf8",
);
const terminal = fs.readFileSync(
  new URL("../src/app/components/openharness/dashboard-agent-terminal.tsx", import.meta.url),
  "utf8",
);

test("the status badge covers all required states", () => {
  for (const state of ["healthy", "degraded", "indexing", "stale", "unavailable"]) {
    assert.match(badge, new RegExp(state), `badge must handle "${state}"`);
  }
  // Disabled renders nothing (no palette clutter).
  assert.match(badge, /state === "disabled"[\s\S]*return null/);
});

test("the badge offers a reindex action gated on ownership", () => {
  assert.match(badge, /Reindex/);
  assert.match(badge, /canReindex/);
  assert.match(badge, /\/api\/gbrain\/sync/);
});

test("the badge consumes ONLY the safe status/sync endpoints (no secrets/paths/ids)", () => {
  // Only these two endpoints are fetched.
  const fetches = badge.match(/\/api\/gbrain\/[a-z]+/g) ?? [];
  for (const f of fetches) assert.ok(["/api/gbrain/status", "/api/gbrain/sync"].includes(f), `unexpected endpoint ${f}`);
  // The component must not reference secrets, adapter URLs, absolute paths, or source ids.
  assert.ok(!/adapterUrl|GBRAIN_ADAPTER_SECRET|sourceId|C:\\\\|127\.0\.0\.1/.test(badge));
});

test("the badge is mounted in Garden Chat and the Terminal", () => {
  assert.match(chat, /GBrainStatusBadge/);
  assert.match(chat, /gardenSlug=\{gardenSlug\}/);
  assert.match(terminal, /GBrainStatusBadge/);
});

test("the badge distinguishes unavailable from a grounded answer (honest failure)", () => {
  // The unavailable state is explicit, never a silent fallback label.
  assert.match(badge, /Knowledge: unavailable/);
});
