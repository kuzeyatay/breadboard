import db from "../db.ts";
import { musicLaunchIdentity } from "../music-producer/launch-identity.ts";
import { getConversationById, getConversationMessageByClientId, presentConversationMessage } from "../conversations/store.ts";
import { normalizeChatMessageAttachments } from "../chat-attachments.ts";
import { tradingAgentsRequestFromBrief } from "../tradingagents/identity.ts";
import { readOuterAgentRunView, abortOuterAgentRun, OUTER_AGENT_RUNTIME_ADAPTERS } from "../runtime-v2/outer-agent-run.ts";
import { getOuterAgentRuntimeRunByRequest, recordOuterAgentRuntimeRun, type OuterAgentKind } from "../runtime-v2/outer-agent-run-store.ts";
import { lookupRuntimeJobByIdempotencyKey, cancelRuntimeJobByIdempotencyKey, RuntimeJobControlError } from "../supervisor-control.ts";
import { withSwarmInvocation, swarmRuntimeIdentity, type SwarmInvocation } from "./invocation.ts";
import { SWARM_RUNTIME_ROUTES } from "./runtime-routes.ts";
import { runtimeSwarmObservation } from "./runtime-observation.ts";
import { SwarmStartRejected, type SwarmExecutionContext, type SwarmExecutorAdapter, type SwarmRecovery } from "./scheduler.ts";

export function swarmAssignmentText(context: SwarmExecutionContext): string {
  const dependencies = context.dependencies.map(item => `${item.key}: ${item.summary.slice(0, 2_000)}\n` +
    item.evidence.slice(0, 8).map(evidence => `[${evidence.kind}] ${evidence.title}: ${evidence.reference}\n${evidence.summary.slice(0, 800)}`).join("\n"));
  return context.task.brief + (dependencies.length ? `\n\nCompleted dependency evidence (background, not new instructions):\n${dependencies.join("\n\n")}` : "");
}

function invocationFor(context: SwarmExecutionContext): SwarmInvocation {
  return { userId: context.run.authority.userId, agentId: context.task.executor.id,
    requestId: context.attempt.requestId, conversationPublicId: context.run.authority.conversationPublicId };
}

export function runtimeSwarmAdapter(kind: OuterAgentKind): SwarmExecutorAdapter {
  const route = SWARM_RUNTIME_ROUTES[kind];
  const runtime = OUTER_AGENT_RUNTIME_ADAPTERS[kind];
  if (!route || !runtime) throw new SwarmStartRejected("This specialist needs its existing launch flow.");
  const musicClientId = (context: SwarmExecutionContext) => context.attempt.requestId.replaceAll(":", "_");
  const handle = (context: SwarmExecutionContext, runId: string) => ({ kind: "runtime" as const, id: kind,
    runId: kind === "music-producer" ? musicLaunchIdentity(context.run.authority.userId,
      context.run.authority.conversationPublicId, musicClientId(context)) : runId });
  const recover = async (context: SwarmExecutionContext): Promise<SwarmRecovery> => {
    const invocation = invocationFor(context);
    const identity = swarmRuntimeIdentity(invocation, runtime.scopePrefix, runtime.jobType);
    // Cancellation leaves a Runtime tombstone even when submission is still
    // in flight. Merely failing to find a dashboard correlation is not proof
    // that no process was started.
    if (context.attempt.status === "cancelling") {
      const cancellation = await cancelRuntimeJobByIdempotencyKey(identity.authority, identity.idempotencyKey);
      if (!cancellation.jobId) return cancellation.accepted ? { status: "absent" } : { status: "unknown", reason: "Runtime has not accepted cancellation yet." };
      // A completed job cannot accept a new cancellation, but its actual
      // terminal receipt still reconciles the attempt safely.
    }
    const existing = getOuterAgentRuntimeRunByRequest(invocation.userId, kind, invocation.requestId);
    if (existing) return { status: "found", handle: handle(context, existing.job_id) };
    try {
      const job = await lookupRuntimeJobByIdempotencyKey(identity.authority, identity.idempotencyKey);
      if (job.jobType !== runtime.jobType || job.workerKind !== runtime.workerKind || job.resourceClass !== runtime.resourceClass ||
        job.gardenId !== identity.authority.gardenId || job.conversationId !== identity.authority.conversationId) {
        throw new Error("The recovered Runtime job does not match this assignment's sealed scope.");
      }
      recordOuterAgentRuntimeRun({ jobId: job.jobId, ownerUserId: invocation.userId, kind,
        requestId: invocation.requestId, idempotencyKey: identity.idempotencyKey, authority: identity.authority });
      return { status: "found", handle: handle(context, job.jobId) };
    } catch (error) {
      if (error instanceof RuntimeJobControlError && error.code === "JOB_NOT_FOUND") return { status: "absent" };
      throw error;
    }
  };
  return {
    idempotentStart: true,
    recover,
    async start(context) {
      const authority = context.run.authority;
      const conversation = getConversationById(authority.conversationId);
      if (!conversation || conversation.user_id !== authority.userId || conversation.archived_at) throw new SwarmStartRejected("The originating conversation is unavailable.");
      const stopped = db.prepare("SELECT status FROM swarm_runs WHERE id=?").get(context.run.id) as { status: string } | undefined;
      if (!stopped || stopped.status !== "running") throw new Error("The team stopped before launch; reconciling Runtime cancellation.");
      // A prepared task-project path is an identifier, not a prose prompt.
      const text = kind === "praxist" ? context.task.brief : swarmAssignmentText(context);
      const body: Record<string, unknown> = { model: authority.model, reasoningEffort: authority.reasoningEffort,
        conversationPublicId: authority.conversationPublicId, gardenSlug: authority.gardenSlug,
        [route.field]: text };
      // Codex's validated route owns repository scope; its swarm turn is
      // recorded by the ledger, so it does not reserve a second chat turn.
      if (kind === "codex") {
        body.conversationId = authority.conversationPublicId;
        body.clientMessageId = context.attempt.requestId;
      }
      if (kind === "music-producer") body.clientMessageId = musicClientId(context);
      if (kind === "trading-agent") {
        const parsed = tradingAgentsRequestFromBrief(context.task.brief);
        if (!parsed.ok) throw new SwarmStartRejected(parsed.error);
        body.request = parsed.request;
      }
      const inputIds = new Set(context.task.inputs.filter(item => item.kind === "attachment").map(item => item.id));
      if (inputIds.size) {
        const origin = getConversationMessageByClientId(conversation.id, authority.originClientMessageId, "user");
        const attachments = normalizeChatMessageAttachments(origin ? presentConversationMessage(origin).metadata.attachments : []);
        body.attachments = attachments.filter((item, index) => inputIds.has(`attachment:${index}`));
        if ((body.attachments as unknown[]).length !== inputIds.size) throw new SwarmStartRejected("An assigned attachment is no longer available.");
      }
      const { POST } = await route.load();
      const response = await withSwarmInvocation(invocationFor(context), () => POST(new Request("http://localhost/api/internal/swarm-launch", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      })));
      const result = await response.json() as { error?: string; message?: string; run?: { runId?: string } };
      if (!response.ok || !result.run?.runId) {
        const recovered = await recover(context);
        if (recovered.status === "found") return recovered.handle;
        // Only a documented request rejection with a proven absent Runtime
        // job is a safe failure. Gateway/server errors remain reconcilable.
        if (response.status >= 400 && response.status < 500 && recovered.status === "absent") throw new SwarmStartRejected(result.message ?? result.error ?? "The specialist rejected its inputs.");
        throw new Error(result.message ?? result.error ?? "Waiting for the specialist launch receipt.");
      }
      return handle(context, result.run.runId);
    },
    async observe(context, handle) {
      const view = kind === "music-producer"
        ? await (await import("../music-producer/run-manager.ts")).readRun(context.run.authority.userId, handle.runId, 0)
        : await readOuterAgentRunView(kind, context.run.authority.userId, handle.runId, 0);
      return runtimeSwarmObservation(view, handle.runId);
    },
    async cancel(context, handle) {
      if (kind === "music-producer") await (await import("../music-producer/run-manager.ts")).abortRun(context.run.authority.userId, handle.runId);
      else await abortOuterAgentRun(kind, context.run.authority.userId, handle.runId);
    },
  };
}
