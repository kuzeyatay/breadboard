// Durable Next.js facade for Vibe Trading.
//
// The trusted server writes the service's closed configuration before the job
// is submitted. Rust can therefore satisfy the job's Vibe Trading dependency
// with the right per-run model/settings. The disposable worker receives only
// product inputs plus Runtime-injected loopback service credentials.

import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import {
  abortOuterAgentRun,
  readOuterAgentRunView,
  startOuterAgentRun,
  type OuterAgentEvent,
  type OuterAgentRunStatus,
} from "../runtime-v2/outer-agent-run.ts";
import {
  isRuntimeV2ServiceControlConfigured,
  readSupervisedServiceSnapshot,
  type SupervisedServiceLifecycleState,
} from "../supervisor-control.ts";
import type { StartRunInput } from "./run-manager.ts";
import { prepareService } from "./service.ts";

export type VibeTradingEvent = OuterAgentEvent;

const ALREADY_RUNNING = new Set<SupervisedServiceLifecycleState>([
  "starting",
  "healthy",
  "degraded",
  "ready",
  "busy",
]);

async function serviceColdStartHint(): Promise<boolean> {
  if (!isRuntimeV2ServiceControlConfigured()) return false;
  const before = await readSupervisedServiceSnapshot("vibe-trading").catch(() => null);
  return !before || !ALREADY_RUNNING.has(before.state);
}

interface StartDependencies {
  readonly prepare: typeof prepareService;
  readonly coldStartHint: () => Promise<boolean>;
  readonly submit: typeof startOuterAgentRun;
}

const DEFAULT_DEPENDENCIES: StartDependencies = {
  prepare: prepareService,
  coldStartHint: serviceColdStartHint,
  submit: startOuterAgentRun,
};

/**
 * Write the trusted service configuration first, then submit one sealed job.
 * The optional dependency seam exists only for an ordering/security test.
 */
export async function startRun(
  input: StartRunInput & { requestId?: string },
  dependencies: StartDependencies = DEFAULT_DEPENDENCIES,
): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  await dependencies.prepare({
    baseUrl: input.baseUrl,
    apiKey: chatmockApiKeyValue(),
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    settings: input.settings,
  });
  const coldStart = await dependencies.coldStartHint();
  return dependencies.submit({
    kind: "vibe-trading",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      task: input.task,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      baseUrl: input.baseUrl,
      settings: {
        model: input.settings.model,
        temperature: input.settings.temperature,
        memory: input.settings.memory,
        dataCache: input.settings.dataCache,
        cryptoExchange: input.settings.cryptoExchange,
      },
      conversationContext: input.conversationContext ?? "",
      coldStart,
    },
  });
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<VibeTradingEvent[]> {
  return [...(await readOuterAgentRunView("vibe-trading", userId, runId, since)).events];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return (await readOuterAgentRunView("vibe-trading", userId, runId, 0)).terminal;
}

export function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortOuterAgentRun("vibe-trading", userId, runId);
}
