// Durable Next.js facade for MoneyPrinter. The dashboard submits one sealed
// finite job; a fresh Runtime worker owns the clone interaction, progress
// projection, artifact publication, cancellation, and terminal result.

import {
  abortOuterAgentRun,
  readOuterAgentRunView,
  startOuterAgentRun,
  type OuterAgentEvent,
  type OuterAgentRunStatus,
} from "../runtime-v2/outer-agent-run.ts";
import type { MoneyPrinterRequest } from "./identity.ts";

export type MoneyPrinterEvent = OuterAgentEvent;

export interface StartMoneyPrinterRuntimeRunInput {
  readonly userId: number;
  readonly requestId?: string;
  readonly conversationPublicId: string;
  readonly request: MoneyPrinterRequest;
  readonly model: string;
  readonly baseUrl: string;
}

export function startRun(
  input: StartMoneyPrinterRuntimeRunInput,
): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  return startOuterAgentRun({
    kind: "money-printer",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      conversationPublicId: input.conversationPublicId,
      request: input.request,
      model: input.model,
      baseUrl: input.baseUrl,
    },
  });
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<MoneyPrinterEvent[]> {
  return [...(await readOuterAgentRunView("money-printer", userId, runId, since)).events];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return (await readOuterAgentRunView("money-printer", userId, runId, 0)).terminal;
}

export function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortOuterAgentRun("money-printer", userId, runId);
}
