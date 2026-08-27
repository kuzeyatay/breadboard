// Durable ownership correlation for disposable Runtime V2 outer-agent jobs.
// Runtime owns execution, events, cancellation, and result files. This table
// keeps only the authenticated scope needed to address that authority after a
// Next.js hot reload or server restart.

import db from "../db.ts";
import type { RuntimeJobAuthority } from "../supervisor-control.ts";

export type OuterAgentKind =
  | "codex"
  | "ruflo"
  | "deep-tutor"
  | "deer-flow"
  | "deep-research"
  | "opencode"
  | "trading-agent"
  | "career-ops"
  | "agent-reach"
  | "agent-tars"
  | "openwork"
  | "shorts"
  | "open-gym"
  | "legal"
  | "openplanter"
  | "resource2skill"
  | "matraix"
  | "hyperframes"
  | "openmontage"
  | "bolt-slides"
  | "hardware-blueprint"
  | "inbox-zero"
  | "socials-manager"
  | "get-doc"
  | "get-doc-download"
  | "meeting-notes"
  | "money-printer"
  | "video-use"
  | "openscience"
  | "max-research"
  | "wardrobe"
  | "parametric-cad"
  | "stock-analyst"
  | "vibe-trading";

export interface OuterAgentRuntimeRunRow {
  job_id: string;
  owner_user_id: number;
  agent_kind: OuterAgentKind;
  request_id: string;
  idempotency_key: string;
  garden_id: string | null;
  conversation_id: string;
  created_at: string;
  terminal_at: string | null;
}

let schemaReady = false;

function ensureSchema(): void {
  if (schemaReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_v2_outer_agent_runs (
      job_id          TEXT PRIMARY KEY,
      owner_user_id   INTEGER NOT NULL,
      agent_kind      TEXT NOT NULL CHECK (agent_kind IN ('codex', 'ruflo', 'deep-tutor', 'deer-flow', 'deep-research', 'opencode', 'trading-agent', 'career-ops', 'agent-reach', 'agent-tars', 'openwork', 'shorts', 'open-gym', 'legal', 'openplanter', 'resource2skill', 'matraix', 'hyperframes', 'openmontage', 'bolt-slides', 'hardware-blueprint', 'inbox-zero', 'socials-manager', 'get-doc', 'get-doc-download', 'meeting-notes', 'money-printer', 'video-use', 'openscience', 'max-research', 'wardrobe', 'parametric-cad', 'stock-analyst', 'vibe-trading')),
      request_id      TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      garden_id       TEXT,
      conversation_id TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      terminal_at     TEXT,
      UNIQUE (owner_user_id, agent_kind, request_id)
    );
  `);
  const schema = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get("runtime_v2_outer_agent_runs") as { sql?: string | null } | undefined;
  if (
    !schema?.sql?.includes("'legal'") ||
    !schema.sql.includes("'deer-flow'") ||
    !schema.sql.includes("'deep-research'") ||
    !schema.sql.includes("'agent-reach'") ||
    !schema.sql.includes("'agent-tars'") ||
    !schema.sql.includes("'openwork'") ||
    !schema.sql.includes("'openplanter'") ||
    !schema.sql.includes("'resource2skill'") ||
    !schema.sql.includes("'matraix'") ||
    !schema.sql.includes("'hyperframes'") ||
    !schema.sql.includes("'openmontage'") ||
    !schema.sql.includes("'bolt-slides'") ||
    !schema.sql.includes("'hardware-blueprint'") ||
    !schema.sql.includes("'inbox-zero'") ||
    !schema.sql.includes("'socials-manager'") ||
    !schema.sql.includes("'get-doc'") ||
    !schema.sql.includes("'get-doc-download'") ||
    !schema.sql.includes("'meeting-notes'") ||
    !schema.sql.includes("'money-printer'") ||
    !schema.sql.includes("'video-use'") ||
    !schema.sql.includes("'openscience'") ||
    !schema.sql.includes("'max-research'") ||
    !schema.sql.includes("'wardrobe'") ||
    !schema.sql.includes("'parametric-cad'") ||
    !schema.sql.includes("'stock-analyst'") ||
    !schema.sql.includes("'vibe-trading'")
  ) {
    try {
      db.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE runtime_v2_outer_agent_runs
          RENAME TO runtime_v2_outer_agent_runs_legacy;
        CREATE TABLE runtime_v2_outer_agent_runs (
          job_id          TEXT PRIMARY KEY,
          owner_user_id   INTEGER NOT NULL,
          agent_kind      TEXT NOT NULL CHECK (agent_kind IN ('codex', 'ruflo', 'deep-tutor', 'deer-flow', 'deep-research', 'opencode', 'trading-agent', 'career-ops', 'agent-reach', 'agent-tars', 'openwork', 'shorts', 'open-gym', 'legal', 'openplanter', 'resource2skill', 'matraix', 'hyperframes', 'openmontage', 'bolt-slides', 'hardware-blueprint', 'inbox-zero', 'socials-manager', 'get-doc', 'get-doc-download', 'meeting-notes', 'money-printer', 'video-use', 'openscience', 'max-research', 'wardrobe', 'parametric-cad', 'stock-analyst', 'vibe-trading')),
          request_id      TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          garden_id       TEXT,
          conversation_id TEXT NOT NULL,
          created_at      TEXT NOT NULL,
          terminal_at     TEXT,
          UNIQUE (owner_user_id, agent_kind, request_id)
        );
        INSERT INTO runtime_v2_outer_agent_runs
          (job_id, owner_user_id, agent_kind, request_id, idempotency_key,
           garden_id, conversation_id, created_at, terminal_at)
        SELECT job_id, owner_user_id, agent_kind, request_id, idempotency_key,
               garden_id, conversation_id, created_at, terminal_at
        FROM runtime_v2_outer_agent_runs_legacy;
        DROP TABLE runtime_v2_outer_agent_runs_legacy;
        COMMIT;
      `);
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // SQLite already rolled the failed migration back.
      }
      throw error;
    }
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_runtime_v2_outer_agent_runs_owner
      ON runtime_v2_outer_agent_runs(owner_user_id, agent_kind, created_at);
    CREATE INDEX IF NOT EXISTS idx_runtime_v2_outer_agent_runs_active
      ON runtime_v2_outer_agent_runs(terminal_at, created_at);
  `);
  schemaReady = true;
}

export function recordOuterAgentRuntimeRun(input: {
  readonly jobId: string;
  readonly ownerUserId: number;
  readonly kind: OuterAgentKind;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly authority: RuntimeJobAuthority;
  readonly createdAt?: string;
}): OuterAgentRuntimeRunRow {
  ensureSchema();
  if (
    input.authority.userId !== input.ownerUserId ||
    input.authority.conversationId === null
  ) {
    throw new Error("Outer-agent Runtime correlation has invalid authority.");
  }
  db.prepare(
    `INSERT INTO runtime_v2_outer_agent_runs
       (job_id, owner_user_id, agent_kind, request_id, idempotency_key,
        garden_id, conversation_id, created_at, terminal_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(owner_user_id, agent_kind, request_id) DO NOTHING`,
  ).run(
    input.jobId,
    input.ownerUserId,
    input.kind,
    input.requestId,
    input.idempotencyKey,
    input.authority.gardenId,
    input.authority.conversationId,
    input.createdAt ?? new Date().toISOString(),
  );
  const row = getOuterAgentRuntimeRunByRequest(
    input.ownerUserId,
    input.kind,
    input.requestId,
  );
  if (
    !row ||
    row.job_id !== input.jobId ||
    row.idempotency_key !== input.idempotencyKey ||
    row.garden_id !== input.authority.gardenId ||
    row.conversation_id !== input.authority.conversationId
  ) {
    throw new Error("Outer-agent Runtime correlation conflicted with an existing request.");
  }
  return row;
}

export function getOuterAgentRuntimeRun(
  ownerUserId: number,
  kind: OuterAgentKind,
  jobId: string,
): OuterAgentRuntimeRunRow | null {
  ensureSchema();
  return (
    (db.prepare(
      `SELECT * FROM runtime_v2_outer_agent_runs
       WHERE job_id = ? AND owner_user_id = ? AND agent_kind = ?`,
    ).get(jobId, ownerUserId, kind) as OuterAgentRuntimeRunRow | undefined) ?? null
  );
}

export function getOuterAgentRuntimeRunByRequest(
  ownerUserId: number,
  kind: OuterAgentKind,
  requestId: string,
): OuterAgentRuntimeRunRow | null {
  ensureSchema();
  return (
    (db.prepare(
      `SELECT * FROM runtime_v2_outer_agent_runs
       WHERE owner_user_id = ? AND agent_kind = ? AND request_id = ?`,
    ).get(ownerUserId, kind, requestId) as OuterAgentRuntimeRunRow | undefined) ?? null
  );
}

export function outerAgentRuntimeAuthority(
  row: OuterAgentRuntimeRunRow,
): RuntimeJobAuthority {
  return {
    userId: row.owner_user_id,
    gardenId: row.garden_id,
    conversationId: row.conversation_id,
  };
}

export function markOuterAgentRuntimeRunTerminal(
  jobId: string,
  terminalAt = new Date().toISOString(),
): void {
  ensureSchema();
  db.prepare(
    `UPDATE runtime_v2_outer_agent_runs
     SET terminal_at = COALESCE(terminal_at, ?)
     WHERE job_id = ?`,
  ).run(terminalAt, jobId);
}
