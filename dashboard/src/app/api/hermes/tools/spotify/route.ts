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
  spotifyPlaybackTarget,
  withSpotifyPlaybackDevice,
  type SpotifyPlaybackTarget,
} from "@/lib/spotify/playback-target.ts";
import type { SpotifyConnectDevice } from "@/lib/spotify/devices.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SPOTIFY_CONTROL_ACTIONS = [
  "pause",
  "resume",
  "next",
  "previous",
  "seek",
  "shuffle",
  "volume",
  "repeat",
] as const;

type SpotifyControlAction =
  (typeof SPOTIFY_CONTROL_ACTIONS)[number];

function playbackControlAction(value: unknown): SpotifyControlAction | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    !SPOTIFY_CONTROL_ACTIONS.includes(
      value as SpotifyControlAction,
    )
  ) {
    throw new ApiError(
      400,
      "spotify_control_invalid",
      "That Spotify playback control is not supported.",
    );
  }
  return value as SpotifyControlAction;
}

async function startPlayback(input: {
  userId: number;
  uris: string[];
  target: SpotifyPlaybackTarget;
}): Promise<SpotifyConnectDevice> {
  return withSpotifyPlaybackDevice(input.userId, input.target, async (device) => {
    await spotifyApiRequest({
      userId: input.userId,
      method: "PUT",
      endpoint: "/v1/me/player/play",
      query: { device_id: device.id },
      body: { uris: input.uris },
    });
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const current = await spotifyCurrentPlaybackState(input.userId).catch(
        () => null,
      );
      if (
        current?.isPlaying === true &&
        current.deviceId === device.id &&
        current.track.uri === input.uris[0]
      ) {
        return device;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new ApiError(
      502,
      "spotify_playback_failed",
      input.target === "phone"
        ? "Spotify selected your phone but did not start the requested track. Try playback again."
        : "Breadboard's Spotify player did not start the requested track. Try playback again.",
    );
  }, true);
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

async function controlSpotifyPlayback(input: {
  userId: number;
  action: SpotifyControlAction;
  target: SpotifyPlaybackTarget;
  args: Record<string, unknown>;
}) {
  let method: "POST" | "PUT" = "PUT";
  let endpoint = "";
  const query: Record<string, string | number | boolean> = {};

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

  return withSpotifyPlaybackDevice(input.userId, input.target, async (device) => {
    query.device_id = device.id;
    await spotifyApiRequest({
      userId: input.userId,
      method,
      endpoint,
      query,
    });
    return {
      action: input.action,
      status: "controlled",
      player: input.target,
      device: { name: device.name, type: device.type },
    };
  });
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
    const target = spotifyPlaybackTarget(args.target);
    const controlAction = toolName === "spotify_play"
      ? playbackControlAction(args.action)
      : null;
    if (controlAction) {
      const data = await controlSpotifyPlayback({
        userId: session.user_id,
        action: controlAction,
        target,
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
    const playlist = toolName === "spotify_create_playlist"
      ? await createSpotifyPlaylist({
          userId: session.user_id,
          name: typeof args.name === "string" ? args.name : "",
          description: typeof args.description === "string" ? args.description : "",
          tracks,
        })
      : null;
    const shouldPlay = toolName === "spotify_play" || (playlist !== null && args.play === true);
    const data = shouldPlay
      ? await (async () => {
          // Persist the resolved request before starting audio so the inline
          // controls remain available even if the playback engine fails.
          const intent = recordSpotifyPlaybackIntent({
            userId: session.user_id!,
            conversationId: session.conversation_id!,
            tracks,
            target,
          });
          const selection = {
            ...(playlist ? { playlist } : {}),
            selected: intent.track,
            queueLength: intent.queueUris.length,
            player: target,
          };
          try {
            const device = await startPlayback({
              userId: session.user_id!, uris: intent.queueUris, target,
            });
            return {
              ...selection, status: "playing", playbackStarted: true,
              device: { name: device.name, type: device.type },
            };
          } catch (error) {
            return {
              ...selection, status: "playback_failed", playbackStarted: false,
              playbackError: error instanceof Error ? error.message : "Spotify playback failed.",
            };
          }
        })()
      : playlist ? { playlist, status: "created" } : { tracks };
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
