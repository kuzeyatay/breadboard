// Durable dashboard facade for Socials Manager. Drafting, artifact publication,
// calendar writes, and Postiz hand-off execute only in a fresh Runtime worker.

import {
  abortOuterAgentRun,
  readOuterAgentRunView,
  startOuterAgentRun,
  type OuterAgentEvent,
} from "../runtime-v2/outer-agent-run.ts";

export type SocialsManagerEvent = OuterAgentEvent;
export type SocialsManagerRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "aborted";

export interface StartSocialsManagerRuntimeRunInput {
  readonly userId: number;
  readonly requestId?: string;
  readonly brief: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly conversationPublicId?: string | null;
  readonly conversationContext?: string;
}

export async function startRun(
  input: StartSocialsManagerRuntimeRunInput,
): Promise<{ runId: string; status: SocialsManagerRunStatus }> {
  const run = await startOuterAgentRun({
    kind: "socials-manager",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      brief: input.brief,
      model: input.model,
      baseUrl: input.baseUrl,
      conversationPublicId: input.conversationPublicId ?? null,
      conversationContext: input.conversationContext ?? "",
    },
  });
  return {
    runId: run.runId,
    status: run.status === "planning" ? "running" : run.status,
  };
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<SocialsManagerEvent[]> {
  return [...(await readOuterAgentRunView("socials-manager", userId, runId, since)).events];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return (await readOuterAgentRunView("socials-manager", userId, runId, 0)).terminal;
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortOuterAgentRun("socials-manager", userId, runId);
}
