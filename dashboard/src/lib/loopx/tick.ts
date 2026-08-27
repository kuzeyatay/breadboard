// The write path: one LoopX tick per completed Hermes turn.
//
// This runs after a turn has finished streaming, never before or during one. It
// creates the goal the first time a conversation qualifies, records what the
// turn actually delivered, and refreshes the snapshot the next turn will read.
// Nothing here is awaited by a request handler: a tick that fails leaves the
// previous snapshot in place and the conversation keeps working.

import { recordAuditEvent } from "../hermes/runtime-store.ts";
import type { HermesSurface } from "../hermes/config.ts";
import type { CapabilityMode } from "../hermes/capability-policy.ts";
import {
  LoopxTickRuntimeError,
  runLoopxTickViaRuntime,
} from "../runtime-v2/loopx-tick-job.ts";
import { decideEngagement } from "./governance.ts";
import { LoopxError, loopxText } from "./request.ts";
import {
  loopxEnabled,
  loopxGoalExists,
  loopxPaths,
} from "./state.ts";

/** One tick per conversation at a time; a second request is dropped, not queued. */
const inFlight = new Set<string>();

export interface LoopxTickInput {
  userId: number;
  gardenId: string | null;
  conversationPublicId: string;
  surface: HermesSurface;
  mode: CapabilityMode;
  /** The user message this turn answered, for the engagement rule. */
  userText: string;
  userTurnCount: number;
  /** The objective to open the goal with, normally the conversation's first request. */
  objective: string;
  outcome: "completed" | "error" | "cancelled";
  /** Observable facts about what the turn did, never a model self-report. */
  toolCalls: number;
  producedArtifact: boolean;
}

export interface LoopxTickResult {
  ran: boolean;
  reason: string;
  created?: boolean;
  goalId?: string;
  durationMs?: number;
}

export async function runLoopxTick(
  input: LoopxTickInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LoopxTickResult> {
  if (!loopxEnabled(env)) return { ran: false, reason: "disabled" };
  if (!input.conversationPublicId) {
    return { ran: false, reason: "no_conversation" };
  }
  const hasGoal = loopxGoalExists(input.conversationPublicId, env);
  const engagement = decideEngagement({
    surface: input.surface,
    mode: input.mode,
    userText: input.userText,
    userTurnCount: input.userTurnCount,
    hasGoal,
  });
  if (!engagement.engaged) return { ran: false, reason: engagement.reason };
  if (inFlight.has(input.conversationPublicId)) {
    return { ran: false, reason: "tick_in_flight" };
  }
  inFlight.add(input.conversationPublicId);
  const paths = loopxPaths(input.conversationPublicId, env);
  try {
    const result = await runLoopxTickViaRuntime({
      scope: {
        userId: input.userId,
        gardenId: input.gardenId,
        conversationId: input.conversationPublicId,
      },
      request: {
        protocolVersion: 1,
        operation: "tick",
        conversationPublicId: input.conversationPublicId,
        turnSequence: input.userTurnCount,
        objective: loopxText(input.objective) || "Continue this work",
        outcome: input.outcome,
        toolCalls: input.toolCalls,
        producedArtifact: input.producedArtifact,
      },
    });
    return {
      ran: true,
      reason: engagement.reason,
      created: result.created,
      goalId: result.goalId,
      durationMs: result.durationMs,
    };
  } catch (error) {
    if (
      error instanceof LoopxTickRuntimeError &&
      error.code === "loopx_runtime_unavailable"
    ) return { ran: false, reason: "runtime_unavailable" };
    // A failed tick must never surface as a failed turn. Record it and leave the
    // previous snapshot alone: stale loop context is better than none, and the
    // next completed turn tries again.
    recordAuditEvent({
      eventType: "loopx.tick_failed",
      payload: {
        goalId: paths.goalId,
        code:
          error instanceof LoopxError || error instanceof LoopxTickRuntimeError
            ? error.code
            : "loopx_unknown_error",
        message: loopxText(
          error instanceof Error ? error.message : String(error),
          300,
        ),
      },
    });
    return { ran: false, reason: "tick_failed" };
  } finally {
    inFlight.delete(input.conversationPublicId);
  }
}

/** Fire-and-forget entry point for the runtime completion hooks. */
export function scheduleLoopxTick(input: LoopxTickInput): void {
  void runLoopxTick(input).catch(() => {
    // runLoopxTick already audits its own failures.
  });
}
