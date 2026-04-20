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
ensureColumn("users", "username", "username TEXT");

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
