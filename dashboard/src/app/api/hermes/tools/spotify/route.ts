import { NextResponse } from "next/server";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import { SPOTIFY_TOOLS } from "@/lib/hermes/tool-scopes.ts";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import {
  createSpotifyPlaylist,
  recordSpotifyPlaybackIntent,
  searchSpotifyTracks,
  spotifyApiRequest,
  spotifyCurrentPlaybackState,
  SPOTIFY_SKILL_SLUG,
} from "@/lib/spotify/service.ts";
import {
  ensureSpotifyPlaybackEngine,
  spotifyPlaybackEngineStatus,
} from "@/lib/spotify/playback-engine.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function startInlinePlaylistPlayback(input: {
  userId: number;
  requestOrigin: string;
  uris: string[];
}): Promise<boolean> {
  let engine = ensureSpotifyPlaybackEngine(input.userId, input.requestOrigin);
  for (let attempt = 0; attempt < 20 && !engine.ready; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    engine = spotifyPlaybackEngineStatus(input.userId);
  }
  if (!engine.ready || !engine.deviceId) return false;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await spotifyApiRequest({
        userId: input.userId,
        method: "PUT",
        endpoint: "/v1/me/player/play",
        query: { device_id: engine.deviceId },
        body: { uris: input.uris },
      });
      for (let poll = 0; poll < 6; poll += 1) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        const current = await spotifyCurrentPlaybackState(input.userId).catch(
          () => null,
        );
        if (
          current?.isPlaying === true &&
          input.uris.includes(current.track.uri)
        ) {
          return true;
        }
      }
    }
    return false;
  } catch {
    // The private playlist was still created successfully. Keep its inline
    // queue available so a transient playback-device delay is recoverable with
    // the widget's Play control instead of turning the write into a false fail.
    return false;
  }
}

export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  let toolName = "";
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const body = await readJsonBody(request, 16 * 1024);
    toolName = typeof body.tool === "string" ? body.tool : "";
    if (!SPOTIFY_TOOLS.includes(toolName as (typeof SPOTIFY_TOOLS)[number])) {
      throw new ApiError(400, "spotify_unknown_tool", "Unknown Spotify tool.");
    }
    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: toolName })) {
      throw new ApiError(403, "spotify_capability_denied", "Spotify access is not authorized.");
    }
    runtimeSessionId = Number(verified.token.breadboardSessionId);
    const session = getRuntimeSessionById(runtimeSessionId);
    if (
      !session ||
      session.user_id === null ||
      session.conversation_id === null ||
      !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(403, "spotify_session_scope_mismatch", "Spotify session scope is invalid.");
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(409, "spotify_run_required", "Spotify requires a current chat turn.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (
      !decision ||
      !decision.allowedTools.includes(toolName) ||
      !decision.selectedConditionalSkills.includes(SPOTIFY_SKILL_SLUG)
    ) {
      throw new ApiError(403, "spotify_skill_not_selected", "Select the Spotify skill for this turn.");
    }
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const query = typeof args.query === "string" ? args.query : "";
    const playlistQueries = toolName === "spotify_create_playlist"
      ? [
          ...(Array.isArray(args.queries) ? args.queries : []),
          ...(query ? [query] : []),
        ]
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim().slice(0, 200))
          .filter(Boolean)
          .filter((value, index, values) => values.indexOf(value) === index)
          .slice(0, 4)
      : [query];
    const trackGroups: Awaited<ReturnType<typeof searchSpotifyTracks>>[] = [];
    for (const playlistQuery of playlistQueries) {
      trackGroups.push(
        await searchSpotifyTracks(
          session.user_id,
          playlistQuery,
          toolName === "spotify_search" ? 5 : 10,
        ),
      );
    }
    const tracks = [...new Map(
      trackGroups.flat().map((track) => [track.uri, track] as const),
    ).values()].slice(0, 30);
    if (!tracks.length) {
      throw new ApiError(404, "spotify_track_not_found", "Spotify did not find a matching track.");
    }
    const data = toolName === "spotify_create_playlist"
      ? await (async () => {
          const playlist = await createSpotifyPlaylist({
            userId: session.user_id!,
            name: typeof args.name === "string" ? args.name : "",
            description: typeof args.description === "string" ? args.description : "",
            tracks,
          });
          const shouldPlay = args.play === true;
          const playbackStarted = shouldPlay
            ? await startInlinePlaylistPlayback({
                userId: session.user_id!,
                requestOrigin: new URL(request.url).origin,
                uris: tracks.map((track) => track.uri),
              })
            : false;
          const intent = shouldPlay
            ? recordSpotifyPlaybackIntent({
                userId: session.user_id!,
                conversationId: session.conversation_id!,
                tracks,
              })
            : null;
          return {
            playlist,
            ...(intent
              ? {
                  selected: intent.track,
                  queueLength: intent.queueUris.length,
                  player: "inline",
                  status: playbackStarted ? "playing" : "ready",
                  playbackStarted,
                }
              : { status: "created" }),
          };
        })()
      : toolName === "spotify_play"
      ? (() => {
          const intent = recordSpotifyPlaybackIntent({
            userId: session.user_id!,
            conversationId: session.conversation_id!,
            tracks,
          });
          return {
            selected: intent.track,
            queueLength: intent.queueUris.length,
            player: "inline",
            status: "ready",
            playbackStarted: false,
          };
        })()
      : { tracks };
    recordAuditEvent({
      eventType: "spotify.tool_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        runId: run.id,
        tool: toolName,
        resultCount: tracks.length,
        playlistId:
          typeof data === "object" &&
          data !== null &&
          "playlist" in data &&
          typeof data.playlist === "object" &&
          data.playlist !== null &&
          "id" in data.playlist &&
          typeof data.playlist.id === "string"
            ? data.playlist.id
            : null,
        playbackStarted:
          typeof data === "object" && data !== null && "playbackStarted" in data
            ? data.playbackStarted === true
            : false,
      },
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "spotify.tool_failed",
        runtimeSessionId,
        payload: {
          tool: toolName,
          reason: error instanceof ApiError ? error.code : "spotify_tool_failed",
        },
      });
    }
    return apiErrorResponse(error);
  }
}
