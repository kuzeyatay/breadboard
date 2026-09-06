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
  spotifyAddTrackToPlaylist,
  spotifyApiRequest,
  spotifyConnectionStatus,
  spotifyCreateManagedPlaylist,
  spotifyCurrentPlaybackState,
  spotifyDeletePlaylist,
  spotifyLibraryContains,
  spotifyListeningHistory,
  spotifyPlaylistTracks,
  spotifyRecommendedTracks,
  spotifyRemoveTrackFromPlaylist,
  spotifyRenamePlaylist,
  spotifySetTrackSaved,
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
  "save-track",
  "remove-saved-track",
  "add-to-playlist",
  "remove-from-playlist",
  "create-playlist",
  "rename-playlist",
  "delete-playlist",
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
        savedTrack: false,
        history: spotifyListeningHistory.read(userId),
      });
    }
    const [engine, playback] = await Promise.all([
      spotifyPlaybackEngineStatus(userId),
      spotifyCurrentPlaybackState(userId).catch(() => null),
    ]);
    const savedTrack = playback
      ? await spotifyLibraryContains(userId, playback.track.id).catch(() => false)
      : false;
    return NextResponse.json(
      { ...connection, engine, playback, savedTrack, history: spotifyListeningHistory.read(userId) },
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
    const body = await readJsonBody(request, 64 * 1024);
    const action = typeof body.action === "string" ? body.action : "";
    if (action === "import-history") {
      if (!Array.isArray(body.tracks) || Object.keys(body).some((key) => key !== "action" && key !== "tracks")) {
        throw new ApiError(400, "invalid_spotify_history", "The saved Spotify history is invalid.");
      }
      return NextResponse.json({ history: spotifyListeningHistory.importLegacy(userId, body.tracks) });
    }
    if (!ACTIONS.has(action)) {
      throw new ApiError(400, "invalid_spotify_dock_action", "That music control is not supported.");
    }
    const allowedKeys = action === "play-track"
      ? new Set(["action", "trackUri", "queueUris", "autoplay"])
      : action === "play-playlist"
        ? new Set(["action", "playlistUri"])
        : action === "save-track" || action === "remove-saved-track"
          ? new Set(["action", "trackUri"])
          : action === "add-to-playlist" || action === "remove-from-playlist"
            ? new Set(["action", "playlistId", "trackUri"])
            : action === "create-playlist"
              ? new Set(["action", "name", "trackUri"])
              : action === "rename-playlist"
                ? new Set(["action", "playlistId", "name"])
                : action === "delete-playlist"
                  ? new Set(["action", "playlistId"])
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
    const trackUri = typeof body.trackUri === "string" ? body.trackUri : "";
    const playlistUri = typeof body.playlistUri === "string" ? body.playlistUri : "";
    const playlistId = typeof body.playlistId === "string" ? body.playlistId : "";
    const name = typeof body.name === "string" ? body.name : "";
    if (
      (action === "play-track" ||
        action === "save-track" ||
        action === "remove-saved-track" ||
        action === "add-to-playlist" ||
        action === "remove-from-playlist" ||
        (action === "create-playlist" && trackUri)) &&
      !SPOTIFY_TRACK_URI.test(trackUri)
    ) {
      throw new ApiError(400, "invalid_spotify_track", "The Spotify track is invalid.");
    }
    if (action === "play-track" && "autoplay" in body && typeof body.autoplay !== "boolean") {
      throw new ApiError(400, "invalid_spotify_autoplay", "The Spotify autoplay option is invalid.");
    }
    if (action === "play-playlist" && !SPOTIFY_PLAYLIST_URI.test(playlistUri)) {
      throw new ApiError(400, "invalid_spotify_playlist", "The Spotify playlist is invalid.");
    }
    if (
      (action === "add-to-playlist" || action === "remove-from-playlist") &&
      playlistId !== "liked-songs" &&
      !/^[A-Za-z0-9]{10,64}$/.test(playlistId)
    ) {
      throw new ApiError(400, "invalid_spotify_playlist", "The Spotify playlist is invalid.");
    }
    if (
      (action === "rename-playlist" || action === "delete-playlist") &&
      !/^[A-Za-z0-9]{10,64}$/.test(playlistId)
    ) {
      throw new ApiError(400, "invalid_spotify_playlist", "The Spotify playlist is invalid.");
    }

    if (action === "save-track" || action === "remove-saved-track") {
      const savedTrack = action === "save-track";
      await spotifySetTrackSaved(userId, trackUri, savedTrack);
      return NextResponse.json({
        ok: true,
        savedTrack,
        message: savedTrack ? "Added to Liked Songs." : "Removed from Liked Songs.",
      });
    }
    if (action === "add-to-playlist") {
      await spotifyAddTrackToPlaylist({ userId, playlistId, trackUri });
      return NextResponse.json({
        ok: true,
        ...(playlistId === "liked-songs" ? { savedTrack: true } : {}),
        message: "Song added to playlist.",
      });
    }
    if (action === "remove-from-playlist") {
      await spotifyRemoveTrackFromPlaylist({ userId, playlistId, trackUri });
      return NextResponse.json({
        ok: true,
        ...(playlistId === "liked-songs" ? { savedTrack: false } : {}),
        message: "Song removed from playlist.",
      });
    }
    if (action === "create-playlist") {
      const playlist = await spotifyCreateManagedPlaylist({
        userId,
        name,
        ...(trackUri ? { trackUri } : {}),
      });
      return NextResponse.json({ ok: true, playlist, message: "Playlist created." });
    }
    if (action === "rename-playlist") {
      await spotifyRenamePlaylist({ userId, playlistId, name });
      return NextResponse.json({ ok: true, message: "Playlist renamed." });
    }
    if (action === "delete-playlist") {
      await spotifyDeletePlaylist(userId, playlistId);
      return NextResponse.json({ ok: true, message: "Playlist removed from your Spotify library." });
    }

    const engine = await spotifyPlaybackEngineStatus(userId);
    // Transport controls stay on the active Spotify device, including a
    // phone, and do not need Breadboard's own playback engine to be ready.
    if (action === "pause" || action === "previous" || action === "next") {
      const current = await spotifyCurrentPlaybackState(userId).catch(() => null);
      if (!current) {
        throw new ApiError(409, "spotify_playback_required", "Start a track in Spotify first.");
      }
      await spotifyApiRequest({
        userId,
        method: action === "pause" ? "PUT" : "POST",
        endpoint: `/v1/me/player/${action}`,
        query: current.deviceId ? { device_id: current.deviceId } : undefined,
      });
      return NextResponse.json({
        ok: true,
        engine,
        playback: await stateAfterChange(userId),
        history: spotifyListeningHistory.read(userId),
      });
    }
    if (!engine.ready || !engine.deviceId) {
      throw new ApiError(
        409,
        "spotify_engine_starting",
        "Breadboard's Spotify player is still starting.",
      );
    }

    if (action === "play-track") {
      // Search results are not a listening queue. Seed Spotify's recommendation
      // engine from the selected result, then fall back to Spotify autoplay if
      // recommendations are unavailable for this account or app quota mode.
      const submittedQueue = body.autoplay === true
        ? await spotifyRecommendedTracks(userId, trackUri.slice("spotify:track:".length), 10)
          .then((tracks) => tracks.map((track) => track.uri))
          .catch(() => [])
        : Array.isArray(body.queueUris) ? body.queueUris : [];
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
        history: spotifyListeningHistory.read(userId),
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
        history: spotifyListeningHistory.read(userId),
      });
    }

    const current = await spotifyCurrentPlaybackState(userId).catch(() => null);
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
    }

    return NextResponse.json({
      ok: true,
      engine,
      playback: await stateAfterChange(userId),
      history: spotifyListeningHistory.read(userId),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
