if (typeof window !== "undefined") {
  throw new Error("Agent TARS Runtime control is server-only.");
}

// Authenticated durable facade for Agent TARS. Next prepares one immutable
// private profile, submits a fixed scoped Runtime job, and thereafter only
// reads/cancels its sealed projection. The UI-TARS database remains the durable
// product ledger for history, approval ownership, and restored screenshots.

import { randomUUID } from "node:crypto";
import { dashboardDataDir } from "../runtime-paths.ts";
import {
  abortOuterAgentRun,
  readOuterAgentRunView,
  startOuterAgentRun,
  type OuterAgentRunStatus,
  type OuterAgentRunView,
} from "../runtime-v2/outer-agent-run.ts";
import { validateAgentConfiguration } from "./config.ts";
import { UITarsServiceError } from "./errors.ts";
import { resolveRunModel } from "./model-provider.ts";
import { configurationForAgentTarsTask } from "./operator-routing.ts";
import { prepareUITarsRunProfile, uiTarsProfileId } from "./run-profile.ts";
import * as store from "./store.ts";

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TERMINAL = new Set(["completed", "failed", "aborted", "runtime_lost"]);
const ACTIVE = new Set(["queued", "starting", "running", "awaiting_approval"]);
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(userId: number): void {
  const key = String(userId);
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || now > current.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return;
  }
  if (current.count >= 10) throw new UITarsServiceError(429, "rate_limited");
  current.count += 1;
}

function validatedLaunch(userId: number, agentId: string, task: string) {
  const agent = store.getAgent(userId, agentId);
  if (!agent) throw new UITarsServiceError(404, "agent_not_found");
  if (agent.enabled !== 1) throw new UITarsServiceError(409, "agent_disabled");
  let raw: unknown;
  try {
    raw = JSON.parse(agent.configuration_json);
  } catch {
    throw new UITarsServiceError(400, "invalid_configuration");
  }
  const parsed = validateAgentConfiguration(raw);
  if (!parsed.ok || !parsed.value) {
    throw new UITarsServiceError(400, "invalid_configuration");
  }
  if (!parsed.value.model.trim()) {
    throw new UITarsServiceError(400, "model_not_configured");
  }
  const normalizedTask = typeof task === "string" ? task.trim() : "";
  if (!normalizedTask) throw new UITarsServiceError(400, "empty_task");
  if (normalizedTask.length > 8_000 || Buffer.byteLength(normalizedTask, "utf8") > 32 * 1024) {
    throw new UITarsServiceError(400, "task_too_long");
  }
  const resolved = resolveRunModel(parsed.value, store.getSecret(agentId) ?? undefined);
  return {
    task: normalizedTask,
    configuration: configurationForAgentTarsTask(resolved.configuration, normalizedTask),
    providerApiKey: resolved.providerApiKey ?? null,
  };
}

export async function startRun(
  userId: number,
  agentId: string,
  task: string,
  options: { readonly requestId?: string } = {},
): Promise<{ readonly runId: string; readonly status: OuterAgentRunStatus }> {
  rateLimit(userId);
  const requestId = options.requestId?.trim() || randomUUID();
  if (!REQUEST_ID.test(requestId)) {
    throw new UITarsServiceError(400, "invalid_request_id");
  }
  const launch = validatedLaunch(userId, agentId, task);
  const profileId = uiTarsProfileId(userId, agentId, requestId);
  try {
    prepareUITarsRunProfile(dashboardDataDir(), {
      profileId,
      ownerUserId: userId,
      agentId,
      task: launch.task,
      configuration: launch.configuration,
      providerApiKey: launch.providerApiKey,
    });
  } catch (error) {
    if (error instanceof Error && /identity was reused/u.test(error.message)) {
      throw new UITarsServiceError(409, "request_conflict");
    }
    throw error;
  }

  const runtime = await startOuterAgentRun({
    kind: "agent-tars",
    userId,
    requestId,
    requestPayload: {
      agentId,
      task: launch.task,
      profileId,
    },
  });
  store.createRunRecord({
    id: runtime.runId,
    agentId,
    userId,
    task: launch.task,
    operatorType: launch.configuration.operator,
    runtimeSessionId: runtime.runId,
  });
  return runtime;
}

export function requireRunForAgent(
  userId: number,
  agentId: string,
  runId: string,
): store.RunRow {
  const run = store.getRunForAgent(userId, agentId, runId);
  if (!run) throw new UITarsServiceError(404, "run_not_found");
  return run;
}

function persistedStatus(run: store.RunRow): OuterAgentRunStatus {
  if (run.status === "completed") return "completed";
  if (run.status === "aborted") return "aborted";
  if (run.status === "failed" || run.status === "runtime_lost") return "failed";
  return run.status === "queued" ? "queued" : "running";
}

/** Reconcile Runtime's bounded projection into the long-lived product ledger. */
export async function syncRunProjection(
  userId: number,
  agentId: string,
  runId: string,
): Promise<{ readonly run: store.RunRow; readonly runtime: OuterAgentRunView | null }> {
  let run = requireRunForAgent(userId, agentId, runId);
  let runtime: OuterAgentRunView | null = null;
  try {
    runtime = await readOuterAgentRunView("agent-tars", userId, runId, 0);
    if (runtime.events.length) {
      store.persistEvents(runId, [...runtime.events]);
      run = requireRunForAgent(userId, agentId, runId);
    }
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "run_not_found") throw error;
    if (ACTIVE.has(run.status)) {
      store.markRunRuntimeLost(runId);
      run = requireRunForAgent(userId, agentId, runId);
    }
  }
  return { run, runtime };
}

/** Generic SSE view backed by Runtime, with complete history from the DB ledger. */
export async function readEventsView(
  userId: number,
  agentId: string,
  runId: string,
  since: number,
): Promise<OuterAgentRunView> {
  if (!Number.isSafeInteger(since) || since < 0) {
    throw new UITarsServiceError(400, "invalid_event_cursor");
  }
  const reconciled = await syncRunProjection(userId, agentId, runId);
  return {
    events: store.listEvents(userId, runId, since),
    terminal: TERMINAL.has(reconciled.run.status) || reconciled.runtime?.terminal === true,
    status: persistedStatus(reconciled.run),
  };
}

export async function runView(
  userId: number,
  agentId: string,
  runId: string,
  since = 0,
): Promise<{
  readonly run: store.RunRow;
  readonly events: ReturnType<typeof store.listEvents>;
  readonly pendingApproval: store.PendingUITarsApproval | null;
}> {
  const { run } = await syncRunProjection(userId, agentId, runId);
  return {
    run,
    events: store.listEvents(userId, runId, since),
    pendingApproval: store.pendingApproval(userId, agentId, runId),
  };
}

export async function refreshAgentRuns(userId: number, agentId: string): Promise<void> {
  const active = store.listRuns(userId, agentId, 50).filter((run) => ACTIVE.has(run.status));
  await Promise.allSettled(active.map((run) => syncRunProjection(userId, agentId, run.id)));
}

export async function abortRun(
  userId: number,
  runId: string,
  agentId?: string,
): Promise<boolean> {
  const run = agentId
    ? requireRunForAgent(userId, agentId, runId)
    : store.getRun(userId, runId);
  if (!run) throw new UITarsServiceError(404, "run_not_found");
  return abortOuterAgentRun("agent-tars", userId, runId);
}
