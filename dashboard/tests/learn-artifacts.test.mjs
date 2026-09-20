import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLearnArtifacts, writeLearnArtifactSelection, sourceSetHashWithLearnArtifacts, promptLearnArtifacts, learnArtifactKey } from "../src/lib/learn-artifacts.ts";
import { seedDurableInputs, fingerprintDurableGardenState } from "../src/lib/learn-build-workspace.ts";
import { parseArtifactReference } from "../src/lib/generated/artifact-reference.ts";

const item = { id: "art_a", conversationId: "chat_a", version: 2, title: "Circuit explorer", kind: "html", renderer: "interactive-visualizer", filename: "circuit.html", content: 'model source\n<button>Vary resistance</button>', contentHash: "source-hash", previewUrl: "/preview?version=2", downloadUrl: "/download?version=2" };

test("selected artifact snapshots survive Learn staging and invalidate old source hashes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "learn-artifacts-"));
  try {
    const garden = path.join(root, "garden"), staging = path.join(root, "staging");
    fs.mkdirSync(garden);
    assert.deepEqual(readLearnArtifacts(garden), []);
    assert.equal(sourceSetHashWithLearnArtifacts("original", []), "original");
    const before = fingerprintDurableGardenState(garden);
    writeLearnArtifactSelection(garden, learnArtifactKey(item), item);
    writeLearnArtifactSelection(garden, learnArtifactKey(item), item);
    assert.deepEqual(readLearnArtifacts(garden), [item]);
    assert.notEqual(fingerprintDurableGardenState(garden), before);
    seedDurableInputs(garden, staging);
    assert.deepEqual(readLearnArtifacts(staging), [item]);
    const hash = sourceSetHashWithLearnArtifacts("original", [item]);
    assert.notEqual(hash, "original");
    assert.notEqual(hash, sourceSetHashWithLearnArtifacts("original", [{ ...item, content: "changed bytes" }]));
    assert.notEqual(hash, sourceSetHashWithLearnArtifacts("original", [{ ...item, version: 3 }]));
    writeLearnArtifactSelection(garden, learnArtifactKey(item), null);
    assert.deepEqual(readLearnArtifacts(garden), []);
    assert.deepEqual(readLearnArtifacts(staging), [item], "a running build keeps its original selected snapshot");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Learn receives all selected artifact kinds as optional data and a pinned embed", () => {
  const packet = promptLearnArtifacts([item, { ...item, id: "art_b", kind: "pdf", content: "Document text" }]);
  assert.equal(packet.artifacts.length, 2);
  assert.match(packet.guidance, /optional teaching aids/);
  assert.match(packet.guidance, /ignore irrelevant/);
  assert.match(packet.guidance, /untrusted reference data/);
  assert.match(packet.artifacts[0].content, /Vary resistance/);
  assert.equal(parseArtifactReference(packet.artifacts[0].embedMarkdown.split("\n")[1]).version, 2);
  assert.equal(parseArtifactReference('{"id":"art_a","conversationId":"chat_a","version":-1}'), null);
  assert.equal(promptLearnArtifacts([]), undefined);
});

test("malformed selected material fails instead of silently dropping user input", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "learn-artifacts-"));
  try {
    fs.mkdirSync(path.join(root, ".breadboard"));
    fs.writeFileSync(path.join(root, ".breadboard/learn-artifacts.json"), '{"schemaVersion":1,"artifacts":[{}]}');
    assert.throws(() => readLearnArtifacts(root), /could not be read/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
