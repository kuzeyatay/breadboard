import { NextResponse } from "next/server";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import { listRecentConversationMessages } from "@/lib/conversations/store.ts";
import { AUDIO_ANALYSIS_SKILL } from "@/lib/hermes/audio-intent.ts";
import {
  analyzableTracks,
  RECENT_MESSAGE_LOOKBACK,
  selectTrack,
  type ResolvedTrack,
} from "@/lib/audio-analyzer/tracks.ts";
import {
  AudioAnalyzerError,
  parseAnalysisOptions,
  runAudioAnalysis,
  runAudioComparison,
} from "@/lib/audio-analyzer/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOOLS = new Set(["audio_analyze", "audio_compare"]);

/** HTTP status by cause, so the model is told what kind of problem it hit. */
function statusForCode(code: string): number {
  if (code === "audio_analyzer_unavailable") return 503;
  if (code === "audio_analyzer_timeout") return 504;
  if (
    code === "audio_analyzer_invalid_arguments" ||
    code === "audio_analyzer_file_missing" ||
    code === "audio_analyzer_file_too_large" ||
    code === "audio_analyzer_unreadable"
  ) {
    return 400;
  }
  return 502;
}

function requireTrack(
  tracks: readonly ResolvedTrack[],
  reference: string | undefined,
  field: string,
): ResolvedTrack {
  const track = selectTrack(tracks, reference);
  if (!track) {
    throw new ApiError(
      400,
      "audio_track_not_found",
      `No attached track matches ${field === "track" ? "that name" : `"${reference}"`}. ` +
        `Attached: ${tracks.map((entry) => entry.name).join(", ")}.`,
    );
  }
  if (!track.path) {
    throw new ApiError(
      400,
      "audio_track_unreadable",
      `The stored file for "${track.name}" could not be opened.`,
    );
  }
  return track;
}

/**
 * Analyse one attached track, or compare two.
 *
 * No path is ever taken from the request. The model names a track by the
 * filename it was shown, and the file is resolved here out of a message in the
 * caller's own conversation — so the analyzer can only ever be pointed at
 * something this person attached, and never at a path the model wrote.
 */
export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const verified = verifyCapabilityToken(rawToken);
    const body = await readJsonBody(request, 16 * 1024);
    const action = typeof body.action === "string" ? body.action : "";
    if (!TOOLS.has(action)) {
      throw new ApiError(400, "audio_tool_unknown", "That audio tool does not exist.");
    }
    if (!verified.ok || !tokenAllows(verified.token, { tool: action })) {
      throw new ApiError(403, "audio_capability_denied", "Audio analysis is not authorized.");
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
        "audio_session_scope_mismatch",
        "Audio analysis is available only in an authenticated chat session.",
      );
    }
    if (!getActiveRuntimeRun(session.id)) {
      throw new ApiError(409, "audio_run_required", "Audio analysis requires a current run.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (
      !decision ||
      !decision.allowedTools.includes(action) ||
      !decision.selectedConditionalSkills.includes(AUDIO_ANALYSIS_SKILL)
    ) {
      throw new ApiError(
        403,
        "audio_skill_not_selected",
        "Select the first-party Audio Analysis skill for this turn.",
      );
    }

    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const reference = typeof args.track === "string" ? args.track.slice(0, 240) : undefined;

    const tracks = analyzableTracks(
      session.user_id,
      listRecentConversationMessages(session.conversation_id, RECENT_MESSAGE_LOOKBACK),
    );
    if (tracks.length === 0) {
      throw new ApiError(
        400,
        "audio_no_track",
        "No audio is attached to this conversation. Ask the person to attach an mp3, wav, flac, " +
          "ogg, m4a or aac file.",
      );
    }

    if (action === "audio_compare") {
      const against = typeof args.against === "string" ? args.against.slice(0, 240) : undefined;
      if (!reference || !against) {
        throw new ApiError(
          400,
          "audio_compare_needs_two",
          "audio_compare needs both `track` and `against`, each naming an attached file.",
        );
      }
      const first = requireTrack(tracks, reference, "track");
      const second = requireTrack(tracks, against, "against");
      if (first.blobId === second.blobId) {
        throw new ApiError(
          400,
          "audio_compare_same_track",
          "Those two names resolve to the same file; a comparison needs two different tracks.",
        );
      }
      recordAuditEvent({
        eventType: "audio.comparison_started",
        runtimeSessionId: session.id,
        userId: session.user_id,
        payload: { trackA: first.name, trackB: second.name },
      });
      const result = await runAudioComparison({
        pathA: first.path!,
        pathB: second.path!,
        signal: request.signal,
      });
      return NextResponse.json({
        ok: true,
        data: {
          tracks: [first.name, second.name],
          report: result.report,
          durationMs: result.durationMs,
        },
      });
    }

    const options = parseAnalysisOptions(args);
    const track = requireTrack(tracks, reference, "track");
    recordAuditEvent({
      eventType: "audio.analysis_started",
      runtimeSessionId: session.id,
      userId: session.user_id,
      payload: {
        track: track.name,
        analysis: options.analysis,
        ...(options.resolution === null ? {} : { resolution: options.resolution }),
        ...(options.startTime === null ? {} : { startTime: options.startTime }),
        ...(options.endTime === null ? {} : { endTime: options.endTime }),
      },
    });
    const result = await runAudioAnalysis({
      path: track.path!,
      options,
      signal: request.signal,
    });
    recordAuditEvent({
      eventType: "audio.analysis_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      payload: {
        track: track.name,
        analysis: options.analysis,
        durationMs: result.durationMs,
        reportChars: result.report.length,
      },
    });
    return NextResponse.json({
      ok: true,
      data: {
        track: track.name,
        analysis: result.analysis,
        ...(track.carriedForward ? { carriedForward: true } : {}),
        report: result.report,
        durationMs: result.durationMs,
        // Repeated where the model reads it, because the sentence it writes
        // underneath is the only place most people will see the distinction:
        // these are measurements of this file, not recollections about the song.
        provenance:
          "Measured from the attached file's waveform by the local audio analyzer; nothing was uploaded.",
      },
    });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "audio.analysis_failed",
        runtimeSessionId,
        payload: {
          reason:
            error instanceof AudioAnalyzerError
              ? error.code
              : error instanceof ApiError
                ? error.code
                : "audio_analysis_failed",
        },
      });
    }
    if (error instanceof AudioAnalyzerError) {
      return apiErrorResponse(new ApiError(statusForCode(error.code), error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}
