// Socials Manager persistence: the social channels a user has registered, and the posts
// the agent drafts for them.
//
// Additive and applied with CREATE TABLE IF NOT EXISTS, matching the repo's
// migration style, and taking an injected handle so the store can be unit tested
// against an in-memory SQLite database.
//
// Times are wall-clock strings ("YYYY-MM-DDTHH:MM") for the same reason the
// calendar uses them — a post's publish slot is a slot on a wall, and the two
// tables have to compare without a timezone round-trip. See
// ../calendar/wallclock.ts.
//
// `calendar_event_id` is the whole point of the join: a scheduled post owns a
// real row in calendar_events, so it shows up in Breadboard's calendar rather
// than in a private Postiz-shaped copy of one. ON DELETE SET NULL means removing
// the calendar entry unschedules the post instead of destroying the draft.

import type DatabaseType from "better-sqlite3";

type Db = DatabaseType.Database;

/**
 * The tables were called `postiz_channels` / `postiz_posts` while the agent was
 * called Postiz. They are renamed in place rather than recreated, because every
 * scheduled post in them is joined to a live row in `calendar_events` — a fresh
 * empty table would leave those events pointing at nothing and quietly lose
 * every draft the user has not published yet.
 *
 * Runs before the CREATE statements below so they find the renamed tables and
 * do nothing, and is a no-op on a database that never had the old names.
 */
function renameLegacyTables(db: Db): void {
  const named = (name: string): boolean =>
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined;

  for (const [from, to] of [
    ["postiz_channels", "socials_manager_channels"],
    ["postiz_posts", "socials_manager_posts"],
  ]) {
    if (named(from) && !named(to)) db.exec(`ALTER TABLE ${from} RENAME TO ${to}`);
  }

  // SQLite carries indexes across a table rename under their old names, which
  // would make the CREATE INDEX statements below build a second set over the
  // same columns. Dropping them first keeps one index per lookup.
  for (const index of [
    "idx_postiz_channels_identity",
    "idx_postiz_posts_user_schedule",
    "idx_postiz_posts_run",
    "idx_postiz_posts_calendar_event",
  ]) {
    db.exec(`DROP INDEX IF EXISTS ${index}`);
  }
}

export function ensureSocialsManagerSchema(db: Db): void {
  renameLegacyTables(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS socials_manager_channels (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider_id TEXT    NOT NULL,
      handle      TEXT    NOT NULL,
      display_name TEXT   NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_socials_manager_channels_identity
      ON socials_manager_channels(user_id, provider_id, handle);

    CREATE TABLE IF NOT EXISTS socials_manager_posts (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      run_id            TEXT,
      provider_id       TEXT    NOT NULL,
      channel_id        INTEGER REFERENCES socials_manager_channels(id) ON DELETE SET NULL,
      content           TEXT    NOT NULL,
      status            TEXT    NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','scheduled','published','failed','cancelled')),
      scheduled_at      TEXT,
      published_at      TEXT,
      calendar_event_id INTEGER REFERENCES calendar_events(id) ON DELETE SET NULL,
      artifact_id       TEXT,
      -- The image artifact published with the copy. Deliberately not a foreign
      -- key: artifacts live in their own store and deleting one must unschedule
      -- nothing, so a stale id is resolved (and cleared) at read time.
      image_artifact_id TEXT,
      -- The post's id inside the real Postiz stack, when one owns it. Null means
      -- this row is a local-only draft made while the stack was unavailable.
      remote_id         TEXT,
      error             TEXT,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_socials_manager_posts_user_schedule
      ON socials_manager_posts(user_id, scheduled_at);

    CREATE INDEX IF NOT EXISTS idx_socials_manager_posts_run
      ON socials_manager_posts(run_id);

    CREATE INDEX IF NOT EXISTS idx_socials_manager_posts_calendar_event
      ON socials_manager_posts(calendar_event_id);
  `);

  // Additive columns for databases created before the real stack was supported
  // (remote_id) and before posts could carry artwork (image_artifact_id).
  const columns = db
    .prepare(`PRAGMA table_info(socials_manager_posts)`)
    .all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "remote_id")) {
    db.exec(`ALTER TABLE socials_manager_posts ADD COLUMN remote_id TEXT`);
  }
  if (!columns.some((column) => column.name === "image_artifact_id")) {
    db.exec(`ALTER TABLE socials_manager_posts ADD COLUMN image_artifact_id TEXT`);
  }
}
