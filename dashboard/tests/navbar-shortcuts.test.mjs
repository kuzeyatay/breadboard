// Which optional entries the navbar carries: the rules, and the per-user
// storage behind them, run against an in-memory database.

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import {
  DEFAULT_NAVBAR_SHORTCUTS,
  NAVBAR_SHORTCUTS,
  applyNavbarShortcutPatch,
  ensureNavbarShortcutSchema,
  isNavbarShortcutKey,
  readNavbarShortcuts,
  writeNavbarShortcuts,
} from "../src/lib/profile/navbar-shortcuts.ts";

function createDatabase() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);");
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@x.com'), (2, 'b@x.com')").run();
  ensureNavbarShortcutSchema(db);
  return db;
}

test("the work timer and Plan sit by default; the world monitor and map are asked for", () => {
  assert.deepEqual(DEFAULT_NAVBAR_SHORTCUTS, {
    workTimer: true,
    worldMonitor: false,
    plan: true,
    map: false,
  });
  const db = createDatabase();
  assert.deepEqual(readNavbarShortcuts(db, 1), DEFAULT_NAVBAR_SHORTCUTS);
});

test("the catalog names exactly the keys the settings carry", () => {
  const keys = NAVBAR_SHORTCUTS.map((shortcut) => shortcut.key).sort();
  assert.deepEqual(keys, Object.keys(DEFAULT_NAVBAR_SHORTCUTS).sort());
  for (const shortcut of NAVBAR_SHORTCUTS) {
    assert.ok(isNavbarShortcutKey(shortcut.key));
    assert.match(shortcut.href, /^\//, "and each points at an in-app page");
    assert.ok(shortcut.label && shortcut.description, "with something to show in the toggle");
  }
  assert.equal(isNavbarShortcutKey("somethingElse"), false);
});

test("a patch only moves the keys it names, and only with booleans", () => {
  const current = { workTimer: true, worldMonitor: false, plan: true, map: false };

  assert.deepEqual(applyNavbarShortcutPatch(current, { worldMonitor: true }), {
    workTimer: true,
    worldMonitor: true,
    plan: true,
    map: false,
  });
  assert.deepEqual(
    applyNavbarShortcutPatch(current, { workTimer: "yes", nonsense: true }),
    current,
    "junk is ignored rather than coerced",
  );
  assert.deepEqual(applyNavbarShortcutPatch(current, null), current);
  assert.deepEqual(applyNavbarShortcutPatch(current, []), current);
  assert.notEqual(applyNavbarShortcutPatch(current, {}), current, "and the result is a copy");
});

test("a toggle survives being written and read back, per user", () => {
  const db = createDatabase();

  assert.deepEqual(writeNavbarShortcuts(db, 1, { worldMonitor: true }), {
    workTimer: true,
    worldMonitor: true,
    plan: true,
    map: false,
  });
  assert.deepEqual(readNavbarShortcuts(db, 1), {
    workTimer: true,
    worldMonitor: true,
    plan: true,
    map: false,
  });
  assert.deepEqual(
    readNavbarShortcuts(db, 2),
    DEFAULT_NAVBAR_SHORTCUTS,
    "one account's navbar is not another's",
  );

  // A second write updates the existing row rather than failing on the key.
  writeNavbarShortcuts(db, 1, { workTimer: false });
  assert.deepEqual(readNavbarShortcuts(db, 1), {
    workTimer: false,
    worldMonitor: true,
    plan: true,
    map: false,
  });

  writeNavbarShortcuts(db, 1, { worldMonitor: false });
  assert.deepEqual(readNavbarShortcuts(db, 1), {
    workTimer: false,
    worldMonitor: false,
    plan: true,
    map: false,
  });

  writeNavbarShortcuts(db, 1, { plan: false, map: true });
  assert.deepEqual(readNavbarShortcuts(db, 1), {
    workTimer: false,
    worldMonitor: false,
    plan: false,
    map: true,
  });
});

test("applying the schema twice is safe", () => {
  const db = createDatabase();
  writeNavbarShortcuts(db, 1, { workTimer: true });
  ensureNavbarShortcutSchema(db);
  assert.deepEqual(readNavbarShortcuts(db, 1), {
    workTimer: true,
    worldMonitor: false,
    plan: true,
    map: false,
  });
});

test("existing shortcut rows gain later entries without losing their choices", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
    INSERT INTO users (id, email) VALUES (1, 'a@x.com');
    CREATE TABLE navbar_shortcut_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      work_timer INTEGER NOT NULL DEFAULT 0,
      world_monitor INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO navbar_shortcut_settings (user_id, work_timer, world_monitor)
    VALUES (1, 0, 1);
  `);

  ensureNavbarShortcutSchema(db);
  assert.deepEqual(readNavbarShortcuts(db, 1), {
    workTimer: false,
    worldMonitor: true,
    plan: true,
    map: false,
  });
});
