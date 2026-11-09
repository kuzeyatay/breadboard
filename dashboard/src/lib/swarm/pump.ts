import { createHash } from "node:crypto";
import db from "../db.ts";
import { swarmCoordinatorPrompt } from "../system-prompts/coordination.ts";
import { SwarmScheduler } from "./scheduler.ts";
import { swarmStore } from "./service.ts";
import { runtimeSwarmAdapter } from "./runtime-adapter.ts";
import { workerSwarmAdapter } from "./worker-adapter.ts";
import type { OuterAgentKind } from "../runtime-v2/outer-agent-run-store.ts";
import type { SwarmSnapshot } from "./types.ts";
import { getConversationById, getConversationMessageByClientId } from "../conversations/store.ts";
import { getRuntimeSessionByConversation, recordAuditEvent } from "../hermes/runtime-store.ts";
import { getActiveRuntimeRun } from "../hermes/run-store.ts";
import { accountGoalModeTurn, readGoalModeState } from "../goal-mode.ts";

const state = globalThis as typeof globalThis & { __breadboardSwarmPumps?: Map<string, Promise<void>>; __breadboardSwarmWakes?: Set<string> };
const pumps = state.__breadboardSwarmPumps ??= new Map<string, Promise<void>>();
const repeat = state.__breadboardSwarmWakes ??= new Set<string>();
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const finalStates = new Set(["completed", "cancelled", "failed"]);

async function notifyCoordinator(snapshot: SwarmSnapshot): Promise<boolean> {
  const { run, tasks } = snapshot;
  if (["paused", "cancelling", "cancelled", "budget_limited"].includes(run.status)) return true;
  if (!tasks.some(task => ["verifying", "failed", "uncertain", "blocked", "awaiting_approval", "completed"].includes(task.status))) return true;
  const conversation = getConversationById(run.authority.conversationId);
  if (!conversation || conversation.archived_at) return true;
  const runtime = getRuntimeSessionByConversation(conversation.id);
  if (runtime && getActiveRuntimeRun(runtime.id)) return false;
  if (db.prepare("SELECT 1 FROM conversation_messages WHERE conversation_id=? AND status='pending' LIMIT 1").get(conversation.id)) return false;
  const origin = getConversationMessageByClientId(conversation.id, run.authority.originClientMessageId, "user");
  if (origin && db.prepare(`SELECT 1 FROM conversation_messages WHERE conversation_id=? AND role='user' AND order_index>?
    AND COALESCE(json_extract(metadata,'$.internalAgentContinuation'),0)<>1
    AND json_type(metadata,'$.chatCoordination') IS NULL LIMIT 1`).get(conversation.id, origin.order_index)) return true;
  const key = createHash("sha256").update(JSON.stringify(tasks.map(task => [task.key, task.status, task.activeAttemptId]))).digest("hex").slice(0, 24);
  const clientMessageId = `team:${run.id}:${key}`;
  // The ordinary turn reservation is the durable outbox and idempotency gate.
  // A pending/failed submission is inspected, never blindly sent again.
  if (getConversationMessageByClientId(conversation.id, clientMessageId, "user")) return true;
  const { startConversationTurn } = await import("../conversations/turn-service.ts");
  await startConversationTurn({ conversation, clientMessageId,
    text: swarmCoordinatorPrompt(run.authority.userId, { runId: run.id, objective: run.objective,
      updates: tasks.map(task => `${task.key} (${task.executor.kind}:${task.executor.id}): ${task.status}\n${task.summary.slice(0, 3_000)}${task.error ? `\n${task.error}` : ""}`).join("\n\n") }),
    surface: conversation.surface, surfaceContext: { activeGardenSlug: run.authority.gardenSlug ?? undefined },
    model: run.authority.model, reasoningEffort: run.authority.reasoningEffort, yoloMode: run.authority.standingApproval,
    internalAgentContinuation: true, swarmCoordinator: run.authority, swarmCoordinatorRunId: run.id });
  return true;
}

async function drain(userId: number, runId: string) {
  const store = swarmStore();
  const scheduler = new SwarmScheduler(store, executor => executor.kind === "runtime"
    ? runtimeSwarmAdapter(executor.id as OuterAgentKind) : workerSwarmAdapter);
  let failures = 0;
  for (;;) {
    const before = store.get(userId, runId);
    const conversation = getConversationById(before.authority.conversationId);
    if (!conversation || conversation.archived_at) store.control(userId, runId, "cancel");
    const goal = before.authority.goalId ? readGoalModeState(before.authority.conversationPublicId) : null;
    if (goal && goal.goal_id === before.authority.goalId && ["paused", "budget_limited", "usage_limited", "complete"].includes(goal.status) && !finalStates.has(before.status)) {
      store.control(userId, runId, "cancel");
    }
    if (!finalStates.has(before.status)) {
      try { await scheduler.tick(userId, runId); failures = 0; }
      catch (error) {
        failures += 1;
        recordAuditEvent({ eventType: "swarm.tick_retry", userId, payload: { runId, failures,
          message: error instanceof Error ? error.message : String(error) } });
        if (Date.now() > before.deadlineAt + 120_000) throw error;
        await pause(Math.min(10_000, failures * 1_000));
        continue;
      }
    }
    const snapshot = store.snapshot(userId, runId);
    if (snapshot.run.authority.goalId) accountGoalModeTurn({ conversationPublicId: snapshot.run.authority.conversationPublicId,
      goalId: snapshot.run.authority.goalId, runId, startedAt: new Date(snapshot.run.createdAt).toISOString(),
      tokensUsed: snapshot.run.chargedTokens, finished: finalStates.has(snapshot.run.status), outcome: "completed" });
    let notified = false;
    try { notified = await notifyCoordinator(snapshot); }
    catch (error) {
      recordAuditEvent({ eventType: "swarm.coordinator_pending", userId, payload: { runId,
        message: error instanceof Error ? error.message : String(error) } });
      // A transient chat/provider failure must not stop observing its workers.
      // Terminal teams retry their durable notification on the next reconnect.
    }
    if (finalStates.has(snapshot.run.status)) return;
    const active = snapshot.attempts.some(attempt => ["starting", "running", "cancelling"].includes(attempt.status));
    const ready = snapshot.run.status === "running" && snapshot.tasks.some(task => task.status === "queued" && task.dependsOn.every(key =>
      snapshot.tasks.some(dep => dep.key === key && (dep.status === "completed" || (task.verifies === key && dep.status === "verifying")))));
    if (!active && !ready && notified) return;
    await pause(2_000);
  }
}

/** Finite work for persisted assignments; no recurring service or process. */
export function wakeSwarm(userId: number, runId: string): void {
  if (pumps.has(runId)) { repeat.add(runId); return; }
  const work = drain(userId, runId).catch(error => {
    recordAuditEvent({ eventType: "swarm.recovery_pending", userId, payload: { runId, message: error instanceof Error ? error.message : String(error) } });
  }).finally(() => { pumps.delete(runId); if (repeat.delete(runId)) wakeSwarm(userId, runId); });
  pumps.set(runId, work);
}
export function recoverSwarms(): void {
  for (const run of swarmStore().pending()) wakeSwarm(run.userId, run.id);
}
export async function cancelConversationSwarms(userId: number, conversationId: number): Promise<void> {
  const store = swarmStore();
  for (const run of store.pending().filter(item => item.userId === userId && item.conversationId === conversationId)) {
    store.control(userId, run.id, "cancel");
    wakeSwarm(userId, run.id);
    const scheduler = new SwarmScheduler(store, executor => executor.kind === "runtime" ? runtimeSwarmAdapter(executor.id as OuterAgentKind) : workerSwarmAdapter);
    await scheduler.tick(userId, run.id);
  }
}
