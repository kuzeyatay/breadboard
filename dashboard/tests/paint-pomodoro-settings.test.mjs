import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { PAINT_POMODORO_SETTINGS_KEY, parsePaintPomodoroDurations } from "../src/lib/paint-pomodoro-settings.ts";
import { readPaintPomodoroDurations, writePaintPomodoroDurations } from "../src/lib/paint-pomodoro-settings-store.ts";
import { loadPaintPomodoroDurations, readLocalPaintPomodoroDurations, savePaintPomodoroDurations } from "../src/lib/paint-pomodoro-settings-client.ts";

test("timer durations survive reopening the database and stay per account", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "paint-pomodoro-settings-"));
  const filename = path.join(directory, "brain.db");
  let db = new Database(filename);
  try {
    db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1), (2)");
    assert.equal(readPaintPomodoroDurations(db, 1), null);
    writePaintPomodoroDurations(db, 1, { focus: 40, short: 7, long: 20 });
    const last = { focus: 45, short: 8, long: 30 };
    writePaintPomodoroDurations(db, 1, last);
    assert.throws(() => writePaintPomodoroDurations(db, 1, { ...last, short: 0 }));
    db.close();
    db = new Database(filename);
    assert.deepEqual(readPaintPomodoroDurations(db, 1), last);
    assert.equal(readPaintPomodoroDurations(db, 2), null);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid or incomplete saved settings cannot create a broken timer", () => {
  for (const value of [null, [], {}, { focus: 25 }, { focus: "25", short: 5, long: 15 },
    { focus: Infinity, short: 5, long: 15 }, { focus: NaN, short: 5, long: 15 },
    { focus: 181, short: 5, long: 15 }]) {
    assert.equal(parsePaintPomodoroDurations(value), null);
  }
  assert.deepEqual(parsePaintPomodoroDurations({ focus: 1, short: 180, long: 15 }), { focus: 1, short: 180, long: 15 });
});

function browser(t, initial = {}) {
  const entries = new Map(Object.entries(initial));
  t.mock.method(globalThis, "fetch");
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  } };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  return entries;
}

test("legacy browser settings can migrate to the account and load with empty browser storage", async t => {
  const legacy = { focus: 37, short: 9, long: 22 };
  const entries = browser(t, { [PAINT_POMODORO_SETTINGS_KEY]: JSON.stringify(legacy) });
  let account = null;
  globalThis.fetch.mock.mockImplementation(async (_url, init) => {
    if (init.method === "PUT") account = JSON.parse(init.body);
    return { ok: true, json: async () => ({ durations: account }) };
  });
  assert.equal(await loadPaintPomodoroDurations(), null);
  await savePaintPomodoroDurations(readLocalPaintPomodoroDurations());
  entries.clear();
  assert.equal(readLocalPaintPomodoroDurations(), null);
  assert.deepEqual(await loadPaintPomodoroDurations(), legacy);
});

test("rapid edits persist in order and reload waits for the final save", async t => {
  const entries = browser(t);
  const releases = [];
  let account = null;
  globalThis.fetch.mock.mockImplementation(async (_url, init) => {
    if (init.method === "PUT") {
      await new Promise(resolve => releases.push(resolve));
      account = JSON.parse(init.body);
    }
    return { ok: true, json: async () => ({ durations: account }) };
  });
  const first = { focus: 26, short: 5, long: 15 };
  const last = { focus: 27, short: 6, long: 16 };
  const firstSave = savePaintPomodoroDurations(first);
  const lastSave = savePaintPomodoroDurations(last);
  const reload = loadPaintPomodoroDurations();
  assert.deepEqual(JSON.parse(entries.get(PAINT_POMODORO_SETTINGS_KEY)), last, "cache updates before navigation");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(releases.length, 1);
  releases.shift()();
  await firstSave;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(releases.length, 1);
  releases.shift()();
  await lastSave;
  assert.deepEqual(await reload, last);
});

test("a failed account save remains cached and can be retried", async t => {
  browser(t);
  const durations = { focus: 50, short: 10, long: 25 };
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: false }));
  await assert.rejects(savePaintPomodoroDurations(durations), /Could not save/);
  assert.deepEqual(readLocalPaintPomodoroDurations(), durations);
  await assert.rejects(loadPaintPomodoroDurations(), /Could not load/);
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: true }));
  await savePaintPomodoroDurations(durations);
});

test("account persistence works when localStorage is blocked", async t => {
  browser(t);
  window.localStorage.getItem = window.localStorage.setItem = () => { throw new Error("Blocked"); };
  assert.equal(readLocalPaintPomodoroDurations(), null);
  const durations = { focus: 33, short: 7, long: 18 };
  globalThis.fetch.mock.mockImplementation(async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), durations);
    return { ok: true };
  });
  await savePaintPomodoroDurations(durations);
});
