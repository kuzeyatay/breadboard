import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  requireString,
  ApiError,
} from "@/lib/openharness/route-helpers.ts";
import { authorizeRuntimeSession, markStatus } from "@/lib/openharness/session-service.ts";
import { getOpenHarnessGateway } from "@/lib/openharness/gateway.ts";
import { appendRuntimeMessage } from "@/lib/openharness/runtime-store.ts";
import { appendChatMessage } from "@/lib/openharness/runtime-store.ts";

export const dynamic = "force-dynamic";

function parseSessionId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, "invalid_session_id", "Invalid session id.");
  }
  return id;
}

// POST: submit a user message. The message is persisted in Breadboard, then
// handed to OpenHarness via prompt_async. The assistant's answer streams back
// over the /events SSE channel (not this response). The OpenHarness session id
// is derived server-side from the authorized runtime-session record; the client
// never supplies it.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await params;
    const runtimeSessionId = parseSessionId(sessionId);
    const session = authorizeRuntimeSession(userId, runtimeSessionId);

    const body = await readJsonBody(request);
    const text = requireString(body.text, "text", 200_000);
    const model =
      body.model && typeof body.model === "object"
        ? (body.model as { providerID?: string; modelID?: string })
        : undefined;

    // Persist the user's message before dispatching so it is durable even if the
    // runtime call fails.
    if (session.row.chat_session_id) {
      appendChatMessage({
        chatSessionId: session.row.chat_session_id,
        role: "user",
        content: text,
      });
    } else {
      appendRuntimeMessage({
        runtimeSessionId: session.row.id,
        role: "user",
        content: text,
      });
    }

    markStatus(session, "busy");
    await getOpenHarnessGateway().sendMessage({
      openHarnessSessionId: session.openHarnessSessionId,
      workspaceKey: session.workspaceKey,
      agentName: session.agentName,
      text,
      model: model?.providerID && model?.modelID ? { providerID: model.providerID, modelID: model.modelID } : undefined,
    });

    return NextResponse.json({ accepted: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
