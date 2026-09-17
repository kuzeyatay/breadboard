import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { artifactsForTranscript } from "../src/lib/hermes/artifact-transcript.ts";

function fixture() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE hermes_artifacts (id TEXT PRIMARY KEY, conversation_id INTEGER);
    CREATE TABLE conversation_messages (id INTEGER PRIMARY KEY, conversation_id INTEGER, role TEXT);
    CREATE TABLE hermes_artifact_versions (artifact_id TEXT, version INTEGER, status TEXT,
      source_location TEXT, preview_location TEXT, output_location TEXT, mime_type TEXT,
      byte_size INTEGER, content_hash TEXT, metadata_json TEXT, error_json TEXT,
      created_at TEXT, updated_at TEXT);
    CREATE TABLE hermes_artifact_events (id INTEGER PRIMARY KEY, artifact_id TEXT,
      conversation_id INTEGER, assistant_message_id INTEGER, run_id TEXT,
      event_type TEXT, status TEXT, version INTEGER, created_at TEXT);
    INSERT INTO hermes_artifacts VALUES ('art_circuit', 337), ('art_other', 338);
    INSERT INTO conversation_messages VALUES
      (92, 337, 'assistant'), (94, 337, 'assistant'), (96, 337, 'assistant'),
      (93, 337, 'user'), (100, 338, 'assistant');
  `);
  const artifact = {
    id: "art_circuit", conversation_id: 337, conversation_public_id: "conv_circuit",
    renderer_id: "interactive-visualizer", status: "ready", current_version: 2,
    originating_message_id: 92, originating_run_id: "run_92", title: "Original circuit",
    preview_location: "v2/preview.html", output_location: "v2/preview.html",
    metadata_json: '{"latest":true}', highlight: "sage",
  };
  for (const version of [1, 2, 3]) {
    database.prepare("INSERT INTO hermes_artifact_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)")
      .run(artifact.id, version, version === 3 ? "failed" : "ready", `v${version}/source.json`,
        `v${version}/preview.html`, `v${version}/preview.html`, "text/html", version * 100,
        `hash_${version}`, JSON.stringify({ inlineInChat: true,
          interactiveVisualizer: { manifest: { title: `Circuit ${version}` } } }),
        `created_${version}`, `updated_${version}`);
  }
  const publish = (message, version, { type = "artifact.completed", status = "ready", conversation = 337 } = {}) => {
    database.prepare("INSERT INTO hermes_artifact_events (artifact_id, conversation_id, assistant_message_id, run_id, event_type, status, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(artifact.id, conversation, message, `run_${message}`, type, status, version, `published_${message}_${version}`);
  };
  publish(92, 1);
  publish(94, 2);
  return { database, artifact, publish };
}

test("successive visualizer replies keep their own published content after refresh", () => {
  const { database, artifact } = fixture();
  try {
    const before = structuredClone(artifact);
    const snapshots = artifactsForTranscript([artifact], database);
    assert.deepEqual(snapshots.map(a => [a.originating_message_id, a.current_version]), [[94, 2], [92, 1]]);
    for (const snapshot of snapshots) {
      const version = snapshot.current_version;
      assert.equal(snapshot.preview_location, `v${version}/preview.html`);
      assert.equal(snapshot.output_location, `v${version}/preview.html`);
      assert.equal(snapshot.content_hash, `hash_${version}`);
      assert.equal(snapshot.byte_size, version * 100);
      assert.equal(snapshot.title, `Circuit ${version}`);
      assert.equal(snapshot.originating_run_id, `run_${snapshot.originating_message_id}`);
      assert.equal(snapshot.presentation_message_id, snapshot.originating_message_id);
      assert.equal(snapshot.highlight, "sage");
      assert.equal(JSON.parse(snapshot.metadata_json).interactiveVisualizer.manifest.title, snapshot.title);
    }
    assert.deepEqual(artifact, before, "the latest artifact/archive row is never mutated");
    assert.deepEqual(artifactsForTranscript([artifact], database), snapshots, "reload reconstructs the same replies");
  } finally { database.close(); }
});

test("failed revisions, duplicate events and another reply's rollback do not replace earlier visuals", () => {
  const { database, artifact, publish } = fixture();
  try {
    publish(94, 2);
    publish(94, 3, { type: "artifact.failed" }); // failed revision can preserve ready artifact status
    publish(94, 3); // even a bad completion cannot expose a failed version
    publish(96, 1); // rolling back is another reply's successful output
    assert.deepEqual(artifactsForTranscript([artifact], database)
      .map(a => [a.originating_message_id, a.current_version]), [[96, 1], [94, 2], [92, 1]]);
    publish(94, 1);
    assert.deepEqual(artifactsForTranscript([artifact], database)
      .map(a => [a.originating_message_id, a.current_version]), [[94, 1], [96, 1], [92, 1]],
      "the last successful publication within one reply wins, including rollback");
  } finally { database.close(); }
});

test("transcript projections reject cross-conversation and non-assistant associations", () => {
  const { database, artifact, publish } = fixture();
  try {
    publish(100, 2);
    publish(93, 2);
    publish(92, 2, { conversation: 338 });
    assert.deepEqual(artifactsForTranscript([artifact], database)
      .map(a => [a.originating_message_id, a.current_version]), [[94, 2], [92, 1]]);
    assert.deepEqual(artifactsForTranscript([], database), []);
  } finally { database.close(); }
});

test("ordinary artifacts, archived visuals and legacy visuals without publication history retain their behavior", () => {
  const { database, artifact } = fixture();
  try {
    for (const input of [{ ...artifact, renderer_id: "pdf" }, { ...artifact, status: "archived" }]) {
      assert.deepEqual(artifactsForTranscript([input], database), [input]);
    }
    database.exec("DELETE FROM hermes_artifact_events");
    assert.deepEqual(artifactsForTranscript([artifact], database), [artifact]);
  } finally { database.close(); }
});

test("a revision in progress or a failed revision preserves all previously published replies", () => {
  const { database, artifact } = fixture();
  try {
    for (const status of ["generating", "failed"]) {
      const snapshots = artifactsForTranscript([{ ...artifact, status }], database);
      assert.deepEqual(snapshots.map(a => [a.originating_message_id, a.current_version, a.status]),
        [[94, 2, "ready"], [92, 1, "ready"]]);
    }
  } finally { database.close(); }
});
