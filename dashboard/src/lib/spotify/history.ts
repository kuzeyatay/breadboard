import type { SpotifyTrack } from "./service.ts";

export const SPOTIFY_HISTORY_LIMIT = 20;

/** Keep the saved history bounded and accept only complete, replayable tracks. */
export function spotifyHistoryTracks(value: unknown): SpotifyTrack[] {
  if (!Array.isArray(value)) return [];
  const tracks: SpotifyTrack[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const track = item as Record<string, unknown>;
    if (
      typeof track.id !== "string" || !/^[A-Za-z0-9]{10,64}$/.test(track.id) ||
      track.uri !== `spotify:track:${track.id}` || seen.has(track.id) ||
      typeof track.name !== "string" || !track.name.trim() ||
      typeof track.artist !== "string" || !track.artist.trim() ||
      typeof track.album !== "string" ||
      (track.imageUrl !== null && typeof track.imageUrl !== "string") ||
      typeof track.durationMs !== "number" || !Number.isFinite(track.durationMs) || track.durationMs <= 0
    ) continue;
    seen.add(track.id);
    tracks.push({
      id: track.id,
      uri: track.uri as string,
      name: track.name.trim().slice(0, 300),
      artist: track.artist.trim().slice(0, 300),
      album: track.album.slice(0, 300),
      imageUrl: typeof track.imageUrl === "string" && /^https:\/\//i.test(track.imageUrl)
        ? track.imageUrl.slice(0, 2_048) : null,
      durationMs: track.durationMs,
    });
    if (tracks.length === SPOTIFY_HISTORY_LIMIT) break;
  }
  return tracks;
}
