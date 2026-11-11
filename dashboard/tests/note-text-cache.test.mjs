import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  enableNoteTextDiskCache,
  forgetNoteTextsInMemory,
  openNoteTexts,
} from "../src/lib/note-text-cache.ts";

function garden() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "note-text-cache-"));
  const dir = path.join(root, "content", "physics");
  fs.mkdirSync(dir, { recursive: true });
  return { root, dir, data: root, cache: path.join(root, "cache", "garden-notes") };
}

// Whole-second times survive utimes exactly, so a rewrite can keep "the same" time.
const STAMP = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
const stamp = (file) => fs.utimesSync(file, STAMP, STAMP);

function scan(dir) {
  const texts = openNoteTexts(dir);
  const out = {};
  const names = fs.readdirSync(dir).filter((name) => name.endsWith(".md"));
  for (const name of names) out[name] = texts.read(name, path.join(dir, name), fs.statSync(path.join(dir, name)));
  texts.finish(names);
  return out;
}

async function waitForFile(file) {
  for (let i = 0; i < 100 && !fs.existsSync(file); i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(fs.existsSync(file), "the cache file was written");
}

test("a note is read from disk only when its size or time changed, and deleted notes are forgotten", async () => {
  const { dir, cache, data } = garden();
  enableNoteTextDiskCache(data);
  forgetNoteTextsInMemory();
  fs.writeFileSync(path.join(dir, "a.md"), "alpha");
  fs.writeFileSync(path.join(dir, "b.md"), "beta");
  stamp(path.join(dir, "a.md"));
  assert.deepEqual(scan(dir), { "a.md": "alpha", "b.md": "beta" });
  await waitForFile(path.join(cache, "physics.json"));

  // Same size and time but different bytes on disk: proof the second scan did
  // not touch the file at all.
  const aPath = path.join(dir, "a.md");
  fs.writeFileSync(aPath, "ALPHA");
  stamp(aPath);
  assert.equal(scan(dir)["a.md"], "alpha");

  // A real edit changes the time (and here the size) and is picked up.
  fs.writeFileSync(aPath, "alpha, edited");
  fs.utimesSync(aPath, new Date(), new Date(STAMP.getTime() + 5_000));
  fs.rmSync(path.join(dir, "b.md"));
  assert.deepEqual(scan(dir), { "a.md": "alpha, edited" });
});

test("after a restart the text comes back from the one cache file, and a foreign or torn file is ignored", async () => {
  const { dir, cache, data } = garden();
  enableNoteTextDiskCache(data);
  forgetNoteTextsInMemory();
  const notePath = path.join(dir, "n.md");
  fs.writeFileSync(notePath, "first");
  stamp(notePath);
  scan(dir);
  await waitForFile(path.join(cache, "physics.json"));

  fs.writeFileSync(notePath, "FIRST");
  stamp(notePath);
  forgetNoteTextsInMemory();
  assert.equal(scan(dir)["n.md"], "first", "served from the cache file");

  fs.writeFileSync(path.join(cache, "physics.json"), "{ not json");
  forgetNoteTextsInMemory();
  assert.equal(scan(dir)["n.md"], "FIRST", "a torn cache falls back to the note");

  // Without a cache directory (runtime workers) nothing is written.
  enableNoteTextDiskCache(null);
  forgetNoteTextsInMemory();
  fs.rmSync(cache, { recursive: true, force: true });
  scan(dir);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(fs.existsSync(cache), false);
});
