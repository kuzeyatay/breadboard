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

test("the work timer and Plan sit by default; the world monitor and Fast-read are asked for", () => {
  assert.deepEqual(DEFAULT_NAVBAR_SHORTCUTS, {
    workTimer: true,
    worldMonitor: false,
    plan: true,
    fastRead: false,
    buzz: false,
  });
  const db = createDatabase();
  assert.deepEqual(readNavbarShortcuts(db, 1), DEFAULT_NAVBAR_SHORTCUTS);
});

test("the catalog names exactly the keys the settings carry", () => {
  const keys = NAVBAR_SHORTCUTS.map((shortcut) => shortcut.key).sort();
  assert.deepEqual(keys, Object.keys(DEFAULT_NAVBAR_SHORTCUTS).sort());
  for (const shortcut of NAVBAR_SHORTCUTS) {
    assert.ok(isNavbarShortcutKey(shortcut.key));
    // A seat is either a page you can visit or a control with nowhere to go —
    // never a broken link.
    if (shortcut.href !== undefined) {
      assert.match(shortcut.href, /^\//, "a link points at an in-app page");
    }
    assert.ok(shortcut.label && shortcut.description, "with something to show in the toggle");
  }
  assert.equal(isNavbarShortcutKey("somethingElse"), false);
});

test("a patch only moves the keys it names, and only with booleans", () => {
  const current = {
    workTimer: true,
    worldMonitor: false,
    plan: true,
    fastRead: false,
    buzz: false,
  };

  assert.deepEqual(applyNavbarShortcutPatch(current, { worldMonitor: true }), {
    workTimer: true,
    worldMonitor: true,
    plan: true,
    fastRead: false,
    buzz: false,
  });
  assert.deepEqual(
    applyNavbarShortcutPatch(current, { map: true }),
    current,
    "the withdrawn map shortcut is no longer a key a patch can set",
  );
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
    fastRead: false,
    buzz: false,
  });
  assert.deepEqual(readNavbarShortcuts(db, 1), {
    workTimer: true,
    worldMonitor: true,
    plan: true,
    fastRead: false,
    buzz: false,
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
    fastRead: false,
    buzz: false,
  });

  writeNavbarShortcuts(db, 1, { worldMonitor: false });
  assert.deepEqual(readNavbarShortcuts(db, 1), {
    workTimer: false,
    worldMonitor: false,
    plan: true,
    fastRead: false,
    buzz: false,
  });

  writeNavbarShortcuts(db, 1, { plan: false });
  assert.deepEqual(readNavbarShortcuts(db, 1), {
    workTimer: false,
    worldMonitor: false,
    plan: false,
    fastRead: false,
    buzz: false,
  });

  writeNavbarShortcuts(db, 1, { fastRead: true });
  assert.deepEqual(readNavbarShortcuts(db, 1), {
    workTimer: false,
    worldMonitor: false,
    plan: false,
    fastRead: true,
    buzz: false,
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
    fastRead: false,
    buzz: false,
  });
});

test("a database from before the map shortcut was withdrawn still writes", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
    INSERT INTO users (id, email) VALUES (1, 'a@x.com');
    CREATE TABLE navbar_shortcut_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      work_timer INTEGER NOT NULL DEFAULT 0,
      world_monitor INTEGER NOT NULL DEFAULT 0,
      plan INTEGER NOT NULL DEFAULT 1,
      map_page INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO navbar_shortcut_settings (user_id, work_timer, world_monitor, plan, map_page)
    VALUES (1, 1, 0, 1, 1);
  `);

  ensureNavbarShortcutSchema(db);
  // The leftover column keeps its NOT NULL satisfied by its own default, and
  // the seat it used to grant is simply not read.
  assert.deepEqual(writeNavbarShortcuts(db, 1, { worldMonitor: true }), {
    workTimer: true,
    worldMonitor: true,
    plan: true,
    fastRead: false,
    buzz: false,
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
  // Each new seat arrives at its own default: Plan on, Fast-read off. The two
  // choices this account had already made are untouched.
  assert.deepEqual(readNavbarShortcuts(db, 1), {
    workTimer: false,
    worldMonitor: true,
    plan: true,
    fastRead: false,
    buzz: false,
  });

  // And the row still writes, now that the statement names a column the
  // original table never had.
  assert.deepEqual(writeNavbarShortcuts(db, 1, { fastRead: true }), {
    workTimer: false,
    worldMonitor: true,
    plan: true,
    fastRead: true,
    buzz: false,
  });
});
