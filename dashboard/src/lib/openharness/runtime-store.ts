// Persistence helpers for OpenHarness runtime sessions and their messages.
//
// Breadboard owns the durable, user-visible conversation. OpenHarness keeps its
// own runtime session, but must never be the only record of what the user saw.
// This module maps between Breadboard's chat model and the OpenHarness runtime
// session, and persists per-message runtime metadata (tool calls, citations,
// permission decisions, usage, errors, status) without duplicating messages on
// reconnect.

import db from "../db.ts";
import type { OpenHarnessSurface } from "./config.ts";

export type FilesystemAccessMode = "restricted" | "full";

export interface RuntimeSessionRow {
  id: number;
  surface: OpenHarnessSurface;
  user_id: number | null;
  chat_session_id: number | null;
  openharness_session_id: string | null;
  agent_name: string;
  cluster_id: number | null;
  garden_id: string | null;
  page_slug: string | null;
  workspace_key: string;
  active_directory: string | null;
  filesystem_mode: FilesystemAccessMode;
  runtime_metadata: string | null;
  last_runtime_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRuntimeSessionInput {
  surface: OpenHarnessSurface;
  userId: number | null;
  chatSessionId: number | null;
  agentName: string;
  clusterId: number | null;
  gardenId: string | null;
  pageSlug: string | null;
  workspaceKey: string;
  activeDirectory: string;
  filesystemMode: FilesystemAccessMode;
  openHarnessSessionId?: string | null;
  runtimeMetadata?: Record<string, unknown> | null;
}

export function createRuntimeSession(
  input: CreateRuntimeSessionInput,
): RuntimeSessionRow {
  const result = db
    .prepare(
      `INSERT INTO openharness_runtime_sessions
         (surface, user_id, chat_session_id, openharness_session_id, agent_name,
          cluster_id, garden_id, page_slug, workspace_key, active_directory,
          filesystem_mode, runtime_metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.surface,
      input.userId,
      input.chatSessionId,
      input.openHarnessSessionId ?? null,
      input.agentName,
      input.clusterId,
      input.gardenId,
      input.pageSlug,
      input.workspaceKey,
      input.activeDirectory,
      input.filesystemMode,
      input.runtimeMetadata ? JSON.stringify(input.runtimeMetadata) : null,
    );
  return getRuntimeSessionById(Number(result.lastInsertRowid))!;
}

export function getRuntimeSessionById(id: number): RuntimeSessionRow | null {
  const row = db
    .prepare("SELECT * FROM openharness_runtime_sessions WHERE id = ?")
    .get(id) as RuntimeSessionRow | undefined;
  return row ?? null;
}

export function getRuntimeSessionByChatSession(
  chatSessionId: number,
): RuntimeSessionRow | null {
  const row = db
    .prepare(
      "SELECT * FROM openharness_runtime_sessions WHERE chat_session_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(chatSessionId) as RuntimeSessionRow | undefined;
  return row ?? null;
}

export function getRuntimeSessionByOpenHarnessId(
  openHarnessSessionId: string,
): RuntimeSessionRow | null {
  const row = db
    .prepare(
      "SELECT * FROM openharness_runtime_sessions WHERE openharness_session_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(openHarnessSessionId) as RuntimeSessionRow | undefined;
  return row ?? null;
}

export interface OpenHarnessUserSettings {
  filesystemMode: FilesystemAccessMode;
  lastActiveDirectory: string | null;
}

export function getOpenHarnessUserSettings(
  userId: number,
): OpenHarnessUserSettings {
  const row = db
    .prepare(
      "SELECT filesystem_mode, last_active_directory FROM openharness_user_settings WHERE user_id = ?",
    )
    .get(userId) as
    | {
        filesystem_mode: FilesystemAccessMode;
        last_active_directory: string | null;
      }
    | undefined;
  return {
    filesystemMode: row?.filesystem_mode === "full" ? "full" : "restricted",
    lastActiveDirectory: row?.last_active_directory ?? null,
  };
}

export function setOpenHarnessUserSettings(
  userId: number,
  input: Partial<OpenHarnessUserSettings>,
): OpenHarnessUserSettings {
  const current = getOpenHarnessUserSettings(userId);
  const next = {
    filesystemMode: input.filesystemMode ?? current.filesystemMode,
    lastActiveDirectory:
      input.lastActiveDirectory === undefined
        ? current.lastActiveDirectory
        : input.lastActiveDirectory,
  };
  db.prepare(
    `INSERT INTO openharness_user_settings
       (user_id, filesystem_mode, last_active_directory, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       filesystem_mode = excluded.filesystem_mode,
       last_active_directory = excluded.last_active_directory,
       updated_at = datetime('now')`,
  ).run(userId, next.filesystemMode, next.lastActiveDirectory);
  return next;
}

export function setOpenHarnessSessionId(
  id: number,
  openHarnessSessionId: string,
): void {
  db.prepare(
    `UPDATE openharness_runtime_sessions
     SET openharness_session_id = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(openHarnessSessionId, id);
}

export function setRuntimeStatus(id: number, status: string): void {
  db.prepare(
    `UPDATE openharness_runtime_sessions
     SET last_runtime_status = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(status, id);
}

export interface PersistMessageInput {
  chatSessionId: number;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  tokenUsage?: unknown;
  toolCalls?: unknown;
  permissionDecisions?: unknown;
  runtimeError?: string | null;
  runtimeStatus?: string | null;
  proposal?: unknown;
}

/**
 * Append a message to a chat session, computing the next order_index. Idempotent
 * appends are the caller's responsibility (the routes dedupe by only persisting
 * a finalized assistant turn once), which keeps reconnects from duplicating
 * messages.
 */
export function appendChatMessage(input: PersistMessageInput): number {
  const nextIndex = db
    .prepare(
      "SELECT COALESCE(MAX(order_index) + 1, 0) AS next FROM chat_messages WHERE session_id = ?",
    )
    .get(input.chatSessionId) as { next: number };
  const result = db
    .prepare(
      `INSERT INTO chat_messages
         (session_id, role, content, sources, token_usage, tool_calls,
          permission_decisions, runtime_error, runtime_status, proposal, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.chatSessionId,
      input.role,
      input.content,
      input.sources && input.sources.length > 0
        ? JSON.stringify(input.sources)
        : null,
      input.tokenUsage ? JSON.stringify(input.tokenUsage) : null,
      input.toolCalls ? JSON.stringify(input.toolCalls) : null,
      input.permissionDecisions
        ? JSON.stringify(input.permissionDecisions)
        : null,
      input.runtimeError ?? null,
      input.runtimeStatus ?? null,
      input.proposal ? JSON.stringify(input.proposal) : null,
      nextIndex.next,
    );
  db.prepare(
    "UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?",
  ).run(input.chatSessionId);
  return Number(result.lastInsertRowid);
}

export interface RuntimeMessageRow {
  id: number;
  runtime_session_id: number;
  role: "user" | "assistant";
  content: string;
  sources: string | null;
  token_usage: string | null;
  tool_calls: string | null;
  permission_decisions: string | null;
  runtime_error: string | null;
  runtime_status: string | null;
  proposal: string | null;
  order_index: number;
  created_at: string;
}

/**
 * Append a message to a runtime session transcript (used by the terminal and
 * Quartz surfaces, which are not cluster-scoped and so do not map onto the
 * cluster-bound chat_sessions table). Garden chat uses appendChatMessage.
 */
export function appendRuntimeMessage(input: {
  runtimeSessionId: number;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  tokenUsage?: unknown;
  toolCalls?: unknown;
  permissionDecisions?: unknown;
  runtimeError?: string | null;
  runtimeStatus?: string | null;
  proposal?: unknown;
}): number {
  const nextIndex = db
    .prepare(
      "SELECT COALESCE(MAX(order_index) + 1, 0) AS next FROM openharness_messages WHERE runtime_session_id = ?",
    )
    .get(input.runtimeSessionId) as { next: number };
  const result = db
    .prepare(
      `INSERT INTO openharness_messages
         (runtime_session_id, role, content, sources, token_usage, tool_calls,
          permission_decisions, runtime_error, runtime_status, proposal, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.runtimeSessionId,
      input.role,
      input.content,
      input.sources && input.sources.length > 0
        ? JSON.stringify(input.sources)
        : null,
      input.tokenUsage ? JSON.stringify(input.tokenUsage) : null,
      input.toolCalls ? JSON.stringify(input.toolCalls) : null,
      input.permissionDecisions
        ? JSON.stringify(input.permissionDecisions)
        : null,
      input.runtimeError ?? null,
      input.runtimeStatus ?? null,
      input.proposal ? JSON.stringify(input.proposal) : null,
      nextIndex.next,
    );
  db.prepare(
    "UPDATE openharness_runtime_sessions SET updated_at = datetime('now') WHERE id = ?",
  ).run(input.runtimeSessionId);
  return Number(result.lastInsertRowid);
}

export function listRuntimeMessages(
  runtimeSessionId: number,
): RuntimeMessageRow[] {
  return db
    .prepare(
      "SELECT * FROM openharness_messages WHERE runtime_session_id = ? ORDER BY order_index",
    )
    .all(runtimeSessionId) as RuntimeMessageRow[];
}

export function listRuntimeSessionsForUser(
  surface: OpenHarnessSurface,
  userId: number,
): RuntimeSessionRow[] {
  return db
    .prepare(
      `SELECT * FROM openharness_runtime_sessions
       WHERE surface = ? AND user_id = ?
       ORDER BY updated_at DESC, id DESC LIMIT 100`,
    )
    .all(surface, userId) as RuntimeSessionRow[];
}

export function deleteRuntimeSession(id: number): void {
  db.prepare("DELETE FROM openharness_runtime_sessions WHERE id = ?").run(id);
}

export interface ProposalRow {
  id: number;
  cluster_id: number | null;
  garden_id: string;
  surface: string;
  kind: "note" | "page_revision" | "visualization";
  page_slug: string | null;
  rationale: string | null;
  payload: string;
  evidence_anchors: string | null;
  status: "pending" | "applied" | "rejected";
  created_by_user_id: number | null;
  runtime_session_id: number | null;
  created_at: string;
  decided_at: string | null;
}

export interface CreateProposalInput {
  clusterId: number | null;
  gardenId: string;
  surface: string;
  kind: "note" | "page_revision" | "visualization";
  pageSlug?: string | null;
  rationale?: string | null;
  payload: unknown;
  evidenceAnchors?: string[];
  createdByUserId?: number | null;
  runtimeSessionId?: number | null;
}

export function createProposal(input: CreateProposalInput): ProposalRow {
  const result = db
    .prepare(
      `INSERT INTO openharness_proposals
         (cluster_id, garden_id, surface, kind, page_slug, rationale, payload,
          evidence_anchors, created_by_user_id, runtime_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.clusterId,
      input.gardenId,
      input.surface,
      input.kind,
      input.pageSlug ?? null,
      input.rationale ?? null,
      JSON.stringify(input.payload),
      input.evidenceAnchors && input.evidenceAnchors.length
        ? JSON.stringify(input.evidenceAnchors)
        : null,
      input.createdByUserId ?? null,
      input.runtimeSessionId ?? null,
    );
  return getProposalById(Number(result.lastInsertRowid))!;
}

export function getProposalById(id: number): ProposalRow | null {
  const row = db
    .prepare("SELECT * FROM openharness_proposals WHERE id = ?")
    .get(id) as ProposalRow | undefined;
  return row ?? null;
}

export function listProposalsForGarden(
  gardenId: string,
  status?: string,
): ProposalRow[] {
  if (status) {
    return db
      .prepare(
        "SELECT * FROM openharness_proposals WHERE garden_id = ? AND status = ? ORDER BY created_at DESC",
      )
      .all(gardenId, status) as ProposalRow[];
  }
  return db
    .prepare(
      "SELECT * FROM openharness_proposals WHERE garden_id = ? ORDER BY created_at DESC LIMIT 200",
    )
    .all(gardenId) as ProposalRow[];
}

export function setProposalStatus(
  id: number,
  status: "applied" | "rejected",
): void {
  db.prepare(
    "UPDATE openharness_proposals SET status = ?, decided_at = datetime('now') WHERE id = ?",
  ).run(status, id);
}

export interface SkillAuditInput {
  skillName: string;
  sourceUrl?: string | null;
  version?: string | null;
  decision: "quarantined" | "promoted" | "rejected";
  decidedBy?: number | null;
  manifest?: unknown;
  notes?: string | null;
}

export function recordSkillDecision(input: SkillAuditInput): number {
  const result = db
    .prepare(
      `INSERT INTO openharness_skill_audit
         (skill_name, source_url, version, decision, decided_by, manifest, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.skillName,
      input.sourceUrl ?? null,
      input.version ?? null,
      input.decision,
      input.decidedBy ?? null,
      input.manifest ? JSON.stringify(input.manifest) : null,
      input.notes ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function listSkillAudit(
  skillName?: string,
): Array<Record<string, unknown>> {
  if (skillName) {
    return db
      .prepare(
        "SELECT * FROM openharness_skill_audit WHERE skill_name = ? ORDER BY created_at DESC",
      )
      .all(skillName) as Array<Record<string, unknown>>;
  }
  return db
    .prepare(
      "SELECT * FROM openharness_skill_audit ORDER BY created_at DESC LIMIT 200",
    )
    .all() as Array<Record<string, unknown>>;
}

export function recordAuditEvent(input: {
  eventType: string;
  runtimeSessionId?: number | null;
  userId?: number | null;
  gardenId?: string | null;
  payload?: unknown;
}): number {
  const result = db
    .prepare(
      `INSERT INTO openharness_audit_events
       (event_type, runtime_session_id, user_id, garden_id, payload)
     VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.eventType,
      input.runtimeSessionId ?? null,
      input.userId ?? null,
      input.gardenId ?? null,
      input.payload === undefined ? null : JSON.stringify(input.payload),
    );
  return Number(result.lastInsertRowid);
}

export function listAuditEvents(
  runtimeSessionId?: number,
): Array<Record<string, unknown>> {
  if (runtimeSessionId) {
    return db
      .prepare(
        "SELECT * FROM openharness_audit_events WHERE runtime_session_id = ? ORDER BY created_at, id",
      )
      .all(runtimeSessionId) as Array<Record<string, unknown>>;
  }
  return db
    .prepare(
      "SELECT * FROM openharness_audit_events ORDER BY created_at DESC, id DESC LIMIT 500",
    )
    .all() as Array<Record<string, unknown>>;
}

/** Successful tools actually observed for this user; payloads remain server-side. */
export function successfulToolNamesForUser(userId: number): Set<string> {
  const rows = db
    .prepare(
      `SELECT payload FROM openharness_audit_events
     WHERE user_id = ? AND event_type = 'tool.completed'
     ORDER BY id DESC LIMIT 1000`,
    )
    .all(userId) as Array<{ payload: string | null }>;
  const names = new Set<string>();
  for (const row of rows) {
    if (!row.payload) continue;
    try {
      const payload = JSON.parse(row.payload) as {
        toolName?: unknown;
        success?: unknown;
      };
      if (payload.success === true && typeof payload.toolName === "string") {
        names.add(payload.toolName.toLowerCase());
      }
    } catch {
      // Ignore old or malformed audit rows.
    }
  }
  return names;
}

export function getLatestCapabilityGap(
  runtimeSessionId: number,
): Record<string, unknown> | null {
  const row = db
    .prepare(
      `SELECT payload FROM openharness_audit_events
     WHERE runtime_session_id = ? AND event_type = 'capability.gap'
       AND id > COALESCE((
         SELECT MAX(id) FROM openharness_audit_events
         WHERE runtime_session_id = ? AND event_type = 'task.resumed'
       ), 0)
     ORDER BY id DESC LIMIT 1`,
    )
    .get(runtimeSessionId, runtimeSessionId) as
    { payload: string | null } | undefined;
  if (!row?.payload) return null;
  try {
    const parsed = JSON.parse(row.payload) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
