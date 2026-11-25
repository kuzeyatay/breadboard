import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { apiErrorResponse, ApiError, readJsonBody, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import { getRuntimeSessionById, recordAuditEvent, runtimeExternalSessionId } from "@/lib/hermes/runtime-store.ts";
import { getConversationById } from "@/lib/conversations/store.ts";
import { readHermesConfig } from "@/lib/hermes/config.ts";
import { directoryForWorkspaceKey } from "@/lib/hermes/workspace.ts";
import { synthesizeNarrationLines } from "@/lib/speech/synthesis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_LINES = 60;
const MAX_LINE_CHARACTERS = 1200;

function extensionFor(contentType: string): string {
  if (/mpeg|mp3/i.test(contentType)) return "mp3";
  if (/wav|wave/i.test(contentType)) return "wav";
  if (/ogg|opus/i.test(contentType)) return "ogg";
  if (/aac|mp4|m4a/i.test(contentType)) return "m4a";
  if (/flac/i.test(contentType)) return "flac";
  return "audio";
}

/**
 * Speak narration lines with the voice the user set up for read-aloud (the
 * same provider video_render narrates with) and save one audio file per line
 * in the conversation workspace. Agents that assemble their own videos with
 * ffmpeg (screencasts, slide walkthroughs) use these files instead of an OS
 * voice such as Windows SAPI.
 */
export async function POST(request: Request) {
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: "speech_synthesize" })) {
      throw new ApiError(403, "speech_denied", "Speech synthesis is not authorized for this turn.");
    }
    const session = getRuntimeSessionById(Number(verified.token.breadboardSessionId));
    const conversation = session?.conversation_id ? getConversationById(session.conversation_id) : null;
    if (!session || !session.user_id || !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
      verified.token.userId !== session.user_id || conversation?.user_id !== session.user_id ||
      verified.token.conversationId !== session.conversation_id ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId) {
      throw new ApiError(403, "speech_session_denied", "Only an authenticated Breadboard conversation can synthesize speech.");
    }
    const body = await readJsonBody(request, 256 * 1024);
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? body.args as Record<string, unknown> : body as Record<string, unknown>;
    const raw = Array.isArray(args.lines) ? args.lines : typeof args.text === "string" ? [args.text] : [];
    const lines = raw.map((line) => (typeof line === "string" ? line.trim() : "")).filter(Boolean);
    if (!lines.length) throw new ApiError(400, "speech_text_missing", "Pass `lines` (one string per narration clip) or `text`.");
    if (lines.length > MAX_LINES) throw new ApiError(400, "speech_too_many_lines", `At most ${MAX_LINES} lines per call.`);
    const long = lines.findIndex((line) => line.length > MAX_LINE_CHARACTERS);
    if (long >= 0) throw new ApiError(400, "speech_line_too_long", `Line ${long + 1} is over ${MAX_LINE_CHARACTERS} characters; split it.`);
    const label = (typeof args.name === "string" ? args.name : "narration")
      .replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "narration";

    const workspace = directoryForWorkspaceKey(readHermesConfig(), session.workspace_key);
    const folder = path.join(workspace, "narration", label);
    fs.mkdirSync(folder, { recursive: true });

    const files: { index: number; path: string; bytes: number; contentType: string }[] = [];
    const { clips, fallback } = await synthesizeNarrationLines({ userId: session.user_id, lines, signal: request.signal })
      .catch((error: unknown) => {
        throw new ApiError(409, "speech_unavailable",
          `The read-aloud voice is unavailable: ${error instanceof Error ? error.message : "speech failed"}. ` +
          "Tell the user to set it up in Settings → Speech. Do not fall back to an OS voice (SAPI, say, espeak).");
      });
    for (const [index, clip] of clips.entries()) {
      const hash = createHash("sha256").update(clip.text).digest("hex").slice(0, 8);
      const target = path.join(folder, `${String(index + 1).padStart(2, "0")}-${hash}.${extensionFor(clip.contentType)}`);
      fs.writeFileSync(target, clip.audio);
      files.push({ index: index + 1, path: target, bytes: clip.audio.byteLength, contentType: clip.contentType });
    }
    recordAuditEvent({
      eventType: "speech.synthesized",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: { lines: lines.length, folder: folder.slice(0, 300) },
    });
    return NextResponse.json({
      ok: true,
      data: {
        folder,
        files,
        note: "Measure each clip with ffprobe and time the picture to it. Mix with ffmpeg; do not re-voice with another engine." +
          (fallback
            ? ` The user's ChatGPT voice was unavailable (${fallback.reason}), so every clip was read by their local Voicebox voice, ${fallback.voice}. Mention this once in your reply.`
            : ""),
      },
    });
  } catch (error) { return apiErrorResponse(error); }
}
