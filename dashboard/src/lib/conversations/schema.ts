import crypto from "node:crypto";
import type Database from "better-sqlite3";

/**
 * Additive, repeatable migration for Breadboard-owned conversations.
 *
 * The legacy chat/runtime tables intentionally remain in place while clients
 * move to the canonical store.  Stable legacy bindings make the backfill safe
 * to run on every process start without copying a message twice.
 */
export function ensureConversationSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id                 TEXT NOT NULL UNIQUE,
      user_id                   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title                     TEXT NOT NULL,
      surface                   TEXT NOT NULL DEFAULT 'dashboard_terminal'
                                CHECK (surface IN ('dashboard_terminal','garden_chat','quartz_ai')),
      scope_kind                TEXT NOT NULL DEFAULT 'global'
                                CHECK (scope_kind IN ('global','garden','page')),
      default_garden_id         INTEGER REFERENCES clusters(id) ON DELETE SET NULL,
      active_agency_agent_slug  TEXT,
      legacy_chat_session_id    INTEGER UNIQUE,
      legacy_runtime_session_id INTEGER UNIQUE,
      next_order_index          INTEGER NOT NULL DEFAULT 0,
      created_at                TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
      ON conversations(user_id, updated_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id   INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      client_message_id TEXT NOT NULL,
      role              TEXT NOT NULL CHECK (role IN ('user','assistant')),
      surface           TEXT NOT NULL CHECK (surface IN ('dashboard_terminal','garden_chat','quartz_ai')),
      content           TEXT NOT NULL DEFAULT '',
      status            TEXT NOT NULL CHECK (status IN ('pending','complete','failed','aborted')),
      order_index       INTEGER NOT NULL,
      metadata          TEXT,
      sources           TEXT,
      token_usage       TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(conversation_id, client_message_id, role),
      UNIQUE(conversation_id, order_index)
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_messages_recent
      ON conversation_messages(conversation_id, order_index DESC);
    CREATE INDEX IF NOT EXISTS idx_conversation_messages_pending
      ON conversation_messages(conversation_id, status, role);

    CREATE TABLE IF NOT EXISTS conversation_memory_state (
      conversation_id          INTEGER PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      rolling_summary          TEXT NOT NULL DEFAULT '',
      working_state            TEXT NOT NULL DEFAULT '{}',
      summarized_through_order INTEGER NOT NULL DEFAULT -1,
      version                  INTEGER NOT NULL DEFAULT 0,
      updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS durable_memories (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      memory_key             TEXT,
      content                TEXT NOT NULL,
      kind                   TEXT NOT NULL
                             CHECK (kind IN ('preference','project_fact','decision','working_pattern')),
      scope                  TEXT NOT NULL CHECK (scope IN ('global','project','garden')),
      scope_id               TEXT,
      source_conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
      state                  TEXT NOT NULL DEFAULT 'candidate'
                             CHECK (state IN ('candidate','confirmed','superseded')),
      confidence             REAL NOT NULL DEFAULT 0.35 CHECK (confidence >= 0 AND confidence <= 1),
      salience               REAL NOT NULL DEFAULT 0.5 CHECK (salience >= 0 AND salience <= 1),
      created_at             TEXT NOT NULL DEFAULT (datetime('now')),
      last_confirmed_at      TEXT,
      superseded_at          TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_durable_memories_retrieval
      ON durable_memories(user_id, state, scope, scope_id, last_confirmed_at, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_durable_memories_active_key
      ON durable_memories(user_id, scope, COALESCE(scope_id, ''), memory_key)
      WHERE memory_key IS NOT NULL AND state <> 'superseded';

    CREATE TABLE IF NOT EXISTS conversation_schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  ensureColumn(database, "chat_sessions", "conversation_id", "conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL");
  ensureColumn(
    database,
    "conversations",
    "surface",
    "surface TEXT NOT NULL DEFAULT 'dashboard_terminal' CHECK (surface IN ('dashboard_terminal','garden_chat','quartz_ai'))",
  );
  ensureColumn(
    database,
    "conversations",
    "active_agency_agent_slug",
    "active_agency_agent_slug TEXT",
  );
  ensureColumn(database, "openharness_runtime_sessions", "conversation_id", "conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL");
  ensureColumn(database, "openharness_runtime_sessions", "allowed_garden_ids", "allowed_garden_ids TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(database, "chat_messages", "canonical_message_id", "canonical_message_id INTEGER REFERENCES conversation_messages(id) ON DELETE SET NULL");
  ensureColumn(database, "openharness_messages", "canonical_message_id", "canonical_message_id INTEGER REFERENCES conversation_messages(id) ON DELETE SET NULL");

  backfillLegacyConversations(database);

  // Older canonical conversations pre-date surface binding. Recover the
  // server-created surface from their runtime/message history once, then keep
  // it immutable at the request layer. This closes the former privilege
  // escalation where a Garden request could relabel its runtime as Terminal.
  database.exec(`
    UPDATE conversations
    SET surface = COALESCE(
      (SELECT ors.surface FROM openharness_runtime_sessions ors
       WHERE ors.conversation_id = conversations.id
       ORDER BY ors.updated_at DESC, ors.id DESC LIMIT 1),
      (SELECT cm.surface FROM conversation_messages cm
       WHERE cm.conversation_id = conversations.id
       ORDER BY cm.order_index ASC LIMIT 1),
      surface
    );
  `);

  database.exec(`
    UPDATE openharness_runtime_sessions
    SET allowed_garden_ids = '[' || cluster_id || ']'
    WHERE cluster_id IS NOT NULL
      AND (allowed_garden_ids IS NULL OR allowed_garden_ids = '' OR allowed_garden_ids = '[]');
  `);

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_sessions_conversation
      ON chat_sessions(conversation_id) WHERE conversation_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_openharness_runtime_conversation
      ON openharness_runtime_sessions(conversation_id) WHERE conversation_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_canonical
      ON chat_messages(canonical_message_id) WHERE canonical_message_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_openharness_messages_canonical
      ON openharness_messages(canonical_message_id) WHERE canonical_message_id IS NOT NULL;
    INSERT OR IGNORE INTO conversation_schema_migrations(version) VALUES (1);
  `);
}

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((candidate) => candidate.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

function opaqueConversationId(): string {
  return `conv_${crypto.randomBytes(18).toString("base64url")}`;
}

function backfillLegacyConversations(database: Database.Database): void {
  const migrate = database.transaction(() => {
    const legacySessions = database.prepare(`
      SELECT cs.id, cs.user_id, cs.cluster_id, cs.title, cs.created_at, cs.updated_at,
             cs.conversation_id
      FROM chat_sessions cs
      ORDER BY cs.id
    `).all() as Array<{
      id: number;
      user_id: number;
      cluster_id: number;
      title: string;
      created_at: string;
      updated_at: string;
      conversation_id: number | null;
    }>;

    for (const session of legacySessions) {
      let conversationId = session.conversation_id;
      if (!conversationId) {
        database.prepare(`
          INSERT OR IGNORE INTO conversations
            (public_id, user_id, title, scope_kind, default_garden_id,
             legacy_chat_session_id, created_at, updated_at)
          VALUES (?, ?, ?, 'garden', ?, ?, ?, ?)
        `).run(
          opaqueConversationId(),
          session.user_id,
          session.title || "New chat",
          session.cluster_id,
          session.id,
          session.created_at,
          session.updated_at,
        );
        conversationId = (database.prepare(
          "SELECT id FROM conversations WHERE legacy_chat_session_id = ?",
        ).get(session.id) as { id: number }).id;
        database.prepare("UPDATE chat_sessions SET conversation_id = ? WHERE id = ?")
          .run(conversationId, session.id);
      }

      const messages = database.prepare(`
        SELECT id, role, content, sources, token_usage, order_index, created_at,
               tool_calls, permission_decisions, runtime_error, runtime_status, proposal
        FROM chat_messages
        WHERE session_id = ?
        ORDER BY order_index, id
      `).all(session.id) as Array<Record<string, unknown>>;
      copyLegacyMessages(database, conversationId, messages, "garden_chat", `chat-${session.id}`);
    }

    const runtimes = database.prepare(`
      SELECT id, user_id, chat_session_id, surface, garden_id, cluster_id, runtime_metadata,
             created_at, updated_at, conversation_id
      FROM openharness_runtime_sessions
      ORDER BY updated_at DESC, id DESC
    `).all() as Array<{
      id: number;
      user_id: number | null;
      chat_session_id: number | null;
      surface: "dashboard_terminal" | "garden_chat" | "quartz_ai";
      garden_id: string | null;
      cluster_id: number | null;
      runtime_metadata: string | null;
      created_at: string;
      updated_at: string;
      conversation_id: number | null;
    }>;
    const claimed = new Set<number>();

    for (const runtime of runtimes) {
      // Anonymous Quartz remains deliberately outside private canonical memory.
      if (runtime.user_id === null) continue;

      let conversationId = runtime.conversation_id;
      if (!conversationId && runtime.chat_session_id !== null) {
        conversationId = (database.prepare(
          "SELECT conversation_id AS id FROM chat_sessions WHERE id = ?",
        ).get(runtime.chat_session_id) as { id: number | null } | undefined)?.id ?? null;
      }
      if (!conversationId) {
        const title = runtimeTitle(runtime.runtime_metadata);
        database.prepare(`
          INSERT OR IGNORE INTO conversations
            (public_id, user_id, title, scope_kind, default_garden_id,
             legacy_runtime_session_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          opaqueConversationId(),
          runtime.user_id,
          title,
          runtime.garden_id ? (runtime.surface === "quartz_ai" ? "page" : "garden") : "global",
          runtime.cluster_id,
          runtime.id,
          runtime.created_at,
          runtime.updated_at,
        );
        conversationId = (database.prepare(
          "SELECT id FROM conversations WHERE legacy_runtime_session_id = ?",
        ).get(runtime.id) as { id: number }).id;

        const messages = database.prepare(`
          SELECT id, role, content, sources, token_usage, order_index, created_at,
                 tool_calls, permission_decisions, runtime_error, runtime_status, proposal
          FROM openharness_messages
          WHERE runtime_session_id = ?
          ORDER BY order_index, id
        `).all(runtime.id) as Array<Record<string, unknown>>;
        copyLegacyMessages(database, conversationId, messages, runtime.surface, `runtime-${runtime.id}`);
      }

      // Old data can contain more than one runtime for a chat. The most recent
      // one wins; the others remain as audit/history rows without ownership.
      if (!claimed.has(conversationId)) {
        database.prepare("UPDATE openharness_runtime_sessions SET conversation_id = ? WHERE id = ?")
          .run(conversationId, runtime.id);
        claimed.add(conversationId);
      } else if (runtime.conversation_id === conversationId) {
        database.prepare("UPDATE openharness_runtime_sessions SET conversation_id = NULL WHERE id = ?")
          .run(runtime.id);
      }
    }
  });

  migrate.immediate();
}

function copyLegacyMessages(
  database: Database.Database,
  conversationId: number,
  messages: Array<Record<string, unknown>>,
  surface: "dashboard_terminal" | "garden_chat" | "quartz_ai",
  prefix: string,
): void {
  const existing = database.prepare(
    "SELECT COUNT(*) AS count FROM conversation_messages WHERE conversation_id = ?",
  ).get(conversationId) as { count: number };
  let nextOrder = existing.count === 0
    ? 0
    : (database.prepare(
        "SELECT COALESCE(MAX(order_index) + 1, 0) AS value FROM conversation_messages WHERE conversation_id = ?",
      ).get(conversationId) as { value: number }).value;

  for (const message of messages) {
    const metadata = legacyMetadata(message);
    const result = database.prepare(`
      INSERT OR IGNORE INTO conversation_messages
        (conversation_id, client_message_id, role, surface, content, status,
         order_index, metadata, sources, token_usage, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      conversationId,
      `legacy-${prefix}-${String(message.id)}`,
      message.role,
      surface,
      String(message.content ?? ""),
      legacyStatus(message),
      nextOrder,
      metadata,
      message.sources ?? null,
      message.token_usage ?? null,
      message.created_at,
      message.created_at,
    );
    const canonical = database.prepare(`
      SELECT id FROM conversation_messages
      WHERE conversation_id = ? AND client_message_id = ? AND role = ?
    `).get(
      conversationId,
      `legacy-${prefix}-${String(message.id)}`,
      message.role,
    ) as { id: number };
    if (prefix.startsWith("chat-")) {
      database.prepare("UPDATE chat_messages SET canonical_message_id = ? WHERE id = ?")
        .run(canonical.id, message.id);
    } else {
      database.prepare("UPDATE openharness_messages SET canonical_message_id = ? WHERE id = ?")
        .run(canonical.id, message.id);
    }
    if (result.changes > 0) nextOrder += 1;
  }

  database.prepare(`
    UPDATE conversations
    SET next_order_index = MAX(next_order_index, ?)
    WHERE id = ?
  `).run(nextOrder, conversationId);
  database.prepare(`
    INSERT OR IGNORE INTO conversation_memory_state(conversation_id)
    VALUES (?)
  `).run(conversationId);
}

function legacyStatus(message: Record<string, unknown>): "complete" | "failed" | "aborted" {
  if (message.runtime_status === "aborted") return "aborted";
  if (message.runtime_error) return "failed";
  return "complete";
}

function legacyMetadata(message: Record<string, unknown>): string | null {
  const metadata = {
    toolCalls: parseJson(message.tool_calls),
    permissionDecisions: parseJson(message.permission_decisions),
    runtimeError: message.runtime_error ?? null,
    runtimeStatus: message.runtime_status ?? null,
    proposal: parseJson(message.proposal),
    migrated: true,
  };
  return JSON.stringify(metadata);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function runtimeTitle(metadata: string | null): string {
  if (!metadata) return "New chat";
  try {
    const parsed = JSON.parse(metadata) as { title?: unknown };
    return typeof parsed.title === "string" && parsed.title.trim()
      ? parsed.title.trim()
      : "New chat";
  } catch {
    return "New chat";
  }
}
