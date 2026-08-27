// Durable dashboard facade for Stock Analyst. Next writes the existing trusted
// service boot profile before submission; Rust then starts that dependency and
// a fresh worker owns the question, progress stream, cancellation, and terminal
// projection. No run map or open response body remains in the dashboard.

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
} from "../supervisor-control.ts";
import { prepareService } from "./service.ts";
import type { StockAnalystSettings } from "./settings.ts";

export type StockAnalystEvent = OuterAgentEvent;

const RUNNING_SERVICE_STATES = new Set(["starting", "healthy", "degraded", "ready", "busy"]);

async function coldStartHint(): Promise<boolean> {
  if (!isRuntimeV2ServiceControlConfigured()) return false;
  const snapshot = await readSupervisedServiceSnapshot("stock-analyst").catch(() => null);
  return !snapshot || !RUNNING_SERVICE_STATES.has(snapshot.state);
}

export interface StartStockAnalystRuntimeRunInput {
  readonly userId: number;
  readonly requestId?: string;
  readonly task: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly settings: StockAnalystSettings;
  readonly memoryContext: string;
  readonly conversationContext?: string;
}

export async function startRun(
  input: StartStockAnalystRuntimeRunInput,
): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  // The managed service reads this private data-root profile at dependency
  // admission. It must exist before job submission; the disposable worker is
  // deliberately not given service-control or provider-secret authority.
  const [service, coldStart] = await Promise.all([
    prepareService({
      baseUrl: input.baseUrl,
      apiKey: chatmockApiKeyValue(),
      model: input.model,
      settings: input.settings,
    }),
    coldStartHint(),
  ]);
  return startOuterAgentRun({
    kind: "stock-analyst",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      task: input.task,
      model: input.model,
      baseUrl: input.baseUrl,
      settings: input.settings,
      memoryContext: input.memoryContext,
      conversationContext: input.conversationContext ?? "",
      serviceModel: service.model,
      coldStart,
    },
  });
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<StockAnalystEvent[]> {
  return [...(await readOuterAgentRunView("stock-analyst", userId, runId, since)).events];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return (await readOuterAgentRunView("stock-analyst", userId, runId, 0)).terminal;
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortOuterAgentRun("stock-analyst", userId, runId);
}
