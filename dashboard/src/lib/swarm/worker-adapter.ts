import db from "../db.ts";
import { swarmWorkerPrompt } from "../system-prompts/coordination.ts";
import { createConversation, getConversationById, getConversationMessageByClientId, presentConversationMessage, updateConversation } from "../conversations/store.ts";
import { getRuntimeSessionByConversation } from "../hermes/runtime-store.ts";
import { getActiveRuntimeRun } from "../hermes/run-store.ts";
import { normalizeChatTokenUsage } from "../chat-token-usage.ts";
import { normalizeChatMessageAttachments, reusableChatAttachments } from "../chat-attachments.ts";
import { SwarmStartRejected, type SwarmExecutionContext, type SwarmExecutorAdapter } from "./scheduler.ts";
import { swarmAssignmentText } from "./runtime-adapter.ts";
import type { SwarmWorkerScope } from "./worker-policy.ts";

interface WorkerRow { attempt_id: string; conversation_id: number; error: string | null; created_at: number }
function schema() { db.exec(`CREATE TABLE IF NOT EXISTS swarm_worker_chats (
  attempt_id TEXT PRIMARY KEY REFERENCES swarm_attempts(id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id), error TEXT, created_at INTEGER NOT NULL)`); }
function row(attemptId: string): WorkerRow | undefined {
  schema(); return db.prepare("SELECT * FROM swarm_worker_chats WHERE attempt_id=?").get(attemptId) as WorkerRow | undefined;
}
export function swarmWorkerCurrent(scope: SwarmWorkerScope): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM swarm_attempts a JOIN swarm_runs r ON r.id=a.run_id
    WHERE a.id=? AND r.id=? AND a.status IN ('starting','running') AND r.status IN ('running','paused')`)
    .get(scope.attemptId, scope.runId));
}
const handleFor = (context: SwarmExecutionContext, child: WorkerRow) => ({ ...context.task.executor, runId: context.attempt.id, conversationId: child.conversation_id });

export const workerSwarmAdapter: SwarmExecutorAdapter = {
  idempotentStart: false,
  async start(context) {
    schema();
    const authority = context.run.authority;
    if (!authority.capability) throw new SwarmStartRejected("The parent turn did not retain its capability scope.");
    const scope: SwarmWorkerScope = { runId: context.run.id, taskKey: context.task.key, attemptId: context.attempt.id, authority, executor: context.task.executor };
    const reservation = db.transaction(() => {
      const existing = row(context.attempt.id);
      if (existing) return { child: existing, created: false };
      if (!swarmWorkerCurrent(scope)) throw new SwarmStartRejected("This assignment was stopped before it began.");
      const conversation = createConversation({ userId: authority.userId, title: context.task.title,
        surface: authority.surface, defaultGardenId: authority.gardenId, scopeKind: authority.gardenId ? "garden" : "global",
        temporary: true, originLabel: "swarm-worker" });
      if (context.task.executor.kind === "persona") updateConversation(conversation, { activeAgencyAgentSlug: context.task.executor.id });
      db.prepare("INSERT INTO swarm_worker_chats VALUES (?,?,NULL,?)").run(context.attempt.id, conversation.id, Date.now());
      return { child: row(context.attempt.id)!, created: true };
    }).immediate();
    if (!reservation.created) return handleFor(context, reservation.child);
    const child = getConversationById(reservation.child.conversation_id)!;
    const origin = getConversationMessageByClientId(authority.conversationId, authority.originClientMessageId, "user");
    const ids = new Set(context.task.inputs.filter(item => item.kind === "attachment").map(item => item.id));
    const attachments = normalizeChatMessageAttachments(origin ? presentConversationMessage(origin).metadata.attachments : [])
      .filter((_, index) => ids.has(`attachment:${index}`));
    const { startConversationTurn } = await import("../conversations/turn-service.ts");
    try {
      const result = await startConversationTurn({ conversation: child, clientMessageId: context.attempt.requestId,
        text: swarmWorkerPrompt(authority.userId, { assignment: swarmAssignmentText(context), acceptance: context.task.acceptance,
          workflowId: context.task.executor.kind === "workflow" ? context.task.executor.id : undefined }),
        surface: authority.surface, surfaceContext: { activeGardenSlug: authority.gardenSlug ?? undefined },
        model: authority.model, reasoningEffort: authority.reasoningEffort, internalAgentContinuation: true,
        attachments: reusableChatAttachments(attachments),
        personalize: false, yoloMode: authority.standingApproval, swarmWorker: scope });
      if (!result.accepted && !("replayed" in result)) {
        db.prepare("UPDATE swarm_worker_chats SET error=? WHERE attempt_id=?").run("The assignment needs a decision in its worker chat; no broader permission was granted.", context.attempt.id);
      }
    } catch (error) {
      // A submission error may follow accepted execution. Observe the durable
      // turn before classifying it; never re-submit the assignment here.
      db.prepare("UPDATE swarm_worker_chats SET error=? WHERE attempt_id=?").run(error instanceof Error ? error.message : "Worker submission interrupted.", context.attempt.id);
    }
    return handleFor(context, reservation.child);
  },
  async recover(context) {
    const child = row(context.attempt.id);
    return child ? { status: "found", handle: handleFor(context, child) } : { status: "absent" };
  },
  async observe(context, handle) {
    const child = row(context.attempt.id);
    if (!child || child.conversation_id !== handle.conversationId) throw new Error("The worker chat correlation is unavailable.");
    const runtime = getRuntimeSessionByConversation(child.conversation_id);
    if (runtime && getActiveRuntimeRun(runtime.id)) {
      const { authorizeConversationRuntime } = await import("../hermes/session-service.ts");
      const { startSessionEventPump } = await import("../hermes/event-stream.ts");
      startSessionEventPump(authorizeConversationRuntime(getConversationById(child.conversation_id)!));
    }
    const message = getConversationMessageByClientId(child.conversation_id, context.attempt.requestId, "assistant");
    if (!message || message.status === "pending") {
      if (child.error && !runtime) return { status: "failed", error: child.error, summary: child.error };
      if (!message && Date.now() - child.created_at > 120_000) return { status: "uncertain", summary: "Worker preparation was interrupted; inspect the saved chat before retrying." };
      return { status: "running" };
    }
    const presented = presentConversationMessage(message);
    const usage = normalizeChatTokenUsage(presented.usage);
    const artifacts = db.prepare("SELECT 1 FROM sqlite_master WHERE name='hermes_artifacts' AND type='table'").get()
      ? db.prepare(`SELECT id,title,current_version,status FROM hermes_artifacts WHERE user_id=? AND conversation_id=?
          AND json_extract(metadata_json,'$.swarm.attemptId')=?`).all(context.run.authority.userId, context.run.authority.conversationId, context.attempt.id) as Array<{ id: string; title: string; current_version: number; status: string }> : [];
    return { status: message.status === "complete" ? "completed" : message.status === "aborted" ? "cancelled" : "failed",
      summary: message.content.slice(0, 24_000), ...(child.error ? { error: child.error } : {}),
      evidence: [{ title: "Worker response", kind: "observation", summary: message.content.slice(0, 8_000), reference: `conversation:${child.conversation_id}:${message.id}` },
        ...artifacts.map(artifact => ({ title: artifact.title, kind: "artifact" as const,
          summary: `Artifact ${artifact.status}, version ${artifact.current_version}.`, reference: `artifact:${artifact.id}:${artifact.current_version}` }))],
      ...(usage ? { totalTokens: usage.totalTokens, usageComplete: usage.partial !== true && usage.estimated !== true } : {}) };
  },
  async cancel(context, handle) {
    const child = row(context.attempt.id);
    if (!child || child.conversation_id !== handle.conversationId) return;
    const runtime = getRuntimeSessionByConversation(child.conversation_id);
    if (runtime) {
      const { cancelRuntimeSessionWork } = await import("../hermes/session-cancel.ts");
      const report = await cancelRuntimeSessionWork(context.run.authority.userId, runtime);
      if (!report.runtimeStopAcknowledged) throw new Error("Waiting for the worker runtime to acknowledge Stop.");
    }
    const { failAssistantMessage } = await import("../conversations/store.ts");
    if (getConversationMessageByClientId(child.conversation_id, context.attempt.requestId, "assistant")) {
      failAssistantMessage({ conversationId: child.conversation_id, clientMessageId: context.attempt.requestId, status: "aborted", error: "Team stopped." });
    } else db.prepare("UPDATE swarm_worker_chats SET error='Team stopped before dispatch.' WHERE attempt_id=?").run(context.attempt.id);
  },
};
