import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HermesRuntimeAdapter } from "../src/lib/agent-runtime/adapters/hermes.ts";

const flush = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const previousRoot = process.env.HERMES_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-preparation-lease-"));
  process.env.HERMES_ROOT = root;
  const adapter = new HermesRuntimeAdapter({ baseUrl: "http://127.0.0.1:9119",
    sessionToken: "test", requestTimeoutMs: 5_000 });
  const requests = [], releases = [], acquisitions = [];
  adapter.resolveModelIdentity = async () => ({ model: "test-model", provider: "chatgpt" });
  adapter.ensureSessionLease = async state => { acquisitions.push(state); return null; };
  const release = adapter.releaseSessionLease.bind(adapter);
  adapter.releaseSessionLease = async state => { releases.push(state.externalSessionId); await release(state); };
  adapter.client = {
    async request(method) {
      requests.push(method);
      return method === "session.create" ? { session_id: "live", stored_session_id: "stored" }
        : method === "session.turn_result" ? { state: "completed", maintenance_running: true } : {};
    },
    clearSession() {}, close() {},
  };
  t.after(() => {
    adapter.dispose();
    if (previousRoot === undefined) delete process.env.HERMES_ROOT;
    else process.env.HERMES_ROOT = previousRoot;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("breadboard-preparation-lease-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const session = await adapter.createSession({ surface: "dashboard_terminal", sessionKey: "artifact-only" });
  return { adapter, session, requests, releases, acquisitions };
}

test("an unused artifact context releases its runtime after two minutes and preserves its files", async t => {
  const { adapter, session, releases, acquisitions, requests } = await fixture(t);
  const artifact = path.join(session.directory, "report.txt");
  fs.writeFileSync(artifact, "saved specialist result");
  t.mock.timers.tick(119_999);
  await flush();
  assert.deepEqual(releases, []);
  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(releases, ["stored"]);
  assert.equal(fs.readFileSync(artifact, "utf8"), "saved specialist result");
  assert.ok(!requests.includes("session.close"));
  t.mock.timers.tick(360_000);
  await flush();
  assert.deepEqual(releases, ["stored"], "idle preparation cleanup runs once");
  await adapter.startRun({ ...session, messageId: "later", text: "Continue with the saved report" });
  assert.equal(acquisitions.length, 2, "a later turn reacquires through the normal lease path");
  assert.ok(requests.includes("prompt.submit"));
});

test("starting a turn cancels preparation expiry before slow model preparation", async t => {
  const { adapter, session, releases, requests } = await fixture(t);
  let finishPreparation;
  adapter.resolveModelIdentity = () => new Promise(resolve => { finishPreparation = resolve; });
  t.mock.timers.tick(119_000);
  const run = adapter.startRun({ ...session, messageId: "turn", text: "Long preparation" });
  await flush();
  t.mock.timers.tick(600_000);
  await flush();
  assert.deepEqual(releases, [], "a submitted request is protected before prompt.submit");
  assert.ok(!requests.includes("prompt.submit"));
  finishPreparation({ model: "test-model", provider: "chatgpt" });
  await run;
  assert.ok(requests.includes("prompt.submit"));
});

test("a connected event stream owns its lease until its reply completes", async t => {
  const { adapter, session, releases } = await fixture(t);
  let complete;
  const finished = new Promise(resolve => { complete = resolve; });
  adapter.client.events = async function* () {
    yield { type: "message.delta", session_id: "live", payload: { turn_id: "turn", text: "Working" } };
    await finished;
    yield { type: "message.complete", session_id: "live", payload: { turn_id: "turn", text: "Working done", status: "complete" } };
  };
  const stream = adapter.streamSession({ ...session, messageId: "turn" });
  assert.equal((await stream.next()).value.type, "assistant.delta");
  t.mock.timers.tick(120_000);
  await flush();
  assert.deepEqual(releases, []);
  complete();
  for await (const _event of stream) { /* drain the actual adapter cleanup */ }
  assert.deepEqual(releases, ["stored"]);
});

test("background maintenance retains preparation resources until completion", async t => {
  const { adapter, session, releases } = await fixture(t);
  const maintenance = running => adapter.trackMaintenance({ type: "session.maintenance",
    session_id: "live", payload: { running, turn_id: "compact" } });
  maintenance(true);
  t.mock.timers.tick(120_000);
  await flush();
  assert.deepEqual(releases, []);
  maintenance(false);
  await flush();
  assert.deepEqual(releases, [session.externalSessionId]);
});

test("disposing an unused session clears its pending preparation cleanup", async t => {
  const { adapter, session, releases } = await fixture(t);
  await adapter.disposeSession(session);
  assert.deepEqual(releases, ["stored"]);
  t.mock.timers.tick(120_000);
  await flush();
  assert.deepEqual(releases, ["stored"]);
});
