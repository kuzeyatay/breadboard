import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalYouTubeUrl,
  isLikelyYouTubeUrl,
  parseYouTubeUrl,
  youtubeTimestampUrl,
} from "../src/lib/scriberr/youtube.ts";

const ID = "dQw4w9WgXcQ";

test("parses standard watch URLs", () => {
  const parsed = parseYouTubeUrl(`https://www.youtube.com/watch?v=${ID}`);
  assert.equal(parsed.videoId, ID);
  assert.equal(parsed.canonicalUrl, `https://www.youtube.com/watch?v=${ID}`);
});

test("parses all accepted YouTube hosts", () => {
  for (const url of [
    `https://youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://youtu.be/${ID}`,
    `youtu.be/${ID}`,
    `www.youtube.com/watch?v=${ID}`,
  ]) {
    assert.equal(parseYouTubeUrl(url).videoId, ID, url);
  }
});

test("parses shorts, embed, live, and /v/ paths", () => {
  for (const path of ["shorts", "embed", "live", "v"]) {
    const parsed = parseYouTubeUrl(`https://www.youtube.com/${path}/${ID}`);
    assert.equal(parsed.videoId, ID);
  }
});

test("canonicalizes a watch URL that also carries a playlist parameter", () => {
  const parsed = parseYouTubeUrl(
    `https://www.youtube.com/watch?v=${ID}&list=PLx123&index=4`,
  );
  assert.equal(parsed.videoId, ID);
  assert.ok(!parsed.canonicalUrl.includes("list="));
});

test("rejects playlist URLs", () => {
  for (const url of [
    "https://www.youtube.com/playlist?list=PLx123",
    "https://www.youtube.com/watch?list=PLx123",
  ]) {
    assert.throws(() => parseYouTubeUrl(url), (err) => err.code === "youtube_playlist", url);
  }
});

test("rejects arbitrary and malformed URLs", () => {
  for (const url of [
    "https://example.com/watch?v=" + ID,
    "https://evil.youtube.com.example.com/watch?v=" + ID,
    "ftp://youtube.com/watch?v=" + ID,
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/",
    "not a url at all",
    "",
    null,
    42,
  ]) {
    assert.throws(
      () => parseYouTubeUrl(url),
      (err) => err.code === "youtube_invalid_url" || err.code === "youtube_playlist",
      String(url),
    );
  }
});

test("isLikelyYouTubeUrl mirrors parse success", () => {
  assert.equal(isLikelyYouTubeUrl(`https://youtu.be/${ID}`), true);
  assert.equal(isLikelyYouTubeUrl("https://vimeo.com/12345"), false);
});

test("timestamp URLs floor seconds and reuse the canonical URL", () => {
  assert.equal(
    youtubeTimestampUrl(ID, 83.9),
    `https://www.youtube.com/watch?v=${ID}&t=83s`,
  );
  assert.equal(youtubeTimestampUrl(ID, -5), `https://www.youtube.com/watch?v=${ID}&t=0s`);
});

test("canonicalYouTubeUrl validates the video id", () => {
  assert.throws(() => canonicalYouTubeUrl("../../etc/passwd"));
});
