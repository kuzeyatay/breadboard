import { NextResponse } from "next/server";
import db from "@/lib/db";
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
import { getActiveRuntimeRun, parseRuntimeRunDispatch } from "@/lib/hermes/run-store.ts";
import { createImportedArtifact, presentArtifact } from "@/lib/hermes/artifact-store.ts";
import {
  VIDEO_SKILLS,
  VIDEO_TOOL,
  VideoRequestError,
  validateMusicAnalysisRequest,
  validateVideoRequest,
} from "@/lib/remotion/request.ts";
import { analyzeMusic } from "@/lib/remotion/audio.ts";
import { parseAnalysisOptions, runAudioAnalysis } from "@/lib/audio-analyzer/service.ts";
import { renderVideo } from "@/lib/remotion/service.ts";
import { synthesizeSpeech } from "@/lib/speech/synthesis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  video_invalid_arguments: 400,
  video_invalid_source: 400,
  video_text_style: 400,
  video_narration_unavailable: 409,
  video_audio_failed: 502,
  video_runtime_unavailable: 503,
  video_timeout: 504,
};

export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: VIDEO_TOOL })) {
      throw new ApiError(403, "video_capability_denied", "Video rendering is not authorized.");
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
        "video_session_scope_mismatch",
        "Video rendering is available only in an authenticated chat session.",
      );
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(409, "video_run_required", "Video rendering requires a current run.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    const skill = VIDEO_SKILLS.find((slug) => decision?.selectedConditionalSkills.includes(slug));
    if (!decision || !decision.allowedTools.includes(VIDEO_TOOL) || !skill) {
      throw new ApiError(
        403,
        "video_skill_not_selected",
        "Select the first-party Film or Video skill for this turn.",
      );
    }

    // JSON escaping inflates TSX (quotes and newlines), so the wire limit sits
    // well above the 96 KiB source limit.
    const body = await readJsonBody(request, 384 * 1024);
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : {};
    if (args.mode === "analyze_music") {
      const { music, windowSeconds } = validateMusicAnalysisRequest(args);
      const { file, ...analysis } = await analyzeMusic(music, windowSeconds, request.signal);
      // Breadboard's own analyzer adds key and character when its runtime is up.
      // It is a bonus: the cut points above never wait on it for long.
      const conversation = db
        .prepare("SELECT public_id FROM conversations WHERE id = ? AND user_id = ?")
        .get(session.conversation_id, session.user_id) as { public_id: string } | undefined;
      const character = conversation?.public_id
        ? await Promise.race([
            runAudioAnalysis({
              path: file,
              options: parseAnalysisOptions({
                analysis: "harmonic",
                startTime: analysis.fromSeconds,
                endTime: analysis.toSeconds,
              }),
              scope: {
                userId: session.user_id,
                gardenId: session.garden_id,
                conversationId: conversation.public_id,
              },
              signal: request.signal,
            }).then((result) => result.report.slice(0, 1_500)),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 25_000)),
          ]).catch(() => null)
        : null;
      return NextResponse.json({ ok: true, data: { analysis, character } });
    }
    const requested = validateVideoRequest(args);
    // Projects are kept on disk, so each user gets their own namespace.
    const videoRequest = requested.projectId === null
      ? requested
      : { ...requested, projectId: `u${session.user_id}-${requested.projectId}` };
    recordAuditEvent({
      eventType: "video.render_started",
      runtimeSessionId: session.id,
      userId: session.user_id,
      payload: {
        runId: run.id,
        format: videoRequest.format,
        quality: videoRequest.quality,
        durationInFrames: videoRequest.durationInFrames,
        sourceBytes: Buffer.byteLength(videoRequest.code ?? "", "utf8"),
        projectId: requested.projectId,
        preview: requested.preview,
      },
    });

    // Narration is spoken by whatever voice the user set up for read-aloud.
    const narrationAudio: Uint8Array[] = [];
    for (const line of videoRequest.narration) {
      const speech = await synthesizeSpeech({
        userId: session.user_id,
        text: line.text,
        signal: request.signal,
      }).catch((error: unknown) => {
        throw new VideoRequestError(
          "video_narration_unavailable",
          `Narration could not be spoken: ${error instanceof Error ? error.message : "speech failed"} Render without narration, or tell the user what to switch on.`,
        );
      });
      narrationAudio.push(new Uint8Array(await speech.arrayBuffer()));
    }

    const result = await renderVideo(videoRequest, { signal: request.signal, narrationAudio });
    try {
      const dispatch = parseRuntimeRunDispatch(run);
      const assistantMessage = dispatch.clientMessageId
        ? (db
            .prepare(
              `SELECT id FROM conversation_messages
               WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'`,
            )
            .get(session.conversation_id, dispatch.clientMessageId) as { id: number } | undefined)
        : undefined;
      if (result.report) {
        // A preview delivers its contact sheet and what the frame checks found;
        // the video itself stays in the project until the final render.
        const sheet = await createImportedArtifact({
          userId: session.user_id,
          runtimeSessionId: session.id,
          hermesSessionId: runtimeExternalSessionId(session)!,
          conversationId: session.conversation_id,
          clusterId: session.cluster_id,
          runId: run.id,
          assistantMessageId: assistantMessage?.id ?? null,
          toolCallId: typeof body.toolCallId === "string" ? body.toolCallId.slice(0, 200) : null,
          surface: session.surface,
          kind: "image",
          title: `${result.title} (preview frames)`,
          filename: "preview-sheet.png",
          authorizedRoot: result.videoRoot,
          filePath: result.report.sheetPath,
          parentArtifactId: null,
          metadata: { remotion: true, sourceSkill: skill, preview: true, description: result.description },
          sourceSkill: skill,
          sourceHermesTool: VIDEO_TOOL,
        });
        return NextResponse.json({
          ok: true,
          data: {
            preview: true,
            projectId: requested.projectId,
            contactSheet: presentArtifact(sheet),
            findings: result.report.findings,
            samples: result.report.samples.filter((_, index) => index % 2 === 0),
            renderSeconds: result.renderSeconds,
            music: result.audio.music
              ? { title: result.audio.music.title, startSeconds: result.audio.music.startSeconds }
              : null,
            notes: result.audio.notes,
          },
        });
      }
      const slug = result.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);
      const artifact = await createImportedArtifact({
        userId: session.user_id,
        runtimeSessionId: session.id,
        hermesSessionId: runtimeExternalSessionId(session)!,
        conversationId: session.conversation_id,
        clusterId: session.cluster_id,
        runId: run.id,
        assistantMessageId: assistantMessage?.id ?? null,
        toolCallId: typeof body.toolCallId === "string" ? body.toolCallId.slice(0, 200) : null,
        surface: session.surface,
        kind: "video",
        title: result.title,
        filename: `${slug || "video"}.mp4`,
        authorizedRoot: result.videoRoot,
        filePath: result.videoPath,
        parentArtifactId: null,
        metadata: {
          remotion: true,
          sourceSkill: skill,
          description: result.description,
          format: result.format,
          quality: result.quality,
          durationInFrames: result.durationInFrames,
          renderDurationSeconds: result.renderSeconds,
        },
        sourceSkill: skill,
        sourceHermesTool: VIDEO_TOOL,
      });
      recordAuditEvent({
        eventType: "video.render_completed",
        runtimeSessionId: session.id,
        userId: session.user_id,
        payload: { runId: run.id, artifactId: artifact.id, renderSeconds: result.renderSeconds },
      });
      return NextResponse.json({
        ok: true,
        data: {
          artifact: presentArtifact(artifact),
          projectId: requested.projectId,
          format: result.format,
          quality: result.quality,
          renderSeconds: result.renderSeconds,
          fps: result.fps,
          music: result.audio.music
            ? { title: result.audio.music.title, startSeconds: result.audio.music.startSeconds }
            : null,
          narration: result.audio.narration.map(({ atSeconds, durationSeconds }) => ({
            atSeconds,
            durationSeconds,
          })),
          notes: result.audio.notes,
        },
      });
    } finally {
      result.cleanup();
    }
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "video.render_failed",
        runtimeSessionId,
        payload: {
          reason: error instanceof VideoRequestError || error instanceof ApiError
            ? error.code
            : "video_render_failed",
        },
      });
    }
    if (error instanceof VideoRequestError) {
      return apiErrorResponse(new ApiError(STATUS[error.code] ?? 502, error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}
