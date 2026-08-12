// Persistence + ownership for the UI-TARS subsystem. Every query is scoped by
// owner_user_id; there is no code path that returns another user's agent, run,
// event, or approval. Provider keys are read/written ONLY through the dedicated
// secret helpers and are never included in any presented DTO.

import crypto from "node:crypto";
import db from "../db.ts";
import {
  validateAgentConfiguration,
  defaultAgentConfiguration,
  type UITarsAgentConfiguration,
} from "./config.ts";

export function publicId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

export interface AgentRow {
  id: string;
  owner_user_id: number;
  name: string;
  description: string;
  kind: string;
  runtime: string | null;
  capabilities_json: string;
  configuration_json: string;
  enabled: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface PresentedAgent {
  id: string;
  name: string;
  description: string;
  kind: "prompt" | "runtime";
  runtime: "ui-tars" | "hermes" | null;
  capabilities: string[];
  enabled: boolean;
  isDefault: boolean;
  configuration: UITarsAgentConfiguration;
  secretConfigured: boolean;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_AGENT_NAME = "Agent TARS";
const DEFAULT_AGENT_DESCRIPTION =
  "Clicks, types, and completes visual tasks in an isolated browser or on your desktop when you approve access.";
const PREVIOUS_DEFAULT_AGENT_DESCRIPTION =
  "UI-TARS operator for an isolated browser or explicitly approved control of the actual desktop.";
const LEGACY_DEFAULT_AGENT_NAME = "UI-TARS Browser Operator";
const LEGACY_DEFAULT_AGENT_DESCRIPTION =
  "Browser-only UI-TARS operator. Launches an isolated browser task with human approval for sensitive actions.";

function capabilitiesFor(configuration: UITarsAgentConfiguration): string[] {
  return [configuration.operator === "computer" ? "computer_control" : "browser_control"];
}

/** Migrate only Breadboard's untouched legacy identity/capability metadata. */
function adoptDefaultAgentIdentity(agent: AgentRow): AgentRow {
  const parsed = validateAgentConfiguration(JSON.parse(agent.configuration_json));
  const configuration = parsed.value ?? defaultAgentConfiguration();
  const name = agent.name === LEGACY_DEFAULT_AGENT_NAME ? DEFAULT_AGENT_NAME : agent.name;
  const description =
    agent.description === LEGACY_DEFAULT_AGENT_DESCRIPTION ||
    agent.description === PREVIOUS_DEFAULT_AGENT_DESCRIPTION
      ? DEFAULT_AGENT_DESCRIPTION
      : agent.description;
  const capabilities = JSON.stringify(capabilitiesFor(configuration));
  if (name === agent.name && description === agent.description && capabilities === agent.capabilities_json) {
    return agent;
  }
  db.prepare(
    "UPDATE ui_tars_agents SET name = ?, description = ?, capabilities_json = ?, updated_at = ? WHERE id = ?",
  ).run(name, description, capabilities, new Date().toISOString(), agent.id);
  return db.prepare("SELECT * FROM ui_tars_agents WHERE id = ?").get(agent.id) as AgentRow;
}

/**
 * Adopt the current default model wiring for a default agent that has never been
 * configured (no model chosen, no stored key). Agents the user has touched are
 * left exactly as they are.
 */
function adoptDefaultModelWiring(agent: AgentRow): AgentRow {
  const parsed = validateAgentConfiguration(JSON.parse(agent.configuration_json));
  const current = parsed.ok && parsed.value ? parsed.value : null;
  if (!current || current.model.trim().length > 0 || hasSecret(agent.id)) return agent;

  const defaults = defaultAgentConfiguration();
  const next: UITarsAgentConfiguration = {
    ...current,
    provider: defaults.provider,
    model: defaults.model,
    ...(defaults.endpoint ? { endpoint: defaults.endpoint } : {}),
  };
  db.prepare("UPDATE ui_tars_agents SET configuration_json = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(next),
    new Date().toISOString(),
    agent.id,
  );
  return db.prepare("SELECT * FROM ui_tars_agents WHERE id = ?").get(agent.id) as AgentRow;
}

/** Create the first-party default agent for a user if absent. Idempotent. */
export function ensureDefaultAgent(userId: number): AgentRow {
  const existing = db
    .prepare("SELECT * FROM ui_tars_agents WHERE owner_user_id = ? AND is_default = 1")
    .get(userId) as AgentRow | undefined;
  if (existing) return adoptDefaultModelWiring(adoptDefaultAgentIdentity(existing));

  const id = publicId("uta");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ui_tars_agents
      (id, owner_user_id, name, description, kind, runtime, capabilities_json, configuration_json, enabled, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'runtime', 'ui-tars', ?, ?, 1, 1, ?, ?)`,
  ).run(
    id,
    userId,
    DEFAULT_AGENT_NAME,
    DEFAULT_AGENT_DESCRIPTION,
    JSON.stringify(capabilitiesFor(defaultAgentConfiguration())),
    JSON.stringify(defaultAgentConfiguration()),
    now,
    now,
  );
  return db.prepare("SELECT * FROM ui_tars_agents WHERE id = ?").get(id) as AgentRow;
}

export function listAgents(userId: number): AgentRow[] {
  ensureDefaultAgent(userId);
  return db
    .prepare("SELECT * FROM ui_tars_agents WHERE owner_user_id = ? ORDER BY is_default DESC, created_at ASC")
    .all(userId) as AgentRow[];
}

export function getAgent(userId: number, agentId: string): AgentRow | null {
  return (
    (db
      .prepare("SELECT * FROM ui_tars_agents WHERE id = ? AND owner_user_id = ?")
      .get(agentId, userId) as AgentRow | undefined) ?? null
  );
}

export function createAgent(
  userId: number,
  input: { name: string; description?: string; configuration: UITarsAgentConfiguration },
): AgentRow {
  const id = publicId("uta");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ui_tars_agents
      (id, owner_user_id, name, description, kind, runtime, capabilities_json, configuration_json, enabled, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'runtime', 'ui-tars', ?, ?, 1, 0, ?, ?)`,
  ).run(
    id,
    userId,
    input.name.slice(0, 120),
    (input.description ?? "").slice(0, 500),
    JSON.stringify(capabilitiesFor(input.configuration)),
    JSON.stringify(input.configuration),
    now,
    now,
  );
  return db.prepare("SELECT * FROM ui_tars_agents WHERE id = ?").get(id) as AgentRow;
}

export function updateAgent(
  userId: number,
  agentId: string,
  patch: { name?: string; description?: string; enabled?: boolean; configuration?: UITarsAgentConfiguration },
): AgentRow | null {
  const agent = getAgent(userId, agentId);
  if (!agent) return null;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE ui_tars_agents
       SET name = ?, description = ?, enabled = ?, configuration_json = ?, capabilities_json = ?, updated_at = ?
     WHERE id = ? AND owner_user_id = ?`,
  ).run(
    (patch.name ?? agent.name).slice(0, 120),
    (patch.description ?? agent.description).slice(0, 500),
    patch.enabled === undefined ? agent.enabled : patch.enabled ? 1 : 0,
    patch.configuration ? JSON.stringify(patch.configuration) : agent.configuration_json,
    JSON.stringify(capabilitiesFor(patch.configuration ?? (
      validateAgentConfiguration(JSON.parse(agent.configuration_json)).value ?? defaultAgentConfiguration()
    ))),
    now,
    agentId,
    userId,
  );
  return getAgent(userId, agentId);
}

// ---------------- secrets (server-only) ----------------

export function setSecret(agentId: string, providerApiKey: string): void {
  db.prepare(
    `INSERT INTO ui_tars_agent_secrets (agent_id, provider_api_key, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(agent_id) DO UPDATE SET provider_api_key = excluded.provider_api_key, updated_at = datetime('now')`,
  ).run(agentId, providerApiKey);
}

export function clearSecret(agentId: string): void {
  db.prepare("DELETE FROM ui_tars_agent_secrets WHERE agent_id = ?").run(agentId);
}

export function hasSecret(agentId: string): boolean {
  return !!db.prepare("SELECT 1 FROM ui_tars_agent_secrets WHERE agent_id = ?").get(agentId);
}

/** Server-only. NEVER return this through an API response. */
export function getSecret(agentId: string): string | null {
  const row = db.prepare("SELECT provider_api_key FROM ui_tars_agent_secrets WHERE agent_id = ?").get(agentId) as
    | { provider_api_key: string }
    | undefined;
  return row?.provider_api_key ?? null;
}

/** Present an agent for the frontend — redacted, secret shown only as a boolean. */
export function presentAgent(agent: AgentRow): PresentedAgent {
  const parsed = validateAgentConfiguration(JSON.parse(agent.configuration_json));
  const configuration = parsed.ok && parsed.value ? parsed.value : defaultAgentConfiguration();
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    kind: agent.kind === "prompt" ? "prompt" : "runtime",
    runtime: agent.runtime === "ui-tars" || agent.runtime === "hermes" ? agent.runtime : null,
    capabilities: capabilitiesFor(configuration),
    enabled: agent.enabled === 1,
    isDefault: agent.is_default === 1,
    configuration,
    secretConfigured: hasSecret(agent.id),
    createdAt: agent.created_at,
    updatedAt: agent.updated_at,
  };
}

// ---------------- runs ----------------

export interface RunRow {
  id: string;
  agent_id: string;
  owner_user_id: number;
  conversation_id: string | null;
  status: string;
  task: string;
  operator_type: string;
  runtime_session_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  aborted_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
}

export function createRunRecord(input: {
  id: string;
  agentId: string;
  userId: number;
  task: string;
  operatorType?: "browser" | "computer";
  runtimeSessionId?: string;
  conversationId?: string;
}): RunRow {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ui_tars_runs
      (id, agent_id, owner_user_id, conversation_id, status, task, operator_type, runtime_session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.agentId,
    input.userId,
    input.conversationId ?? null,
    input.task,
    input.operatorType ?? "browser",
    input.runtimeSessionId ?? input.id,
    now,
    now,
  );
  return db.prepare("SELECT * FROM ui_tars_runs WHERE id = ?").get(input.id) as RunRow;
}

export function getRun(userId: number, runId: string): RunRow | null {
  return (
    (db
      .prepare("SELECT * FROM ui_tars_runs WHERE id = ? AND owner_user_id = ?")
      .get(runId, userId) as RunRow | undefined) ?? null
  );
}

export function listRuns(userId: number, agentId: string, limit = 50): RunRow[] {
  return db
    .prepare(
      "SELECT * FROM ui_tars_runs WHERE owner_user_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(userId, agentId, Math.min(Math.max(limit, 1), 200)) as RunRow[];
}

function updateRunStatus(runId: string, status: string, failure?: { code: string; message: string }): void {
  const now = new Date().toISOString();
  const abortedAt = status === "aborted" ? now : null;
  db.prepare(
    `UPDATE ui_tars_runs
       SET status = ?,
           updated_at = ?,
           started_at = COALESCE(started_at, CASE WHEN ? IN ('running','awaiting_approval') THEN ? ELSE started_at END),
           completed_at = CASE WHEN ? IN ('completed','failed','aborted','runtime_lost') THEN ? ELSE completed_at END,
           aborted_at = COALESCE(aborted_at, ?),
           failure_code = COALESCE(?, failure_code),
           failure_message = COALESCE(?, failure_message)
     WHERE id = ?`,
  ).run(
    status,
    now,
    status,
    now,
    status,
    now,
    abortedAt,
    failure?.code ?? null,
    failure?.message ?? null,
    runId,
  );
}

/**
 * Idempotently persist normalized events. Duplicate (run_id, sequence_number)
 * rows are ignored, so re-delivery after reconnect never duplicates. Terminal
 * and status events drive the persisted run status.
 */
export function persistEvents(
  runId: string,
  events: Array<{ sequenceNumber: number; type: string; payload: Record<string, unknown> }>,
): number {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO ui_tars_run_events (run_id, sequence_number, event_type, payload_json, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  );
  let inserted = 0;
  const tx = db.transaction((evs: typeof events) => {
    for (const e of evs) {
      const res = insert.run(runId, e.sequenceNumber, e.type, JSON.stringify(e.payload ?? {}));
      if (res.changes > 0) inserted += 1;
      applyEventSideEffects(runId, e);
    }
  });
  tx(events);
  return inserted;
}

function applyEventSideEffects(
  runId: string,
  e: { type: string; payload: Record<string, unknown> },
): void {
  switch (e.type) {
    case "run.started":
      updateRunStatus(runId, "running");
      break;
    case "approval.requested":
      updateRunStatus(runId, "awaiting_approval");
      recordApproval(runId, e.payload);
      break;
    case "approval.approved":
      setApprovalDecision(runId, String(e.payload.actionId ?? ""), "approved");
      updateRunStatus(runId, "running");
      break;
    case "approval.rejected":
      setApprovalDecision(runId, String(e.payload.actionId ?? ""), "rejected");
      break;
    case "run.completed":
      updateRunStatus(runId, "completed");
      break;
    case "run.failed":
      updateRunStatus(runId, "failed", {
        code: String(e.payload.code ?? "failed"),
        message: String(e.payload.message ?? ""),
      });
      break;
    case "run.aborted":
      updateRunStatus(runId, "aborted");
      break;
    case "runtime.disconnected":
      updateRunStatus(runId, "runtime_lost", {
        code: String(e.payload.code ?? "runtime_lost"),
        message: String(e.payload.message ?? "Runtime disconnected"),
      });
      break;
    default:
      break;
  }
}

/** Finalize a persisted active run that can no longer exist in the adapter. */
export function markRunRuntimeLost(
  runId: string,
  message = "Agent TARS stopped because its desktop runtime closed. Start a new run to continue.",
): boolean {
  const row = db.prepare("SELECT status FROM ui_tars_runs WHERE id = ?").get(runId) as
    | { status: string }
    | undefined;
  if (!row || ["completed", "failed", "aborted", "runtime_lost"].includes(row.status)) return false;
  const next = lastSequence(runId) + 1;
  persistEvents(runId, [
    { sequenceNumber: next, type: "run.status", payload: { message } },
    {
      sequenceNumber: next + 1,
      type: "runtime.disconnected",
      payload: { code: "runtime_lost", message },
    },
  ]);
  return true;
}

/** Highest persisted sequence number for a run (0 if none). */
export function lastSequence(runId: string): number {
  const row = db
    .prepare("SELECT MAX(sequence_number) AS m FROM ui_tars_run_events WHERE run_id = ?")
    .get(runId) as { m: number | null } | undefined;
  return row?.m ?? 0;
}

export function listEvents(userId: number, runId: string, sinceSeq = 0): Array<{
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}> {
  if (!getRun(userId, runId)) return [];
  const rows = db
    .prepare(
      `SELECT sequence_number, event_type, payload_json, created_at
       FROM ui_tars_run_events WHERE run_id = ? AND sequence_number > ? ORDER BY sequence_number ASC`,
    )
    .all(runId, sinceSeq) as Array<{ sequence_number: number; event_type: string; payload_json: string; created_at: string }>;
  return rows.map((r) => ({
    sequenceNumber: r.sequence_number,
    type: r.event_type,
    payload: safeJson(r.payload_json),
    at: r.created_at,
  }));
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ---------------- approvals ----------------

export function recordApproval(runId: string, payload: Record<string, unknown>): void {
  db.prepare(
    `INSERT OR IGNORE INTO ui_tars_approvals
      (id, run_id, action_id, action_type, action_summary, risk_level, requested_payload_json, decision, requested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    publicId("apr"),
    runId,
    String(payload.actionId ?? ""),
    String(payload.action ?? "click"),
    String(payload.explanation ?? ""),
    String(payload.risk ?? "low"),
    JSON.stringify(payload),
    String(payload.requestedAt ?? new Date().toISOString()),
  );
}

function setApprovalDecision(runId: string, actionId: string, decision: "approved" | "rejected"): void {
  db.prepare(
    `UPDATE ui_tars_approvals SET decision = ?, decided_at = datetime('now')
     WHERE run_id = ? AND action_id = ? AND decision = 'pending'`,
  ).run(decision, runId, actionId);
}

export function markApprovalDecidedBy(runId: string, actionId: string, userId: number): void {
  db.prepare(
    `UPDATE ui_tars_approvals SET decided_by_user_id = ? WHERE run_id = ? AND action_id = ?`,
  ).run(userId, runId, actionId);
}
