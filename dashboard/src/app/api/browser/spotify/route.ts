import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { spotifyPlaybackEngineStatus } from "@/lib/spotify/playback-engine.ts";
import {
  searchSpotifyTracks,
  spotifyApiRequest,
  spotifyConnectionStatus,
  spotifyCurrentPlaybackState,
  spotifyPlaylistTracks,
  spotifyUserPlaylists,
} from "@/lib/spotify/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS = new Set([
  "pause",
  "resume",
  "previous",
  "next",
  "transfer",
  "play-track",
  "play-playlist",
]);
const SPOTIFY_TRACK_URI = /^spotify:track:[A-Za-z0-9]{10,64}$/;
const SPOTIFY_PLAYLIST_URI = /^spotify:playlist:[A-Za-z0-9]{10,64}$/;

async function stateAfterChange(userId: number, expectedUri?: string) {
  for (let attempt = 0; attempt < (expectedUri ? 5 : 1); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 180));
    const playback = await spotifyCurrentPlaybackState(userId).catch(() => null);
    if (!expectedUri || playback?.track.uri === expectedUri) return playback;
  }
  return spotifyCurrentPlaybackState(userId).catch(() => null);
}

export async function GET(request: Request) {
  try {
    requireEnabled();
    const userId = await requireUserId();
    const url = new URL(request.url);
    const view = url.searchParams.get("view");
    if (view === "search") {
      const query = url.searchParams.get("q") ?? "";
      return NextResponse.json(
        { tracks: await searchSpotifyTracks(userId, query, 10) },
        { headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" } },
      );
    }
    if (view === "playlists") {
      return NextResponse.json(
        { playlists: await spotifyUserPlaylists(userId, 24) },
        { headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" } },
      );
    }
    if (view === "playlist") {
      const playlistId = url.searchParams.get("id") ?? "";
      return NextResponse.json(
        await spotifyPlaylistTracks(userId, playlistId, 40),
        { headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" } },
      );
    }
    if (view) {
      throw new ApiError(400, "invalid_spotify_dock_view", "That Spotify view is not supported.");
    }
    const connection = spotifyConnectionStatus(userId);
    if (!connection.connected) {
      return NextResponse.json({
        ...connection,
        engine: { ready: false, deviceId: null, status: "unavailable", error: null },
        playback: null,
      });
    }
    const [engine, playback] = await Promise.all([
      spotifyPlaybackEngineStatus(userId),
      spotifyCurrentPlaybackState(userId).catch(() => null),
    ]);
    return NextResponse.json(
      { ...connection, engine, playback },
      { headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireEnabled();
    const userId = await requireUserId();
    const body = await readJsonBody(request, 16 * 1024);
    const action = typeof body.action === "string" ? body.action : "";
    if (!ACTIONS.has(action)) {
      throw new ApiError(400, "invalid_spotify_dock_action", "That music control is not supported.");
    }
    const allowedKeys = action === "play-track"
      ? new Set(["action", "trackUri", "queueUris"])
      : action === "play-playlist"
        ? new Set(["action", "playlistUri"])
        : new Set(["action"]);
    if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
      throw new ApiError(400, "invalid_spotify_dock_action", "That music control is not supported.");
    }
    if (!spotifyConnectionStatus(userId).connected) {
      throw new ApiError(
        409,
        "spotify_connection_required",
        "Connect Spotify from Settings → Connections first.",
      );
    }
    const engine = await spotifyPlaybackEngineStatus(userId);
    if (!engine.ready || !engine.deviceId) {
      throw new ApiError(
        409,
        "spotify_engine_starting",
        "Breadboard's Spotify player is still starting.",
      );
    }

    const trackUri = typeof body.trackUri === "string" ? body.trackUri : "";
    const playlistUri = typeof body.playlistUri === "string" ? body.playlistUri : "";
    if (action === "play-track" && !SPOTIFY_TRACK_URI.test(trackUri)) {
      throw new ApiError(400, "invalid_spotify_track", "The Spotify track is invalid.");
    }
    if (action === "play-playlist" && !SPOTIFY_PLAYLIST_URI.test(playlistUri)) {
      throw new ApiError(400, "invalid_spotify_playlist", "The Spotify playlist is invalid.");
    }

    if (action === "play-track") {
      const submittedQueue = Array.isArray(body.queueUris) ? body.queueUris : [];
      const queueUris = [trackUri, ...submittedQueue]
        .filter((uri): uri is string => typeof uri === "string" && SPOTIFY_TRACK_URI.test(uri))
        .filter((uri, index, values) => values.indexOf(uri) === index)
        .slice(0, 50);
      await spotifyApiRequest({
        userId,
        method: "PUT",
        endpoint: "/v1/me/player/play",
        query: { device_id: engine.deviceId },
        body: { uris: queueUris },
      });
      return NextResponse.json({
        ok: true,
        engine,
        playback: await stateAfterChange(userId, trackUri),
      });
    }
    if (action === "play-playlist") {
      await spotifyApiRequest({
        userId,
        method: "PUT",
        endpoint: "/v1/me/player/play",
        query: { device_id: engine.deviceId },
        body: { context_uri: playlistUri },
      });
      return NextResponse.json({
        ok: true,
        engine,
        playback: await stateAfterChange(userId),
      });
    }

    const current = await spotifyCurrentPlaybackState(userId).catch(() => null);
    const activeDeviceId = current?.deviceId ?? engine.deviceId;
    if (action === "transfer" || action === "resume") {
      if (current?.deviceId !== engine.deviceId) {
        await spotifyApiRequest({
          userId,
          method: "PUT",
          endpoint: "/v1/me/player",
          body: { device_ids: [engine.deviceId], play: true },
        });
      } else {
        await spotifyApiRequest({
          userId,
          method: "PUT",
          endpoint: "/v1/me/player/play",
          query: { device_id: engine.deviceId },
        });
      }
    } else if (action === "pause") {
      await spotifyApiRequest({
        userId,
        method: "PUT",
        endpoint: "/v1/me/player/pause",
        query: { device_id: activeDeviceId },
      });
    } else {
      if (!current) {
        throw new ApiError(409, "spotify_playback_required", "Start a track in Spotify first.");
      }
      if (current.deviceId !== engine.deviceId) {
        await spotifyApiRequest({
          userId,
          method: "PUT",
          endpoint: "/v1/me/player",
          body: { device_ids: [engine.deviceId], play: current.isPlaying },
        });
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      await spotifyApiRequest({
        userId,
        method: "POST",
        endpoint: action === "previous" ? "/v1/me/player/previous" : "/v1/me/player/next",
        query: { device_id: engine.deviceId },
      });
    }

    return NextResponse.json({
      ok: true,
      engine,
      playback: await stateAfterChange(userId),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
