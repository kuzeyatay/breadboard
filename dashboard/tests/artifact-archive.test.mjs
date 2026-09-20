import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { artifactsForArchive } from "../src/lib/hermes/artifact-archive.ts";

test("the archive includes every successful kind and revision, even after a failed update", () => {
  const database = new Database(":memory:");
  try {
    database.exec(`CREATE TABLE hermes_artifact_versions (artifact_id TEXT, version INTEGER, status TEXT, updated_at TEXT,
      metadata_json TEXT, preview_location TEXT, output_location TEXT, mime_type TEXT, byte_size INTEGER, content_hash TEXT)`);
    const rows = ["html", "code", "document", "pdf", "image", "audio", "video", "data", "folder", "gadget", "model"].map((kind, index) => ({
      id: `art_${index}`, kind, renderer_id: kind, current_version: 2, title: kind, status: "failed", updated_at: "2026-09-19",
    }));
    const insert = database.prepare("INSERT INTO hermes_artifact_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const row of rows) {
      insert.run(row.id, 1, "ready", "2026-09-17", "{}", "v1/preview", "v1/output", "text/plain", 10, "hash-1");
      insert.run(row.id, 2, "failed", "2026-09-19", "{}", null, null, "text/plain", null, null);
    }
    insert.run(rows[0].id, 3, "ready", "2026-09-18", '{"interactiveVisualizer":{"manifest":{"title":"Updated model"}}}', "v3/preview", "v3/output", "text/html", 20, "hash-3");
    const results = artifactsForArchive(rows, database);
    assert.equal(results.length, rows.length + 1);
    assert.ok(results.every(item => item.status === "ready" && item.current_version !== 2));
    assert.equal(results[0].title, "Updated model");
    assert.equal(results[0].current_version, 3);
    assert.equal(results[0].preview_location, "v3/preview");
    assert.deepEqual(new Set(results.map(item => item.kind)), new Set(rows.map(item => item.kind)));
    assert.equal(rows[0].status, "failed", "archive reads never change the active render state");
    assert.deepEqual(artifactsForArchive([], database), []);
  } finally { database.close(); }
});
