import type Database from "better-sqlite3";

/** Spotify playback intents and persistent, user-scoped listening history. */
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

    CREATE TABLE IF NOT EXISTS spotify_listening_history (
      user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      tracks_json TEXT NOT NULL
    );
  `);
  const columns = database.prepare("PRAGMA table_info(spotify_playback_intents)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "target")) {
    // Existing intents were phone remotes. New requests explicitly write their
    // target so opening an old conversation cannot move its playback.
    database.exec("ALTER TABLE spotify_playback_intents ADD COLUMN target TEXT NOT NULL DEFAULT 'phone'");
  }
}
