import type Database from "better-sqlite3";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { ensureVideoTranscriptionSchema } from "./scriberr/job-store.ts";
import { ensureBuzzSchema } from "./buzz/schema.ts";
import { databaseDir } from "./runtime-paths.ts";
import { ensureConversationSchema } from "./conversations/schema.ts";
import { ensureDocumentSkillSchema } from "./document-skills/schema.ts";
import { ensureOrganizationSchema } from "./organizations/schema.ts";
import { ensureArtifactSchema } from "./hermes/artifact-schema.ts";
import { ensureGBrainSchema } from "./gbrain/schema.ts";
import { ensureThoughtTopologySchema } from "./thought-topology/schema.ts";
import { ensureMem0Schema } from "./mem0/schema.ts";
import { ensureMemoryTreeSchema } from "./memory-tree/schema.ts";
import { ensureUITarsSchema } from "./ui-tars/schema.ts";
import { ensureAgentBrowserSchema } from "./agent-browser/schema.ts";
import { ensureCadSchema } from "./cad/schema.ts";
import { ensureAgentSettingsSchema } from "./agent-settings/schema.ts";
import { ensureNangoSchema } from "./nango/schema.ts";
import { ensureScheduledChatSchema } from "./schedules/schema.ts";
import { ensureWorkflowSchema } from "./workflows/schema.ts";
import { ensureTeachSchema } from "./teach/schema.ts";
import { ensureCalendarSchema } from "./calendar/schema.ts";
import { ensureContactSchema } from "./contacts/schema.ts";
import { ensurePlanSchema } from "./plan/schema.ts";
import { ensureMapSchema } from "./map/schema.ts";
import { ensureSocialsManagerSchema } from "./socials-manager/schema.ts";
import { ensureTelegramSchema } from "./telegram/schema.ts";
import { ensureEmailSchema } from "./email/schema.ts";
import { ensureWhatsAppSchema } from "./whatsapp/schema.ts";
import { ensureReviewSchema } from "./review/schema.ts";
import { ensureMcpOAuthSchema } from "./hermes/mcp-oauth-schema.ts";
import { ensureSpotifySchema } from "./spotify/schema.ts";
import { configureSqliteConcurrency } from "./sqlite-concurrency.ts";
import {
  externalRuntimeFilesystem as fs,
  externalRuntimePathExists,
} from "./external-runtime-filesystem.ts";
import { openRuntimeSqliteDatabase } from "./runtime-sqlite-database.ts";

const DB_ROOT = databaseDir();
const DB_PATH = path.join(DB_ROOT, "brain.db");

// Singleton — prevents duplicate connections during Next.js hot-reloading in dev
const globalWithDb = global as typeof globalThis & { db?: Database.Database };
let databaseOpenedHere = false;

if (!globalWithDb.db) {
  const dbDir = path.dirname(DB_PATH);
  if (!externalRuntimePathExists(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  globalWithDb.db = openRuntimeSqliteDatabase({
    authorityRoot: DB_ROOT,
    candidate: DB_PATH,
    filename: "brain.db",
  });
  databaseOpenedHere = true;
  configureSqliteConcurrency(globalWithDb.db);
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
      repo_path   TEXT,
      graft_enabled INTEGER NOT NULL DEFAULT 1,
      thought_topology_enabled INTEGER NOT NULL DEFAULT 1 CHECK (thought_topology_enabled IN (0, 1)),
      thought_topology_revision INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      cluster_id  INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT    NOT NULL,
      history_surface TEXT NOT NULL DEFAULT 'garden_chat',
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
// Hot reload can reuse the process-global handle without re-entering the
// constructor branch. Reapply connection-local settings and verify the
// persistent journal mode in that case as well.
if (!databaseOpenedHere) configureSqliteConcurrency(db);
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
    history_surface TEXT NOT NULL DEFAULT 'garden_chat',
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

/**
 * Preserve installations created before Hermes became Breadboard's sole
 * runtime identity. SQLite updates foreign-key references when a table is
 * renamed, so this migration keeps every session, message, capability grant,
 * and artifact in place.
 */
function migrateLegacyRuntimeSchema(database: Database.Database): void {
  const legacyPrefix = ["open", "harness"].join("");
  const tableSuffixes = [
    "runtime_sessions",
    "capability_decisions",
    "messages",
    "proposals",
    "skill_audit",
    "audit_events",
    "user_settings",
    "prompts",
    "mcp_connections",
    "filesystem_grants",
    "runs",
    "steer_requests",
    "artifacts",
    "artifact_versions",
    "artifact_events",
    "artifact_provenance",
    "interactive_visualizers",
    "interactive_visualizer_jobs",
  ] as const;
  const tableExists = (name: string) =>
    Boolean(
      database
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(name),
    );
  const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

  // IMMEDIATE, not the default deferred: this migration reads before it writes,
  // and SQLite refuses that read-to-write upgrade with SQLITE_BUSY straight
  // away — the busy timeout never applies. Taking the write lock up front is
  // what lets a second process wait its turn instead of crashing on startup.
  const migrate = database.transaction(() => {
    for (const suffix of tableSuffixes) {
      const legacyName = `${legacyPrefix}_${suffix}`;
      const hermesName = `hermes_${suffix}`;
      if (tableExists(legacyName) && !tableExists(hermesName)) {
        database.exec(
          `ALTER TABLE ${quoteIdentifier(legacyName)} RENAME TO ${quoteIdentifier(hermesName)}`,
        );
      }
    }

    if (tableExists("hermes_runtime_sessions")) {
      const legacySessionColumn = `${legacyPrefix}_session_id`;
      const columns = database
        .prepare("PRAGMA table_info(hermes_runtime_sessions)")
        .all() as { name: string }[];
      if (
        columns.some((column) => column.name === legacySessionColumn) &&
        !columns.some((column) => column.name === "hermes_session_id")
      ) {
        database.exec(
          `ALTER TABLE hermes_runtime_sessions RENAME COLUMN ${quoteIdentifier(legacySessionColumn)} TO hermes_session_id`,
        );
      }
      const runtimeColumns = database
        .prepare("PRAGMA table_info(hermes_runtime_sessions)")
        .all() as { name: string }[];
      if (runtimeColumns.some((column) => column.name === "runtime_kind")) {
        database
          .prepare(
            `UPDATE hermes_runtime_sessions SET runtime_kind = 'hermes' WHERE runtime_kind = ?`,
          )
          .run(legacyPrefix);
      }
    }

    if (tableExists("hermes_artifacts")) {
      const artifactColumns = database
        .prepare("PRAGMA table_info(hermes_artifacts)")
        .all() as { name: string }[];
      const artifactColumnNames = new Set(
        artifactColumns.map((column) => column.name),
      );
      const artifactRenames = [
        [`${legacyPrefix}_session_id`, "hermes_session_id"],
        [`source_${legacyPrefix}_tool`, "source_hermes_tool"],
      ] as const;
      for (const [legacyColumn, hermesColumn] of artifactRenames) {
        if (
          artifactColumnNames.has(legacyColumn) &&
          !artifactColumnNames.has(hermesColumn)
        ) {
          database.exec(
            `ALTER TABLE hermes_artifacts RENAME COLUMN ${quoteIdentifier(legacyColumn)} TO ${quoteIdentifier(hermesColumn)}`,
          );
          artifactColumnNames.delete(legacyColumn);
          artifactColumnNames.add(hermesColumn);
        }
      }
    }

    const legacyIndexes = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE ?",
      )
      .all(`idx_${legacyPrefix}_%`) as { name: string }[];
    for (const { name } of legacyIndexes) {
      database.exec(`DROP INDEX IF EXISTS ${quoteIdentifier(name)}`);
    }
  });
  migrate.immediate();
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
ensureColumn("clusters", "repo_path", "repo_path TEXT");
// On by default: the coding agents in this garden (Codex, OpenCode, Ruflo) get
// the graft code index of the connected repository as an MCP server. See
// src/lib/code-index/garden.ts.
ensureColumn(
  "clusters",
  "graft_enabled",
  "graft_enabled INTEGER NOT NULL DEFAULT 1",
);
// Set together with visibility = 'organization': which organization the garden
// is shared with. Null for every other visibility.
ensureColumn("clusters", "organization_id", "organization_id INTEGER");
// Per-garden standing instructions, appended to the system prompt of every turn
// in this garden. See src/lib/hermes/garden-chat-adapter.ts.
ensureColumn(
  "clusters",
  "instructions",
  "instructions TEXT NOT NULL DEFAULT ''",
);
// 'default' | 'garden_only'. Garden-only makes this garden's durable memories
// invisible to chats elsewhere, and hides everything else from chats here — the
// filter lives in retrieveDurableMemories (src/lib/conversations/memory.ts).
ensureColumn(
  "clusters",
  "memory_scope",
  "memory_scope TEXT NOT NULL DEFAULT 'default'",
);
ensureColumn("chat_messages", "token_usage", "token_usage TEXT");
// The garden workspace and its floating Assistant use the same legacy message
// transport, but their recents are separate products. Existing rows remain
// Garden Chat history; new Assistant rows opt into their own rail explicitly.
ensureColumn(
  "chat_sessions",
  "history_surface",
  "history_surface TEXT NOT NULL DEFAULT 'garden_chat'",
);
// Virtual grouping of clusters into folders on the dashboard / garden overview.
ensureColumn("clusters", "folder", "folder TEXT");
ensureColumn("users", "username", "username TEXT");
// What the person is actually called, set by them on the profile page. A
// username is a handle rather than a name — "kuzeyata" is how you sign in,
// not what anyone calls you — so the greeting and every turn's memory
// context prefer these when they are set.
ensureColumn("users", "first_name", "first_name TEXT");
ensureColumn("users", "last_name", "last_name TEXT");
// The rest of "about you", from the same page: what they would rather be
// called, what they do, and anything else they want the assistant to keep in
// mind. All three ride into the memory context beside the name.
ensureColumn("users", "nickname", "nickname TEXT");
ensureColumn("users", "occupation", "occupation TEXT");
ensureColumn("users", "about_you", "about_you TEXT");

// --- Hermes runtime integration ---------------------------------------
// The interactive surfaces (dashboard terminal, garden chat, Quartz page AI)
// are backed by the Hermes agent runtime. Hermes keeps its own
// runtime session state, but Breadboard remains the durable record of the
// user-visible conversation. These migrations extend the existing chat model
// rather than replacing it, and are all backward compatible (nullable columns
// + new tables), so existing sessions and messages stay valid.

migrateLegacyRuntimeSchema(db);

// Per-runtime-session record linking a Breadboard chat_session (or a
// surface-scoped key) to an Hermes session. `chat_session_id` is nullable
// because Quartz page sessions may exist without a full chat_sessions row.
db.exec(`
  CREATE TABLE IF NOT EXISTS hermes_runtime_sessions (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    surface                TEXT    NOT NULL CHECK (surface IN ('dashboard_terminal','garden_chat','quartz_ai')),
    user_id                INTEGER REFERENCES users(id) ON DELETE CASCADE,
    chat_session_id        INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE,
    hermes_session_id TEXT,
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

  CREATE INDEX IF NOT EXISTS idx_hermes_runtime_sessions_chat
    ON hermes_runtime_sessions(chat_session_id);
  CREATE INDEX IF NOT EXISTS idx_hermes_runtime_sessions_external_id
    ON hermes_runtime_sessions(hermes_session_id);
  CREATE INDEX IF NOT EXISTS idx_hermes_runtime_sessions_surface_user
    ON hermes_runtime_sessions(surface, user_id);

  CREATE TABLE IF NOT EXISTS hermes_capability_decisions (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    runtime_session_id          INTEGER NOT NULL REFERENCES hermes_runtime_sessions(id) ON DELETE CASCADE,
    mode                        TEXT NOT NULL CHECK (mode IN ('knowledge','technical_read','scoped_implementation')),
    requested_outcome           TEXT NOT NULL,
    implementation_required     INTEGER NOT NULL DEFAULT 0,
    decision_reason             TEXT NOT NULL,
    decision_source             TEXT NOT NULL,
    authorized_roots            TEXT NOT NULL DEFAULT '[]',
    authorized_path_patterns    TEXT NOT NULL DEFAULT '[]',
    authorized_delete_targets   TEXT NOT NULL DEFAULT '[]',
    allowed_tools               TEXT NOT NULL DEFAULT '[]',
    allowed_operations          TEXT NOT NULL DEFAULT '[]',
    allowed_command_patterns    TEXT NOT NULL DEFAULT '[]',
    selected_conditional_skills TEXT NOT NULL DEFAULT '[]',
    selected_connections        TEXT NOT NULL DEFAULT '[]',
    created_at                  TEXT NOT NULL,
    expires_at                  TEXT,
    revoked_at                  TEXT,
    revocation_reason           TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_hermes_capability_session
    ON hermes_capability_decisions(runtime_session_id, id DESC);

  CREATE TABLE IF NOT EXISTS hermes_messages (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    runtime_session_id INTEGER NOT NULL REFERENCES hermes_runtime_sessions(id) ON DELETE CASCADE,
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

  CREATE INDEX IF NOT EXISTS idx_hermes_messages_session_order
    ON hermes_messages(runtime_session_id, order_index);

  CREATE TABLE IF NOT EXISTS hermes_proposals (
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
    runtime_session_id INTEGER REFERENCES hermes_runtime_sessions(id) ON DELETE SET NULL,
    created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    decided_at         TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_hermes_proposals_garden
    ON hermes_proposals(garden_id, status, created_at DESC);

  CREATE TABLE IF NOT EXISTS hermes_skill_audit (
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

  CREATE INDEX IF NOT EXISTS idx_hermes_skill_audit_name
    ON hermes_skill_audit(skill_name, created_at DESC);

  CREATE TABLE IF NOT EXISTS hermes_audit_events (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type         TEXT NOT NULL,
    runtime_session_id INTEGER REFERENCES hermes_runtime_sessions(id) ON DELETE SET NULL,
    user_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
    garden_id          TEXT,
    payload            TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_hermes_audit_events_session
    ON hermes_audit_events(runtime_session_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS hermes_user_settings (
    user_id               INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    filesystem_mode       TEXT NOT NULL DEFAULT 'restricted'
                          CHECK (filesystem_mode IN ('restricted','full')),
    last_active_directory TEXT,
    default_model         TEXT NOT NULL DEFAULT 'gpt-5.6-sol',
    reasoning_effort      TEXT NOT NULL DEFAULT 'high'
                          CHECK (reasoning_effort IN ('none','low','medium','high','xhigh','max')),
    intelligence_preference_set INTEGER NOT NULL DEFAULT 0,
    updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS hermes_prompts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    legacy_id   TEXT,
    slug        TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    content     TEXT    NOT NULL,
    category    TEXT    NOT NULL DEFAULT 'Custom',
    favorite    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, slug),
    UNIQUE(user_id, legacy_id)
  );

  CREATE INDEX IF NOT EXISTS idx_hermes_prompts_user_updated
    ON hermes_prompts(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS hermes_mcp_connections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug        TEXT    NOT NULL,
    display_name TEXT   NOT NULL,
    transport   TEXT    NOT NULL CHECK (transport IN ('local','remote')),
    config_json TEXT    NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    approved_at TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, slug)
  );

  CREATE INDEX IF NOT EXISTS idx_hermes_mcp_connections_user
    ON hermes_mcp_connections(user_id, enabled, updated_at DESC);

  -- Persistent, per-user grants over real local folders. A grant is the ONLY
  -- way Hermes may touch a path outside its ephemeral workspace. Paths are
  -- stored canonicalized (and symlink-resolved) by the server; a path appearing
  -- in a chat message never implies a grant.
  CREATE TABLE IF NOT EXISTS hermes_filesystem_grants (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    canonical_path TEXT    NOT NULL,
    display_name   TEXT    NOT NULL,
    perm_read      INTEGER NOT NULL DEFAULT 1,
    perm_create    INTEGER NOT NULL DEFAULT 0,
    perm_modify    INTEGER NOT NULL DEFAULT 0,
    perm_move      INTEGER NOT NULL DEFAULT 0,
    perm_delete    INTEGER NOT NULL DEFAULT 0,
    perm_execute   INTEGER NOT NULL DEFAULT 0,
    -- One-time grants are consumed when the turn that requested them ends.
    scope          TEXT    NOT NULL DEFAULT 'remembered'
                   CHECK (scope IN ('remembered','one_time')),
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    revoked_at     TEXT,
    UNIQUE(user_id, canonical_path)
  );

  CREATE INDEX IF NOT EXISTS idx_hermes_fs_grants_user
    ON hermes_filesystem_grants(user_id, revoked_at);

  -- Breadboard-owned run identity makes steering and cancellation explicit
  -- without exposing Hermes ids to the browser. Only one run may be
  -- active for a runtime session at a time.
  CREATE TABLE IF NOT EXISTS hermes_runs (
    id                 TEXT PRIMARY KEY,
    runtime_session_id INTEGER NOT NULL REFERENCES hermes_runtime_sessions(id) ON DELETE CASCADE,
    instruction        TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','completed','cancelled','error')),
    dispatch_json      TEXT NOT NULL DEFAULT '{}',
    started_at         TEXT NOT NULL,
    finished_at        TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_runs_one_active
    ON hermes_runs(runtime_session_id) WHERE status = 'active';
  CREATE INDEX IF NOT EXISTS idx_hermes_runs_session_started
    ON hermes_runs(runtime_session_id, started_at DESC);

  CREATE TABLE IF NOT EXISTS hermes_steer_requests (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    runtime_session_id INTEGER NOT NULL REFERENCES hermes_runtime_sessions(id) ON DELETE CASCADE,
    run_id             TEXT NOT NULL REFERENCES hermes_runs(id) ON DELETE CASCADE,
    client_request_id  TEXT NOT NULL,
    content            TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','accepted','failed')),
    error_code         TEXT,
    result_run_id      TEXT,
    result_mode        TEXT CHECK (result_mode IN ('steer','follow_up')),
    created_at         TEXT NOT NULL,
    accepted_at        TEXT,
    UNIQUE(runtime_session_id, client_request_id)
  );

  CREATE INDEX IF NOT EXISTS idx_hermes_steer_requests_run
    ON hermes_steer_requests(run_id, created_at);
`);

ensureColumn(
  "hermes_runtime_sessions",
  "active_directory",
  "active_directory TEXT",
);
ensureColumn(
  "hermes_runtime_sessions",
  "runtime_kind",
  "runtime_kind TEXT NOT NULL DEFAULT 'hermes' CHECK (runtime_kind = 'hermes')",
);
ensureColumn(
  "hermes_runtime_sessions",
  "external_session_id",
  "external_session_id TEXT",
);
ensureColumn(
  "hermes_runtime_sessions",
  "live_session_id",
  "live_session_id TEXT",
);
ensureColumn(
  "hermes_runtime_sessions",
  "last_event_sequence",
  "last_event_sequence INTEGER NOT NULL DEFAULT 0",
);
ensureColumn(
  "hermes_runtime_sessions",
  "filesystem_mode",
  "filesystem_mode TEXT NOT NULL DEFAULT 'restricted' CHECK (filesystem_mode IN ('restricted','full'))",
);
// The pump driving a run stamps this while it is alive. Without it an active
// run whose owning process died stayed active forever and blocked its
// conversation; see lib/hermes/run-liveness.ts.
ensureColumn("hermes_runs", "heartbeat_at", "heartbeat_at TEXT");
ensureColumn("hermes_steer_requests", "result_run_id", "result_run_id TEXT");
ensureColumn(
  "hermes_steer_requests",
  "result_mode",
  "result_mode TEXT CHECK (result_mode IN ('steer','follow_up'))",
);
ensureColumn(
  "hermes_runtime_sessions",
  "capability_mode",
  "capability_mode TEXT NOT NULL DEFAULT 'knowledge' CHECK (capability_mode IN ('knowledge','technical_read','scoped_implementation'))",
);
ensureColumn(
  "hermes_runtime_sessions",
  "capability_decision_id",
  "capability_decision_id INTEGER",
);
ensureColumn(
  "hermes_capability_decisions",
  "authorized_path_patterns",
  "authorized_path_patterns TEXT NOT NULL DEFAULT '[]'",
);
ensureColumn(
  "hermes_capability_decisions",
  "authorized_delete_targets",
  "authorized_delete_targets TEXT NOT NULL DEFAULT '[]'",
);
ensureColumn(
  "hermes_capability_decisions",
  "allowed_command_patterns",
  "allowed_command_patterns TEXT NOT NULL DEFAULT '[]'",
);
ensureColumn(
  "hermes_user_settings",
  "default_model",
  "default_model TEXT NOT NULL DEFAULT 'gpt-5.6-sol'",
);
db.exec(`
  UPDATE hermes_runtime_sessions
  SET external_session_id = hermes_session_id
  WHERE external_session_id IS NULL AND hermes_session_id IS NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_agent_runtime_sessions_external
    ON hermes_runtime_sessions(runtime_kind, external_session_id);
`);
ensureColumn(
  "hermes_user_settings",
  "reasoning_effort",
  "reasoning_effort TEXT NOT NULL DEFAULT 'high' CHECK (reasoning_effort IN ('none','low','medium','high','xhigh','max'))",
);
ensureColumn(
  "hermes_user_settings",
  "intelligence_preference_set",
  "intelligence_preference_set INTEGER NOT NULL DEFAULT 0",
);
// Effort is remembered per model, not just globally: the ladders differ by
// model, so switching to one that stops at High clamps the choice down, and
// without this the original depth is lost the moment you come back.
ensureColumn(
  "hermes_user_settings",
  "reasoning_effort_by_model",
  "reasoning_effort_by_model TEXT NOT NULL DEFAULT '{}'",
);
// How much the agent may do without asking when the act-without-asking switch
// is on. Defaults to 'autonomous', which is what that switch has always done;
// the narrower tiers are there to be chosen, not to be arrived at by upgrading.
// See lib/hermes/autonomy.ts.
ensureColumn(
  "hermes_user_settings",
  "autonomy_tier",
  "autonomy_tier TEXT NOT NULL DEFAULT 'autonomous' CHECK (autonomy_tier IN ('supervised','semi_autonomous','autonomous'))",
);
// A column default only applies to rows written after it exists, and a
// pre-release build of this column backfilled 'semi_autonomous'. Nothing could
// have chosen that deliberately -- the tier has no UI and reached the API only
// through this same build -- so those rows are the old default, not a choice,
// and putting them back is a correction rather than an override.
db.exec(`
  UPDATE hermes_user_settings
  SET autonomy_tier = 'autonomous'
  WHERE autonomy_tier = 'semi_autonomous';
`);
// "Rewrite naturally" as a standing preference rather than a per-message
// toggle. It lives on the server because the browser switch alone cannot reach
// the surfaces the user asked it to cover: an artifact and a garden note are
// written by the server, often while the agent is working and nobody is
// looking at a composer. Default 0 - this rewrites what Breadboard says, so it
// stays off until somebody turns it on.
ensureColumn(
  "hermes_user_settings",
  "humanizer_auto",
  "humanizer_auto INTEGER NOT NULL DEFAULT 0",
);
// The composer's Intelligence-menu switches (YOLO, Agent mode, Super agent,
// Direct mode, Personalize) as an account setting. The browser stores keep
// them in localStorage, which is keyed by origin, and the desktop dashboard is
// served on a different loopback port after every restart - so without this
// column every switch silently reset each time Breadboard was reopened. A
// partial JSON record: an absent key means "never set", and the browser keeps
// its own default. See lib/hermes/composer-switches.ts.
ensureColumn(
  "hermes_user_settings",
  "composer_switches",
  "composer_switches TEXT NOT NULL DEFAULT '{}'",
);

// Additional per-message runtime metadata. These are nullable so historical
// ChatMock-authored messages remain valid and readable.
ensureColumn("chat_messages", "tool_calls", "tool_calls TEXT");
ensureColumn(
  "chat_messages",
  "permission_decisions",
  "permission_decisions TEXT",
);
ensureColumn("chat_messages", "runtime_error", "runtime_error TEXT");
ensureColumn("chat_messages", "runtime_status", "runtime_status TEXT");
// Whether a garden/quartz message carried a typed proposal (JSON payload).
ensureColumn("chat_messages", "proposal", "proposal TEXT");

// Canonical, surface-independent conversation and memory ownership. This runs
// after the legacy chat and Hermes tables exist so its guarded backfill can
// preserve every user-visible transcript without a destructive migration.
ensureMcpOAuthSchema(db);
ensureConversationSchema(db);
// Bookkeeping mapping durable memories to their mem0 semantic-index entries.
// Must follow the conversation schema: it references durable_memories(id).
ensureMem0Schema(db);
// Structure over those same memories, plus the bookkeeping for mirroring it
// into an editable markdown vault. Also references durable_memories(id), so it
// follows the conversation schema for the same reason mem0 does.
ensureMemoryTreeSchema(db);
ensureArtifactSchema(db);
// Additive GBrain source-mapping and sync/audit bookkeeping (derived retrieval
// state only; canonical content stays in markdown). Safe to re-apply.
ensureGBrainSchema(db);
// Persistent derived-work bookkeeping. Existing pre-feature Gardens retain
// their rollout state; every Garden inserted after this schema is installed is
// enabled by default.
ensureThoughtTopologySchema(db);

// Additive UI-TARS runtime-agent tables (agents, runs, normalized events,
// approvals, artifacts) + server-only provider-key storage. Safe to re-apply.
ensureUITarsSchema(db);

// Additive Agent Browser configuration plus Runtime V2 ownership correlation;
// native Runtime V2 remains the run lifecycle ledger. Safe to re-apply.
ensureAgentBrowserSchema(db);

// Additive parametric CAD tables (projects, immutable revisions, the files each
// revision produced). Must be applied after the artifact tables: a project
// points at the artifact its design is published as. Safe to re-apply.
ensureCadSchema(db);

// Per-user connected-app ownership, one-time OAuth state, and encrypted vault.
ensureNangoSchema(db);
// Conversation-scoped tracks selected by the native inline Spotify player.
ensureSpotifySchema(db);

// Additive cron-scheduled chat jobs; the schema lives with its store in
// src/lib/schedules/ and is safe to re-apply.
ensureScheduledChatSchema(db);
// Native workflows; after users so the owner foreign key resolves.
ensureWorkflowSchema(db);

// Workflows authored by demonstration. Applied straight after the workflow
// tables because it adds columns to `workflows` itself: a demonstrated workflow
// is a workflow row with a learned procedure on it, not a separate kind of
// object living somewhere else.
ensureTeachSchema(db);

// Additive calendar tables (named calendars + their events). Times are stored
// as timezone-free wall-clock stamps; see src/lib/calendar/wallclock.ts.
ensureCalendarSchema(db);

// The address book. Applied after the calendar because the calendar is what
// fills it: everyone invited to an event you create is filed here, which is how
// the book has anything in it before you have typed a single card.
ensureContactSchema(db);

// Additive Socials Manager tables (registered channels + drafted posts). Must be
// applied after the calendar: socials_manager_posts.calendar_event_id references
// calendar_events, which is how a scheduled post occupies a real calendar slot.
ensureSocialsManagerSchema(db);

// Additive Plan tables (the Kaneo board model: projects, columns, tasks, labels,
// comments, relations). Due dates use the calendar's wall-clock date strings, so
// the Plan page can lay tasks and events out on the same grid.
ensurePlanSchema(db);

// Per-user defaults for the runtime agents that have something worth deciding
// in advance (see src/lib/agent-settings/). Safe to re-apply.
ensureAgentSettingsSchema(db);

// Breadboard's geographic state: the places, selection, route and viewport one
// conversation is working with. Written by the map service, read by the map UI
// and by the agent's map_* tools. See src/lib/map/.
ensureMapSchema(db);

// Additive WhatsApp link tables (settings, chat→conversation map, dedupe). The
// linked-device credentials are never stored here — only on disk under Hermes.
ensureWhatsAppSchema(db);

// Additive Telegram link tables (settings + update offset, chat→conversation map,
// dedupe). The bot token is never stored here either — only on disk under Hermes.
ensureTelegramSchema(db);
// Email as a channel the assistant speaks through, alongside WhatsApp and
// Telegram. Credentials live on disk, never here.
ensureEmailSchema(db);

// Spaced repetition: per-user delivery choice, per-garden participation, one
// FSRS card per learning page, and the questions currently awaiting a reply.
// Scheduling state lives here rather than in note frontmatter because a garden's
// markdown is a build output the Learn pipeline rewrites. See src/lib/review/.
ensureReviewSchema(db);

// Persist cluster-group folders even while they contain no clusters yet.
db.exec(`
  CREATE TABLE IF NOT EXISTS cluster_folders (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name    TEXT    NOT NULL,
    UNIQUE(user_id, name)
  )
`);

// Where the user dragged a cluster among its siblings. NULL means "never
// reordered", which sorts alphabetically after the placed ones.
ensureColumn("cluster_folders", "position", "position INTEGER");

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

// --- Document skills (book-to-skill integration) ---------------------------
// Skills distilled from selected or uploaded documents, keyed by content hash
// so the same document is only ever distilled once.
ensureDocumentSkillSchema(db);

// --- Organizations ---------------------------------------------------------
// Groups of accounts that can see each other's gardens shared with the group.
ensureOrganizationSchema(db);

// --- Video transcription (Scriberr integration) ----------------------------
// Additive table for asynchronous video transcription jobs; the schema lives
// with its store in src/lib/scriberr/job-store.ts and is safe to re-apply.
ensureVideoTranscriptionSchema(db);

// --- Buzz rooms ------------------------------------------------------------
// The multi-party chat surface: rooms, their members (the account plus agent
// personas), the shared transcript and its threads. Runs after the canonical
// conversation schema because it adds `conversations.buzz_room_id`, the column
// that keeps a member's private thinking out of the chat sidebar.
ensureBuzzSchema(db);

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
