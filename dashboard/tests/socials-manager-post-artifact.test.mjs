// The artifact boundary for a social post: what may be stored as one, and what
// the viewer refuses to open.
//
// A post artifact opens as an editor over the post, so a document that cannot
// be trusted must be refused rather than half-loaded — an editor over half a
// post would save half a post back.

import assert from "node:assert/strict";
import test from "node:test";

const {
  parseStoredSocialsPost,
  socialsPostArtifactMetadata,
  socialsPostArtifactTitle,
  socialsPostDocument,
  SOCIALS_MANAGER_POST_RENDERER,
  SOCIALS_MANAGER_POST_SCHEMA_VERSION,
} = await import("../src/lib/socials-manager/post-artifact.ts");
const { artifactRenderer, availableArtifactRenderers } = await import(
  "../src/lib/hermes/artifact-renderers.ts"
);

const POST = {
  id: 12,
  runId: "pzrun_test",
  providerId: "x",
  channelId: null,
  content: "Ship day. The garden view is live.",
  status: "scheduled",
  scheduledAt: "2026-08-12T09:00",
  publishedAt: null,
  calendarEventId: 4,
  artifactId: "art_test",
  imageArtifactId: "art_image",
  remoteId: "postiz_9",
  error: null,
  createdAt: "2026-08-07T10:00:00.000Z",
  updatedAt: "2026-08-07T10:00:00.000Z",
};

test("a stored post carries everything the studio needs to open without the model", () => {
  const document = socialsPostDocument(POST);

  assert.equal(document.schemaVersion, SOCIALS_MANAGER_POST_SCHEMA_VERSION);
  assert.equal(document.postId, 12);
  assert.equal(document.providerName, "X");
  assert.equal(document.editor, "normal");
  // The network's own ceiling travels with the post: the character count under
  // the caption means nothing without it.
  assert.equal(document.characterLimit, 280);
  assert.equal(document.scheduledAt, "2026-08-12T09:00");
  assert.equal(document.imageArtifactId, "art_image");
  assert.equal(document.remoteId, "postiz_9");

  assert.equal(parseStoredSocialsPost(document).ok, true);
});

test("the title and metadata name the post the way every surface that never opens it reads", () => {
  const document = socialsPostDocument(POST);

  assert.equal(socialsPostArtifactTitle(document), "X — Ship day. The garden view is live.");
  assert.equal(
    socialsPostArtifactTitle({ ...document, content: "" }),
    "X post",
  );

  const metadata = socialsPostArtifactMetadata(document);
  assert.equal(metadata.socialsManagerPostId, 12);
  assert.equal(metadata.socialsManagerNetwork, "x");
  assert.equal(metadata.socialsManagerNetworkName, "X");
  assert.equal(metadata.socialsManagerScheduledAt, "2026-08-12T09:00");
  assert.equal(metadata.characterCount, POST.content.length);
  assert.equal(metadata.characterLimit, 280);
});

test("a post from a future build is refused, not opened for editing", () => {
  const result = parseStoredSocialsPost({
    ...socialsPostDocument(POST),
    schemaVersion: SOCIALS_MANAGER_POST_SCHEMA_VERSION + 1,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Unsupported post schema version/);
});

test("a post missing the network it was written for is refused", () => {
  const { providerId: _providerId, ...withoutNetwork } = socialsPostDocument(POST);
  const result = parseStoredSocialsPost(withoutNetwork);
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.startsWith("providerId")),
    result.issues.join("; "),
  );
});

test("a post stored without a picture or a slot still opens", () => {
  const parsed = parseStoredSocialsPost({
    schemaVersion: SOCIALS_MANAGER_POST_SCHEMA_VERSION,
    providerId: "linkedin",
    providerName: "LinkedIn",
    content: "A draft, nothing else.",
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.scheduledAt, null);
  assert.equal(parsed.value.imageArtifactId, null);
  assert.equal(parsed.value.postId, null);
  assert.equal(parsed.value.status, "draft");
});

test("the renderer is registered and validates before it publishes", async () => {
  const renderer = artifactRenderer(SOCIALS_MANAGER_POST_RENDERER);
  assert.ok(renderer, "the socials-manager-post renderer must be registered");
  assert.equal(renderer.kind, "data");
  assert.equal(renderer.extension, ".json");

  assert.deepEqual(
    await renderer.validate(JSON.stringify(socialsPostDocument(POST))),
    { ok: true },
  );

  const notJson = await renderer.validate("just the caption, then");
  assert.equal(notJson.ok, false);
  assert.match(notJson.error, /valid JSON/);

  const wrongShape = await renderer.validate(JSON.stringify({ content: "nearly" }));
  assert.equal(wrongShape.ok, false);
  assert.match(wrongShape.error, /did not match its schema/);

  assert.ok(
    availableArtifactRenderers().some((entry) => entry.id === SOCIALS_MANAGER_POST_RENDERER),
    "the renderer must be listed as available",
  );
});
