// Linked videos: what counts as one, that it is fetched once, and that the copy
// is reused for every later mention.
//
// The risk here is not the download — that is yt-dlp's job — it is *identity*.
// If `youtu.be/abc` and `youtube.com/watch?v=abc&list=…` are two videos, then
// every rephrasing re-downloads, an edit and the question that preceded it work
// on different files, and the cache is decoration. So most of this file is about
// one video having exactly one key.
//
// The other half is the cache being honest: scoped to its owner, and never
// handing back an entry whose file has been swept.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "video-sources-test-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { firstVideoSource, videoSourceFor, videoUrlsIn } = await import(
  "../src/lib/video-sources/identity.ts"
);
const { lookupVideoSource, recordVideoSource, listVideoSources } = await import(
  "../src/lib/video-sources/store.ts"
);
const { adoptVideoBlob, findVideoBlob } = await import(
  "../src/lib/conversations/video-blob-store.ts"
);

const VIDEO_ID = "aqz-KE-bpKQ";

// --- identity ---------------------------------------------------------------

test("every spelling of one YouTube video is one source key", () => {
  const spellings = [
    `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    `https://youtube.com/watch?v=${VIDEO_ID}`,
    `https://m.youtube.com/watch?v=${VIDEO_ID}`,
    `https://music.youtube.com/watch?v=${VIDEO_ID}`,
    `https://youtu.be/${VIDEO_ID}`,
    `https://www.youtube.com/shorts/${VIDEO_ID}`,
    `https://www.youtube.com/embed/${VIDEO_ID}`,
    `https://www.youtube.com/live/${VIDEO_ID}`,
    // A watch URL inside a playlist is still one video.
    `https://www.youtube.com/watch?v=${VIDEO_ID}&list=PLabc&index=7`,
    // …and a timestamped share link is the same video, not a second copy.
    `https://youtu.be/${VIDEO_ID}?t=42`,
  ];
  const keys = new Set(spellings.map((url) => videoSourceFor(url)?.key));
  assert.equal(keys.size, 1, `expected one key, got ${[...keys].join(", ")}`);
  assert.equal([...keys][0], `youtube:${VIDEO_ID}`);
  // And the canonical URL is what actually gets fetched.
  assert.equal(
    videoSourceFor(spellings.at(-1)).canonicalUrl,
    `https://www.youtube.com/watch?v=${VIDEO_ID}`,
  );
});

test("things that are not a single video are refused", () => {
  for (const url of [
    "https://www.youtube.com/playlist?list=PLabc",
    "https://www.youtube.com/@someone",
    "https://www.youtube.com/results?search_query=cats",
    "https://example.com/an-article",
    "https://example.com/page.html",
    "ftp://example.com/clip.mp4",
    "not a url at all",
    "",
  ]) {
    assert.equal(videoSourceFor(url), null, url);
  }
});

test("a direct media link is a video, keyed without its query string", () => {
  const plain = videoSourceFor("https://cdn.example.com/talks/keynote.mp4");
  assert.equal(plain?.provider, "web");
  // A signed URL for the same file must not become a second copy of it.
  const signed = videoSourceFor("https://cdn.example.com/talks/keynote.mp4?token=abc123");
  assert.equal(signed?.key, plain?.key);
  // …but what is fetched keeps the token, or the fetch would be refused.
  assert.match(signed.canonicalUrl, /token=abc123/);
});

test("credentials in a link are refused rather than forwarded", () => {
  assert.equal(videoSourceFor("https://user:pass@cdn.example.com/clip.mp4"), null);
});

test("links are found inside ordinary prose", () => {
  assert.equal(
    firstVideoSource(`have a look at https://youtu.be/${VIDEO_ID}, it's short`)?.key,
    `youtube:${VIDEO_ID}`,
  );
  assert.equal(
    firstVideoSource(`(https://www.youtube.com/watch?v=${VIDEO_ID}) cut the intro`)?.key,
    `youtube:${VIDEO_ID}`,
  );
  assert.equal(firstVideoSource("no links in this one"), null);
});

test("the first video link wins and duplicates collapse", () => {
  const text = `https://youtu.be/${VIDEO_ID} and https://youtu.be/${VIDEO_ID} and https://example.com/b.mp4`;
  assert.equal(videoUrlsIn(text).length, 2);
  assert.equal(firstVideoSource(text)?.key, `youtube:${VIDEO_ID}`);
});

// --- the cache --------------------------------------------------------------

async function storeFakeVideo(userId, name) {
  const staging = path.join(scratch, "staging");
  fs.mkdirSync(staging, { recursive: true });
  const file = path.join(staging, name);
  fs.writeFileSync(file, Buffer.alloc(2048, 7));
  return adoptVideoBlob({ userId, filePath: file, format: "mp4", root: scratch });
}

test("a fetched video is stored as an ordinary chat attachment", async () => {
  const blob = await storeFakeVideo(11, "adopted.mp4");
  assert.match(blob.blobId, /^vid_[0-9a-f]{32}$/);
  assert.equal(blob.byteSize, 2048);
  // Findable exactly like an uploaded one — that is what lets a downloaded
  // video flow through Watch and the editor without either knowing.
  const found = findVideoBlob({ userId: 11, blobId: blob.blobId, root: scratch });
  assert.ok(found);
  assert.equal(found.path, blob.path);
});

test("the cache returns the same copy for every later mention", async () => {
  const blob = await storeFakeVideo(12, "cached.mp4");
  recordVideoSource({
    userId: 12,
    key: `youtube:${VIDEO_ID}`,
    blob,
    canonicalUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    title: "A talk",
    durationSeconds: 635,
    root: scratch,
  });

  for (const spelling of [
    `https://youtu.be/${VIDEO_ID}`,
    `https://www.youtube.com/watch?v=${VIDEO_ID}&list=PLabc`,
  ]) {
    const hit = lookupVideoSource(12, videoSourceFor(spelling).key, scratch);
    assert.ok(hit, spelling);
    assert.equal(hit.blob.blobId, blob.blobId, spelling);
    assert.equal(hit.entry.title, "A talk");
  }
});

test("one person's downloads are not another's", async () => {
  const blob = await storeFakeVideo(13, "mine.mp4");
  recordVideoSource({
    userId: 13,
    key: "youtube:private1234",
    blob,
    canonicalUrl: "https://www.youtube.com/watch?v=private1234",
    title: "Mine",
    durationSeconds: null,
    root: scratch,
  });
  assert.ok(lookupVideoSource(13, "youtube:private1234", scratch));
  assert.equal(lookupVideoSource(14, "youtube:private1234", scratch), null);
});

test("an entry whose file has been swept is dropped, not returned", async () => {
  const blob = await storeFakeVideo(15, "doomed.mp4");
  recordVideoSource({
    userId: 15,
    key: "youtube:doomed12345",
    blob,
    canonicalUrl: "https://www.youtube.com/watch?v=doomed12345",
    title: "Doomed",
    durationSeconds: null,
    root: scratch,
  });
  assert.ok(lookupVideoSource(15, "youtube:doomed12345", scratch));

  // The upload sweep removes blobs no message references; the index must not
  // outlive its file, or a "cache hit" hands back a path to nothing.
  fs.rmSync(blob.path, { force: true });
  assert.equal(lookupVideoSource(15, "youtube:doomed12345", scratch), null);
  assert.equal(listVideoSources(15, scratch).length, 0);
});

// --- wiring -----------------------------------------------------------------

test("sending is never blocked on a download", () => {
  const terminal = read("src/app/components/hermes/dashboard-agent-terminal.tsx");
  // The composer hands the link over as a link. Nothing in the send path may
  // await a fetch, or the message stops being instant.
  assert.doesNotMatch(terminal, /resolveLinkedVideo\b/);
  assert.doesNotMatch(terminal, /Fetching the linked video/);
  assert.match(terminal, /url: linked\.canonicalUrl/);
  // An attached video wins over a link in the same message and keeps its whole
  // pointer so the auto-routed external turn can still render and retain it.
  assert.match(terminal, /if \(attached\) return attached/);
});

test("the editor resolves a linked video inside the run, where progress lives", () => {
  const runManager = read("src/lib/video-use/run-manager.ts");
  assert.match(runManager, /request\.source\.kind === "url"/);
  assert.match(runManager, /ensureVideoSource\(/);
  // The run reports the fetch as a stage of its own, and can be stopped.
  assert.match(runManager, /stage: "fetch"/);
  assert.match(runManager, /fetch\.progress/);
  assert.match(runManager, /signal: run\.controller\.signal/);
  // The card has somewhere to show it.
  const card = read("src/app/components/hermes/inline-video-use-run.tsx");
  assert.match(card, /key: "fetch", label: "Fetching the video"/);
  assert.match(card, /"fetch\.progress"/);
});

test("a turn only downloads a linked video when Watch is going to open it", () => {
  const turnService = read("src/lib/conversations/turn-service.ts");
  assert.match(turnService, /fetchLinkedVideoForWatch/);
  // Gated on the skill actually being selected — the same rule that stops
  // gigabytes being linked into a workspace for a turn that never reads them.
  assert.match(
    turnService,
    /decision\.selectedConditionalSkills\.includes\("watch"\) &&\s*turnVideos\.length === 0/,
  );
  // Bounded, so a slow fetch cannot hold a conversation open indefinitely.
  assert.match(turnService, /LINKED_VIDEO_BUDGET_MS/);
  assert.match(turnService, /Promise\.race\(\[fetching, budget\]\)/);
});

test("one video is fetched once, however many callers ask at once", () => {
  const resolve = read("src/lib/video-sources/resolve.ts");
  // Both callers go through the same door, and a second caller joins the fetch
  // already running rather than starting a second one.
  assert.match(resolve, /pending\.get\(lock\)/);
  assert.match(resolve, /pending\.set\(lock, started\)/);
  assert.match(resolve, /pending\.delete\(lock\)/);
  for (const caller of [
    "src/lib/video-use/run-manager.ts",
    "src/lib/conversations/turn-service.ts",
  ]) {
    assert.match(read(caller), /ensureVideoSource|cachedVideoSource/, caller);
  }
});

test("the downloader reuses the app's existing yt-dlp contract", () => {
  const download = read("src/lib/video-sources/download.ts");
  // YTDLP_PATH is what the desktop shell sets and what Scriberr and Watch read.
  assert.match(download, /env\.YTDLP_PATH/);
  // Metadata comes from the shared builder rather than a second argument list.
  assert.match(download, /buildYtdlpMetadataArgs/);
  assert.match(download, /from "\.\.\/scriberr\/exec\.ts"/);
  // A playlist, a livestream and an oversized fetch each fail before any bytes.
  assert.match(download, /"--no-playlist"/);
  assert.match(download, /is_live/);
  assert.match(download, /--max-filesize/);
});
