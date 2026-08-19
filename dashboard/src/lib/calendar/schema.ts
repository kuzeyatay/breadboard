// Calendar persistence: named calendars, their events, and the attendees on
// those events.
//
// Additive and applied with CREATE TABLE IF NOT EXISTS, matching the repo's
// migration style, and taking an injected handle so the store can be unit
// tested against an in-memory SQLite database.
//
// Times are stored as timezone-free wall-clock strings ("YYYY-MM-DDTHH:MM")
// rather than epoch numbers: they sort correctly as text, they survive a
// machine changing timezone, and they are what the UI renders. See
// ./wallclock.ts for the reasoning.
//
// `calendar_events` is referenced by socials_manager_posts.calendar_event_id, so columns
// added after the first release are applied with ALTER TABLE rather than by
// recreating the table — dropping and rebuilding it would break that foreign
// key and silently unschedule every social post.

import type DatabaseType from "better-sqlite3";

type Db = DatabaseType.Database;

interface ColumnPatch {
  table: string;
  column: string;
  /** Everything after the column name. Must default to NULL or carry a DEFAULT. */
  definition: string;
}

/**
 * Columns added after the first release. SQLite has no `ADD COLUMN IF NOT
 * EXISTS`, so each is probed with `PRAGMA table_info` first. A column with a
 * REFERENCES clause must default to NULL, which every one of these does.
 */
const COLUMN_PATCHES: readonly ColumnPatch[] = [
  // --- per-instance edits of a recurring series -----------------------------
  // An override is a normal event row that names the master it replaces and the
  // occurrence it stands in for, so it can be moved, retitled or recoloured
  // without touching its siblings.
  {
    table: "calendar_events",
    column: "parent_event_id",
    definition: "INTEGER REFERENCES calendar_events(id) ON DELETE CASCADE",
  },
  {
    table: "calendar_events",
    column: "recurrence_id",
    definition: "TEXT",
  },
  // JSON array of occurrence starts removed from a master ("delete just this
  // one"). iCalendar calls these EXDATEs.
  {
    table: "calendar_events",
    column: "excluded_dates",
    definition: "TEXT",
  },

  // --- iCalendar identity ---------------------------------------------------
  // A stable UID lets an export/import round trip update events instead of
  // duplicating them, and lets a subscription refresh match rows it already has.
  { table: "calendar_events", column: "uid", definition: "TEXT" },
  { table: "calendar_events", column: "organizer_email", definition: "TEXT" },
  { table: "calendar_events", column: "organizer_name", definition: "TEXT" },

  // --- subscribed (read-only) calendars ------------------------------------
  { table: "calendar_collections", column: "source_url", definition: "TEXT" },
  {
    table: "calendar_collections",
    column: "read_only",
    definition: "INTEGER NOT NULL DEFAULT 0",
  },
  { table: "calendar_collections", column: "last_synced_at", definition: "TEXT" },
  { table: "calendar_collections", column: "sync_error", definition: "TEXT" },

  // --- two-way CalDAV -------------------------------------------------------
  // A subscribed calendar mirrors an ICS document over GET (`source_url`); a
  // CalDAV calendar is bound to a *collection* it can also write back to, and
  // that is a different thing, so it gets its own column rather than
  // overloading the one that means "read-only mirror".
  { table: "calendar_collections", column: "caldav_url", definition: "TEXT" },
  // The account name, kept for the UI. The password lives sealed in
  // calendar_caldav_credentials and never on this row.
  { table: "calendar_collections", column: "caldav_username", definition: "TEXT" },
  // The collection tag as of the last successful sync. Unchanged ctag means
  // nothing in the collection moved, and the whole listing step can be skipped.
  { table: "calendar_collections", column: "caldav_ctag", definition: "TEXT" },
  // Consecutive failed syncs, which the background poller turns into a backoff.
  // Reset to zero the moment one succeeds. Without it, a calendar whose password
  // was revoked is retried every few minutes forever.
  {
    table: "calendar_collections",
    column: "caldav_failures",
    definition: "INTEGER NOT NULL DEFAULT 0",
  },
  // Held while a sync is in flight, as an ISO instant. Two processes can share
  // this database — the desktop app and a dev server — and two syncs of one
  // calendar at once would have the second one's writes refused as conflicts,
  // which resolves by discarding a local edit. The lease makes that impossible.
  { table: "calendar_collections", column: "caldav_lease_until", definition: "TEXT" },

  // Where this event lives on the server, and which version we hold. The etag
  // is what makes a write safe: it is sent back as If-Match, so a PUT that
  // would overwrite someone else's newer edit is refused by the server instead.
  { table: "calendar_events", column: "remote_href", definition: "TEXT" },
  { table: "calendar_events", column: "remote_etag", definition: "TEXT" },
  // Set by trigger on every local write, cleared once the change has been sent.
  // A flag rather than a timestamp comparison because `updated_at` has
  // one-second resolution, and an edit made in the same second as a push must
  // not be mistaken for the push's own write.
  {
    table: "calendar_events",
    column: "remote_dirty",
    definition: "INTEGER NOT NULL DEFAULT 0",
  },
];

function addMissingColumns(db: Db): void {
  for (const patch of COLUMN_PATCHES) {
    const columns = db.prepare(`PRAGMA table_info(${patch.table})`).all() as {
      name: string;
    }[];
    if (columns.some((column) => column.name === patch.column)) continue;
    db.exec(
      `ALTER TABLE ${patch.table} ADD COLUMN ${patch.column} ${patch.definition}`,
    );
  }
}

export function ensureCalendarSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_collections (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name           TEXT    NOT NULL,
      color          TEXT    NOT NULL DEFAULT '#4f6f68',
      visible        INTEGER NOT NULL DEFAULT 1,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      source_url     TEXT,
      read_only      INTEGER NOT NULL DEFAULT 0,
      last_synced_at TEXT,
      sync_error     TEXT,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_collections_user
      ON calendar_collections(user_id, sort_order, id);

    CREATE TABLE IF NOT EXISTS calendar_events (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      calendar_id         INTEGER NOT NULL REFERENCES calendar_collections(id) ON DELETE CASCADE,
      title               TEXT    NOT NULL,
      description         TEXT,
      location            TEXT,
      all_day             INTEGER NOT NULL DEFAULT 0,
      starts_at           TEXT    NOT NULL,
      ends_at             TEXT    NOT NULL,
      recurrence          TEXT    NOT NULL DEFAULT 'none'
                            CHECK (recurrence IN ('none','daily','weekly','monthly','yearly')),
      recurrence_interval INTEGER NOT NULL DEFAULT 1,
      recurrence_until    TEXT,
      recurrence_count    INTEGER,
      parent_event_id     INTEGER REFERENCES calendar_events(id) ON DELETE CASCADE,
      recurrence_id       TEXT,
      excluded_dates      TEXT,
      uid                 TEXT,
      organizer_email     TEXT,
      organizer_name      TEXT,
      created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_events_user_range
      ON calendar_events(user_id, starts_at);

    CREATE INDEX IF NOT EXISTS idx_calendar_events_calendar
      ON calendar_events(calendar_id);

    CREATE TABLE IF NOT EXISTS calendar_event_attendees (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id   INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
      email      TEXT    NOT NULL,
      name       TEXT,
      role       TEXT    NOT NULL DEFAULT 'required'
                   CHECK (role IN ('required','optional','chair')),
      status     TEXT    NOT NULL DEFAULT 'needs-action'
                   CHECK (status IN ('needs-action','accepted','declined','tentative')),
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(event_id, email)
    );
  `);

  addMissingColumns(db);

  // Created after the patch pass: on an existing database the columns they
  // cover do not exist until ALTER TABLE has run.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_calendar_events_series
      ON calendar_events(parent_event_id, recurrence_id);

    CREATE INDEX IF NOT EXISTS idx_calendar_events_uid
      ON calendar_events(user_id, uid);

    CREATE INDEX IF NOT EXISTS idx_calendar_event_attendees_event
      ON calendar_event_attendees(event_id);

    CREATE INDEX IF NOT EXISTS idx_calendar_events_remote
      ON calendar_events(calendar_id, remote_href);

    -- A deleted event leaves nothing behind to sync from, so the address of
    -- the thing to delete on the server is recorded before the row goes. The
    -- alternative is remembering to write one of these at all five places that
    -- can delete an event — including the cascade when a recurring master takes
    -- its overrides with it — which is exactly the kind of bookkeeping that
    -- gets forgotten in the sixth place.
    -- The password for a bound collection, sealed by src/lib/calendar/
    -- caldav-credentials.ts. Its own table, keyed by the calendar it unlocks,
    -- so that dropping the calendar drops the secret with it and no ordinary
    -- read of calendar_collections can ever return ciphertext by accident.
    CREATE TABLE IF NOT EXISTS calendar_caldav_credentials (
      calendar_id     INTEGER PRIMARY KEY
                        REFERENCES calendar_collections(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL,
      encrypted_value TEXT    NOT NULL,
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calendar_remote_tombstones (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      calendar_id INTEGER NOT NULL,
      href        TEXT    NOT NULL,
      etag        TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_tombstones_href
      ON calendar_remote_tombstones(user_id, href);

    CREATE TRIGGER IF NOT EXISTS trg_calendar_events_tombstone
    AFTER DELETE ON calendar_events
    WHEN OLD.remote_href IS NOT NULL
    BEGIN
      INSERT OR IGNORE INTO calendar_remote_tombstones (user_id, calendar_id, href, etag)
      VALUES (OLD.user_id, OLD.calendar_id, OLD.remote_href, OLD.remote_etag);
    END;

    -- Any local write marks the event as owing the server a copy. An event
    -- arriving *from* the server is inserted with its href already set, which
    -- is how the pull half avoids marking everything it just downloaded as
    -- something to upload again.
    CREATE TRIGGER IF NOT EXISTS trg_calendar_events_dirty_insert
    AFTER INSERT ON calendar_events
    WHEN NEW.remote_href IS NULL AND NEW.remote_dirty = 0
    BEGIN
      UPDATE calendar_events SET remote_dirty = 1 WHERE id = NEW.id;
    END;

    -- Guarded so it cannot chase its own tail: it fires only when the flag was
    -- clean and stayed clean, which is never true of the update it makes itself
    -- or of the one that clears the flag after a successful push.
    CREATE TRIGGER IF NOT EXISTS trg_calendar_events_dirty_update
    AFTER UPDATE ON calendar_events
    WHEN NEW.remote_dirty = 0 AND OLD.remote_dirty = 0
    BEGIN
      UPDATE calendar_events SET remote_dirty = 1 WHERE id = NEW.id;
    END;
  `);
}
