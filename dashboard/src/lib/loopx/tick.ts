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
import { decideEngagement, deliveryFor } from "./governance.ts";
import {
  LoopxError,
  loopxEnabled,
  loopxGoalExists,
  loopxPaths,
  loopxText,
  resolveLoopxRuntime,
  runLoopx,
} from "./runtime.ts";
import { buildSnapshot, readObjective, writeSnapshot } from "./snapshot.ts";

/** One tick per conversation at a time; a second request is dropped, not queued. */
const inFlight = new Set<string>();

export interface LoopxTickInput {
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
  if (!resolveLoopxRuntime(env)) {
    return { ran: false, reason: "runtime_unavailable" };
  }
  if (inFlight.has(input.conversationPublicId)) {
    return { ran: false, reason: "tick_in_flight" };
  }
  inFlight.add(input.conversationPublicId);
  const started = Date.now();
  const paths = loopxPaths(input.conversationPublicId, env);
  try {
    if (!hasGoal) {
      const objective = loopxText(input.objective) || "Continue this work";
      await runLoopx({
        conversationPublicId: input.conversationPublicId,
        command: [
          "bootstrap",
          "--project",
          paths.project,
          "--goal-id",
          paths.goalId,
          "--objective",
          objective,
          // The project directory is Breadboard's own, so there is nothing to
          // scan, and the shared registry is never written.
          "--no-onboarding-scan",
          "--no-global-sync",
        ],
        env,
      });
    }

    const delivery = deliveryFor(input);
    await runLoopx({
      conversationPublicId: input.conversationPublicId,
      command: [
        "refresh-state",
        "--goal-id",
        paths.goalId,
        "--project",
        paths.project,
        "--classification",
        delivery.classification,
        "--delivery-batch-scale",
        delivery.scale,
        "--delivery-outcome",
        delivery.outcome,
        "--no-global-sync",
        "--suppress-external-sinks",
      ],
      env,
    });

    const quota = await runLoopx({
      conversationPublicId: input.conversationPublicId,
      command: ["quota", "should-run", "--goal-id", paths.goalId],
      env,
    });
    writeSnapshot(
      input.conversationPublicId,
      buildSnapshot({
        goalId: paths.goalId,
        objective: readObjective(paths.stateFile),
        quota: quota.payload,
        capturedAt: new Date().toISOString(),
      }),
      env,
    );
    return {
      ran: true,
      reason: engagement.reason,
      created: !hasGoal,
      goalId: paths.goalId,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    // A failed tick must never surface as a failed turn. Record it and leave the
    // previous snapshot alone: stale loop context is better than none, and the
    // next completed turn tries again.
    recordAuditEvent({
      eventType: "loopx.tick_failed",
      payload: {
        goalId: paths.goalId,
        code: error instanceof LoopxError ? error.code : "loopx_unknown_error",
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
