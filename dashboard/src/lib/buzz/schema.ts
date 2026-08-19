// Storage for Buzz rooms — the multi-party chat surface.
//
// Why this is not `conversations`
// -------------------------------
// The canonical conversation store is deliberately two-party: `role` is
// `('user','assistant')`, `UNIQUE(conversation_id, order_index)` gives one
// strictly ordered spine, and `startConversationTurn` refuses a turn whose
// surface does not match its conversation. A Buzz room is none of those
// things — several agents and a person all post into one transcript, two
// agents can answer the same message, and a reply can hang off a thread
// rather than the spine. Forcing that shape into `conversation_messages`
// would mean rebuilding the CHECK constraints on the two hottest tables in
// the app, and would still leave the ordering invariants wrong.
//
// So the room transcript lives here and is the source of truth for what is
// displayed. What the room does *not* reimplement is the agent: when a member
// speaks, it thinks in an ordinary conversation via the ordinary turn
// pipeline, and its answer is copied back into `buzz_room_messages`. That
// keeps tools, memory, streaming, attachments and output scrubbing on the one
// code path they already have, and it is why `conversations` gains a single
// additive column below rather than a new surface value.

import type Database from "better-sqlite3";

export function ensureBuzzSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS buzz_rooms (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id        TEXT NOT NULL UNIQUE,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug             TEXT NOT NULL,
      name             TEXT NOT NULL,
      topic            TEXT NOT NULL DEFAULT '',
      purpose          TEXT NOT NULL DEFAULT '',
      kind             TEXT NOT NULL DEFAULT 'channel'
                       CHECK (kind IN ('channel','dm')),
      visibility       TEXT NOT NULL DEFAULT 'public'
                       CHECK (visibility IN ('public','private')),
      -- Archiving keeps a room's history readable while taking it out of the
      -- sidebar. Rooms are never silently destroyed by the UI.
      archived_at      TEXT,
      last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, slug)
    );

    CREATE INDEX IF NOT EXISTS idx_buzz_rooms_user_activity
      ON buzz_rooms(user_id, archived_at, last_activity_at DESC, id DESC);

    -- Who is in the room. A member is either the account itself or one agent
    -- persona from the org-chart roster; both post into the same transcript
    -- and are addressed the same way, which is the whole point of the model.
    CREATE TABLE IF NOT EXISTS buzz_room_members (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id         INTEGER NOT NULL REFERENCES buzz_rooms(id) ON DELETE CASCADE,
      kind            TEXT NOT NULL CHECK (kind IN ('human','agent')),
      user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
      persona_slug    TEXT,
      display_name    TEXT NOT NULL,
      handle          TEXT NOT NULL,
      accent          TEXT NOT NULL DEFAULT '#8839ef',
      -- When this member speaks unprompted. 'mention' is the default because a
      -- room with several always-on agents answers every message N times.
      respond_to      TEXT NOT NULL DEFAULT 'mention'
                      CHECK (respond_to IN ('always','mention','never')),
      model           TEXT,
      -- The private conversation this agent thinks in for this room. One per
      -- (room, member) so a persona keeps continuity in each room separately.
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
      muted           INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0, 1)),
      joined_at       TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(room_id, handle)
    );

    CREATE INDEX IF NOT EXISTS idx_buzz_room_members_room
      ON buzz_room_members(room_id, kind, joined_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_buzz_room_members_persona
      ON buzz_room_members(room_id, persona_slug)
      WHERE persona_slug IS NOT NULL;

    CREATE TABLE IF NOT EXISTS buzz_room_messages (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id           INTEGER NOT NULL REFERENCES buzz_rooms(id) ON DELETE CASCADE,
      client_message_id TEXT NOT NULL,
      member_id         INTEGER REFERENCES buzz_room_members(id) ON DELETE SET NULL,
      author_kind       TEXT NOT NULL CHECK (author_kind IN ('human','agent','system')),
      author_name       TEXT NOT NULL,
      author_handle     TEXT NOT NULL DEFAULT '',
      persona_slug      TEXT,
      body              TEXT NOT NULL DEFAULT '',
      -- NULL for a message on the channel spine; otherwise the root message
      -- whose thread this reply belongs to. Threads are one level deep, as
      -- they are upstream: a reply to a reply still hangs off the root.
      parent_id         INTEGER REFERENCES buzz_room_messages(id) ON DELETE CASCADE,
      status            TEXT NOT NULL DEFAULT 'complete'
                        CHECK (status IN ('pending','streaming','complete','failed','aborted')),
      -- Answering agents stream into their own row; this holds the run id so a
      -- reload can re-attach to a reply that is still being written.
      run_id            TEXT,
      metadata          TEXT,
      edited_at         TEXT,
      deleted_at        TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(room_id, client_message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_buzz_room_messages_spine
      ON buzz_room_messages(room_id, parent_id, id);
    CREATE INDEX IF NOT EXISTS idx_buzz_room_messages_thread
      ON buzz_room_messages(parent_id, id)
      WHERE parent_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_buzz_room_messages_live
      ON buzz_room_messages(room_id, status)
      WHERE status IN ('pending','streaming');

    CREATE TABLE IF NOT EXISTS buzz_room_reactions (
      message_id  INTEGER NOT NULL REFERENCES buzz_room_messages(id) ON DELETE CASCADE,
      member_id   INTEGER NOT NULL REFERENCES buzz_room_members(id) ON DELETE CASCADE,
      emoji       TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (message_id, member_id, emoji)
    );

    -- One read marker per person per room. Agents do not carry unread state:
    -- they are told what to read when they are asked to speak.
    CREATE TABLE IF NOT EXISTS buzz_room_reads (
      room_id              INTEGER NOT NULL REFERENCES buzz_rooms(id) ON DELETE CASCADE,
      user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_message_id INTEGER NOT NULL DEFAULT 0,
      updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (room_id, user_id)
    );
  `);

  // The seam that keeps an agent's private thinking out of the chat sidebar.
  // A conversation carrying a room id belongs to a Buzz member, not to the
  // account's own chat history, and `listConversationsForUser` filters on it.
  ensureColumn(
    database,
    "conversations",
    "buzz_room_id",
    "buzz_room_id INTEGER REFERENCES buzz_rooms(id) ON DELETE CASCADE",
  );
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_buzz_room
      ON conversations(buzz_room_id) WHERE buzz_room_id IS NOT NULL;
  `);
}

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (!columns.some((candidate) => candidate.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}
