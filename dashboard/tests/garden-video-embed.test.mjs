import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  MARKDOWN_VIDEO_ACCEPT_ATTR,
  MAX_MARKDOWN_VIDEO_BYTES,
  isResolvedVideoUpload,
  resolveVideoUpload,
  sanitizeEmbedTitle,
  videoEmbedMarkdown,
} from "../src/lib/garden-video-embed.ts";
import fs from "node:fs";
import os from "node:os";
import {
  normalizeDocumentSlug,
  safeClusterDir,
  slugifyAssetName,
  uniqueAssetPath,
  writeAssetStream,
} from "../src/lib/garden-markdown-assets.ts";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bb-video-"));
}

/** A body that yields `count` chunks of `size` bytes, like a streamed upload. */
function bodyOf(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

test("accepts the container formats a browser can play", () => {
  for (const name of ["clip.mp4", "clip.M4V", "clip.webm", "clip.ogv", "clip.mov"]) {
    const resolved = resolveVideoUpload(name, "video/mp4", 1024);
    assert.ok(isResolvedVideoUpload(resolved), name);
  }
});

test("rejects containers a browser cannot play", () => {
  for (const name of ["clip.mkv", "clip.avi", "clip.flv", "notes.pdf", "clip"]) {
    const resolved = resolveVideoUpload(name, "video/x-matroska", 1024);
    assert.ok(!isResolvedVideoUpload(resolved), name);
  }
});

test("the extension decides, so an empty or generic MIME type still passes", () => {
  for (const mime of ["", undefined, "application/octet-stream", "video/quicktime"]) {
    const resolved = resolveVideoUpload("holiday.mov", mime, 2048);
    assert.ok(isResolvedVideoUpload(resolved), String(mime));
  }
});

test("a MIME type that contradicts the extension is rejected", () => {
  const resolved = resolveVideoUpload("clip.mp4", "image/png", 2048);
  assert.ok(!isResolvedVideoUpload(resolved));
});

test("derives a safe asset stem and a readable title from the file name", () => {
  const resolved = resolveVideoUpload("Lecture 3 — Fourier_Transform.mp4", "video/mp4", 4096);
  assert.ok(isResolvedVideoUpload(resolved));
  assert.equal(resolved.ext, "mp4");
  assert.equal(resolved.mimeType, "video/mp4");
  assert.equal(resolved.baseName, "lecture-3-fourier-transform");
  assert.equal(resolved.title, "Lecture 3 — Fourier Transform");
});

test("an m4v is stored as mp4, and the stem never escapes the assets folder", () => {
  const resolved = resolveVideoUpload("../../etc/passwd.m4v", "video/mp4", 4096);
  assert.ok(isResolvedVideoUpload(resolved));
  assert.equal(resolved.mimeType, "video/mp4");
  assert.ok(!resolved.baseName.includes("/"));
  assert.ok(!resolved.baseName.includes("."));
});

test("empty and oversized uploads are refused", () => {
  assert.ok(!isResolvedVideoUpload(resolveVideoUpload("clip.mp4", "video/mp4", 0)));
  assert.ok(
    !isResolvedVideoUpload(
      resolveVideoUpload("clip.mp4", "video/mp4", MAX_MARKDOWN_VIDEO_BYTES + 1),
    ),
  );
  assert.ok(
    isResolvedVideoUpload(resolveVideoUpload("clip.mp4", "video/mp4", MAX_MARKDOWN_VIDEO_BYTES)),
  );
});

test("the editor's accept attribute lists exactly the accepted extensions", () => {
  assert.equal(MARKDOWN_VIDEO_ACCEPT_ATTR, ".mp4,.m4v,.webm,.ogv,.mov");
});

test("a title carrying brackets or newlines cannot break the Markdown embed", () => {
  assert.equal(sanitizeEmbedTitle("Fun [with] brackets"), "Fun with brackets");
  assert.equal(sanitizeEmbedTitle("two\nlines"), "two lines");
  assert.equal(sanitizeEmbedTitle("   "), "");
  assert.equal(sanitizeEmbedTitle(undefined, "Video"), "Video");
  assert.equal(sanitizeEmbedTitle(42, "Video"), "Video");
});

test("both sources are written as the same Markdown shape", () => {
  assert.equal(
    videoEmbedMarkdown("/my-garden/assets/lecture-3.mp4", "Lecture 3"),
    "![Lecture 3](/my-garden/assets/lecture-3.mp4)",
  );
  assert.equal(
    videoEmbedMarkdown("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "A talk"),
    "![A talk](https://www.youtube.com/watch?v=dQw4w9WgXcQ)",
  );
});

// --------------------------------------------------------------- asset paths

test("a cluster directory may not escape the content root", () => {
  const root = path.resolve("/content");
  assert.equal(safeClusterDir(root, "my-garden"), path.join(root, "my-garden"));
  assert.equal(safeClusterDir(root, ".."), null);
  assert.equal(safeClusterDir(root, "../other"), null);
  assert.equal(safeClusterDir(root, ""), null);
});

test("the note slug is reduced to a basename, and index pages are not editable", () => {
  assert.equal(normalizeDocumentSlug("my-garden", "my-garden/folder/note"), "note");
  assert.equal(normalizeDocumentSlug("my-garden", "garden/my-garden/note.md"), "note");
  assert.equal(normalizeDocumentSlug("my-garden", "note?note=other"), "other");
  assert.equal(normalizeDocumentSlug("my-garden", "my-garden/index"), null);
  assert.equal(normalizeDocumentSlug("my-garden", "my-garden/_index"), null);
});

test("asset names fall back rather than becoming empty", () => {
  assert.equal(slugifyAssetName("Hello World"), "hello-world");
  assert.equal(slugifyAssetName("!!!", "video"), "video");
  assert.equal(slugifyAssetName(""), "file");
});

test("a second upload of the same name gets its own file", () => {
  const dir = tempDir();
  try {
    const first = uniqueAssetPath(dir, "lecture", "mp4");
    fs.writeFileSync(first, "a");
    const second = uniqueAssetPath(dir, "lecture", "mp4");
    assert.equal(path.basename(first), "lecture.mp4");
    assert.equal(path.basename(second), "lecture-2.mp4");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------- streamed upload

test("a streamed upload is written whole", async () => {
  const dir = tempDir();
  const target = path.join(dir, "clip.mp4");
  try {
    const chunks = [Buffer.from("abc"), Buffer.from("defg")];
    const result = await writeAssetStream(bodyOf(chunks), target, 1024);
    assert.deepEqual(result, { ok: true, bytes: 7 });
    assert.equal(fs.readFileSync(target, "utf8"), "abcdefg");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the cap is enforced on the bytes, not on a claimed content-length", async () => {
  const dir = tempDir();
  const target = path.join(dir, "clip.mp4");
  try {
    // Ten 1 KB chunks against a 4 KB ceiling: nothing announced the real size.
    const chunks = Array.from({ length: 10 }, () => Buffer.alloc(1024, 1));
    const result = await writeAssetStream(bodyOf(chunks), target, 4096);
    assert.deepEqual(result, { ok: false, reason: "too_large" });
    assert.equal(
      fs.existsSync(target),
      false,
      "an over-cap upload must not leave a truncated asset behind",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an upload exactly at the cap is accepted", async () => {
  const dir = tempDir();
  const target = path.join(dir, "clip.mp4");
  try {
    const result = await writeAssetStream(bodyOf([Buffer.alloc(4096, 1)]), target, 4096);
    assert.deepEqual(result, { ok: true, bytes: 4096 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty upload leaves no file", async () => {
  const dir = tempDir();
  const target = path.join(dir, "clip.mp4");
  try {
    const result = await writeAssetStream(bodyOf([]), target, 1024);
    assert.deepEqual(result, { ok: false, reason: "empty" });
    assert.equal(fs.existsSync(target), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an aborted upload cleans up its partial file and reports the failure", async () => {
  const dir = tempDir();
  const target = path.join(dir, "clip.mp4");
  try {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from("partial"));
        controller.error(new Error("connection lost"));
      },
    });
    await assert.rejects(() => writeAssetStream(body, target, 1024), /connection lost/);
    assert.equal(fs.existsSync(target), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
