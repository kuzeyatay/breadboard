import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { announceRecallAutostart } from "../src/app/components/recall-autostart-lifecycle.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const response = (outcome = "start") => ({ ok: true, json: async () => ({ result: { outcome } }) });

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

test("signed-out and malformed sessions never attempt Recall autostart", async () => {
  const calls = [];
  const storage = memoryStorage();
  const fetchImpl = async (...args) => { calls.push(args); return response(); };

  for (const session of [null, {}, { user: null }, { user: {} }, { user: { id: "nope" } }]) {
    assert.equal(await announceRecallAutostart({ session, storage, fetchImpl }), false);
  }

  assert.equal(calls.length, 0);
  assert.equal(storage.values.size, 0);
});

test("an authenticated user is announced once per app tab", async () => {
  const calls = [];
  const storage = memoryStorage();
  const fetchImpl = async (...args) => { calls.push(args); return response(); };
  const input = { session: { user: { id: "7" } }, storage, fetchImpl };

  assert.equal(await announceRecallAutostart(input), true);
  assert.equal(await announceRecallAutostart(input), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    "/api/recall/autostart",
    { method: "POST", cache: "no-store" },
  ]);
});

test("the tab guard is scoped to the authenticated user", async () => {
  const calls = [];
  const storage = memoryStorage();
  const fetchImpl = async (...args) => { calls.push(args); return response(); };

  await announceRecallAutostart({ session: { user: { id: "7" } }, storage, fetchImpl });
  await announceRecallAutostart({ session: { user: { id: "8" } }, storage, fetchImpl });

  assert.equal(calls.length, 2);
  assert.deepEqual([...storage.values.keys()].sort(), [
    "breadboard:recall-autostart:v2:7",
    "breadboard:recall-autostart:v2:8",
  ]);
});

test("installation and failed requests remain retryable until startup succeeds", async () => {
  const storage = memoryStorage();
  const answers = [
    () => { throw new Error("offline"); },
    () => ({ ok: false }),
    () => response("installing"),
    () => response("start_failed"),
    () => response("start"),
  ];
  const input = {
    session: { user: { id: "11" } }, storage,
    fetchImpl: async () => answers.shift()(),
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    assert.equal(await announceRecallAutostart(input), false);
    assert.equal(storage.values.size, 0);
  }
  assert.equal(await announceRecallAutostart(input), true);
  assert.equal(await announceRecallAutostart(input), true);
  assert.equal(answers.length, 0);
});

test("concurrent mounts share one startup request", async () => {
  let finish;
  let calls = 0;
  const input = {
    session: { user: { id: "12" } }, storage: memoryStorage(),
    fetchImpl: () => { calls++; return new Promise(resolve => { finish = resolve; }); },
  };
  const first = announceRecallAutostart(input);
  const second = announceRecallAutostart(input);
  assert.equal(calls, 1);
  finish(response());
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
});

test("a settings change can retry an earlier settled opt-out", async () => {
  let calls = 0;
  const input = {
    session: { user: { id: "13" } }, storage: memoryStorage(),
    fetchImpl: async () => response(++calls === 1 ? "capture_disabled" : "installing"),
  };
  assert.equal(await announceRecallAutostart(input), true);
  assert.equal(await announceRecallAutostart({ ...input, force: true }), false);
  assert.equal(await announceRecallAutostart(input), false);
  assert.equal(calls, 3);
});

test("a settings change during a pending opt-out response rechecks the new preference", async () => {
  let finish;
  let calls = 0;
  const input = {
    session: { user: { id: "14" } }, storage: memoryStorage(),
    fetchImpl: () => ++calls === 1
      ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve(response("installing")),
  };
  const first = announceRecallAutostart(input);
  const changed = announceRecallAutostart({...input, force: true});
  finish(response("capture_disabled"));
  assert.deepEqual(await Promise.all([first, changed]), [true, false]);
  assert.equal(calls, 2);
});

test("the root mount rechecks authentication after client navigation", () => {
  const component = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "app", "components", "recall-autostart.tsx"),
    "utf8",
  );

  assert.match(component, /const pathname = usePathname\(\)/);
  assert.match(component, /getSession\(\)/);
  assert.match(component, /announceRecallAutostart\(\{/);
  assert.match(component, /\}, \[pathname\]\)/);
});
