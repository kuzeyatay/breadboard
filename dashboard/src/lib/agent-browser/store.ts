// Persistence + ownership for agent-browser agents. Every query is scoped by
// owner_user_id. Runtime V2 owns run state; this store retains only durable
// user/agent/job correlation so old transcript artifacts remain authorized.

import crypto from "node:crypto";
import db from "../db.ts";
import {
  validateAgentConfiguration,
  defaultAgentConfiguration,
  type AgentBrowserConfiguration,
} from "./config.ts";

export function publicId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

export interface AgentRow {
  id: string;
  owner_user_id: number;
  name: string;
  description: string;
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
  kind: "runtime";
  runtime: "agent-browser";
  capabilities: string[];
  enabled: boolean;
  isDefault: boolean;
  configuration: AgentBrowserConfiguration;
  createdAt: string;
  updatedAt: string;
}

export interface AgentBrowserRuntimeRunRow {
  job_id: string;
  owner_user_id: number;
  agent_id: string;
  request_id: string;
  idempotency_key: string;
  created_at: string;
  terminal_at: string | null;
}

const DEFAULT_AGENT_NAME = "Agent Browser";
const DEFAULT_DESCRIPTION =
  "Opens a real browser to visit sites, click buttons, fill forms, and gather information while showing each step.";
const PREVIOUS_DEFAULT_DESCRIPTION =
  "Browser operator powered by vercel-labs/agent-browser. Drives a real browser to complete a task, using ChatMock as the model.";

/** Refresh only Breadboard's untouched default copy; preserve user edits. */
function adoptDefaultDescription(agent: AgentRow): AgentRow {
  if (agent.description !== PREVIOUS_DEFAULT_DESCRIPTION) return agent;
  db.prepare("UPDATE agent_browser_agents SET description = ?, updated_at = ? WHERE id = ?").run(
    DEFAULT_DESCRIPTION,
    new Date().toISOString(),
    agent.id,
  );
  return db.prepare("SELECT * FROM agent_browser_agents WHERE id = ?").get(agent.id) as AgentRow;
}

/** Adopt current default model wiring for a default agent never configured. */
function adoptDefaultModelWiring(agent: AgentRow): AgentRow {
  const parsed = validateAgentConfiguration(JSON.parse(agent.configuration_json));
  const current = parsed.ok && parsed.value ? parsed.value : null;
  if (!current || current.model.trim().length > 0) return agent;
  const defaults = defaultAgentConfiguration();
  const next: AgentBrowserConfiguration = {
    ...current,
    provider: defaults.provider,
    model: defaults.model,
    ...(defaults.endpoint ? { endpoint: defaults.endpoint } : {}),
  };
  db.prepare("UPDATE agent_browser_agents SET configuration_json = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(next),
    new Date().toISOString(),
    agent.id,
  );
  return db.prepare("SELECT * FROM agent_browser_agents WHERE id = ?").get(agent.id) as AgentRow;
}

export function ensureDefaultAgent(userId: number): AgentRow {
  const existing = db
    .prepare("SELECT * FROM agent_browser_agents WHERE owner_user_id = ? AND is_default = 1")
    .get(userId) as AgentRow | undefined;
  if (existing) return adoptDefaultModelWiring(adoptDefaultDescription(existing));

  const id = publicId("abr");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agent_browser_agents
      (id, owner_user_id, name, description, capabilities_json, configuration_json, enabled, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
  ).run(
    id,
    userId,
    DEFAULT_AGENT_NAME,
    DEFAULT_DESCRIPTION,
    JSON.stringify(["browser_control"]),
    JSON.stringify(defaultAgentConfiguration()),
    now,
    now,
  );
  return db.prepare("SELECT * FROM agent_browser_agents WHERE id = ?").get(id) as AgentRow;
}

export function listAgents(userId: number): AgentRow[] {
  ensureDefaultAgent(userId);
  return db
    .prepare("SELECT * FROM agent_browser_agents WHERE owner_user_id = ? ORDER BY is_default DESC, created_at ASC")
    .all(userId) as AgentRow[];
}

export function getAgent(userId: number, agentId: string): AgentRow | null {
  return (
    (db
      .prepare("SELECT * FROM agent_browser_agents WHERE id = ? AND owner_user_id = ?")
      .get(agentId, userId) as AgentRow | undefined) ?? null
  );
}

export function updateAgent(
  userId: number,
  agentId: string,
  patch: { name?: string; description?: string; enabled?: boolean; configuration?: AgentBrowserConfiguration },
): AgentRow | null {
  const agent = getAgent(userId, agentId);
  if (!agent) return null;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE agent_browser_agents
       SET name = ?, description = ?, enabled = ?, configuration_json = ?, updated_at = ?
     WHERE id = ? AND owner_user_id = ?`,
  ).run(
    (patch.name ?? agent.name).slice(0, 120),
    (patch.description ?? agent.description).slice(0, 500),
    patch.enabled === undefined ? agent.enabled : patch.enabled ? 1 : 0,
    patch.configuration ? JSON.stringify(patch.configuration) : agent.configuration_json,
    now,
    agentId,
    userId,
  );
  return getAgent(userId, agentId);
}

function safeArray(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function presentAgent(agent: AgentRow): PresentedAgent {
  const parsed = validateAgentConfiguration(JSON.parse(agent.configuration_json));
  const configuration = parsed.ok && parsed.value ? parsed.value : defaultAgentConfiguration();
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    kind: "runtime",
    runtime: "agent-browser",
    capabilities: safeArray(agent.capabilities_json),
    enabled: agent.enabled === 1,
    isDefault: agent.is_default === 1,
    configuration,
    createdAt: agent.created_at,
    updatedAt: agent.updated_at,
  };
}

/**
 * Persist only the authenticated correlation needed to address Runtime V2.
 * State, events, cancellation, and results remain native-runtime authority.
 */
export function recordRuntimeRun(input: {
  jobId: string;
  ownerUserId: number;
  agentId: string;
  requestId: string;
  idempotencyKey: string;
  createdAt?: string;
}): AgentBrowserRuntimeRunRow {
  const createdAt = input.createdAt ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO agent_browser_runtime_runs
       (job_id, owner_user_id, agent_id, request_id, idempotency_key, created_at, terminal_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(owner_user_id, agent_id, request_id) DO UPDATE SET
       job_id = excluded.job_id,
       idempotency_key = excluded.idempotency_key`,
  ).run(
    input.jobId,
    input.ownerUserId,
    input.agentId,
    input.requestId,
    input.idempotencyKey,
    createdAt,
  );
  const row = db.prepare(
    `SELECT * FROM agent_browser_runtime_runs
     WHERE owner_user_id = ? AND agent_id = ? AND request_id = ?`,
  ).get(input.ownerUserId, input.agentId, input.requestId) as
    | AgentBrowserRuntimeRunRow
    | undefined;
  if (!row || row.job_id !== input.jobId || row.idempotency_key !== input.idempotencyKey) {
    throw new Error("Agent Browser Runtime correlation conflicted with an existing request.");
  }
  return row;
}

export function getRuntimeRun(
  ownerUserId: number,
  agentId: string,
  jobId: string,
): AgentBrowserRuntimeRunRow | null {
  return (
    (db.prepare(
      `SELECT * FROM agent_browser_runtime_runs
       WHERE job_id = ? AND owner_user_id = ? AND agent_id = ?`,
    ).get(jobId, ownerUserId, agentId) as AgentBrowserRuntimeRunRow | undefined) ?? null
  );
}

export function getRuntimeRunByRequest(
  ownerUserId: number,
  agentId: string,
  requestId: string,
): AgentBrowserRuntimeRunRow | null {
  return (
    (db.prepare(
      `SELECT * FROM agent_browser_runtime_runs
       WHERE owner_user_id = ? AND agent_id = ? AND request_id = ?`,
    ).get(ownerUserId, agentId, requestId) as AgentBrowserRuntimeRunRow | undefined) ?? null
  );
}

export function getRuntimeRunByOwner(
  ownerUserId: number,
  jobId: string,
): AgentBrowserRuntimeRunRow | null {
  return (
    (db.prepare(
      `SELECT * FROM agent_browser_runtime_runs
       WHERE job_id = ? AND owner_user_id = ?`,
    ).get(jobId, ownerUserId) as AgentBrowserRuntimeRunRow | undefined) ?? null
  );
}

export function firstPotentiallyActiveRuntimeRun(): AgentBrowserRuntimeRunRow | null {
  return (
    (db.prepare(
      `SELECT * FROM agent_browser_runtime_runs
       WHERE terminal_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1`,
    ).get() as AgentBrowserRuntimeRunRow | undefined) ?? null
  );
}

export function markRuntimeRunTerminal(jobId: string, terminalAt = new Date().toISOString()): void {
  db.prepare(
    `UPDATE agent_browser_runtime_runs
     SET terminal_at = COALESCE(terminal_at, ?)
     WHERE job_id = ?`,
  ).run(terminalAt, jobId);
}
