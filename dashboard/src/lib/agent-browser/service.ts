// Authorization + orchestration between the authenticated dashboard API and the
// in-memory run manager. Enforces agent ownership, validates configuration, and
// rate-limits run creation. The run manager owns process lifecycle + events.

import * as store from "./store.ts";
import { validateAgentConfiguration } from "./config.ts";
import {
  startRun as managerStartRun,
  runtimeAvailability,
  type StartRunResult,
} from "./run-manager.ts";

export class AgentBrowserServiceError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export type RuntimeState = "available" | "unavailable" | "misconfigured" | "disabled";

const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (bucket.count >= max) throw new AgentBrowserServiceError(429, "rate_limited");
  bucket.count += 1;
}

function agentRuntimeState(agent: store.PresentedAgent, available: boolean): RuntimeState {
  if (!agent.enabled) return "disabled";
  if (agent.configuration.model.trim().length === 0) return "misconfigured";
  return available ? "available" : "unavailable";
}

export function agentsPage(userId: number): {
  available: boolean;
  reason?: string;
  agents: Array<store.PresentedAgent & { runtimeState: RuntimeState }>;
} {
  const availability = runtimeAvailability();
  const agents = store.listAgents(userId).map((row) => {
    const presented = store.presentAgent(row);
    return { ...presented, runtimeState: agentRuntimeState(presented, availability.available) };
  });
  return { available: availability.available, reason: availability.reason, agents };
}

export function requireAgent(userId: number, agentId: string): store.AgentRow {
  const agent = store.getAgent(userId, agentId);
  if (!agent) throw new AgentBrowserServiceError(404, "agent_not_found");
  return agent;
}

export function updateAgentConfig(
  userId: number,
  agentId: string,
  patch: Parameters<typeof store.updateAgent>[2],
): store.PresentedAgent {
  const updated = store.updateAgent(userId, agentId, patch);
  if (!updated) throw new AgentBrowserServiceError(404, "agent_not_found");
  return store.presentAgent(updated);
}

export function startRun(userId: number, agentId: string, task: string): StartRunResult {
  rateLimit(`run:${userId}`, 10, 60_000);
  const agent = requireAgent(userId, agentId);
  if (agent.enabled !== 1) throw new AgentBrowserServiceError(409, "agent_disabled");

  const parsed = validateAgentConfiguration(JSON.parse(agent.configuration_json));
  if (!parsed.ok || !parsed.value) throw new AgentBrowserServiceError(400, "invalid_configuration");
  if (parsed.value.model.trim().length === 0) throw new AgentBrowserServiceError(400, "model_not_configured");

  const trimmed = typeof task === "string" ? task.trim() : "";
  if (trimmed.length === 0) throw new AgentBrowserServiceError(400, "empty_task");
  if (trimmed.length > 8_000) throw new AgentBrowserServiceError(400, "task_too_long");

  const availability = runtimeAvailability();
  if (!availability.available) throw new AgentBrowserServiceError(503, "runtime_unavailable");

  try {
    return managerStartRun({ userId, agentId, task: trimmed, config: parsed.value });
  } catch (error) {
    throw new AgentBrowserServiceError(502, error instanceof Error ? error.message : "runtime_error");
  }
}
