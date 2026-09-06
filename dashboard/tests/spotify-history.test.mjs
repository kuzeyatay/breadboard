import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { ensureSpotifySchema } from "../src/lib/spotify/schema.ts";
import { createSpotifyHistoryStore } from "../src/lib/spotify/history-store.ts";

const track = (number) => ({
  id: String(number).padStart(22, "0"),
  uri: `spotify:track:${String(number).padStart(22, "0")}`,
  name: `Song ${number}`, artist: "Artist", album: "Album", imageUrl: null, durationMs: 180_000,
});

function open(filename = ":memory:") {
  const database = new Database(filename);
  database.pragma("foreign_keys = ON");
  database.exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS conversations (id INTEGER PRIMARY KEY); INSERT OR IGNORE INTO users VALUES (7), (8);");
  ensureSpotifySchema(database);
  return database;
}

test("the latest 20 distinct songs survive closing and reopening the database", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spotify-history-"));
  const filename = path.join(directory, "history.db");
  let database = open(filename);
  try {
    const history = createSpotifyHistoryStore(database);
    for (let number = 1; number <= 25; number++) history.record(7, track(number));
    history.record(8, track(99));
    assert.equal(JSON.parse(database.prepare("SELECT tracks_json FROM spotify_listening_history WHERE user_id=7").get().tracks_json).length, 20);
    database.close();
    database = open(filename);
    const restored = createSpotifyHistoryStore(database);
    assert.deepEqual(restored.read(7), Array.from({length: 20}, (_, index) => track(25 - index)));
    assert.deepEqual(restored.read(8), [track(99)]);
    database.prepare("DELETE FROM users WHERE id=7").run();
    assert.deepEqual(restored.read(7), []);
    assert.deepEqual(restored.read(8), [track(99)]);
  } finally {
    database.close();
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test("polling does not write duplicates; replaying an older song moves it first", () => {
  const database = open();
  try {
    const firstTab = createSpotifyHistoryStore(database);
    const secondTab = createSpotifyHistoryStore(database);
    firstTab.record(7, track(1));
    secondTab.record(7, track(2));
    const changes = database.prepare("SELECT total_changes() AS count").get().count;
    for (let poll = 0; poll < 5; poll++) firstTab.record(7, track(2));
    assert.equal(database.prepare("SELECT total_changes() AS count").get().count, changes);
    secondTab.record(7, track(1));
    assert.deepEqual(firstTab.read(7), [track(1), track(2)]);
  } finally { database.close(); }
});

test("legacy migration merges safely behind new listens and is idempotent", () => {
  const database = open();
  try {
    const history = createSpotifyHistoryStore(database);
    history.record(7, track(30));
    const legacy = [track(5), null, {...track(6), uri: "invalid"}, track(4), track(5), track(30)];
    assert.deepEqual(history.importLegacy(7, legacy), [track(30), track(5), track(4)]);
    assert.deepEqual(history.importLegacy(7, legacy), [track(30), track(5), track(4)]);
    assert.deepEqual(history.read(8), []);
    assert.equal(history.importLegacy(7, Array.from({length: 30}, (_, i) => track(i + 1))).length, 20);
  } finally { database.close(); }
});

test("malformed stored data cannot break playback or restoration", () => {
  const database = open();
  try {
    database.prepare("INSERT INTO spotify_listening_history VALUES (?, ?)").run(7, "broken JSON");
    const history = createSpotifyHistoryStore(database);
    assert.deepEqual(history.read(7), []);
    history.record(7, track(1));
    assert.deepEqual(history.read(7), [track(1)]);
  } finally { database.close(); }
});
