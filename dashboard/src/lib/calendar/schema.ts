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
  `);
}
