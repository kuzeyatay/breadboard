// UI-TARS service: the authorization + orchestration layer between the
// authenticated dashboard API and the loopback adapter. Enforces agent/run
// ownership, rate limits, secret injection (server-side only), and idempotent
// event persistence for refresh recovery.

import { UITarsClient, UITarsAdapterError, type AdapterRunSummary } from "./client.ts";
import { uiTarsMode, resolveUITarsConfig, type UITarsMode } from "./adapter-config.ts";
import * as store from "./store.ts";
import { validateAgentConfiguration, type UITarsAgentConfiguration } from "./config.ts";

export class UITarsServiceError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export type RuntimeState = "available" | "starting" | "unavailable" | "misconfigured" | "disabled";

// --- lightweight in-memory rate limiting (per user, per action) ---
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (b.count >= max) throw new UITarsServiceError(429, "rate_limited");
  b.count += 1;
}

function client(): UITarsClient {
  return new UITarsClient(resolveUITarsConfig());
}

export function mode(): UITarsMode {
  return uiTarsMode();
}

export async function health(): Promise<{ mode: UITarsMode; runtimeState: RuntimeState; health: Awaited<ReturnType<UITarsClient["health"]>> }> {
  const m = uiTarsMode();
  if (m === "disabled") {
    return {
      mode: m,
      runtimeState: "disabled",
      health: { status: "unavailable", runtime: null, realBrowser: false, operator: null, version: null },
    };
  }
  const h = await client().health();
  return { mode: m, runtimeState: h.status === "healthy" ? "available" : "unavailable", health: h };
}

/** Derive per-agent runtime state for the Agents page card. */
function agentRuntimeState(
  agent: store.PresentedAgent,
  m: UITarsMode,
  adapterHealthy: boolean,
): RuntimeState {
  if (m === "disabled" || !agent.enabled) return "disabled";
  const cfgValid = validateAgentConfiguration(agent.configuration).ok && agent.configuration.model.trim().length > 0;
  if (!cfgValid || (!agent.secretConfigured && adapterHealthy)) return "misconfigured";
  return adapterHealthy ? "available" : "unavailable";
}

export async function agentsPage(userId: number): Promise<{
  mode: UITarsMode;
  adapter: Awaited<ReturnType<UITarsClient["health"]>>;
  agents: Array<store.PresentedAgent & { runtimeState: RuntimeState; lastRun?: { id: string; status: string; createdAt: string } }>;
}> {
  const m = uiTarsMode();
  const adapter =
    m === "disabled"
      ? { status: "unavailable" as const, runtime: null, realBrowser: false, operator: null, version: null }
      : await client().health();
  const adapterHealthy = adapter.status === "healthy";
  const agents = store.listAgents(userId).map((row) => {
    const presented = store.presentAgent(row);
    const runs = store.listRuns(userId, row.id, 1);
    const lastRun = runs[0];
    return {
      ...presented,
      runtimeState: agentRuntimeState(presented, m, adapterHealthy),
      ...(lastRun ? { lastRun: { id: lastRun.id, status: lastRun.status, createdAt: lastRun.created_at } } : {}),
    };
  });
  return { mode: m, adapter, agents };
}

export function requireAgent(userId: number, agentId: string): store.AgentRow {
  const agent = store.getAgent(userId, agentId);
  if (!agent) throw new UITarsServiceError(404, "agent_not_found");
  return agent;
}

export function updateAgentConfig(
  userId: number,
  agentId: string,
  patch: { name?: string; description?: string; enabled?: boolean; configuration?: UITarsAgentConfiguration },
): store.PresentedAgent {
  const updated = store.updateAgent(userId, agentId, patch);
  if (!updated) throw new UITarsServiceError(404, "agent_not_found");
  return store.presentAgent(updated);
}

/** Write-only credential update. Empty/undefined preserves; explicit null removes. */
export function updateSecret(userId: number, agentId: string, providerApiKey: string | null | undefined): void {
  requireAgent(userId, agentId);
  if (providerApiKey === undefined || providerApiKey === "") return; // preserve existing
  if (providerApiKey === null) {
    store.clearSecret(agentId);
    return;
  }
  if (typeof providerApiKey !== "string" || providerApiKey.length > 4096) {
    throw new UITarsServiceError(400, "invalid_credential");
  }
  store.setSecret(agentId, providerApiKey);
}

export async function startRun(userId: number, agentId: string, task: string): Promise<AdapterRunSummary> {
  const m = uiTarsMode();
  if (m === "disabled") throw new UITarsServiceError(409, "runtime_disabled");
  rateLimit(`run:${userId}`, 10, 60_000);

  const agent = requireAgent(userId, agentId);
  if (agent.enabled !== 1) throw new UITarsServiceError(409, "agent_disabled");
  const parsed = validateAgentConfiguration(JSON.parse(agent.configuration_json));
  if (!parsed.ok || !parsed.value) throw new UITarsServiceError(400, "invalid_configuration");
  if (parsed.value.model.trim().length === 0) throw new UITarsServiceError(400, "model_not_configured");

  const t = typeof task === "string" ? task.trim() : "";
  if (t.length === 0) throw new UITarsServiceError(400, "empty_task");
  if (t.length > 8000) throw new UITarsServiceError(400, "task_too_long");

  const runId = store.publicId("run");
  const providerApiKey = store.getSecret(agentId) ?? undefined; // server-only injection

  let summary: AdapterRunSummary;
  try {
    summary = await client().createRun({
      runId,
      ownerUserId: userId,
      task: t,
      config: parsed.value,
      ...(providerApiKey ? { providerApiKey } : {}),
    });
  } catch (err) {
    if (err instanceof UITarsAdapterError && err.code === "unavailable") {
      throw new UITarsServiceError(503, "runtime_unavailable");
    }
    throw new UITarsServiceError(502, err instanceof UITarsAdapterError ? err.code : "adapter_error");
  }

  store.createRunRecord({ id: runId, agentId, userId, task: t, runtimeSessionId: summary.runId });
  await syncRun(userId, runId);
  return summary;
}

/** Pull new adapter events into the DB (idempotent). Returns the run summary if available. */
export async function syncRun(userId: number, runId: string): Promise<AdapterRunSummary | null> {
  const run = store.getRun(userId, runId);
  if (!run) throw new UITarsServiceError(404, "run_not_found");
  if (uiTarsMode() === "disabled") return null;
  try {
    const since = store.lastSequence(runId);
    const events = await client().eventsSince(runId, userId, since);
    if (events.length > 0) store.persistEvents(runId, events);
    return await client().getRun(runId, userId);
  } catch {
    // Adapter unreachable — the persisted state is still authoritative for the UI.
    return null;
  }
}

export async function runView(
  userId: number,
  runId: string,
  sinceSeq = 0,
): Promise<{ run: store.RunRow; events: ReturnType<typeof store.listEvents>; live: AdapterRunSummary | null }> {
  const live = await syncRun(userId, runId).catch(() => null);
  const run = store.getRun(userId, runId);
  if (!run) throw new UITarsServiceError(404, "run_not_found");
  return { run, events: store.listEvents(userId, runId, sinceSeq), live };
}

export async function decide(
  userId: number,
  runId: string,
  actionId: string,
  decision: "approve" | "reject",
): Promise<void> {
  rateLimit(`decide:${userId}`, 60, 60_000);
  const run = store.getRun(userId, runId);
  if (!run) throw new UITarsServiceError(404, "run_not_found");
  if (!actionId) throw new UITarsServiceError(400, "missing_action_id");
  try {
    if (decision === "approve") await client().approve(runId, userId, actionId);
    else await client().reject(runId, userId, actionId);
    store.markApprovalDecidedBy(runId, actionId, userId);
  } catch (err) {
    const code = err instanceof UITarsAdapterError ? err.code : "adapter_error";
    const status = code === "already_decided" || code === "expired" || code === "run_mismatch" ? 409 : 502;
    throw new UITarsServiceError(status, code);
  }
  await syncRun(userId, runId).catch(() => null);
}

export async function abort(userId: number, runId: string): Promise<void> {
  const run = store.getRun(userId, runId);
  if (!run) throw new UITarsServiceError(404, "run_not_found");
  try {
    await client().abort(runId, userId);
  } catch (err) {
    throw new UITarsServiceError(502, err instanceof UITarsAdapterError ? err.code : "adapter_error");
  }
  await syncRun(userId, runId).catch(() => null);
}

export async function screenshot(userId: number, runId: string, screenshotId: string): Promise<Buffer | null> {
  const run = store.getRun(userId, runId);
  if (!run) throw new UITarsServiceError(404, "run_not_found");
  if (!/^[0-9]{1,12}$/.test(screenshotId)) throw new UITarsServiceError(400, "invalid_screenshot_id");
  return client().screenshot(runId, userId, screenshotId);
}
