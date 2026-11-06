import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { starredPdfGardenId } from "../src/lib/starred-pdf-garden.ts";

test("PDF stars resolve Garden documents, generated PDFs and uploaded PDFs with ownership checks", t => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE conversations(id INTEGER, public_id TEXT, user_id INTEGER, default_garden_id INTEGER);
    CREATE TABLE conversation_messages(id INTEGER, conversation_id INTEGER, role TEXT, metadata TEXT);
    CREATE TABLE hermes_artifacts(id TEXT, conversation_id INTEGER, user_id INTEGER, cluster_id INTEGER, kind TEXT);
    INSERT INTO conversations VALUES (1, 'conv_own', 7, 10), (2, 'conv_private', 8, 20), (3, 'conv_reuse', 7, 30);
    INSERT INTO hermes_artifacts VALUES ('art_pdf', 1, 7, 11, 'pdf'), ('art_inherit', 1, 7, NULL, 'pdf'),
      ('art_private', 2, 8, 20, 'pdf'), ('art_other', 1, 7, 11, 'image');`);
  const insert = db.prepare("INSERT INTO conversation_messages VALUES (?, ?, 'user', ?)");
  const metadata = blobId => JSON.stringify({ attachments: [{ type: "document", format: "pdf", blobId }] });
  insert.run(1, 1, metadata("own-upload"));
  insert.run(2, 2, metadata("private-upload"));
  insert.run(3, 3, metadata("own-upload"));
  insert.run(4, 1, "invalid old metadata");
  const request = new Request("http://localhost:3000/api/starred-messages", { headers: { host: "127.0.0.1:3000" } });
  const gardens = [];
  const resolve = source => starredPdfGardenId(db, 7, request, source, slug => {
    gardens.push(slug);
    if (slug !== "my-garden") throw Error("Garden not found");
    return 10;
  });
  assert.equal(resolve("/api/documents/lesson/source-pdf?clusterSlug=my-garden"), 10);
  assert.equal(resolve("http://127.0.0.1:3000/gardens/my-garden/pdf/lesson"), 10);
  assert.throws(() => resolve("/api/documents/lesson/source-pdf?clusterSlug=private"), /Garden not found/);
  assert.equal(resolve("/api/hermes/artifacts/art_pdf/preview?conversationId=conv_own"), 11);
  assert.equal(resolve("/api/hermes/artifacts/art_inherit/preview?conversationId=conv_own"), 10);
  for (const source of [
    "/api/hermes/artifacts/art_pdf/preview?conversationId=conv_private",
    "/api/hermes/artifacts/art_private/preview?conversationId=conv_private",
    "/api/hermes/artifacts/art_other/preview?conversationId=conv_own",
    "/api/chat-attachments/documents/private-upload",
    "/api/chat-attachments/documents/missing",
    "https://external.test/api/documents/lesson/source-pdf?clusterSlug=my-garden",
    "/api/documents/lesson/source-pdf?clusterSlug=..%2Fprivate",
    "/other.pdf",
  ]) assert.equal(resolve(source), null, source);
  assert.equal(resolve("/api/chat-attachments/documents/own-upload"), 10);
  assert.deepEqual(gardens, ["my-garden", "my-garden", "private"]);
});
