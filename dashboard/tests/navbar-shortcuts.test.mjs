// Which optional entries the navbar carries: the rules, and the per-user
// storage behind them, run against an in-memory database.

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import {
  DEFAULT_NAVBAR_FLOWERS,
  DEFAULT_NAVBAR_SHORTCUTS,
  NAVBAR_SHORTCUTS,
  applyNavbarShortcutPatch,
  ensureNavbarShortcutSchema,
  isNavbarShortcutKey,
  readNavbarFlowers,
  readNavbarShortcuts,
  writeNavbarFlowers,
  writeNavbarShortcuts,
} from "../src/lib/profile/navbar-shortcuts.ts";

function createDatabase() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);");
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@x.com'), (2, 'b@x.com')").run();
  ensureNavbarShortcutSchema(db);
  return db;
}

test("the work timer, Clicky and Plan sit by default; Buzz and Fast-read are asked for", () => {
  assert.equal(DEFAULT_NAVBAR_FLOWERS, true);
  assert.deepEqual(DEFAULT_NAVBAR_SHORTCUTS, {
    workTimer: true,
    browser: true,
    clicky: true,
    voice: false,
    plan: true,
    fastRead: false,
    buzz: false,
  });
  const db = createDatabase();
  assert.deepEqual(readNavbarShortcuts(db, 1), DEFAULT_NAVBAR_SHORTCUTS);
  assert.equal(readNavbarFlowers(db, 1), true);
});

test("flowers can be hidden without moving any navbar shortcuts", () => {
  const db = createDatabase();

  assert.equal(writeNavbarFlowers(db, 1, false), false);
  assert.equal(readNavbarFlowers(db, 1), false);
  assert.deepEqual(readNavbarShortcuts(db, 1), DEFAULT_NAVBAR_SHORTCUTS);
  assert.equal(readNavbarFlowers(db, 2), true, "the preference stays with its account");

  writeNavbarShortcuts(db, 1, { buzz: true });
  assert.equal(readNavbarFlowers(db, 1), false, "shortcut changes preserve the decoration choice");
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
    browser: true,
    clicky: true,
    voice: false,
    plan: true,
    fastRead: false,
    buzz: false,
  };

  assert.deepEqual(applyNavbarShortcutPatch(current, { buzz: true }), {
    workTimer: true,
    browser: true,
    clicky: true,
    voice: false,
    plan: true,
    fastRead: false,
    buzz: true,
  });
  assert.deepEqual(
    applyNavbarShortcutPatch(current, { map: true, worldMonitor: true }),
    current,
    "the withdrawn map and world monitor shortcuts are no longer keys a patch can set",
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

  assert.deepEqual(writeNavbarShortcuts(db, 1, { buzz: true }), {
    workTimer: true,
    browser: true,
    clicky: true,
    voice: false,
    plan: true,
    fastRead: false,
    buzz: true,
  });
  assert.equal(readNavbarFlowers(db, 1), true, "saving a shortcut keeps the default decoration");
  assert.deepEqual(readNavbarShortcuts(db, 1), {
    workTimer: true,
    browser: true,
    clicky: true,
    voice: false,
    plan: true,
    fastRead: false,
    buzz: true,
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
    browser: true,
    clicky: true,
    voice: false,
    plan: true,
    fastRead: false,
    buzz: true,
  });

  writeNavbarShortcuts(db, 1, { buzz: false });
  assert.deepEqual(readNavbarShortcuts(db, 1), {
    workTimer: false,
    browser: true,
    clicky: true,
    voice: false,
    plan: true,
    fastRead: false,
    buzz: false,
  });

  writeNavbarShortcuts(db, 1, { plan: false });
  assert.deepEqual(readNavbarShortcuts(db, 1), {
    workTimer: false,
    browser: true,
    clicky: true,
    voice: false,
    plan: false,
    fastRead: false,
    buzz: false,
  });

  writeNavbarShortcuts(db, 1, { fastRead: true });
  assert.deepEqual(readNavbarShortcuts(db, 1), {
    workTimer: false,
    browser: true,
    clicky: true,
    voice: false,
    plan: false,
    fastRead: true,
    buzz: false,
  });

  writeNavbarShortcuts(db, 1, { clicky: false });
  assert.deepEqual(readNavbarShortcuts(db, 1), {
    workTimer: false,
    browser: true,
    clicky: false,
    voice: false,
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
    browser: true,
    clicky: true,
    voice: false,
    plan: true,
    fastRead: false,
    buzz: false,
  });
});

test('Voice can be shown in the navbar independently of other shortcuts and appearance', () => {
  const db = createDatabase();
  try {
    assert.equal(readNavbarShortcuts(db, 1).voice, false);
    assert.equal(writeNavbarShortcuts(db, 1, { voice: true }).voice, true);
    writeNavbarFlowers(db, 1, false);
    assert.equal(readNavbarShortcuts(db, 1).voice, true);
    assert.equal(readNavbarShortcuts(db, 2).voice, false);
    assert.equal(writeNavbarShortcuts(db, 1, { voice: false }).voice, false);
    assert.equal(NAVBAR_SHORTCUTS.find(item => item.key === 'voice').label, 'Voice');
  } finally { db.close(); }
});

test("a database from before those shortcuts were withdrawn still writes", () => {
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
    VALUES (1, 1, 1, 1, 1);
  `);

  ensureNavbarShortcutSchema(db);
  // The leftover columns keep their NOT NULL satisfied by their own defaults,
  // and the seats they used to grant are simply not read.
  assert.deepEqual(writeNavbarShortcuts(db, 1, { buzz: true }), {
    workTimer: true,
    browser: true,
    clicky: true,
    voice: false,
    plan: true,
    fastRead: false,
    buzz: true,
  });
  assert.equal(readNavbarFlowers(db, 1), true, "older rows gain flowers without opting out");
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
  // Each new seat arrives at its own default: Plan on, Fast-read off. The
  // choice this account had already made about the work timer is untouched.
  assert.deepEqual(readNavbarShortcuts(db, 1), {
    workTimer: false,
    browser: true,
    clicky: true,
    voice: false,
    plan: true,
    fastRead: false,
    buzz: false,
  });
  assert.equal(readNavbarFlowers(db, 1), true, "the new appearance setting keeps its default");

  // And the row still writes, now that the statement names a column the
  // original table never had.
  assert.deepEqual(writeNavbarShortcuts(db, 1, { fastRead: true }), {
    workTimer: false,
    browser: true,
    clicky: true,
    voice: false,
    plan: true,
    fastRead: true,
    buzz: false,
  });
});
