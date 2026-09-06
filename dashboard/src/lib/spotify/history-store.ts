import type Database from "better-sqlite3";
import type { SpotifyTrack } from "./service.ts";
import { spotifyHistoryTracks } from "./history.ts";

export function createSpotifyHistoryStore(database: Database.Database) {
  function read(userId: number): SpotifyTrack[] {
    const row = database.prepare(
      "SELECT tracks_json FROM spotify_listening_history WHERE user_id = ?",
    ).get(userId) as { tracks_json: string } | undefined;
    try {
      return spotifyHistoryTracks(JSON.parse(row?.tracks_json ?? "[]"));
    } catch {
      return [];
    }
  }

  function write(userId: number, tracks: SpotifyTrack[]) {
    database.prepare(`
      INSERT INTO spotify_listening_history (user_id, tracks_json) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET tracks_json = excluded.tracks_json
    `).run(userId, JSON.stringify(tracks));
  }

  return {
    read,
    record(userId: number, track: SpotifyTrack) {
      const [valid] = spotifyHistoryTracks([track]);
      if (!valid) return;
      database.transaction(() => {
        const current = read(userId);
        // Playback polling must not repeatedly write or reorder the same song.
        if (current[0]?.uri === valid.uri) return;
        write(userId, spotifyHistoryTracks([valid, ...current]));
      }).immediate();
    },
    importLegacy(userId: number, tracks: unknown): SpotifyTrack[] {
      return database.transaction(() => {
        const current = read(userId);
        // Timestamp-free browser entries are older than confirmed server plays.
        const next = spotifyHistoryTracks([...current, ...spotifyHistoryTracks(tracks)]);
        if (JSON.stringify(next) !== JSON.stringify(current)) write(userId, next);
        return next;
      }).immediate();
    },
  };
}
