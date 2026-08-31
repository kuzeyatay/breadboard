import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem.ts";
import { audioFormatMimeType } from "@/lib/audio-attachments.ts";
import { analyzableTracks, RECENT_MESSAGE_LOOKBACK } from "@/lib/audio-analyzer/tracks.ts";
import { getConversationById, listRecentConversationMessages } from "@/lib/conversations/store.ts";
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import {
  MUSIC_RECOGNITION_SKILL,
  resolveMusicRecognitionTrack,
} from "@/lib/music-recognition/context.ts";
import { MusicRecognitionError } from "@/lib/music-recognition/errors.ts";
import { validateMusicRecognitionAudio } from "@/lib/music-recognition/input.ts";
import { recognizeMusic } from "@/lib/music-recognition/index.ts";
import { consumeMusicRecognitionRateLimit } from "@/lib/music-recognition/rate-limit.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOOL = "music_recognize";

export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    const body = await readJsonBody(request, 16 * 1024);
    if (body.action !== TOOL) {
      throw new ApiError(400, "music_tool_unknown", "That music recognition tool does not exist.");
    }
    if (!verified.ok || !tokenAllows(verified.token, { tool: TOOL })) {
      throw new ApiError(403, "music_capability_denied", "Music recognition is not authorized.");
    }

    runtimeSessionId = Number(verified.token.breadboardSessionId);
    const session = getRuntimeSessionById(runtimeSessionId);
    if (
      !session ||
      session.user_id === null ||
      session.conversation_id === null ||
      (session.surface !== "dashboard_terminal" && session.surface !== "garden_chat") ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(
        403,
        "music_session_scope_mismatch",
        "Music recognition is available only in an authenticated chat session.",
      );
    }
    if (!getActiveRuntimeRun(session.id)) {
      throw new ApiError(409, "music_run_required", "Music recognition requires a current run.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (
      !decision ||
      !decision.allowedTools.includes(TOOL) ||
      !decision.selectedConditionalSkills.includes(MUSIC_RECOGNITION_SKILL)
    ) {
      throw new ApiError(
        403,
        "music_skill_not_selected",
        "Select the first-party Recognize Music skill for this turn.",
      );
    }
    const conversation = getConversationById(session.conversation_id);
    if (!conversation || conversation.user_id !== session.user_id) {
      throw new ApiError(
        403,
        "music_conversation_missing",
        "The music-recognition conversation is unavailable.",
      );
    }

    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const tracks = analyzableTracks(
      session.user_id,
      listRecentConversationMessages(session.conversation_id, RECENT_MESSAGE_LOOKBACK),
    );
    const track = resolveMusicRecognitionTrack(tracks, args);
    validateMusicRecognitionAudio({
      size: track.sizeBytes ?? 0,
      type: audioFormatMimeType(track.format),
    });
    consumeMusicRecognitionRateLimit(`tool-user:${session.user_id}`);
    consumeMusicRecognitionRateLimit(`tool-session:${session.id}`, { limit: 4 });

    recordAuditEvent({
      eventType: "music.recognition_started",
      runtimeSessionId: session.id,
      userId: session.user_id,
      payload: { blobId: track.blobId, byteSize: track.sizeBytes },
    });
    const bytes = await fs.promises.readFile(track.path);
    const audio = new Blob([new Uint8Array(bytes)], {
      type: audioFormatMimeType(track.format),
    });
    const result = await recognizeMusic({
      audio,
      filename: `${track.blobId}.${track.format}`,
      signal: request.signal,
    });
    recordAuditEvent({
      eventType: "music.recognition_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      payload: { blobId: track.blobId, matched: result.match !== null },
    });
    return Response.json({
      ok: true,
      data: {
        attachment: { blobId: track.blobId, name: track.name },
        ...result,
      },
    });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "music.recognition_failed",
        runtimeSessionId,
        payload: {
          reason:
            error instanceof MusicRecognitionError
              ? error.code
              : error instanceof ApiError
                ? error.code
                : "music_recognition_failed",
        },
      });
    }
    if (error instanceof MusicRecognitionError) {
      return apiErrorResponse(new ApiError(error.status, error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}
