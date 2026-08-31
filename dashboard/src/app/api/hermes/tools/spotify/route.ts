import { randomUUID } from "node:crypto";
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
  activateSpotifyPhonePlayback,
  createSpotifyPlaylist,
  recordSpotifyPlaybackIntent,
  searchSpotifyTracks,
  spotifyApiRequest,
  spotifyCurrentPlaybackState,
  spotifyPhonePlaybackDevice,
  SPOTIFY_SKILL_SLUG,
} from "@/lib/spotify/service.ts";
import {
  issueSpotifyPlaybackEngineTicket,
  spotifyPlaybackEngineStatus,
} from "@/lib/spotify/playback-engine.ts";
import {
  releaseSpotifyPlaybackViewLease,
  renewSpotifyPlaybackViewLease,
} from "@/lib/spotify/view-lease.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SPOTIFY_PHONE_CONTROL_ACTIONS = [
  "pause",
  "resume",
  "next",
  "previous",
  "seek",
  "shuffle",
  "volume",
  "repeat",
] as const;

type SpotifyPhoneControlAction =
  (typeof SPOTIFY_PHONE_CONTROL_ACTIONS)[number];

function phoneControlAction(value: unknown): SpotifyPhoneControlAction | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    !SPOTIFY_PHONE_CONTROL_ACTIONS.includes(
      value as SpotifyPhoneControlAction,
    )
  ) {
    throw new ApiError(
      400,
      "spotify_control_invalid",
      "That Spotify playback control is not supported.",
    );
  }
  return value as SpotifyPhoneControlAction;
}

async function requireSpotifyPhone(userId: number) {
  const device = await spotifyPhonePlaybackDevice(userId);
  if (!device) {
    throw new ApiError(
      409,
      "spotify_phone_unavailable",
      "Spotify is not currently available on your phone. Open Spotify on the phone and try again.",
    );
  }
  return device;
}

async function startPhonePlayback(input: {
  userId: number;
  uris: string[];
}) {
  const device = await spotifyPhonePlaybackDevice(input.userId);
  if (!device) return null;
  await spotifyApiRequest({
    userId: input.userId,
    method: "PUT",
    endpoint: "/v1/me/player/play",
    query: { device_id: device.id },
    body: { uris: input.uris },
  });
  return device;
}

function numberInRange(input: {
  value: unknown;
  minimum: number;
  maximum?: number;
  code: string;
  message: string;
}): number {
  const value = Number(input.value);
  if (
    !Number.isFinite(value) ||
    value < input.minimum ||
    (input.maximum !== undefined && value > input.maximum)
  ) {
    throw new ApiError(400, input.code, input.message);
  }
  return Math.round(value);
}

async function controlSpotifyPhone(input: {
  userId: number;
  action: SpotifyPhoneControlAction;
  args: Record<string, unknown>;
}) {
  const availableDevice = await requireSpotifyPhone(input.userId);
  const device = await activateSpotifyPhonePlayback({
    userId: input.userId,
    device: availableDevice,
    play: input.action === "resume",
  });
  let method: "POST" | "PUT" = "PUT";
  let endpoint = "";
  const query: Record<string, string | number | boolean> = {
    device_id: device.id,
  };

  if (input.action === "pause" || input.action === "resume") {
    endpoint = input.action === "pause"
      ? "/v1/me/player/pause"
      : "/v1/me/player/play";
  } else if (input.action === "next" || input.action === "previous") {
    method = "POST";
    endpoint = `/v1/me/player/${input.action}`;
  } else if (input.action === "seek") {
    endpoint = "/v1/me/player/seek";
    query.position_ms = numberInRange({
      value: input.args.positionMs,
      minimum: 0,
      code: "invalid_spotify_position",
      message: "The playback position is invalid.",
    });
  } else if (input.action === "shuffle") {
    if (typeof input.args.enabled !== "boolean") {
      throw new ApiError(
        400,
        "invalid_spotify_shuffle",
        "Shuffle must be turned on or off.",
      );
    }
    endpoint = "/v1/me/player/shuffle";
    query.state = input.args.enabled;
  } else if (input.action === "volume") {
    endpoint = "/v1/me/player/volume";
    query.volume_percent = numberInRange({
      value: input.args.volumePercent,
      minimum: 0,
      maximum: 100,
      code: "invalid_spotify_volume",
      message: "Spotify volume must be between 0 and 100.",
    });
  } else {
    const state = typeof input.args.repeatState === "string"
      ? input.args.repeatState
      : "";
    if (!new Set(["off", "track", "context"]).has(state)) {
      throw new ApiError(
        400,
        "invalid_spotify_repeat",
        "Spotify repeat must be off, track, or context.",
      );
    }
    endpoint = "/v1/me/player/repeat";
    query.state = state;
  }

  await spotifyApiRequest({
    userId: input.userId,
    method,
    endpoint,
    query,
  });
  return {
    action: input.action,
    status: "controlled",
    device: { name: device.name, type: device.type },
  };
}

async function startInlinePlaylistPlayback(input: {
  userId: number;
  uris: string[];
}): Promise<boolean> {
  const viewId = randomUUID();
  try {
    await renewSpotifyPlaybackViewLease({
      userId: input.userId,
      viewId,
      ticket: issueSpotifyPlaybackEngineTicket(input.userId),
    });
  } catch {
    return false;
  }
  try {
    let engine = await spotifyPlaybackEngineStatus(input.userId);
    for (let attempt = 0; attempt < 20 && !engine.ready; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      engine = await spotifyPlaybackEngineStatus(input.userId);
    }
    if (!engine.ready || !engine.deviceId) return false;
    await spotifyApiRequest({
      userId: input.userId,
      method: "PUT",
      endpoint: "/v1/me/player/play",
      query: { device_id: engine.deviceId },
      body: { uris: input.uris },
    });
    for (let poll = 0; poll < 18; poll += 1) {
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
    return false;
  } catch {
    // The private playlist was still created successfully. Keep its inline
    // queue available so a transient playback-device delay is recoverable with
    // the widget's Play control instead of turning the write into a false fail.
    return false;
  } finally {
    await releaseSpotifyPlaybackViewLease({
      userId: input.userId,
      viewId,
    });
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
    const controlAction = toolName === "spotify_play"
      ? phoneControlAction(args.action)
      : null;
    if (controlAction) {
      const data = await controlSpotifyPhone({
        userId: session.user_id,
        action: controlAction,
        args,
      });
      recordAuditEvent({
        eventType: "spotify.tool_completed",
        runtimeSessionId: session.id,
        userId: session.user_id,
        gardenId: session.garden_id,
        payload: {
          runId: run.id,
          tool: toolName,
          action: controlAction,
          deviceType: data.device.type,
        },
      });
      return NextResponse.json({ ok: true, data });
    }
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
          const intent = shouldPlay
            ? recordSpotifyPlaybackIntent({
                userId: session.user_id!,
                conversationId: session.conversation_id!,
                tracks,
              })
            : null;
          const phone = shouldPlay
            ? await startPhonePlayback({
                userId: session.user_id!,
                uris: tracks.map((track) => track.uri),
              })
            : null;
          const playbackStarted = shouldPlay && !phone
            ? await startInlinePlaylistPlayback({
                userId: session.user_id!,
                uris: tracks.map((track) => track.uri),
              })
            : Boolean(phone);
          return {
            playlist,
            ...(intent
              ? {
                  selected: intent.track,
                  queueLength: intent.queueUris.length,
                  player: "inline",
                  status: playbackStarted ? "playing" : "ready",
                  playbackStarted,
                  ...(phone
                    ? { device: { name: phone.name, type: phone.type } }
                    : {}),
                }
              : { status: "created" }),
          };
        })()
      : toolName === "spotify_play"
      ? await (async () => {
          const intent = recordSpotifyPlaybackIntent({
            userId: session.user_id!,
            conversationId: session.conversation_id!,
            tracks,
          });
          const phone = await startPhonePlayback({
            userId: session.user_id!,
            uris: intent.queueUris,
          });
          return {
            selected: intent.track,
            queueLength: intent.queueUris.length,
            player: "inline",
            status: phone ? "playing" : "ready",
            playbackStarted: Boolean(phone),
            ...(phone
              ? { device: { name: phone.name, type: phone.type } }
              : {}),
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
