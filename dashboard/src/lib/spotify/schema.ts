import type Database from "better-sqlite3";

/** Conversation-scoped tracks selected by the Spotify agent for inline play. */
export function ensureSpotifySchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS spotify_playback_intents (
      conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      revision        TEXT NOT NULL,
      track_json      TEXT NOT NULL,
      queue_json      TEXT NOT NULL,
      requested_at    TEXT NOT NULL,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_spotify_playback_intents_user
      ON spotify_playback_intents(user_id, updated_at DESC);
  `);
}
