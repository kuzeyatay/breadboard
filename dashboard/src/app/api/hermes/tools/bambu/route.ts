import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { verifyCapabilityToken, tokenAllows } from "@/lib/hermes/capability-token.ts";
import { getActiveCapabilityDecision, getRuntimeSessionById, runtimeExternalSessionId } from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import { getConversationById } from "@/lib/conversations/store.ts";
import { bambuService, printerResource } from "@/lib/bambu/server.ts";
import { stageAttachment } from "@/lib/bambu/attachments.ts";
import { printerJson, printerError, printerResponse } from "@/lib/bambu/http.ts";
import { fail } from "@/lib/bambu/types.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Preparation only. Neither approval, arbitrary paths, network destinations nor hardware controls are tool arguments. */
export async function POST(request: Request) {
  try {
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: "bambu_print_prepare" })) fail("Print preparation is not authorized.", "bambu_tool_denied", 403);
    const session = getRuntimeSessionById(Number(verified.token.breadboardSessionId));
    const conversation = session?.conversation_id ? getConversationById(session.conversation_id) : null;
    const run = session ? getActiveRuntimeRun(session.id) : null;
    if (!session?.user_id || !conversation || conversation.user_id !== session.user_id || !["dashboard_terminal","garden_chat"].includes(session.surface) || session.surface !== verified.token.surface || session.user_id !== verified.token.userId || session.conversation_id !== verified.token.conversationId || runtimeExternalSessionId(session) !== verified.token.hermesSessionId || !run) fail("An owned, active conversational turn is required.", "bambu_scope_denied", 403);
    const decision = getActiveCapabilityDecision(session.id);
    if (decision && !decision.allowedTools.includes("bambu_print_prepare")) fail("Print preparation was not granted on this turn.", "bambu_tool_denied", 403);
    const dispatch = JSON.parse(run.dispatch_json) as { clientMessageId?: string };
    if (!dispatch.clientMessageId) fail("This run has no originating turn identity.", "bambu_turn_required");
    const body = await printerJson(request), args = (body.args ?? {}) as Record<string, unknown>;
    if (body.tool !== "bambu_print_prepare" || Object.keys(args).some(key => !["jobId","artifactId","uploadId"].includes(key))) fail("Only saved job and authorized attachment references are accepted.", "invalid_prepare_args", 400);
    const service = bambuService();
    let job = typeof args.jobId === "string" ? service.store.get(args.jobId, session.user_id, conversation.public_id) : service.create({ userId: session.user_id, conversationId: conversation.id, conversationPublicId: conversation.public_id, runtimeSessionId: session.id, runId: run.id, originatingTurnId: dispatch.clientMessageId });
    if (!job.file && (args.uploadId || args.artifactId)) {
      try { job = await stageAttachment(job, args); }
      catch { job = service.store.get(job.id, session.user_id, conversation.public_id); }
    }
    return printerResponse({ ok: true, jobId: job.id, state: job.state, message: job.message ?? "Review this job in the attached printer card. Only an explicit user approval there can upload or start it.", uiResources: [printerResource(job)] });
  } catch (error) { return printerError(error); }
}
