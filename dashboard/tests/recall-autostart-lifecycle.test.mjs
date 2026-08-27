import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { announceRecallAutostart } from "../src/app/components/recall-autostart-lifecycle.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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
  const fetchImpl = async (...args) => calls.push(args);

  for (const session of [null, {}, { user: null }, { user: {} }, { user: { id: "nope" } }]) {
    assert.equal(await announceRecallAutostart({ session, storage, fetchImpl }), false);
  }

  assert.equal(calls.length, 0);
  assert.equal(storage.values.size, 0);
});

test("an authenticated user is announced once per app tab", async () => {
  const calls = [];
  const storage = memoryStorage();
  const fetchImpl = async (...args) => calls.push(args);
  const input = { session: { user: { id: "7" } }, storage, fetchImpl };

  assert.equal(await announceRecallAutostart(input), true);
  assert.equal(await announceRecallAutostart(input), false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    "/api/recall/autostart",
    { method: "POST", cache: "no-store" },
  ]);
});

test("the tab guard is scoped to the authenticated user", async () => {
  const calls = [];
  const storage = memoryStorage();
  const fetchImpl = async (...args) => calls.push(args);

  await announceRecallAutostart({ session: { user: { id: "7" } }, storage, fetchImpl });
  await announceRecallAutostart({ session: { user: { id: "8" } }, storage, fetchImpl });

  assert.equal(calls.length, 2);
  assert.deepEqual([...storage.values.keys()].sort(), [
    "breadboard:recall-autostart:7",
    "breadboard:recall-autostart:8",
  ]);
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
