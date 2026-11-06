import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session } from "electron";
import { desktopSessionAccountId, finishedAutomationTabOwners } from "../src/main/desktop-session-auth";

test("automation cleanup authenticates status reads and rejects unavailable or unrelated results", async () => {
  const session = { cookies: { get: async () => [{ name: "session", value: "current" }] } } as unknown as Pick<Session, "cookies">;
  const signal = new AbortController().signal;
  const read: typeof fetch = async (url, init) => {
    assert.equal(url, "http://127.0.0.1:32123/api/browser/automation-tabs");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("Cookie"), "session=current");
    assert.deepEqual(JSON.parse(String(init?.body)), { owners: ["finished", "active"] });
    return Response.json({ finishedOwners: ["finished", "unrequested"] });
  };
  assert.deepEqual(await finishedAutomationTabOwners("http://127.0.0.1:32123", session, ["finished", "active"], signal, read), ["finished"]);
  for (const response of [new Response(null, { status: 503 }), Response.json({}), Response.json({ finishedOwners: [123] })]) {
    await assert.rejects(finishedAutomationTabOwners("http://localhost:32123", session, ["active"], signal, async () => response));
  }
  await assert.rejects(finishedAutomationTabOwners("https://example.com", session, [], signal, read), /Invalid desktop session origin/);
});

test("control bridge authenticates the current app cookies directly with the dashboard", async () => {
  let cookie = "first";
  const session = { cookies: { get: async () => [{ name: "session", value: cookie }] } } as unknown as Pick<Session, "cookies">;
  const read: typeof fetch = async (url, init) => {
    assert.equal(url, "http://127.0.0.1:32123/api/auth/session");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    return Response.json({ user: { id: new Headers(init?.headers).get("Cookie") === "session=first" ? 1 : 2 } });
  };
  assert.equal(await desktopSessionAccountId("http://127.0.0.1:32123/new-tab", session, read), "1");
  cookie = "second";
  assert.equal(await desktopSessionAccountId("http://127.0.0.1:32123", session, read), "2");
  assert.equal(await desktopSessionAccountId("http://127.0.0.1:32123", session, async () => new Response(null, { status: 401 })), "");
  for (const base of ["https://example.com", "http://user:pass@127.0.0.1:32123"]) {
    await assert.rejects(desktopSessionAccountId(base, session, read), /Invalid desktop session origin/);
  }
});
