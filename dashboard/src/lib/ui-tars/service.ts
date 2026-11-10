// Authenticated Agent TARS configuration and bounded control operations.
//
// Finite run creation, replay, cancellation, restart and terminal ownership
// live in runtime-run-manager.ts / the disposable Runtime worker. This module
// retains only product configuration plus the two explicit control exceptions:
// one-shot approval decisions and authenticated screenshot reads.

import { UITarsClient, UITarsAdapterError } from "./client.ts";
import { uiTarsMode, resolveUITarsConfig, type UITarsMode } from "./adapter-config.ts";
import * as store from "./store.ts";
import { validateAgentConfiguration, type UITarsAgentConfiguration } from "./config.ts";
import { providerRequiresStoredKey } from "./model-provider.ts";
import { UITarsServiceError } from "./errors.ts";
import { refreshAgentRuns, syncRunProjection } from "./runtime-run-manager.ts";
import { isRuntimeV2ServiceControlConfigured, readSupervisedServiceSnapshot, SupervisorResourceExhaustedError } from "../supervisor-control.ts";
import { unavailableServiceMessage } from "../runtime-v2/unavailable-service-message.ts";

export { UITarsServiceError } from "./errors.ts";

export type RuntimeState = "available" | "starting" | "unavailable" | "misconfigured" | "disabled";

const STOPPED_HEALTH: Awaited<ReturnType<UITarsClient["health"]>> = {
  status: "unavailable", runtime: null, realBrowser: false, operator: null, version: null,
};

const decisionBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimitDecision(userId: number): void {
  const key = String(userId);
  const now = Date.now();
  const current = decisionBuckets.get(key);
  if (!current || now > current.resetAt) {
    decisionBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return;
  }
  if (current.count >= 60) throw new UITarsServiceError(429, "rate_limited");
  current.count += 1;
}

function client(): UITarsClient {
  return new UITarsClient(resolveUITarsConfig());
}

export function mode(): UITarsMode {
  return uiTarsMode();
}

export async function health(): Promise<{
  mode: UITarsMode;
  runtimeState: RuntimeState;
  health: Awaited<ReturnType<UITarsClient["health"]>>;
  /** Why the runtime is unavailable, in words the person can act on. */
  message?: string;
}> {
  const currentMode = uiTarsMode();
  if (isRuntimeV2ServiceControlConfigured()) {
    const snapshot = await readSupervisedServiceSnapshot("ui-tars");
    if (!snapshot || ["installation-unavailable", "resource-blocked", "failed"].includes(snapshot.state)) {
      return {
        mode: currentMode,
        runtimeState: "unavailable",
        health: STOPPED_HEALTH,
        message: unavailableServiceMessage("The computer-use runtime", snapshot?.state),
      };
    }
    if (snapshot.state === "available-but-stopped" || snapshot.state === "stopped") {
      // Native installation availability permits an on-demand start; it says
      // nothing about a live browser or computer operator. Do not warm the
      // adapter merely to render passive health.
      return { mode: currentMode, runtimeState: "available", health: STOPPED_HEALTH };
    }
    if (snapshot.state === "pending" || snapshot.state === "starting") {
      return { mode: currentMode, runtimeState: "starting", health: STOPPED_HEALTH };
    }
  }
  const adapter = await client().health();
  return {
    mode: currentMode,
    runtimeState: adapter.status === "healthy" ? "available" : "unavailable",
    health: adapter,
  };
}

function agentRuntimeState(
  agent: store.PresentedAgent,
  adapter: Awaited<ReturnType<UITarsClient["health"]>>,
  runtimeState: RuntimeState,
): RuntimeState {
  if (!agent.enabled) return "disabled";
  const configurationReady =
    validateAgentConfiguration(agent.configuration).ok && agent.configuration.model.trim().length > 0;
  if (!configurationReady) return "misconfigured";
  if (providerRequiresStoredKey(agent.configuration) && !agent.secretConfigured) {
    return "misconfigured";
  }
  if (runtimeState !== "available") return runtimeState;
  if (agent.configuration.operator === "computer" && !adapter.operators?.includes("computer")) {
    return "unavailable";
  }
  return "available";
}

export async function agentsPage(userId: number): Promise<{
  mode: UITarsMode;
  adapter: Awaited<ReturnType<UITarsClient["health"]>>;
  agents: Array<
    store.PresentedAgent & {
      runtimeState: RuntimeState;
      lastRun?: { id: string; status: string; createdAt: string };
    }
  >;
}> {
  const currentMode = uiTarsMode();
  const rows = store.listAgents(userId);
  await Promise.allSettled(rows.map((agent) => refreshAgentRuns(userId, agent.id)));
  const { health: adapter, runtimeState } = await health();
  const agents = rows.map((row) => {
    const presented = store.presentAgent(row);
    const lastRun = store.listRuns(userId, row.id, 1)[0];
    return {
      ...presented,
      runtimeState: agentRuntimeState(presented, adapter, runtimeState),
      ...(lastRun
        ? { lastRun: { id: lastRun.id, status: lastRun.status, createdAt: lastRun.created_at } }
        : {}),
    };
  });
  return { mode: currentMode, adapter, agents };
}

export function requireAgent(userId: number, agentId: string): store.AgentRow {
  const agent = store.getAgent(userId, agentId);
  if (!agent) throw new UITarsServiceError(404, "agent_not_found");
  return agent;
}

export function updateAgentConfig(
  userId: number,
  agentId: string,
  patch: {
    name?: string;
    description?: string;
    enabled?: boolean;
    configuration?: UITarsAgentConfiguration;
  },
): store.PresentedAgent {
  const updated = store.updateAgent(userId, agentId, patch);
  if (!updated) throw new UITarsServiceError(404, "agent_not_found");
  return store.presentAgent(updated);
}

/** Write-only credential update. Empty/undefined preserves; explicit null removes. */
export function updateSecret(
  userId: number,
  agentId: string,
  providerApiKey: string | null | undefined,
): void {
  requireAgent(userId, agentId);
  if (providerApiKey === undefined || providerApiKey === "") return;
  if (providerApiKey === null) {
    store.clearSecret(agentId);
    return;
  }
  if (
    typeof providerApiKey !== "string" ||
    Buffer.byteLength(providerApiKey, "utf8") > 4_096 ||
    /[\u0000-\u001f\u007f]/u.test(providerApiKey)
  ) {
    throw new UITarsServiceError(400, "invalid_credential");
  }
  store.setSecret(agentId, providerApiKey);
}

/**
 * Apply one single-use approval decision through the already job-held service.
 * The durable conditional claim prevents competing approve/reject requests;
 * the adapter independently enforces action-id single use.
 */
export async function decide(
  userId: number,
  agentId: string,
  runId: string,
  actionId: string,
  decision: "approve" | "reject",
): Promise<void> {
  rateLimitDecision(userId);
  if (!actionId || !/^[A-Za-z0-9_-]{1,128}$/u.test(actionId)) {
    throw new UITarsServiceError(400, "missing_action_id");
  }
  await syncRunProjection(userId, agentId, runId);
  const claim = store.claimApprovalDecision(userId, agentId, runId, actionId, decision);
  if (claim === "missing") throw new UITarsServiceError(404, "approval_not_found");
  if (claim === "conflict") throw new UITarsServiceError(409, "already_decided");
  if (claim === "in_flight") throw new UITarsServiceError(409, "decision_in_progress");
  if (claim === "already_same") return;

  try {
    if (decision === "approve") await client().approve(runId, userId, actionId);
    else await client().reject(runId, userId, actionId);
    store.finalizeApprovalDecision(runId, actionId, userId, decision);
  } catch (error) {
    const code = error instanceof UITarsAdapterError ? error.code : "adapter_error";
    if (code === "already_decided") {
      // A response can be lost after the adapter consumes its single-use gate.
      // The durable local claim makes this retry the same logical decision.
      store.finalizeApprovalDecision(runId, actionId, userId, decision);
      return;
    }
    store.rollbackApprovalDecision(runId, actionId, decision);
    const status = code === "expired" || code === "run_mismatch" ? 409 : 502;
    throw new UITarsServiceError(status, code);
  }
}

export async function screenshot(
  userId: number,
  agentId: string,
  runId: string,
  screenshotId: string,
): Promise<Buffer | null> {
  if (!store.getRunForAgent(userId, agentId, runId)) {
    throw new UITarsServiceError(404, "run_not_found");
  }
  if (!/^[0-9]{1,12}$/u.test(screenshotId)) {
    throw new UITarsServiceError(400, "invalid_screenshot_id");
  }
  const adapter = client();
  const current = await adapter.screenshot(runId, userId, screenshotId);
  if (current) return current;

  // Legacy screenshots predate the adapter's durable ownership manifest. The
  // dashboard DB authorizes the bounded restoration before the service claim.
  try {
    await adapter.restoreScreenshotHistory(runId, userId);
    return await adapter.screenshot(runId, userId, screenshotId);
  } catch (error) {
    if (error instanceof SupervisorResourceExhaustedError) throw error;
    return null;
  }
}
