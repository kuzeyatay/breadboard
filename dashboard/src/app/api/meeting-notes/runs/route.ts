import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { ensureConversationForLegacyChatSession } from "@/lib/conversations/store.ts";
import { selectedModelForUser } from "@/lib/selected-model.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { meetingNotesDefaults } from "@/lib/agent-settings/defaults.ts";
import {
  MEETING_NOTES_AGENT_ID,
  MAX_PASTED_TRANSCRIPT,
  parseMeetingNotesRequestBody,
} from "@/lib/meeting-notes/identity.ts";
import { startRun } from "@/lib/meeting-notes/run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);

/**
 * Start one run. The body names where the meeting is — a staged upload, an
 * artifact, an attachment, a pasted transcript, or nothing at all, which means
 * "the newest recording in this chat" and is how a delegated launch works.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    // A pasted transcript arrives whole in this body, so the ceiling is the
    // transcript's rather than a normal request's.
    if (text.length > MAX_PASTED_TRANSCRIPT + 64 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    const model =
      (typeof body.model === "string" ? body.model.trim() : "") || selectedModelForUser(userId);
    if (!model) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }

    // The terminal knows its conversation by public id; garden chat still runs
    // on legacy numeric chat sessions, so it sends that instead. The notes have
    // to belong to a conversation either way — that is what binds the artifact.
    let conversationPublicId =
      typeof body.conversationPublicId === "string" ? body.conversationPublicId.trim() : "";
    if (!conversationPublicId && typeof body.chatSessionId === "number") {
      try {
        conversationPublicId = ensureConversationForLegacyChatSession(
          body.chatSessionId,
          userId,
        ).public_id;
      } catch {
        conversationPublicId = "";
      }
    }
    if (!conversationPublicId) {
      return NextResponse.json({ ok: false, error: "conversation_required" }, { status: 400 });
    }

    const requestedEffort =
      typeof body.reasoningEffort === "string" ? body.reasoningEffort.trim().toLowerCase() : "";
    const reasoningEffort =
      requestedEffort === "max"
        ? "xhigh"
        : ALLOWED_EFFORTS.has(requestedEffort)
          ? requestedEffort
          : "medium";

    // Stored preferences fill in what the message left unsaid; a flag typed in
    // the message still wins, which parseMeetingNotesPrompt enforces.
    //
    // This agent takes a file, and never as a path: a recording attached to the
    // message arrives as the `blobId` the composer stored it under, a live
    // capture as the `uploadId` the upload route staged, and an existing
    // recording as its artifact id. Which fields carry them lives in
    // `parseMeetingSource`, so the route cannot fall behind a new one.
    const parsed = parseMeetingNotesRequestBody(
      { ...body, prompt: body.task ?? body.prompt },
      meetingNotesDefaults(agentSettingsFor(userId, MEETING_NOTES_AGENT_ID)),
    );

    const { baseURL } = resolveChatmockBaseUrl(request);
    const run = startRun({
      userId,
      conversationPublicId,
      request: parsed,
      model,
      reasoningEffort,
      baseUrl: baseURL,
    });
    return NextResponse.json({ ok: true, run, request: parsed }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "runtime_error" },
      { status: 502 },
    );
  }
}
