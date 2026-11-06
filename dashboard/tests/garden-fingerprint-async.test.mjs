import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

await import("../scripts/learn-worker-import-hook.mjs");
const { gardenContentFingerprint } = await import("../src/lib/thought-topology/projection.ts");
const { gardenContentFingerprintAsync } = await import("../src/lib/thought-topology/fingerprint-async.ts");

test("async polling matches worker fingerprints and notices files, folders and provenance changes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-fingerprint-"));
  const write = (name, contents) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  };
  try {
    for (const name of ["one.md", "folder/TWO.MD", "assets/ignored.md", ".git/ignored.md", "node_modules/ignored.md", ".breadboard/ignored.md", ".breadboard/source-anchors.json"]) write(name, "initial");
    const first = gardenContentFingerprintAsync(root);
    assert.equal(gardenContentFingerprintAsync(root), first, "concurrent tabs share filesystem work");
    const before = await first;
    assert.equal(before, gardenContentFingerprint(root));
    write("folder/three.md", "new page");
    const added = await gardenContentFingerprintAsync(root);
    assert.notEqual(added, before);
    assert.equal(added, gardenContentFingerprint(root));
    write(".breadboard/source-anchors.json", "changed provenance");
    const provenance = await gardenContentFingerprintAsync(root);
    assert.notEqual(provenance, added);
    assert.equal(provenance, gardenContentFingerprint(root));
    fs.mkdirSync(path.join(root, "empty-folder"));
    const folder = await gardenContentFingerprintAsync(root);
    assert.notEqual(folder, provenance);
    fs.unlinkSync(path.join(root, "one.md"));
    const removed = await gardenContentFingerprintAsync(root);
    assert.notEqual(removed, folder);
    assert.equal(removed, gardenContentFingerprint(root));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("a pending disk read yields so the server can handle another request", async () => {
  const original = fs.promises.readdir;
  let release;
  fs.promises.readdir = () => new Promise(resolve => { release = () => resolve([]); });
  try {
    let settled = false;
    const pending = gardenContentFingerprintAsync(path.join(os.tmpdir(), "bb-fingerprint-stalled")).then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(typeof release, "function");
    release();
    await pending;
  } finally { fs.promises.readdir = original; }
});
