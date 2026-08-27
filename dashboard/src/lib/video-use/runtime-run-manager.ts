// Durable dashboard facade for Video Use.
//
// Next owns only authenticated submission/correlation. The source adoption,
// transcript/silence planning, render, artifact publication and all active
// cancellation controllers live inside one fresh Runtime V2 worker.

import {
  abortOuterAgentRun,
  readOuterAgentRunView,
  startOuterAgentRun,
  type OuterAgentEvent,
  type OuterAgentRunStatus,
} from "../runtime-v2/outer-agent-run.ts";
import type { StartVideoUseRunInput } from "./run-manager.ts";
import { videoUseHealth } from "./runtime.ts";

export type VideoUseRuntimeEvent = OuterAgentEvent;

export interface StartRuntimeVideoUseRunInput extends StartVideoUseRunInput {
  /** The chat turn identity used as Runtime's durable idempotency request. */
  clientMessageId?: string;
}

/** Submit one sealed Video Use worker. There is deliberately no local fallback. */
export async function startRun(
  input: StartRuntimeVideoUseRunInput,
): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  // Preserve the old synchronous readiness refusal. This check is filesystem
  // only; it never probes an executable or starts a service in Next.
  const health = videoUseHealth();
  if (!health.available) {
    throw new Error(health.reason ?? "Video Use is not ready on this machine.");
  }
  return startOuterAgentRun({
    kind: "video-use",
    userId: input.userId,
    requestId: input.clientMessageId,
    requestPayload: {
      conversationPublicId: input.conversationPublicId,
      request: input.request,
      model: input.model,
      reasoningEffort: input.reasoningEffort ?? "medium",
      baseUrl: input.baseUrl,
      conversationContext: input.conversationContext ?? "",
    },
  });
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<VideoUseRuntimeEvent[]> {
  return [...(await readOuterAgentRunView("video-use", userId, runId, since)).events];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return (await readOuterAgentRunView("video-use", userId, runId, 0)).terminal;
}

/** Rust cancellation is awaited before the route reports success. */
export function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortOuterAgentRun("video-use", userId, runId);
}
