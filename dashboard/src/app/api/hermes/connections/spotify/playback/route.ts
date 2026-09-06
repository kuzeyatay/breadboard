import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { getConversationForUser } from "@/lib/conversations/store.ts";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import {
  activateSpotifyPhonePlayback,
  getSpotifyPlaybackIntent,
  spotifyApiRequest,
  spotifyConnectionStatus,
  spotifyCurrentPlaybackState,
  spotifyLibraryContains,
} from "@/lib/spotify/service.ts";
import { spotifyTargetDevice } from "@/lib/spotify/playback-target.ts";
import { spotifyQueueStep } from "@/lib/spotify/queue.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function trackId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9]{10,64}$/.test(id)) {
    throw new ApiError(400, "invalid_spotify_track", "The Spotify track is invalid.");
  }
  return id;
}

async function playbackAfterChange(
  userId: number,
  previousTrackId: string | null,
) {
  let playback = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 160));
    playback = await spotifyCurrentPlaybackState(userId);
    if (playback && (!previousTrackId || playback.track.id !== previousTrackId)) break;
  }
  return playback;
}

async function playbackAtTrack(userId: number, trackId: string) {
  let playback = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    playback = await spotifyCurrentPlaybackState(userId);
    if (playback?.track.id === trackId) break;
  }
  if (playback?.track.id !== trackId) {
    throw new ApiError(
      502,
      "spotify_playlist_skip_failed",
      "Spotify did not advance to the requested playlist track.",
    );
  }
  return playback;
}

async function libraryState(userId: number, id: string | null | undefined) {
  if (!id) return null;
  return {
    trackId: id,
    saved: await spotifyLibraryContains(userId, id),
  };
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const publicId = new URL(request.url).searchParams.get("conversation") ?? "";
    const conversation = getConversationForUser(publicId, userId);
    const status = spotifyConnectionStatus(userId);
    const intent = getSpotifyPlaybackIntent(userId, conversation.id);
    const [current, device] = status.connected && intent
      ? await Promise.all([
          spotifyCurrentPlaybackState(userId).catch(() => null),
          spotifyTargetDevice(userId, intent.target).catch(() => null),
        ])
      : [null, null];
    const playback =
      current &&
      device &&
      current.deviceId === device.id &&
      intent?.queueUris.includes(current.track.uri)
        ? current
        : null;
    return NextResponse.json({
      ...status,
      intent,
      playback,
      device: device
        ? { name: device.name, type: device.type }
        : null,
      library: status.connected
        ? await libraryState(userId, playback?.track.id ?? intent?.track.id).catch(
            () => null,
          )
        : null,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const body = await readJsonBody(request, 16 * 1024);
    const publicId = typeof body.conversation === "string" ? body.conversation : "";
    const conversation = getConversationForUser(publicId, userId);
    const action = typeof body.action === "string" ? body.action : "";
    const target = getSpotifyPlaybackIntent(userId, conversation.id)?.target ?? "inline";
    const playerDeviceId = async (options?: {
      activate?: boolean;
      play?: boolean;
    }) => {
      if (!spotifyConnectionStatus(userId).connected) {
        throw new ApiError(409, "spotify_connection_required", "Connect Spotify from Settings → Connections before using the player.");
      }
      const device = await spotifyTargetDevice(userId, target);
      if (!device) {
        throw new ApiError(409, target === "phone" ? "spotify_phone_unavailable" : "spotify_engine_starting",
          target === "phone" ? "Spotify is not currently available on your phone. Open Spotify on the phone and try again." : "Breadboard's Spotify player is still starting. Try playback again.");
      }
      if (target === "inline" || options?.activate === false || device.isActive) return device.id;
      return (
        await activateSpotifyPhonePlayback({
          userId,
          device,
          play: options?.play === true,
        })
      ).id;
    };

    if (action === "play") {
      const intent = getSpotifyPlaybackIntent(userId, conversation.id);
      if (!intent) {
        throw new ApiError(404, "spotify_track_not_ready", "The requested track is not ready yet.");
      }
      await spotifyApiRequest({
        userId,
        method: "PUT",
        endpoint: "/v1/me/player/play",
        query: { device_id: await playerDeviceId({ activate: false }) },
        body: { uris: intent.queueUris },
      });
      return NextResponse.json({ ok: true, revision: intent.revision });
    }

    if (action === "shuffle") {
      await spotifyApiRequest({
        userId,
        method: "PUT",
        endpoint: "/v1/me/player/shuffle",
        query: {
          state: body.enabled === true,
          device_id: await playerDeviceId(),
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "pause" || action === "resume") {
      await spotifyApiRequest({
        userId,
        method: "PUT",
        endpoint:
          action === "pause" ? "/v1/me/player/pause" : "/v1/me/player/play",
        query: {
          device_id: await playerDeviceId({ play: action === "resume" }),
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "previous" || action === "next") {
      const intent = getSpotifyPlaybackIntent(userId, conversation.id);
      if (!intent) {
        throw new ApiError(404, "spotify_track_not_ready", "The requested track is not ready yet.");
      }
      const before = await spotifyCurrentPlaybackState(userId);
      const requestedTrackId = body.currentTrackId === undefined
        ? null
        : trackId(body.currentTrackId);
      const providerTrackId =
        before && intent.queueUris.includes(before.track.uri)
          ? before.track.id
          : null;
      const step = spotifyQueueStep(
        intent.queueUris,
        requestedTrackId ?? providerTrackId ?? intent.track.id,
        action,
      );
      if (!step) {
        throw new ApiError(409, "spotify_queue_empty", "The playlist queue is empty.");
      }
      await spotifyApiRequest({
        userId,
        method: "PUT",
        endpoint: "/v1/me/player/play",
        query: { device_id: await playerDeviceId() },
        body: { uris: step.playbackUris },
      });
      if (before?.isPlaying === false) {
        await spotifyApiRequest({
          userId,
          method: "PUT",
          endpoint: "/v1/me/player/pause",
          query: { device_id: await playerDeviceId() },
        });
      }
      const playback = await playbackAtTrack(userId, step.targetId);
      return NextResponse.json({
        ok: true,
        playback,
        queue: {
          revision: intent.revision,
          index: step.targetIndex,
          length: intent.queueUris.length,
        },
        library: await libraryState(userId, playback?.track.id).catch(() => null),
      });
    }

    if (action === "seek") {
      const positionMs = Number(body.positionMs);
      if (!Number.isFinite(positionMs) || positionMs < 0) {
        throw new ApiError(400, "invalid_spotify_position", "The playback position is invalid.");
      }
      await spotifyApiRequest({
        userId,
        method: "PUT",
        endpoint: "/v1/me/player/seek",
        query: {
          position_ms: Math.round(positionMs),
          device_id: await playerDeviceId(),
        },
      });
      return NextResponse.json({
        ok: true,
        playback: await playbackAfterChange(userId, null),
      });
    }

    if (action === "save" || action === "unsave") {
      const id = trackId(body.trackId);
      await spotifyApiRequest({
        userId,
        method: action === "save" ? "PUT" : "DELETE",
        endpoint: "/v1/me/library",
        query: { uris: `spotify:track:${id}` },
      });
      return NextResponse.json({
        ok: true,
        library: { trackId: id, saved: action === "save" },
      });
    }

    throw new ApiError(400, "invalid_spotify_action", "That player action is not supported.");
  } catch (error) {
    return apiErrorResponse(error);
  }
}
