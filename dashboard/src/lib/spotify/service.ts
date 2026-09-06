import "server-only";

import crypto from "node:crypto";
import db from "../db.ts";
import {
  connectedAppTokensFor,
  embeddedProviderRequest,
} from "../connected-apps/broker.ts";
import { readConnectedAppTokens } from "../connected-apps/vault.ts";
import { findNangoIntegration } from "../nango/catalog.ts";
import { ApiError } from "../hermes/route-core.ts";
import { createSpotifyHistoryStore } from "./history-store.ts";
import {
  selectSpotifyPhoneDevice,
  type SpotifyConnectDevice,
} from "./devices.ts";

export const SPOTIFY_CONNECTION_SLUG = "spotify";
export const spotifyListeningHistory = createSpotifyHistoryStore(db);
export const SPOTIFY_SKILL_SLUG = "spotify";
// Spotify's current Search API rejects values above 10. Keep this guard at
// the provider boundary so every caller, including playback queue resolution,
// stays valid even if it asks for a larger local result set.
export const SPOTIFY_SEARCH_RESULT_LIMIT = 10;
export const SPOTIFY_LIKED_SONGS_ID = "liked-songs";
export const SPOTIFY_LIKED_SONGS_URI = "spotify:collection:tracks";
export const SPOTIFY_PLAYLIST_WRITE_SCOPE = "playlist-modify-private";
export const SPOTIFY_PUBLIC_PLAYLIST_WRITE_SCOPE = "playlist-modify-public";
export const SPOTIFY_REQUIRED_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-library-read",
  "user-library-modify",
  "playlist-read-private",
] as const;

// Private-playlist discovery was added after the first Spotify connections
// shipped. It enriches the dock, but it is not required for search, playback,
// liked songs, or playlist creation. Keep those existing grants usable instead
// of presenting a healthy, refreshable Spotify account as disconnected.
const SPOTIFY_OPTIONAL_CONNECTION_SCOPES = new Set<string>([
  "playlist-read-private",
]);

export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artist: string;
  album: string;
  imageUrl: string | null;
  durationMs: number;
}

export interface SpotifyPlaybackIntent {
  target: "inline" | "phone";
  revision: string;
  track: SpotifyTrack;
  queueUris: string[];
  requestedAt: string;
}

export interface SpotifyPlaybackState {
  track: SpotifyTrack;
  isPlaying: boolean;
  positionMs: number;
  shuffle: boolean;
  deviceId: string | null;
  deviceName: string | null;
}

export interface SpotifyPlaylist {
  id: string;
  uri: string;
  name: string;
  description: string;
  trackCount: number;
  isPublic: false;
}

export interface SpotifyLibraryPlaylist {
  id: string;
  uri: string;
  kind: "playlist" | "liked-songs";
  name: string;
  description: string;
  imageUrl: string | null;
  trackCount: number;
  owner: string;
  ownerId: string;
  collaborative: boolean;
  isPublic: boolean | null;
  canAddTracks: boolean;
  canRemoveTracks: boolean;
  canEditDetails: boolean;
  canDelete: boolean;
}

type PlaybackIntentRow = {
  target: "inline" | "phone";
  revision: string;
  track_json: string;
  queue_json: string;
  requested_at: string;
};

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function scopes(value: string | null | undefined): Set<string> {
  return new Set((value ?? "").split(/\s+/).filter(Boolean));
}

export function spotifyConnectionStatus(userId: number): {
  configured: boolean;
  connected: boolean;
  status: "connected" | "needs_reauth" | "not_connected";
  playlistAccess: boolean;
  playlistWriteAccess: boolean;
} {
  const tokens = readConnectedAppTokens(userId, SPOTIFY_CONNECTION_SLUG);
  if (!tokens) {
    return {
      configured: false,
      connected: false,
      status: "not_connected",
      playlistAccess: false,
      playlistWriteAccess: false,
    };
  }
  const granted = scopes(tokens.scope);
  const playlistAccess = granted.has("playlist-read-private");
  const playlistWriteAccess =
    granted.has(SPOTIFY_PLAYLIST_WRITE_SCOPE) ||
    granted.has(SPOTIFY_PUBLIC_PLAYLIST_WRITE_SCOPE);
  const connected = SPOTIFY_REQUIRED_SCOPES.every(
    (scope) => granted.has(scope) || SPOTIFY_OPTIONAL_CONNECTION_SCOPES.has(scope),
  );
  return {
    configured: true,
    connected,
    status: connected ? "connected" : "needs_reauth",
    playlistAccess,
    playlistWriteAccess,
  };
}

export async function spotifyBrowserAccessToken(userId: number): Promise<{
  accessToken: string;
  expiresAt: string | null;
}> {
  const status = spotifyConnectionStatus(userId);
  if (!status.connected) {
    throw new ApiError(
      409,
      "spotify_connection_required",
      "Connect Spotify from Settings → Connections before using the player.",
    );
  }
  const tokens = await connectedAppTokensFor(userId, SPOTIFY_CONNECTION_SLUG);
  return { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt };
}

export async function spotifyApiRequest(input: {
  userId: number;
  method: "GET" | "POST" | "PUT" | "DELETE";
  endpoint: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}): Promise<unknown> {
  if (!spotifyConnectionStatus(input.userId).connected) {
    throw new ApiError(
      409,
      "spotify_connection_required",
      "Connect Spotify from Settings → Connections before using the player.",
    );
  }
  const integration = findNangoIntegration(SPOTIFY_CONNECTION_SLUG);
  if (!integration) {
    throw new ApiError(503, "spotify_unavailable", "Spotify is temporarily unavailable.");
  }
  return embeddedProviderRequest({
    userId: input.userId,
    integration,
    request: {
      method: input.method,
      endpoint: input.endpoint,
      ...(input.query ? { query: input.query } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
    },
  });
}

export async function spotifyLibraryContains(
  userId: number,
  trackId: string,
): Promise<boolean> {
  if (!/^[A-Za-z0-9]{10,64}$/.test(trackId)) {
    throw new ApiError(400, "invalid_spotify_track", "The Spotify track is invalid.");
  }
  const payload = await spotifyApiRequest({
    userId,
    method: "GET",
    endpoint: "/v1/me/library/contains",
    query: { uris: `spotify:track:${trackId}` },
  });
  return Array.isArray(payload) && payload[0] === true;
}

function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const allowed =
      url.protocol === "https:" &&
      (url.hostname === "i.scdn.co" ||
        url.hostname.endsWith(".spotifycdn.com") ||
        url.hostname === "mosaic.scdn.co");
    return allowed ? url.toString() : null;
  } catch {
    return null;
  }
}

function spotifyTrack(value: unknown): SpotifyTrack | null {
  const track = objectRecord(value);
  const album = objectRecord(track?.album);
  const artists = Array.isArray(track?.artists) ? track.artists : [];
  const artistNames = artists
    .map(objectRecord)
    .map((artist) => (typeof artist?.name === "string" ? artist.name.trim() : ""))
    .filter(Boolean);
  const images = Array.isArray(album?.images) ? album.images : [];
  const imageUrl = images
    .map(objectRecord)
    .map((image) => safeImageUrl(image?.url))
    .find(Boolean) ?? null;
  const id = typeof track?.id === "string" ? track.id : "";
  const uri = typeof track?.uri === "string" ? track.uri : "";
  const name = typeof track?.name === "string" ? track.name.trim() : "";
  const albumName = typeof album?.name === "string" ? album.name.trim() : "";
  const durationMs = Number(track?.duration_ms);
  if (
    !/^[A-Za-z0-9]{10,64}$/.test(id) ||
    uri !== `spotify:track:${id}` ||
    !name ||
    !artistNames.length ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    return null;
  }
  return {
    id,
    uri,
    name: name.slice(0, 300),
    artist: artistNames.join(", ").slice(0, 300),
    album: albumName.slice(0, 300),
    imageUrl,
    durationMs: Math.round(durationMs),
  };
}

function spotifyLikedSongsCollection(value: unknown): SpotifyLibraryPlaylist {
  const page = objectRecord(value);
  const total = Number(page?.total);
  return {
    id: SPOTIFY_LIKED_SONGS_ID,
    uri: SPOTIFY_LIKED_SONGS_URI,
    kind: "liked-songs",
    name: "Liked Songs",
    description: "Songs saved to your Spotify library.",
    imageUrl: null,
    trackCount: Number.isFinite(total) ? Math.max(0, Math.round(total)) : 0,
    owner: "You",
    ownerId: "",
    collaborative: false,
    isPublic: null,
    canAddTracks: true,
    canRemoveTracks: true,
    canEditDetails: false,
    canDelete: false,
  };
}

function spotifySavedTracks(value: unknown): SpotifyTrack[] {
  const page = objectRecord(value);
  return (Array.isArray(page?.items) ? page.items : [])
    .map((value) => {
      const item = objectRecord(value);
      return spotifyTrack(item?.track ?? item?.item ?? value);
    })
    .filter((track): track is SpotifyTrack => Boolean(track));
}

function spotifyLibraryPlaylist(value: unknown): SpotifyLibraryPlaylist | null {
  const playlist = objectRecord(value);
  const owner = objectRecord(playlist?.owner);
  const itemCollection = objectRecord(playlist?.items) ?? objectRecord(playlist?.tracks);
  const images = Array.isArray(playlist?.images) ? playlist.images : [];
  const imageUrl = images
    .map(objectRecord)
    .map((image) => safeImageUrl(image?.url))
    .find(Boolean) ?? null;
  const id = typeof playlist?.id === "string" ? playlist.id : "";
  const uri = typeof playlist?.uri === "string" ? playlist.uri : "";
  const name = typeof playlist?.name === "string" ? playlist.name.trim() : "";
  const description =
    typeof playlist?.description === "string" ? playlist.description.trim() : "";
  const ownerName =
    typeof owner?.display_name === "string" && owner.display_name.trim()
      ? owner.display_name.trim()
      : "Spotify";
  const ownerId = typeof owner?.id === "string" ? owner.id : "";
  const trackCount = Number(itemCollection?.total);
  if (!/^[A-Za-z0-9]{10,64}$/.test(id) || uri !== `spotify:playlist:${id}` || !name) {
    return null;
  }
  return {
    id,
    uri,
    kind: "playlist",
    name: name.slice(0, 300),
    description: description.slice(0, 500),
    imageUrl,
    trackCount: Number.isFinite(trackCount) ? Math.max(0, Math.round(trackCount)) : 0,
    owner: ownerName.slice(0, 200),
    ownerId,
    collaborative: playlist?.collaborative === true,
    isPublic: typeof playlist?.public === "boolean" ? playlist.public : null,
    canAddTracks: false,
    canRemoveTracks: false,
    canEditDetails: false,
    canDelete: false,
  };
}

function spotifyPlaylistCapabilities(
  playlist: SpotifyLibraryPlaylist,
  currentUserId: string,
): SpotifyLibraryPlaylist {
  if (playlist.kind === "liked-songs") return playlist;
  const owned = Boolean(currentUserId) && playlist.ownerId === currentUserId;
  const editable = owned || playlist.collaborative;
  return {
    ...playlist,
    canAddTracks: editable,
    canRemoveTracks: editable,
    canEditDetails: owned,
    canDelete: owned,
  };
}

export async function spotifyCurrentPlaybackState(
  userId: number,
): Promise<SpotifyPlaybackState | null> {
  const playback = objectRecord(
    await spotifyApiRequest({
      userId,
      method: "GET",
      endpoint: "/v1/me/player",
    }),
  );
  const track = spotifyTrack(playback?.item);
  if (!playback || !track) return null;
  const device = objectRecord(playback.device);
  const progressMs = Number(playback.progress_ms);
  const providerDeviceId = typeof device?.id === "string" ? device.id : null;
  if (playback.is_playing === true) spotifyListeningHistory.record(userId, track);
  return {
    track,
    isPlaying: playback.is_playing === true,
    positionMs: Number.isFinite(progressMs)
      ? Math.max(0, Math.min(track.durationMs, Math.round(progressMs)))
      : 0,
    shuffle: playback.shuffle_state === true,
    deviceId: providerDeviceId,
    deviceName: typeof device?.name === "string" ? device.name.trim() || null : null,
  };
}

export async function spotifyPhonePlaybackDevice(
  userId: number,
): Promise<SpotifyConnectDevice | null> {
  const payload = await spotifyApiRequest({
    userId,
    method: "GET",
    endpoint: "/v1/me/player/devices",
  });
  return selectSpotifyPhoneDevice(payload);
}

export async function activateSpotifyPhonePlayback(input: {
  userId: number;
  device: SpotifyConnectDevice;
  play: boolean;
}): Promise<SpotifyConnectDevice> {
  if (input.device.isActive) return input.device;
  await spotifyApiRequest({
    userId: input.userId,
    method: "PUT",
    endpoint: "/v1/me/player",
    body: {
      device_ids: [input.device.id],
      play: input.play,
    },
  });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const current = await spotifyPhonePlaybackDevice(input.userId);
    if (current?.id === input.device.id && current.isActive) return current;
  }
  throw new ApiError(
    502,
    "spotify_phone_activation_failed",
    "Spotify could not make your phone the active playback device.",
  );
}

export async function searchSpotifyTracks(
  userId: number,
  query: string,
  limit = 10,
): Promise<SpotifyTrack[]> {
  const normalized = query.trim().slice(0, 200);
  if (!normalized) {
    throw new ApiError(400, "spotify_query_required", "A track or artist is required.");
  }
  const payload = objectRecord(
    await spotifyApiRequest({
      userId,
      method: "GET",
      endpoint: "/v1/search",
      query: {
        q: normalized,
        type: "track",
        limit: Math.min(SPOTIFY_SEARCH_RESULT_LIMIT, Math.max(1, limit)),
      },
    }),
  );
  const tracks = objectRecord(payload?.tracks);
  return (Array.isArray(tracks?.items) ? tracks.items : [])
    .map(spotifyTrack)
    .filter((track): track is SpotifyTrack => Boolean(track));
}

export async function spotifyRecommendedTracks(
  userId: number,
  seedTrackId: string,
  limit = 10,
): Promise<SpotifyTrack[]> {
  if (!/^[A-Za-z0-9]{10,64}$/.test(seedTrackId)) {
    throw new ApiError(400, "invalid_spotify_track", "The Spotify track is invalid.");
  }
  const payload = objectRecord(
    await spotifyApiRequest({
      userId,
      method: "GET",
      endpoint: "/v1/recommendations",
      query: {
        seed_tracks: seedTrackId,
        limit: Math.min(20, Math.max(1, limit)),
      },
    }),
  );
  return (Array.isArray(payload?.tracks) ? payload.tracks : [])
    .map(spotifyTrack)
    .filter((track): track is SpotifyTrack => Boolean(track))
    .filter((track) => track.id !== seedTrackId);
}

export async function spotifyUserPlaylists(
  userId: number,
  limit = 20,
): Promise<SpotifyLibraryPlaylist[]> {
  const likedSongsRequest = spotifyApiRequest({
    userId,
    method: "GET",
    endpoint: "/v1/me/tracks",
    query: { limit: 1 },
  });
  if (!spotifyConnectionStatus(userId).playlistAccess) {
    return [spotifyLikedSongsCollection(await likedSongsRequest)];
  }
  try {
    const [likedSongsPayload, playlistPayload, profilePayload] = await Promise.all([
      likedSongsRequest,
      spotifyApiRequest({
        userId,
        method: "GET",
        endpoint: "/v1/me/playlists",
        query: { limit: Math.min(50, Math.max(1, limit)) },
      }),
      spotifyApiRequest({
        userId,
        method: "GET",
        endpoint: "/v1/me",
      }),
    ]);
    const payload = objectRecord(playlistPayload);
    const profile = objectRecord(profilePayload);
    const currentUserId = typeof profile?.id === "string" ? profile.id : "";
    const likedSongs = spotifyLikedSongsCollection(likedSongsPayload);
    const playlists = (Array.isArray(payload?.items) ? payload.items : [])
      .map(spotifyLibraryPlaylist)
      .filter((playlist): playlist is SpotifyLibraryPlaylist => Boolean(playlist))
      .map((playlist) => spotifyPlaylistCapabilities(playlist, currentUserId))
      .filter(
        (playlist) => playlist.ownerId === currentUserId || playlist.collaborative,
      );
    return [likedSongs, ...playlists];
  } catch (error) {
    if (error instanceof ApiError && error.code === "provider_request_forbidden") {
      return [spotifyLikedSongsCollection(await likedSongsRequest)];
    }
    throw error;
  }
}

export async function spotifyPlaylistTracks(
  userId: number,
  playlistId: string,
  limit = 40,
): Promise<{ playlist: SpotifyLibraryPlaylist; tracks: SpotifyTrack[] }> {
  if (playlistId === SPOTIFY_LIKED_SONGS_ID) {
    const payload = await spotifyApiRequest({
      userId,
      method: "GET",
      endpoint: "/v1/me/tracks",
      query: { limit: Math.min(50, Math.max(1, limit)) },
    });
    return {
      playlist: spotifyLikedSongsCollection(payload),
      tracks: spotifySavedTracks(payload),
    };
  }
  if (!/^[A-Za-z0-9]{10,64}$/.test(playlistId)) {
    throw new ApiError(400, "invalid_spotify_playlist", "The Spotify playlist is invalid.");
  }
  const [playlistPayload, itemsPayload, profilePayload] = await Promise.all([
    spotifyApiRequest({
      userId,
      method: "GET",
      endpoint: `/v1/playlists/${playlistId}`,
    }),
    spotifyApiRequest({
      userId,
      method: "GET",
      endpoint: `/v1/playlists/${playlistId}/items`,
      query: { limit: Math.min(50, Math.max(1, limit)) },
    }),
    spotifyApiRequest({
      userId,
      method: "GET",
      endpoint: "/v1/me",
    }),
  ]);
  const parsedPlaylist = spotifyLibraryPlaylist(playlistPayload);
  if (!parsedPlaylist) {
    throw new ApiError(502, "spotify_playlist_invalid_response", "Spotify returned an invalid playlist.");
  }
  const profile = objectRecord(profilePayload);
  const currentUserId = typeof profile?.id === "string" ? profile.id : "";
  const playlist = spotifyPlaylistCapabilities(parsedPlaylist, currentUserId);
  const items = objectRecord(itemsPayload);
  const tracks = (Array.isArray(items?.items) ? items.items : [])
    .map((value) => {
      const item = objectRecord(value);
      return spotifyTrack(item?.item ?? item?.track ?? value);
    })
    .filter((track): track is SpotifyTrack => Boolean(track));
  return { playlist, tracks };
}

function spotifyTrackUri(value: string): string {
  const uri = value.trim();
  if (!/^spotify:track:[A-Za-z0-9]{10,64}$/.test(uri)) {
    throw new ApiError(400, "invalid_spotify_track", "The Spotify track is invalid.");
  }
  return uri;
}

function spotifyPlaylistId(value: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9]{10,64}$/.test(id)) {
    throw new ApiError(400, "invalid_spotify_playlist", "The Spotify playlist is invalid.");
  }
  return id;
}

async function spotifyManagedPlaylist(
  userId: number,
  playlistId: string,
): Promise<SpotifyLibraryPlaylist> {
  const id = spotifyPlaylistId(playlistId);
  const [playlistPayload, profilePayload] = await Promise.all([
    spotifyApiRequest({ userId, method: "GET", endpoint: `/v1/playlists/${id}` }),
    spotifyApiRequest({ userId, method: "GET", endpoint: "/v1/me" }),
  ]);
  const playlist = spotifyLibraryPlaylist(playlistPayload);
  const profile = objectRecord(profilePayload);
  const currentUserId = typeof profile?.id === "string" ? profile.id : "";
  if (!playlist) {
    throw new ApiError(502, "spotify_playlist_invalid_response", "Spotify returned an invalid playlist.");
  }
  return spotifyPlaylistCapabilities(playlist, currentUserId);
}

async function requireSpotifyPlaylistWriteScope(
  userId: number,
  playlist: Pick<SpotifyLibraryPlaylist, "isPublic"> = { isPublic: false },
): Promise<void> {
  const requiredScope = playlist.isPublic === true
    ? SPOTIFY_PUBLIC_PLAYLIST_WRITE_SCOPE
    : SPOTIFY_PLAYLIST_WRITE_SCOPE;
  const tokens = await connectedAppTokensFor(userId, SPOTIFY_CONNECTION_SLUG);
  if (!scopes(tokens.scope).has(requiredScope)) {
    throw new ApiError(
      409,
      "spotify_playlist_permission_required",
      "Reconnect Spotify from Settings → Connections to manage your playlists.",
    );
  }
}

export async function spotifySetTrackSaved(
  userId: number,
  trackUriValue: string,
  saved: boolean,
): Promise<void> {
  const trackUri = spotifyTrackUri(trackUriValue);
  await spotifyApiRequest({
    userId,
    method: saved ? "PUT" : "DELETE",
    endpoint: "/v1/me/library",
    query: { uris: trackUri },
  });
}

export async function spotifyAddTrackToPlaylist(input: {
  userId: number;
  playlistId: string;
  trackUri: string;
}): Promise<void> {
  const trackUri = spotifyTrackUri(input.trackUri);
  if (input.playlistId === SPOTIFY_LIKED_SONGS_ID) {
    await spotifySetTrackSaved(input.userId, trackUri, true);
    return;
  }
  const playlist = await spotifyManagedPlaylist(input.userId, input.playlistId);
  if (!playlist.canAddTracks) {
    throw new ApiError(403, "spotify_playlist_not_editable", "You cannot add songs to that playlist.");
  }
  await requireSpotifyPlaylistWriteScope(input.userId, playlist);
  await spotifyApiRequest({
    userId: input.userId,
    method: "POST",
    endpoint: `/v1/playlists/${playlist.id}/items`,
    body: { uris: [trackUri] },
  });
}

export async function spotifyRemoveTrackFromPlaylist(input: {
  userId: number;
  playlistId: string;
  trackUri: string;
}): Promise<void> {
  const trackUri = spotifyTrackUri(input.trackUri);
  if (input.playlistId === SPOTIFY_LIKED_SONGS_ID) {
    await spotifySetTrackSaved(input.userId, trackUri, false);
    return;
  }
  const playlist = await spotifyManagedPlaylist(input.userId, input.playlistId);
  if (!playlist.canRemoveTracks) {
    throw new ApiError(403, "spotify_playlist_not_editable", "You cannot remove songs from that playlist.");
  }
  await requireSpotifyPlaylistWriteScope(input.userId, playlist);
  await spotifyApiRequest({
    userId: input.userId,
    method: "DELETE",
    endpoint: `/v1/playlists/${playlist.id}/items`,
    body: { items: [{ uri: trackUri }] },
  });
}

export async function spotifyCreateManagedPlaylist(input: {
  userId: number;
  name: string;
  trackUri?: string;
}): Promise<SpotifyLibraryPlaylist> {
  const name = input.name.trim().replace(/\s+/gu, " ").slice(0, 100);
  if (!name) {
    throw new ApiError(400, "spotify_playlist_name_required", "A playlist name is required.");
  }
  const trackUri = input.trackUri ? spotifyTrackUri(input.trackUri) : null;
  await requireSpotifyPlaylistWriteScope(input.userId);
  const createdPayload = await spotifyApiRequest({
    userId: input.userId,
    method: "POST",
    endpoint: "/v1/me/playlists",
    body: {
      name,
      public: false,
      collaborative: false,
      description: "Created in Breadboard",
    },
  });
  const parsed = spotifyLibraryPlaylist(createdPayload);
  if (!parsed) {
    throw new ApiError(502, "spotify_playlist_invalid_response", "Spotify returned an invalid playlist.");
  }
  if (trackUri) {
    await spotifyApiRequest({
      userId: input.userId,
      method: "POST",
      endpoint: `/v1/playlists/${parsed.id}/items`,
      body: { uris: [trackUri] },
    });
  }
  return {
    ...spotifyPlaylistCapabilities(parsed, parsed.ownerId),
    trackCount: trackUri ? 1 : 0,
  };
}

export async function spotifyRenamePlaylist(input: {
  userId: number;
  playlistId: string;
  name: string;
}): Promise<void> {
  const name = input.name.trim().replace(/\s+/gu, " ").slice(0, 100);
  if (!name) {
    throw new ApiError(400, "spotify_playlist_name_required", "A playlist name is required.");
  }
  const playlist = await spotifyManagedPlaylist(input.userId, input.playlistId);
  if (!playlist.canEditDetails) {
    throw new ApiError(403, "spotify_playlist_not_editable", "Only the playlist owner can rename it.");
  }
  await requireSpotifyPlaylistWriteScope(input.userId, playlist);
  await spotifyApiRequest({
    userId: input.userId,
    method: "PUT",
    endpoint: `/v1/playlists/${playlist.id}`,
    body: { name },
  });
}

export async function spotifyDeletePlaylist(
  userId: number,
  playlistId: string,
): Promise<void> {
  const playlist = await spotifyManagedPlaylist(userId, playlistId);
  if (!playlist.canDelete) {
    throw new ApiError(403, "spotify_playlist_not_owned", "Only the playlist owner can delete it.");
  }
  await spotifyApiRequest({
    userId,
    method: "DELETE",
    endpoint: "/v1/me/library",
    query: { uris: playlist.uri },
  });
}

export async function createSpotifyPlaylist(input: {
  userId: number;
  name: string;
  description?: string;
  tracks: SpotifyTrack[];
}): Promise<SpotifyPlaylist> {
  const name = input.name.trim().slice(0, 100);
  const description = (input.description ?? "").trim().slice(0, 300);
  const tracks = [...new Map(input.tracks.map((track) => [track.uri, track])).values()]
    .slice(0, 100);
  if (!name) {
    throw new ApiError(400, "spotify_playlist_name_required", "A playlist name is required.");
  }
  if (!tracks.length) {
    throw new ApiError(
      404,
      "spotify_playlist_tracks_required",
      "Spotify did not find tracks for this playlist.",
    );
  }

  const tokens = await connectedAppTokensFor(input.userId, SPOTIFY_CONNECTION_SLUG);
  if (!scopes(tokens.scope).has(SPOTIFY_PLAYLIST_WRITE_SCOPE)) {
    throw new ApiError(
      409,
      "spotify_playlist_permission_required",
      "Reconnect Spotify from Settings → Connections once to allow Breadboard to create private playlists.",
    );
  }

  const created = objectRecord(
    await spotifyApiRequest({
      userId: input.userId,
      method: "POST",
      endpoint: "/v1/me/playlists",
      body: {
        name,
        public: false,
        collaborative: false,
        description,
      },
    }),
  );
  const id = typeof created?.id === "string" ? created.id : "";
  const uri = typeof created?.uri === "string" ? created.uri : "";
  if (!/^[A-Za-z0-9]{10,64}$/.test(id) || uri !== `spotify:playlist:${id}`) {
    throw new ApiError(
      502,
      "spotify_playlist_invalid_response",
      "Spotify returned an invalid playlist.",
    );
  }

  await spotifyApiRequest({
    userId: input.userId,
    method: "POST",
    endpoint: `/v1/playlists/${id}/items`,
    body: { uris: tracks.map((track) => track.uri) },
  });

  return {
    id,
    uri,
    name:
      typeof created?.name === "string" && created.name.trim()
        ? created.name.trim().slice(0, 100)
        : name,
    description,
    trackCount: tracks.length,
    isPublic: false,
  };
}

export function recordSpotifyPlaybackIntent(input: {
  userId: number;
  conversationId: number;
  tracks: SpotifyTrack[];
  target?: "inline" | "phone";
}): SpotifyPlaybackIntent {
  const [track, ...rest] = input.tracks;
  if (!track) {
    throw new ApiError(404, "spotify_track_not_found", "Spotify did not find a matching track.");
  }
  const intent: SpotifyPlaybackIntent = {
    target: input.target ?? "inline",
    revision: crypto.randomUUID(),
    track,
    queueUris: [track, ...rest].map((item) => item.uri).slice(0, 50),
    requestedAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO spotify_playback_intents
       (conversation_id, user_id, revision, track_json, queue_json, requested_at, target)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET
       user_id = excluded.user_id,
       revision = excluded.revision,
       track_json = excluded.track_json,
       queue_json = excluded.queue_json,
       requested_at = excluded.requested_at,
       target = excluded.target,
       updated_at = datetime('now')`,
  ).run(
    input.conversationId,
    input.userId,
    intent.revision,
    JSON.stringify(intent.track),
    JSON.stringify(intent.queueUris),
    intent.requestedAt,
    intent.target,
  );
  return intent;
}

export function getSpotifyPlaybackIntent(
  userId: number,
  conversationId: number,
): SpotifyPlaybackIntent | null {
  const row = db
    .prepare(
      `SELECT revision, track_json, queue_json, requested_at, target
       FROM spotify_playback_intents
       WHERE user_id = ? AND conversation_id = ?`,
    )
    .get(userId, conversationId) as PlaybackIntentRow | undefined;
  if (!row) return null;
  try {
    const track = JSON.parse(row.track_json) as SpotifyTrack;
    const queueUris = JSON.parse(row.queue_json) as string[];
    return {
      revision: row.revision,
      track,
      queueUris: Array.isArray(queueUris) ? queueUris : [track.uri],
      requestedAt: row.requested_at,
      target: row.target,
    };
  } catch {
    return null;
  }
}
