// Artwork attached to a Socials Manager post: the stored column, the flag that asks a
// run to draw one, the upload into Postiz's media library, and the wiring that
// makes the image studio reachable from a post card.
//
// The store assertions run against a real in-memory database; the wiring ones
// are source-level for the same reason as socials-manager-integration.test.mjs — the
// path crosses the card, the shared studio host and the route.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { SocialsManagerStore } from "../src/lib/socials-manager/store.ts";
import { CalendarStore } from "../src/lib/calendar/store.ts";
import { parseSocialsManagerRequest } from "../src/lib/socials-manager/identity.ts";
import { PostizApiClient } from "../src/lib/socials-manager/api-client.ts";
import { listAttachablePostImages } from "../src/lib/socials-manager/post-images.ts";
import { ensureArtifactSchema } from "../src/lib/hermes/artifact-schema.ts";
import {
  createArtifact,
  createImportedArtifact,
} from "../src/lib/hermes/artifact-store.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

function createStore() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);
    INSERT INTO users (id, email) VALUES (1, 'a@example.com');
  `);
  new CalendarStore(db);
  return { store: new SocialsManagerStore(db), db };
}

// --------------------------------------------------------------------- store

test("a post carries an image artifact id that survives a round trip", () => {
  const { store } = createStore();
  const post = store.createPost(1, { providerId: "x", content: "hello" });
  assert.equal(post.imageArtifactId, null);

  const attached = store.updatePost(1, post.id, { imageArtifactId: "art_1" });
  assert.equal(attached.imageArtifactId, "art_1");
  assert.equal(store.getPost(1, post.id).imageArtifactId, "art_1");

  const detached = store.updatePost(1, post.id, { imageArtifactId: null });
  assert.equal(detached.imageArtifactId, null);
});

test("an unrelated patch leaves the attached image alone", () => {
  const { store } = createStore();
  const post = store.createPost(1, { providerId: "x", content: "hello" });
  store.updatePost(1, post.id, { imageArtifactId: "art_1" });

  const edited = store.updatePost(1, post.id, { content: "hello again" });
  assert.equal(edited.content, "hello again");
  assert.equal(edited.imageArtifactId, "art_1");
});

test("the image column is added to databases that predate it", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);
    INSERT INTO users (id, email) VALUES (1, 'a@example.com');
  `);
  new CalendarStore(db);
  // The pre-image shape: no image_artifact_id, no remote_id.
  db.exec(`
    CREATE TABLE socials_manager_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      run_id TEXT, provider_id TEXT NOT NULL,
      channel_id INTEGER, content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','scheduled','published','failed','cancelled')),
      scheduled_at TEXT, published_at TEXT, calendar_event_id INTEGER,
      artifact_id TEXT, error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const store = new SocialsManagerStore(db);
  const columns = db.prepare("PRAGMA table_info(socials_manager_posts)").all().map((c) => c.name);
  assert.ok(columns.includes("image_artifact_id"));
  assert.ok(columns.includes("remote_id"));

  const post = store.createPost(1, { providerId: "x", content: "hi" });
  assert.equal(store.updatePost(1, post.id, { imageArtifactId: "art_9" }).imageArtifactId, "art_9");
});

// -------------------------------------------------------------------- picker

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=",
  "base64",
);

function archiveFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-post-images-"));
  const database = new Database(path.join(root, "artifacts.sqlite"));
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY, slug TEXT NOT NULL, user_id INTEGER);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT UNIQUE, user_id INTEGER, surface TEXT, default_garden_id INTEGER);
    CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY);
    CREATE TABLE hermes_runs(id TEXT PRIMARY KEY, runtime_session_id INTEGER);
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY);
    INSERT INTO users VALUES (1), (2);
    INSERT INTO clusters VALUES (7, 'physics', 1);
    INSERT INTO conversations VALUES (10, 'conv_garden', 1, 'garden_chat', 7);
    INSERT INTO conversations VALUES (12, 'conv_terminal', 1, 'dashboard_terminal', NULL);
    INSERT INTO conversations VALUES (16, 'conv_other_user', 2, 'dashboard_terminal', NULL);
    INSERT INTO hermes_runtime_sessions VALUES (20);
    INSERT INTO hermes_runs VALUES ('run_one', 20);
  `);
  ensureArtifactSchema(database);
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  return { root, database, storage: path.join(root, "storage"), workspace };
}

async function importImage(fixture, { title, file, conversationId = 10, userId = 1 }) {
  fs.writeFileSync(path.join(fixture.workspace, file), ONE_PIXEL_PNG);
  return createImportedArtifact({
    userId,
    runtimeSessionId: 20,
    hermesSessionId: "oh_session",
    conversationId,
    clusterId: conversationId === 10 ? 7 : null,
    runId: "run_one",
    assistantMessageId: null,
    surface: conversationId === 10 ? "garden_chat" : "dashboard_terminal",
    kind: "image",
    title,
    filename: file,
    authorizedRoot: fixture.workspace,
    filePath: file,
    scrubProvenance: false,
    database: fixture.database,
    storageRoot: fixture.storage,
  });
}

test("the picker offers the user's own pictures, newest first", async () => {
  const fixture = archiveFixture();
  try {
    const older = await importImage(fixture, { title: "Older art", file: "older.png" });
    const newer = await importImage(fixture, {
      title: "Newer art",
      file: "newer.png",
      conversationId: 12,
    });
    // Two imports inside the same second would tie on the ordering column.
    fixture.database
      .prepare("UPDATE hermes_artifacts SET updated_at = ? WHERE id = ?")
      .run("2026-08-01T00:00:00.000Z", older.id);
    fixture.database
      .prepare("UPDATE hermes_artifacts SET updated_at = ? WHERE id = ?")
      .run("2026-08-04T00:00:00.000Z", newer.id);

    const offered = listAttachablePostImages(1, {
      database: fixture.database,
      storageRoot: fixture.storage,
    });

    assert.deepEqual(
      offered.map((image) => image.title),
      ["Newer art", "Older art"],
    );
    // Each entry can be shown without a second lookup, and names where it came from.
    assert.match(
      offered[1].previewUrl,
      new RegExp(`^/api/hermes/artifacts/${older.id}/preview\\?conversationId=conv_garden&version=1$`),
    );
    assert.equal(offered[1].gardenSlug, "physics");
    assert.equal(offered[0].gardenSlug, null);
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("the picker leaves out what a post could never carry", async () => {
  const fixture = archiveFixture();
  try {
    const mine = await importImage(fixture, { title: "Mine", file: "mine.png" });
    const theirs = await importImage(fixture, {
      title: "Theirs",
      file: "theirs.png",
      conversationId: 16,
      userId: 2,
    });
    const vanished = await importImage(fixture, { title: "Vanished", file: "gone.png" });
    createArtifact({
      userId: 1,
      runtimeSessionId: 20,
      hermesSessionId: "oh_session",
      conversationId: 10,
      clusterId: 7,
      runId: "run_one",
      assistantMessageId: null,
      surface: "garden_chat",
      kind: "markdown",
      rendererId: "markdown",
      title: "A document, not a picture",
      filename: "notes.md",
      content: "# Notes",
      database: fixture.database,
      storageRoot: fixture.storage,
    });
    // An artifact whose file was cleared away is a broken option, not an option.
    fs.rmSync(path.join(fixture.storage, "1", vanished.id), {
      recursive: true,
      force: true,
    });

    const titles = listAttachablePostImages(1, {
      database: fixture.database,
      storageRoot: fixture.storage,
    }).map((image) => image.title);

    assert.deepEqual(titles, ["Mine"]);
    assert.equal(
      listAttachablePostImages(2, {
        database: fixture.database,
        storageRoot: fixture.storage,
      })[0].id,
      theirs.id,
    );
    assert.ok(mine.id);
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("the picker route is the user's whole archive, not one conversation's", () => {
  const route = source("src/app/api/socials-manager/images/route.ts");
  const store = source("src/lib/hermes/artifact-store.ts");

  assert.match(route, /requireUserId\(\)/);
  assert.match(route, /listAttachablePostImages\(userId\)/);
  // The conversation-scoped listing would hide most of the user's own images.
  assert.doesNotMatch(route, /conversationId|gardenSlug/);
  assert.match(store, /export function listImageArtifactsForUser/);
  assert.match(store, /AND a\.kind IN \('image','diagram'\)\s+AND a\.status = 'ready'/);
});

// ---------------------------------------------------------------------- flag

test("--image asks a run to draw artwork, and stays out of the brief", () => {
  const withFlag = parseSocialsManagerRequest("announce the launch --image");
  assert.equal(withFlag.withImages, true);
  assert.equal(withFlag.brief, "announce the launch");

  assert.equal(parseSocialsManagerRequest("announce it --images").withImages, true);
  assert.equal(parseSocialsManagerRequest("announce it -i").withImages, true);
  assert.equal(parseSocialsManagerRequest("announce it").withImages, false);
});

test("the flag does not eat words that merely start with it", () => {
  const request = parseSocialsManagerRequest("post about our -important imagery");
  assert.equal(request.withImages, false);
  assert.equal(request.brief, "post about our -important imagery");
});

test("--image composes with the network and schedule flags", () => {
  const request = parseSocialsManagerRequest("ship it --image --on x,linkedin --at 2026-08-05T09:00");
  assert.equal(request.withImages, true);
  assert.deepEqual(request.providerIds, ["x", "linkedin"]);
  assert.equal(request.scheduleAt, "2026-08-05T09:00");
  assert.equal(request.brief, "ship it");
});

// -------------------------------------------------------------------- upload

test("an image is uploaded as multipart and returned as an attachable media record", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: "media_1", path: "http://host/uploads/a.png" }), {
      status: 200,
    });
  };
  try {
    const client = new PostizApiClient(
      { publicApiUrl: "http://postiz/api/public/v1", appApiUrl: "http://postiz/api" },
      "org-key",
    );
    const media = await client.uploadMedia({
      buffer: new Uint8Array([1, 2, 3]),
      filename: "art.png",
      mimeType: "image/png",
    });

    assert.deepEqual(media, { id: "media_1", path: "http://host/uploads/a.png" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://postiz/api/public/v1/upload");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.authorization, "org-key");
    // fetch must set the multipart boundary itself.
    assert.ok(!("content-type" in calls[0].init.headers));
    assert.ok(calls[0].init.body instanceof FormData);
    assert.equal(calls[0].init.body.get("file").name, "art.png");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uploaded media rides along on the created post", async () => {
  let body = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: "post_1" }), { status: 200 });
  };
  try {
    const client = new PostizApiClient(
      { publicApiUrl: "http://postiz/api/public/v1", appApiUrl: "http://postiz/api" },
      "org-key",
    );
    await client.createPost({
      integrationId: "int_1",
      content: "hello",
      scheduledAt: "2026-08-05T09:00",
      image: [{ id: "media_1", path: "http://host/uploads/a.png" }],
    });

    assert.deepEqual(body.posts[0].value[0].image, [
      { id: "media_1", path: "http://host/uploads/a.png" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a post with no artwork still sends the empty image array Postiz requires", async () => {
  let body = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: "post_1" }), { status: 200 });
  };
  try {
    const client = new PostizApiClient(
      { publicApiUrl: "http://postiz/api/public/v1", appApiUrl: "http://postiz/api" },
      "org-key",
    );
    await client.createPost({
      integrationId: "int_1",
      content: "hello",
      scheduledAt: "2026-08-05T09:00",
    });
    assert.deepEqual(body.posts[0].value[0].image, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --------------------------------------------------------------------- wiring

test("one Edit button on a post card opens the post studio", () => {
  const card = source("src/app/components/hermes/inline-socials-manager-run.tsx");
  const host = source("src/app/components/hermes/inline-artifact-cards.tsx");

  assert.match(card, /<SocialsManagerPostStudio/);
  assert.match(card, /setStudioId\(post\.id\)/);
  assert.match(card, />\s*\{imagingId === post\.id/);
  assert.match(card, /post\.imagePreviewUrl/);
  // Artwork and the draft artifact are no longer separate buttons on the card.
  assert.doesNotMatch(card, />\s*Add image\s*</);
  assert.doesNotMatch(card, />\s*Change image\s*</);
  assert.doesNotMatch(card, />\s*Remove image\s*</);
  assert.doesNotMatch(card, />\s*Artifact\s*</);
  // The card no longer edits copy in place either — the studio owns that too.
  assert.doesNotMatch(card, /setDraftContent/);

  // The studio is told where to file new artwork by the surrounding transcript.
  assert.match(host, /export function useInlineArtifactScope/);
  assert.match(host, /sourceSurface: gardenSlug \? "garden_chat" : "dashboard_terminal"/);
  assert.match(card, /conversationId=\{artifactScope\?\.conversationId \?\? null\}/);
});

test("the post studio stages copy and artwork together and saves them at once", () => {
  const studio = source("src/app/components/hermes/socials-manager-post-studio.tsx");

  // Three ways to get a picture, including the archive the user already has.
  assert.match(studio, /"\/api\/socials-manager\/images"/);
  assert.match(studio, /setStaged\(\{\s*artifactId: item\.id/);
  assert.match(studio, /operation: "generate"/);
  assert.match(studio, /new FormData\(\)/);
  assert.match(studio, />\s*Remove image\s*</);

  // Nothing is written until Save, and Save writes both halves in one patch.
  assert.match(studio, /\.\.\.\(captionChanged \? \{ content: caption \} : \{\}\)/);
  assert.match(studio, /\.\.\.\(imageChanged \? \{ imageArtifactId: image\.artifactId \} : \{\}\)/);
  assert.match(studio, /Discard the unsaved changes to this post\?/);

  // It reads as part of the chat: shared material, no brand colours.
  for (const className of ["neu-button", "neu-dialog", "bb-modal-panel"]) {
    assert.ok(studio.includes(className), `${className} is missing from the studio`);
  }
  assert.doesNotMatch(studio, /#[0-9a-f]{6}/i);
});

test("the post route validates the image and mirrors it to a running stack", () => {
  const route = source("src/app/api/socials-manager/posts/[postId]/route.ts");

  assert.match(route, /requireImageArtifactId/);
  assert.match(route, /readPostImage\(userId, value\)/);
  assert.match(route, /openPostizSessionIfRunning/);
  assert.match(route, /republishWithImage/);
  assert.match(route, /presentSocialsManagerPost\(userId, post\)/);
});

test("generated images are read from the stream, not from the completed response", () => {
  const service = source("src/lib/hermes/artifact-image-service.ts");

  assert.match(service, /stream: true/);
  assert.match(service, /response\.output_item\.done/);
  assert.match(service, /response\.image_generation_call\.partial_image/);
  assert.doesNotMatch(service, /stream: false/);
});
