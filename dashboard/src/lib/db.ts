import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "db", "brain.db");

// Singleton — prevents duplicate connections during Next.js hot-reloading in dev
const globalWithDb = global as typeof globalThis & { db?: Database.Database };

if (!globalWithDb.db) {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  globalWithDb.db = new Database(DB_PATH);
  globalWithDb.db.pragma("foreign_keys = ON");

  globalWithDb.db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      username     TEXT    UNIQUE NOT NULL,
      email        TEXT    UNIQUE NOT NULL,
      password_hash TEXT   NOT NULL,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      code               TEXT    UNIQUE NOT NULL,
      created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      used_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      used_at            TEXT
    );

    CREATE TABLE IF NOT EXISTS clusters (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      name        TEXT    NOT NULL,
      slug        TEXT    UNIQUE NOT NULL,
      description TEXT,
      visibility  TEXT    NOT NULL DEFAULT 'private',
      border_color TEXT   NOT NULL DEFAULT '#374151',
      card_width  INTEGER NOT NULL DEFAULT 392,
      card_height INTEGER NOT NULL DEFAULT 244,
      view_count  INTEGER NOT NULL DEFAULT 0,
      last_viewed_at TEXT,
      fork_allowed INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      cluster_id  INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role        TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
      content     TEXT    NOT NULL,
      sources     TEXT,
      token_usage TEXT,
      order_index INTEGER NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pdf_document_edits (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      cluster_id         INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
      document_slug      TEXT    NOT NULL,
      source_pdf_path    TEXT    NOT NULL,
      pdf_data           BLOB    NOT NULL,
      byte_length        INTEGER NOT NULL,
      updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(cluster_id, document_slug)
    );

    CREATE TABLE IF NOT EXISTS pdf_document_edit_history (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      cluster_id         INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
      document_slug      TEXT    NOT NULL,
      source_pdf_path    TEXT    NOT NULL,
      pdf_data           BLOB    NOT NULL,
      byte_length        INTEGER NOT NULL,
      saved_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      saved_at           TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_sessions_cluster_updated
      ON chat_sessions(cluster_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_order
      ON chat_messages(session_id, order_index);

    CREATE INDEX IF NOT EXISTS idx_pdf_document_edits_cluster_slug
      ON pdf_document_edits(cluster_id, document_slug);

    CREATE INDEX IF NOT EXISTS idx_pdf_document_edit_history_cluster_slug
      ON pdf_document_edit_history(cluster_id, document_slug, id DESC);
  `);
}

const db = globalWithDb.db;
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS invite_codes (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    code               TEXT    UNIQUE NOT NULL,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    used_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    used_at            TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_invite_codes_unused
    ON invite_codes(used_at, created_at);

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_id  INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role        TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
    content     TEXT    NOT NULL,
    sources     TEXT,
    token_usage TEXT,
    order_index INTEGER NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pdf_document_edits (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_id         INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    document_slug      TEXT    NOT NULL,
    source_pdf_path    TEXT    NOT NULL,
    pdf_data           BLOB    NOT NULL,
    byte_length        INTEGER NOT NULL,
    updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(cluster_id, document_slug)
  );

  CREATE TABLE IF NOT EXISTS pdf_document_edit_history (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_id         INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    document_slug      TEXT    NOT NULL,
    source_pdf_path    TEXT    NOT NULL,
    pdf_data           BLOB    NOT NULL,
    byte_length        INTEGER NOT NULL,
    saved_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    saved_at           TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_chat_sessions_cluster_updated
    ON chat_sessions(cluster_id, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_chat_messages_session_order
    ON chat_messages(session_id, order_index);

  CREATE INDEX IF NOT EXISTS idx_pdf_document_edits_cluster_slug
    ON pdf_document_edits(cluster_id, document_slug);

  CREATE INDEX IF NOT EXISTS idx_pdf_document_edit_history_cluster_slug
    ON pdf_document_edit_history(cluster_id, document_slug, id DESC);
`);

function ensureColumn(
  tableName: string,
  columnName: string,
  addColumnSql: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as {
    name: string;
  }[];
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${addColumnSql}`);
  }
}

ensureColumn(
  "clusters",
  "visibility",
  "visibility TEXT NOT NULL DEFAULT 'private'",
);
ensureColumn(
  "clusters",
  "border_color",
  "border_color TEXT NOT NULL DEFAULT '#374151'",
);
ensureColumn(
  "clusters",
  "card_width",
  "card_width INTEGER NOT NULL DEFAULT 392",
);
ensureColumn(
  "clusters",
  "card_height",
  "card_height INTEGER NOT NULL DEFAULT 244",
);
ensureColumn("clusters", "view_count", "view_count INTEGER NOT NULL DEFAULT 0");
ensureColumn("clusters", "last_viewed_at", "last_viewed_at TEXT");
ensureColumn(
  "clusters",
  "chat_accessible",
  "chat_accessible INTEGER NOT NULL DEFAULT 0",
);
ensureColumn(
  "clusters",
  "fork_allowed",
  "fork_allowed INTEGER NOT NULL DEFAULT 0",
);
ensureColumn("chat_messages", "token_usage", "token_usage TEXT");
// Virtual grouping of clusters into folders on the dashboard / garden overview.
ensureColumn("clusters", "folder", "folder TEXT");
ensureColumn("users", "username", "username TEXT");

// --- OpenHarness runtime integration ---------------------------------------
// The interactive surfaces (dashboard terminal, garden chat, Quartz page AI)
// are backed by the OpenHarness agent runtime. OpenHarness keeps its own
// runtime session state, but Breadboard remains the durable record of the
// user-visible conversation. These migrations extend the existing chat model
// rather than replacing it, and are all backward compatible (nullable columns
// + new tables), so existing sessions and messages stay valid.

// Per-runtime-session record linking a Breadboard chat_session (or a
// surface-scoped key) to an OpenHarness session. `chat_session_id` is nullable
// because Quartz page sessions may exist without a full chat_sessions row.
db.exec(`
  CREATE TABLE IF NOT EXISTS openharness_runtime_sessions (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    surface                TEXT    NOT NULL CHECK (surface IN ('dashboard_terminal','garden_chat','quartz_ai')),
    user_id                INTEGER REFERENCES users(id) ON DELETE CASCADE,
    chat_session_id        INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE,
    openharness_session_id TEXT,
    agent_name             TEXT    NOT NULL,
    cluster_id             INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
    garden_id              TEXT,
    page_slug              TEXT,
    workspace_key          TEXT    NOT NULL,
    runtime_metadata       TEXT,
    last_runtime_status    TEXT,
    created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at             TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_openharness_runtime_sessions_chat
    ON openharness_runtime_sessions(chat_session_id);
  CREATE INDEX IF NOT EXISTS idx_openharness_runtime_sessions_oh
    ON openharness_runtime_sessions(openharness_session_id);
  CREATE INDEX IF NOT EXISTS idx_openharness_runtime_sessions_surface_user
    ON openharness_runtime_sessions(surface, user_id);

  CREATE TABLE IF NOT EXISTS openharness_messages (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    runtime_session_id INTEGER NOT NULL REFERENCES openharness_runtime_sessions(id) ON DELETE CASCADE,
    role               TEXT    NOT NULL CHECK (role IN ('user','assistant')),
    content            TEXT    NOT NULL,
    sources            TEXT,
    token_usage        TEXT,
    tool_calls         TEXT,
    permission_decisions TEXT,
    runtime_error      TEXT,
    runtime_status     TEXT,
    proposal           TEXT,
    order_index        INTEGER NOT NULL,
    created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_openharness_messages_session_order
    ON openharness_messages(runtime_session_id, order_index);

  CREATE TABLE IF NOT EXISTS openharness_proposals (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_id         INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
    garden_id          TEXT    NOT NULL,
    surface            TEXT    NOT NULL,
    kind               TEXT    NOT NULL CHECK (kind IN ('note','page_revision','visualization')),
    page_slug          TEXT,
    rationale          TEXT,
    payload            TEXT    NOT NULL,
    evidence_anchors   TEXT,
    status             TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','rejected')),
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    runtime_session_id INTEGER REFERENCES openharness_runtime_sessions(id) ON DELETE SET NULL,
    created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    decided_at         TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_openharness_proposals_garden
    ON openharness_proposals(garden_id, status, created_at DESC);

  CREATE TABLE IF NOT EXISTS openharness_skill_audit (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_name     TEXT    NOT NULL,
    source_url     TEXT,
    version        TEXT,
    decision       TEXT    NOT NULL CHECK (decision IN ('quarantined','promoted','rejected')),
    decided_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    manifest       TEXT,
    notes          TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_openharness_skill_audit_name
    ON openharness_skill_audit(skill_name, created_at DESC);

  CREATE TABLE IF NOT EXISTS openharness_audit_events (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type         TEXT NOT NULL,
    runtime_session_id INTEGER REFERENCES openharness_runtime_sessions(id) ON DELETE SET NULL,
    user_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
    garden_id          TEXT,
    payload            TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_openharness_audit_events_session
    ON openharness_audit_events(runtime_session_id, created_at DESC);
`);

// Additional per-message runtime metadata. These are nullable so historical
// ChatMock-authored messages remain valid and readable.
ensureColumn("chat_messages", "tool_calls", "tool_calls TEXT");
ensureColumn("chat_messages", "permission_decisions", "permission_decisions TEXT");
ensureColumn("chat_messages", "runtime_error", "runtime_error TEXT");
ensureColumn("chat_messages", "runtime_status", "runtime_status TEXT");
// Whether a garden/quartz message carried a typed proposal (JSON payload).
ensureColumn("chat_messages", "proposal", "proposal TEXT");

// Persist cluster-group folders even while they contain no clusters yet.
db.exec(`
  CREATE TABLE IF NOT EXISTS cluster_folders (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name    TEXT    NOT NULL,
    UNIQUE(user_id, name)
  )
`);

function usernameBaseFromEmail(email: string): string {
  const localPart = email.split("@")[0] ?? "user";
  const base = localPart
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || "user";
}

function uniqueUsername(base: string, userId: number): string {
  let candidate = base;
  let counter = 2;

  while (
    db
      .prepare("SELECT 1 FROM users WHERE username = ? AND id <> ?")
      .get(candidate, userId)
  ) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }

  return candidate;
}

const usersMissingUsername = db
  .prepare(
    `SELECT id, email
     FROM users
     WHERE username IS NULL OR trim(username) = ''`,
  )
  .all() as { id: number; email: string }[];

for (const user of usersMissingUsername) {
  const username = uniqueUsername(usernameBaseFromEmail(user.email), user.id);
  db.prepare("UPDATE users SET username = ? WHERE id = ?").run(
    username,
    user.id,
  );
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
    ON users(username);

  CREATE INDEX IF NOT EXISTS idx_clusters_visibility_created
    ON clusters(visibility, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_clusters_visibility_popularity
    ON clusters(visibility, view_count DESC, created_at DESC);
`);

const initialInviteCode = process.env.SECOND_BRAIN_INITIAL_INVITE_CODE?.replace(
  /[^a-z0-9]/gi,
  "",
).toUpperCase();

if (initialInviteCode) {
  db.prepare(
    "INSERT OR IGNORE INTO invite_codes (code, created_at) VALUES (?, ?)",
  ).run(initialInviteCode, new Date().toISOString());
}

export default db;
