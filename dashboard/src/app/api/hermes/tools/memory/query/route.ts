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
import {
  conversationIsTemporary,
  getConversationById,
} from "@/lib/conversations/store.ts";
import { memoryQuery, type MemoryQueryMode } from "@/lib/memory-tree/query.ts";

export const dynamic = "force-dynamic";

const MODES = new Set<MemoryQueryMode>(["search", "browse", "topic", "stats"]);

// The read counterpart to save_memory, and the only read the model gets.
//
// One tool over the whole memory surface — the durable rows, the semantic
// index, and the tree that groups them — because a model handed four narrow
// memory tools picks the wrong one. Which store actually answers is decided
// here, and reported in the result so the model knows what it is reading.
//
// Authority mirrors the writer: the capability token identifies the runtime
// session, and the user is resolved from that session row server-side. A model
// argument can never widen the read to another account.
export async function POST(request: Request) {
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: "memory_query" })) {
      throw new ApiError(403, "memory_capability_denied", "Reading memory is not authorized.");
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

    // A temporary chat is sealed in both directions. It never writes memory,
    // and it must not read it either: recalling a stored preference into an
    // off-the-record conversation leaks the record into the place that was
    // promised not to have one.
    if (conversationIsTemporary(getConversationById(session.conversation_id))) {
      return NextResponse.json({
        ok: true,
        data: {
          mode: "search",
          ranking: "none",
          hits: [],
          branches: [],
          stats: null,
          note:
            "This is a temporary chat. Nothing stored is read into one, and " +
            "nothing said here is kept.",
        },
      });
    }

    const body = await readJsonBody(request, 16 * 1024);
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};

    const requestedMode = typeof args.mode === "string" ? args.mode : "search";
    const mode: MemoryQueryMode = MODES.has(requestedMode as MemoryQueryMode)
      ? (requestedMode as MemoryQueryMode)
      : "search";

    const result = await memoryQuery({
      userId: session.user_id,
      mode,
      query: typeof args.query === "string" ? args.query : undefined,
      topic: typeof args.topic === "string" ? args.topic : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
      gardenScopeId: session.cluster_id ? String(session.cluster_id) : null,
      projectScopeId: "breadboard",
      currentConversationId: session.conversation_id,
    });

    recordAuditEvent({
      eventType: "memory.tool.memory_query",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: { mode, ranking: result.ranking, hits: result.hits.length },
    });

    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
