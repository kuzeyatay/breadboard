import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  ApiError,
} from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import {
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import {
  durableMemoryExclusionReason,
  saveDurableMemory,
  type DurableMemoryKind,
  type DurableMemoryScope,
} from "@/lib/conversations/memory.ts";
import {
  conversationIsTemporary,
  getConversationById,
} from "@/lib/conversations/store.ts";

export const dynamic = "force-dynamic";

const KINDS = new Set<DurableMemoryKind>([
  "preference",
  "project_fact",
  "decision",
  "working_pattern",
]);
const SCOPES = new Set<DurableMemoryScope>(["global", "project", "garden"]);

// Model-invoked durable-memory writer. Authority comes from the capability
// token minted for this runtime session's surface (garden_chat / terminal),
// never from the per-turn capability mode: saving a preference must work on a
// plain knowledge turn. The user, conversation, and active garden are resolved
// server-side from the session row, so a model argument can never widen scope
// or write another user's memory.
export async function POST(request: Request) {
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: "save_memory" })) {
      throw new ApiError(403, "memory_capability_denied", "Saving memory is not authorized.");
    }
    const runtimeSessionId = Number(verified.token.breadboardSessionId);
    const session = getRuntimeSessionById(runtimeSessionId);
    if (
      !session ||
      session.user_id === null ||
      session.conversation_id === null ||
      !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(403, "memory_session_scope_mismatch", "Memory session scope is invalid.");
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) throw new ApiError(409, "memory_run_required", "Saving memory requires a current run.");

    const body = await readJsonBody(request, 16 * 1024);
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const content = typeof args.content === "string" ? args.content.trim() : "";
    if (!content) throw new ApiError(400, "memory_content_required", "content is required.");

    const kind: DurableMemoryKind =
      typeof args.kind === "string" && KINDS.has(args.kind as DurableMemoryKind)
        ? (args.kind as DurableMemoryKind)
        : "project_fact";
    const requestedScope: DurableMemoryScope =
      typeof args.scope === "string" && SCOPES.has(args.scope as DurableMemoryScope)
        ? (args.scope as DurableMemoryScope)
        : "global";
    // The active garden is server-derived from the session; a garden-scoped
    // request with no active garden degrades to a project fact rather than a
    // dangling scope.
    const activeGardenId = session.cluster_id;
    const scope: DurableMemoryScope =
      requestedScope === "garden" && !activeGardenId ? "project" : requestedScope;
    const scopeId =
      scope === "global" ? null : scope === "garden" ? String(activeGardenId) : "breadboard";

    // Check both the proposed fact and the user's actual instruction. A model
    // must not be able to erase an opt-out by paraphrasing the text it submits.
    // A temporary chat outranks both: it is a property of the conversation the
    // tool was called from, so no wording of the call can get past it.
    const temporaryChat = conversationIsTemporary(
      getConversationById(session.conversation_id),
    );
    const exclusionReason = temporaryChat
      ? "temporary_chat"
      : durableMemoryExclusionReason(run.instruction) ??
        durableMemoryExclusionReason(content);
    const saved = exclusionReason
      ? null
      : saveDurableMemory({
          userId: session.user_id,
          content,
          kind,
          scope,
          scopeId,
          sourceConversationId: session.conversation_id,
          // An explicit tool call is a deliberate save, so it is confirmed rather
          // than a passive candidate. The user can still curate it in Settings.
          state: "confirmed",
          confidence: 0.9,
          salience: 0.85,
        });

    recordAuditEvent({
      eventType: "memory.tool.save_memory",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        runId: run.id,
        saved: Boolean(saved),
        scope,
        kind,
        ...(exclusionReason ? { exclusionReason } : {}),
      },
    });

    if (!saved) {
      // Report rejection honestly so the model does not claim a save happened.
      return NextResponse.json({
        ok: true,
        data: {
          saved: false,
          reason:
            exclusionReason === "temporary_chat"
              ? "Not saved: this is a temporary chat, and nothing said in one is ever kept as memory."
              : exclusionReason === "user_opt_out"
                ? "Not saved: the user opted out of memory for this request."
                : exclusionReason === "temporary_deliberation"
                  ? "Not saved: unresolved personal deliberations are excluded from durable memory."
                  : "Not saved: the text was empty or looked like a secret and was rejected.",
        },
      });
    }
    return NextResponse.json({
      ok: true,
      data: {
        saved: true,
        id: saved.id,
        scope: saved.scope,
        kind: saved.kind,
        content: saved.content,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
