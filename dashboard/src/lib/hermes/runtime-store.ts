// Persistence helpers for Hermes runtime sessions and their messages.
//
// Breadboard owns the durable, user-visible conversation. Hermes keeps its
// own runtime session, but must never be the only record of what the user saw.
// This module maps between Breadboard's chat model and the Hermes runtime
// session, and persists per-message runtime metadata (tool calls, citations,
// permission decisions, usage, errors, status) without duplicating messages on
// reconnect.

import db from "../db.ts";
import { DEFAULT_MODEL } from "../ai-models.ts";
import {
  ASSISTANT_REASONING_EFFORTS,
  DEFAULT_ASSISTANT_REASONING_EFFORT,
  type AssistantReasoningEffort,
} from "../assistant-reasoning.ts";
import { normalizeAutonomyTier, type AutonomyTier } from "./autonomy.ts";
import {
  mergeComposerSwitches,
  parseComposerSwitches,
  type ComposerSwitches,
} from "./composer-switches.ts";
import type { HermesSurface } from "./config.ts";
import type { RuntimeKind } from "../agent-runtime/contracts.ts";
import type {
  CapabilityDecision,
  CapabilityMode,
  CapabilityOperation,
} from "./capability-policy.ts";

export type FilesystemAccessMode = "restricted" | "full";

export interface RuntimeSessionRow {
  id: number;
  conversation_id: number | null;
  surface: HermesSurface;
  user_id: number | null;
  chat_session_id: number | null;
  hermes_session_id: string | null;
  runtime_kind: RuntimeKind;
  external_session_id: string | null;
  live_session_id: string | null;
  last_event_sequence: number;
  agent_name: string;
  cluster_id: number | null;
  garden_id: string | null;
  page_slug: string | null;
  allowed_garden_ids: string;
  workspace_key: string;
  active_directory: string | null;
  filesystem_mode: FilesystemAccessMode;
  capability_mode: CapabilityMode;
  capability_decision_id: number | null;
  runtime_metadata: string | null;
  last_runtime_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRuntimeSessionInput {
  conversationId?: number | null;
  surface: HermesSurface;
  userId: number | null;
  chatSessionId: number | null;
  agentName: string;
  clusterId: number | null;
  gardenId: string | null;
  pageSlug: string | null;
  allowedGardenIds?: number[];
  workspaceKey: string;
  activeDirectory: string;
  filesystemMode: FilesystemAccessMode;
  hermesSessionId?: string | null;
  runtimeKind?: RuntimeKind;
  externalSessionId?: string | null;
  liveSessionId?: string | null;
  runtimeMetadata?: Record<string, unknown> | null;
}

export function createRuntimeSession(
  input: CreateRuntimeSessionInput,
): RuntimeSessionRow {
  const result = db
    .prepare(
      `INSERT INTO hermes_runtime_sessions
         (conversation_id, surface, user_id, chat_session_id, hermes_session_id,
          runtime_kind, external_session_id, live_session_id, agent_name,
          cluster_id, garden_id, page_slug, workspace_key, active_directory,
          filesystem_mode, runtime_metadata, allowed_garden_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.conversationId ?? null,
      input.surface,
      input.userId,
      input.chatSessionId,
      input.hermesSessionId ?? null,
      input.runtimeKind ?? "hermes",
      input.externalSessionId ?? input.hermesSessionId ?? null,
      input.liveSessionId ?? null,
      input.agentName,
      input.clusterId,
      input.gardenId,
      input.pageSlug,
      input.workspaceKey,
      input.activeDirectory,
      input.filesystemMode,
      input.runtimeMetadata ? JSON.stringify(input.runtimeMetadata) : null,
      JSON.stringify(input.allowedGardenIds ?? []),
    );
  return getRuntimeSessionById(Number(result.lastInsertRowid))!;
}

export function getRuntimeSessionById(id: number): RuntimeSessionRow | null {
  const row = db
    .prepare("SELECT * FROM hermes_runtime_sessions WHERE id = ?")
    .get(id) as RuntimeSessionRow | undefined;
  return row ?? null;
}

export function getRuntimeSessionByConversation(
  conversationId: number,
): RuntimeSessionRow | null {
  const row = db.prepare(`
    SELECT * FROM hermes_runtime_sessions
    WHERE conversation_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(conversationId) as RuntimeSessionRow | undefined;
  return row ?? null;
}

/** Replace (never merge) temporary context so stale gardens cannot leak. */
export function updateRuntimeActiveContext(input: {
  runtimeSessionId: number;
  surface: HermesSurface;
  clusterId: number | null;
  gardenId: string | null;
  pageSlug: string | null;
  allowedGardenIds: number[];
}): RuntimeSessionRow {
  db.prepare(`
    UPDATE hermes_runtime_sessions
    SET surface = ?, cluster_id = ?, garden_id = ?, page_slug = ?,
        allowed_garden_ids = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.surface,
    input.clusterId,
    input.gardenId,
    input.pageSlug,
    JSON.stringify([...new Set(input.allowedGardenIds)].sort((a, b) => a - b)),
    input.runtimeSessionId,
  );
  return getRuntimeSessionById(input.runtimeSessionId)!;
}

export function getRuntimeSessionByChatSession(
  chatSessionId: number,
): RuntimeSessionRow | null {
  const row = db
    .prepare(
      "SELECT * FROM hermes_runtime_sessions WHERE chat_session_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(chatSessionId) as RuntimeSessionRow | undefined;
  return row ?? null;
}

/**
 * Every runtime session a legacy Garden chat has ever had, newest first. The
 * Garden delete path removes the `chat_sessions` row and lets these cascade, so
 * it needs all of them to stop their work — not just the one still in use.
 */
export function listRuntimeSessionsForChatSession(
  chatSessionId: number,
): RuntimeSessionRow[] {
  return db
    .prepare(
      `SELECT * FROM hermes_runtime_sessions
       WHERE chat_session_id = ?
       ORDER BY id DESC`,
    )
    .all(chatSessionId) as RuntimeSessionRow[];
}

export function getRuntimeSessionByHermesId(
  hermesSessionId: string,
): RuntimeSessionRow | null {
  const row = db
    .prepare(
      "SELECT * FROM hermes_runtime_sessions WHERE hermes_session_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(hermesSessionId) as RuntimeSessionRow | undefined;
  return row ?? null;
}

export function getRuntimeSessionByExternalId(
  runtimeKind: RuntimeKind,
  externalSessionId: string,
): RuntimeSessionRow | null {
  const row = db
    .prepare(
      `SELECT * FROM hermes_runtime_sessions
       WHERE runtime_kind = ? AND external_session_id = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(runtimeKind, externalSessionId) as RuntimeSessionRow | undefined;
  return row ?? null;
}

export function runtimeExternalSessionId(row: RuntimeSessionRow): string | null {
  return row.external_session_id ?? row.hermes_session_id;
}

export interface HermesUserSettings {
  filesystemMode: FilesystemAccessMode;
  lastActiveDirectory: string | null;
  defaultModel: string;
  reasoningEffort: AssistantReasoningEffort;
  /**
   * The effort last chosen for each model. Reasoning ladders are a property of
   * the model, so moving to one that stops at High clamps the selection down;
   * without a per-model record that clamp would silently become the new choice
   * for the model you came from.
   */
  reasoningEffortByModel: Record<string, AssistantReasoningEffort>;
  intelligencePreferenceSet: boolean;
  /**
   * How much the agent may do unattended when the act-without-asking switch is
   * on. The switch chooses whether to consult this at all; this chooses where
   * the line falls. See lib/hermes/autonomy.ts.
   */
  autonomyTier: AutonomyTier;
  /**
   * "Rewrite naturally" as a standing preference: every finished answer, every
   * artifact and every garden note is offered to the local rewriter, and takes
   * the rewrite when the preservation gates pass it.
   *
   * Server-side rather than browser-side because the browser switch cannot
   * reach an artifact or a note - those are written by the server, often while
   * nobody is looking at a composer.
   */
  humanizerAuto: boolean;
  /**
   * The composer's Intelligence-menu switches, kept on the account because the
   * browser copy is keyed by origin and the desktop dashboard moves to a new
   * loopback port on every launch. Partial: an absent key means the browser
   * keeps its own default. See lib/hermes/composer-switches.ts.
   */
  composerSwitches: ComposerSwitches;
}

function parseEffortsByModel(raw: string | null | undefined): Record<string, AssistantReasoningEffort> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, AssistantReasoningEffort] =>
          typeof entry[1] === "string" &&
          ASSISTANT_REASONING_EFFORTS.includes(entry[1] as AssistantReasoningEffort),
      ),
    );
  } catch {
    // A corrupt record is a forgotten preference, not a broken settings read.
    return {};
  }
}

export function getHermesUserSettings(
  userId: number,
): HermesUserSettings {
  const row = db
    .prepare(
      `SELECT filesystem_mode, last_active_directory, default_model,
              reasoning_effort, reasoning_effort_by_model, intelligence_preference_set,
              humanizer_auto, autonomy_tier, composer_switches
       FROM hermes_user_settings WHERE user_id = ?`,
    )
    .get(userId) as
    | {
        filesystem_mode: FilesystemAccessMode;
        last_active_directory: string | null;
        default_model: string;
        reasoning_effort: string;
        reasoning_effort_by_model: string | null;
        intelligence_preference_set: number;
        humanizer_auto: number;
        autonomy_tier: string | null;
        composer_switches: string | null;
      }
    | undefined;
  return {
    filesystemMode: row?.filesystem_mode === "full" ? "full" : "restricted",
    lastActiveDirectory: row?.last_active_directory ?? null,
    defaultModel: row?.default_model?.trim() || DEFAULT_MODEL,
    reasoningEffort:
      row && ASSISTANT_REASONING_EFFORTS.includes(row.reasoning_effort as AssistantReasoningEffort)
        ? row.reasoning_effort as AssistantReasoningEffort
        : DEFAULT_ASSISTANT_REASONING_EFFORT,
    reasoningEffortByModel: parseEffortsByModel(row?.reasoning_effort_by_model),
    intelligencePreferenceSet: row?.intelligence_preference_set === 1,
    humanizerAuto: row?.humanizer_auto === 1,
    autonomyTier: normalizeAutonomyTier(row?.autonomy_tier),
    composerSwitches: parseComposerSwitches(row?.composer_switches),
  };
}

export function setHermesUserSettings(
  userId: number,
  input: Partial<HermesUserSettings>,
): HermesUserSettings {
  const current = getHermesUserSettings(userId);
  const defaultModel = input.defaultModel?.trim() || current.defaultModel;
  const remembered = current.reasoningEffortByModel[defaultModel];
  const next = {
    filesystemMode: input.filesystemMode ?? current.filesystemMode,
    lastActiveDirectory:
      input.lastActiveDirectory === undefined
        ? current.lastActiveDirectory
        : input.lastActiveDirectory,
    defaultModel,
    // Selecting a model restores the effort last used *with that model*. An
    // explicit effort in the same call still wins, and a model never chosen
    // before keeps whatever is active so the switch is not a silent downgrade.
    reasoningEffort:
      input.reasoningEffort ??
      (defaultModel !== current.defaultModel && remembered
        ? remembered
        : current.reasoningEffort),
    reasoningEffortByModel: current.reasoningEffortByModel,
    intelligencePreferenceSet:
      input.defaultModel !== undefined || input.reasoningEffort !== undefined
        ? true
        : current.intelligencePreferenceSet,
    humanizerAuto: input.humanizerAuto ?? current.humanizerAuto,
    autonomyTier: normalizeAutonomyTier(input.autonomyTier ?? current.autonomyTier),
    composerSwitches: input.composerSwitches
      ? mergeComposerSwitches(current.composerSwitches, input.composerSwitches)
      : current.composerSwitches,
  };
  if (input.defaultModel !== undefined || input.reasoningEffort !== undefined) {
    next.reasoningEffortByModel = {
      ...current.reasoningEffortByModel,
      [next.defaultModel]: next.reasoningEffort,
    };
  }
  db.prepare(
    `INSERT INTO hermes_user_settings
       (user_id, filesystem_mode, last_active_directory, default_model,
        reasoning_effort, reasoning_effort_by_model, intelligence_preference_set,
        humanizer_auto, autonomy_tier, composer_switches, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       filesystem_mode = excluded.filesystem_mode,
       last_active_directory = excluded.last_active_directory,
       default_model = excluded.default_model,
       reasoning_effort = excluded.reasoning_effort,
       reasoning_effort_by_model = excluded.reasoning_effort_by_model,
       intelligence_preference_set = excluded.intelligence_preference_set,
       humanizer_auto = excluded.humanizer_auto,
       autonomy_tier = excluded.autonomy_tier,
       composer_switches = excluded.composer_switches,
       updated_at = datetime('now')`,
  ).run(
    userId,
    next.filesystemMode,
    next.lastActiveDirectory,
    next.defaultModel,
    next.reasoningEffort,
    JSON.stringify(next.reasoningEffortByModel),
    next.intelligencePreferenceSet ? 1 : 0,
    next.humanizerAuto ? 1 : 0,
    next.autonomyTier,
    JSON.stringify(next.composerSwitches),
  );
  return next;
}

export function setHermesSessionId(
  id: number,
  hermesSessionId: string,
): void {
  db.prepare(
    `UPDATE hermes_runtime_sessions
     SET hermes_session_id = ?, runtime_kind = 'hermes',
         external_session_id = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(hermesSessionId, hermesSessionId, id);
}

export function replaceRuntimeIdentity(input: {
  runtimeSessionId: number;
  hermesSessionId: string;
  workspaceKey: string;
  activeDirectory: string;
  agentName: string;
  runtimeMetadata?: Record<string, unknown>;
}): RuntimeSessionRow {
  db.prepare(`
    UPDATE hermes_runtime_sessions
    SET hermes_session_id = ?, runtime_kind = 'hermes',
        external_session_id = ?, workspace_key = ?, active_directory = ?,
        agent_name = ?, runtime_metadata = COALESCE(?, runtime_metadata),
        last_runtime_status = 'rehydrated', updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.hermesSessionId,
    input.hermesSessionId,
    input.workspaceKey,
    input.activeDirectory,
    input.agentName,
    input.runtimeMetadata ? JSON.stringify(input.runtimeMetadata) : null,
    input.runtimeSessionId,
  );
  return getRuntimeSessionById(input.runtimeSessionId)!;
}

export function replaceAgentRuntimeIdentity(input: {
  runtimeSessionId: number;
  runtimeKind: RuntimeKind;
  externalSessionId: string;
  liveSessionId?: string | null;
  workspaceKey: string;
  activeDirectory: string;
  agentName: string;
  runtimeMetadata?: Record<string, unknown>;
}): RuntimeSessionRow {
  db.prepare(`
    UPDATE hermes_runtime_sessions
    SET runtime_kind = ?, external_session_id = ?, live_session_id = ?,
        hermes_session_id = CASE WHEN ? = 'hermes' THEN ? ELSE NULL END,
        workspace_key = ?, active_directory = ?, agent_name = ?,
        runtime_metadata = COALESCE(?, runtime_metadata),
        last_runtime_status = 'rehydrated', updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.runtimeKind,
    input.externalSessionId,
    input.liveSessionId ?? null,
    input.runtimeKind,
    input.externalSessionId,
    input.workspaceKey,
    input.activeDirectory,
    input.agentName,
    input.runtimeMetadata ? JSON.stringify(input.runtimeMetadata) : null,
    input.runtimeSessionId,
  );
  return getRuntimeSessionById(input.runtimeSessionId)!;
}

export function setRuntimeStatus(id: number, status: string): void {
  db.prepare(
    `UPDATE hermes_runtime_sessions
     SET last_runtime_status = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(status, id);
}

type CapabilityDecisionRow = {
  id: number;
  runtime_session_id: number;
  mode: CapabilityMode;
  requested_outcome: string;
  implementation_required: number;
  decision_reason: string;
  decision_source: CapabilityDecision["decisionSource"];
  authorized_roots: string;
  authorized_path_patterns: string;
  authorized_delete_targets: string;
  allowed_tools: string;
  allowed_operations: string;
  allowed_command_patterns: string;
  selected_conditional_skills: string;
  selected_connections: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
};

export interface StoredCapabilityDecision extends CapabilityDecision {
  id: number;
  runtimeSessionId: number;
}

function stringList(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function presentCapabilityDecision(
  row: CapabilityDecisionRow,
): StoredCapabilityDecision {
  return {
    id: row.id,
    runtimeSessionId: row.runtime_session_id,
    mode: row.mode,
    requestedOutcome: row.requested_outcome,
    implementationRequired: row.implementation_required === 1,
    decisionReason: row.decision_reason,
    decisionSource: row.decision_source,
    authorizedRoots: stringList(row.authorized_roots),
    authorizedPathPatterns: stringList(row.authorized_path_patterns),
    authorizedDeleteTargets: stringList(row.authorized_delete_targets),
    allowedTools: stringList(row.allowed_tools),
    allowedOperations: stringList(
      row.allowed_operations,
    ) as CapabilityOperation[],
    allowedCommandPatterns: stringList(row.allowed_command_patterns),
    selectedConditionalSkills: stringList(row.selected_conditional_skills),
    selectedConnections: stringList(row.selected_connections),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export function persistCapabilityDecision(
  runtimeSessionId: number,
  decision: CapabilityDecision,
): StoredCapabilityDecision {
  const insert = db.transaction(() => {
    db.prepare(
      `UPDATE hermes_capability_decisions
       SET revoked_at = COALESCE(revoked_at, ?),
           revocation_reason = COALESCE(revocation_reason, 'superseded')
       WHERE runtime_session_id = ? AND revoked_at IS NULL`,
    ).run(decision.createdAt, runtimeSessionId);
    const result = db
      .prepare(
        `INSERT INTO hermes_capability_decisions
         (runtime_session_id, mode, requested_outcome, implementation_required,
          decision_reason, decision_source, authorized_roots,
          authorized_path_patterns, authorized_delete_targets, allowed_tools, allowed_operations,
          allowed_command_patterns, selected_conditional_skills,
          selected_connections, created_at, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runtimeSessionId,
        decision.mode,
        decision.requestedOutcome,
        decision.implementationRequired ? 1 : 0,
        decision.decisionReason,
        decision.decisionSource,
        JSON.stringify(decision.authorizedRoots),
        JSON.stringify(decision.authorizedPathPatterns),
        JSON.stringify(decision.authorizedDeleteTargets ?? []),
        JSON.stringify(decision.allowedTools),
        JSON.stringify(decision.allowedOperations),
        JSON.stringify(decision.allowedCommandPatterns),
        JSON.stringify(decision.selectedConditionalSkills),
        JSON.stringify(decision.selectedConnections),
        decision.createdAt,
        decision.expiresAt,
        decision.revokedAt,
      );
    const id = Number(result.lastInsertRowid);
    db.prepare(
      `UPDATE hermes_runtime_sessions
       SET capability_mode = ?, capability_decision_id = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(decision.mode, id, runtimeSessionId);
    return id;
  });
  const id = insert();
  const row = db
    .prepare("SELECT * FROM hermes_capability_decisions WHERE id = ?")
    .get(id) as CapabilityDecisionRow;
  return presentCapabilityDecision(row);
}

export function getActiveCapabilityDecision(
  runtimeSessionId: number,
  now = new Date(),
): StoredCapabilityDecision | null {
  const row = db
    .prepare(
      `SELECT * FROM hermes_capability_decisions
       WHERE runtime_session_id = ? AND revoked_at IS NULL
       ORDER BY id DESC LIMIT 1`,
    )
    .get(runtimeSessionId) as CapabilityDecisionRow | undefined;
  if (!row) return null;
  if (row.expires_at && Date.parse(row.expires_at) <= now.getTime()) {
    revokeCapabilityDecision(runtimeSessionId, "expired", now);
    return null;
  }
  return presentCapabilityDecision(row);
}

export function revokeCapabilityDecision(
  runtimeSessionId: number,
  reason: "completed" | "cancelled" | "expired" | "abandoned" | "migrated" | "superseded",
  now = new Date(),
): boolean {
  const result = db.prepare(
    `UPDATE hermes_capability_decisions
     SET revoked_at = ?, revocation_reason = ?
     WHERE runtime_session_id = ? AND revoked_at IS NULL`,
  ).run(now.toISOString(), reason, runtimeSessionId);
  db.prepare(
    `UPDATE hermes_runtime_sessions
     SET capability_mode = 'knowledge', capability_decision_id = NULL,
         updated_at = datetime('now')
     WHERE id = ?`,
  ).run(runtimeSessionId);
  return result.changes > 0;
}

export function migrateRuntimeSessionPolicy(
  id: number,
  agentName: string,
): void {
  revokeCapabilityDecision(id, "migrated");
  db.prepare(
    `UPDATE hermes_runtime_sessions
     SET agent_name = ?, filesystem_mode = 'restricted',
         capability_mode = 'knowledge', capability_decision_id = NULL,
         updated_at = datetime('now')
     WHERE id = ?`,
  ).run(agentName, id);
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
      "SELECT COALESCE(MAX(order_index) + 1, 0) AS next FROM hermes_messages WHERE runtime_session_id = ?",
    )
    .get(input.runtimeSessionId) as { next: number };
  const result = db
    .prepare(
      `INSERT INTO hermes_messages
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
    "UPDATE hermes_runtime_sessions SET updated_at = datetime('now') WHERE id = ?",
  ).run(input.runtimeSessionId);
  return Number(result.lastInsertRowid);
}

export function listRuntimeMessages(
  runtimeSessionId: number,
): RuntimeMessageRow[] {
  return db
    .prepare(
      "SELECT * FROM hermes_messages WHERE runtime_session_id = ? ORDER BY order_index",
    )
    .all(runtimeSessionId) as RuntimeMessageRow[];
}

/**
 * Present a persisted runtime message in the shape the browser surfaces
 * consume (AgentMessage). Shared by the dashboard and Quartz session-listing
 * routes so restored transcripts look identical on every surface.
 */
export function presentRuntimeMessage(row: RuntimeMessageRow): {
  role: "user" | "assistant";
  content: string;
  sources: string[];
  usage: unknown;
  tools: Array<{
    toolCallId: string;
    toolName: string;
    summary?: string;
    status: "completed" | "failed";
  }>;
  verification?: Record<string, unknown>;
  interrupted: boolean;
} {
  let runtime: {
    calls?: Array<Record<string, unknown>>;
    verification?: Record<string, unknown>;
  } = {};
  try {
    const parsed = row.tool_calls ? JSON.parse(row.tool_calls) : null;
    runtime = Array.isArray(parsed)
      ? { calls: parsed }
      : parsed && typeof parsed === "object"
        ? parsed
        : {};
  } catch {
    runtime = {};
  }
  let sources: string[] = [];
  try {
    const parsed = row.sources ? JSON.parse(row.sources) : [];
    sources = Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    sources = [];
  }
  let usage: unknown;
  try {
    usage = row.token_usage ? JSON.parse(row.token_usage) : undefined;
  } catch {
    usage = undefined;
  }
  return {
    role: row.role,
    content: row.content,
    sources,
    usage,
    tools: (runtime.calls ?? []).map((call, index) => ({
      toolCallId: String(call.toolCallId ?? `${call.toolName ?? "tool"}-${index}`),
      toolName: String(call.toolName ?? "tool"),
      summary: typeof call.summary === "string" ? call.summary : undefined,
      status: call.success === false ? "failed" : "completed",
    })),
    verification: runtime.verification,
    interrupted: row.runtime_status === "aborted",
  };
}

/** Session title stored in runtime_metadata, with a stable fallback. */
export function runtimeSessionTitle(row: RuntimeSessionRow): string {
  try {
    return row.runtime_metadata
      ? ((JSON.parse(row.runtime_metadata).title as string | undefined) ?? "New chat")
      : "New chat";
  } catch {
    return "New chat";
  }
}

export function listRuntimeSessionsForUser(
  surface: HermesSurface,
  userId: number,
): RuntimeSessionRow[] {
  return db
    .prepare(
      `SELECT * FROM hermes_runtime_sessions
       WHERE surface = ? AND user_id = ?
       ORDER BY updated_at DESC, id DESC LIMIT 100`,
    )
    .all(surface, userId) as RuntimeSessionRow[];
}

/**
 * Every runtime session a conversation has ever owned. A conversation can
 * accumulate more than one row (a replacement live session after a restart is a
 * new row), so deleting a chat has to clear all of them, not just the newest.
 */
export function listRuntimeSessionsForConversation(
  conversationId: number,
): RuntimeSessionRow[] {
  return db
    .prepare(
      `SELECT * FROM hermes_runtime_sessions
       WHERE conversation_id = ?
       ORDER BY id DESC`,
    )
    .all(conversationId) as RuntimeSessionRow[];
}

export function deleteRuntimeSession(id: number): void {
  db.prepare("DELETE FROM hermes_runtime_sessions WHERE id = ?").run(id);
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
      `INSERT INTO hermes_proposals
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
    .prepare("SELECT * FROM hermes_proposals WHERE id = ?")
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
        "SELECT * FROM hermes_proposals WHERE garden_id = ? AND status = ? ORDER BY created_at DESC",
      )
      .all(gardenId, status) as ProposalRow[];
  }
  return db
    .prepare(
      "SELECT * FROM hermes_proposals WHERE garden_id = ? ORDER BY created_at DESC LIMIT 200",
    )
    .all(gardenId) as ProposalRow[];
}

export interface ConversationProposalRow extends ProposalRow {
  garden_name: string | null;
  conversation_public_id: string | null;
}

/**
 * Pending proposals a user created from a specific conversation. A proposal is
 * only actionable where the person who can decide on it can see it, so the chat
 * that produced one needs to list it back — the per-garden reviewer is not
 * reachable from the Terminal. Scoping runs through the runtime session that
 * created the proposal, which is how a proposal is tied to a conversation.
 */
export function listPendingProposalsForConversation(input: {
  userId: number;
  conversationPublicId?: string | null;
  gardenId?: string | null;
}): ConversationProposalRow[] {
  const conversation = input.conversationPublicId ?? null;
  const garden = input.gardenId ?? null;
  return db
    .prepare(
      `SELECT p.*, cl.name AS garden_name, c.public_id AS conversation_public_id
         FROM hermes_proposals p
         LEFT JOIN clusters cl ON cl.id = p.cluster_id
         LEFT JOIN hermes_runtime_sessions s ON s.id = p.runtime_session_id
         LEFT JOIN conversations c ON c.id = s.conversation_id
        WHERE p.status = 'pending'
          AND p.created_by_user_id = ?
          AND (? IS NULL OR c.public_id = ?)
          AND (? IS NULL OR p.garden_id = ?)
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT 20`,
    )
    .all(input.userId, conversation, conversation, garden, garden) as ConversationProposalRow[];
}

export function setProposalStatus(
  id: number,
  status: "applied" | "rejected",
): void {
  db.prepare(
    "UPDATE hermes_proposals SET status = ?, decided_at = datetime('now') WHERE id = ?",
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
      `INSERT INTO hermes_skill_audit
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
        "SELECT * FROM hermes_skill_audit WHERE skill_name = ? ORDER BY created_at DESC",
      )
      .all(skillName) as Array<Record<string, unknown>>;
  }
  return db
    .prepare(
      "SELECT * FROM hermes_skill_audit ORDER BY created_at DESC LIMIT 200",
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
      `INSERT INTO hermes_audit_events
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
        "SELECT * FROM hermes_audit_events WHERE runtime_session_id = ? ORDER BY created_at, id",
      )
      .all(runtimeSessionId) as Array<Record<string, unknown>>;
  }
  return db
    .prepare(
      "SELECT * FROM hermes_audit_events ORDER BY created_at DESC, id DESC LIMIT 500",
    )
    .all() as Array<Record<string, unknown>>;
}

/** Successful tools actually observed for this user; payloads remain server-side. */
export function successfulToolNamesForUser(userId: number): Set<string> {
  const rows = db
    .prepare(
      `SELECT payload FROM hermes_audit_events
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
      `SELECT payload FROM hermes_audit_events
     WHERE runtime_session_id = ? AND event_type = 'capability.gap'
       AND id > COALESCE((
         SELECT MAX(id) FROM hermes_audit_events
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
