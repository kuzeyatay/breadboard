// Ordinal references to attachments resolve to the right file.
//
// "The third screenshot" or "the second pdf" only means something if the model
// is told which file sat in which position. Nothing used to say it: text and
// document attachments became named blocks with no place in the row, and images
// reached the model as pixels (Hermes with a filename, agent-mode-off with none
// at all). The manifest under test spells the row out once per message, and
// both Hermes pipelines must include it.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.resolve(here, "..");

const { attachmentOrderManifest } = await import("../src/lib/chat-attachments.ts");

const image = (name) => ({ type: "image", dataUrl: "data:image/png;base64,AA==", name });
const pdf = (name) => ({
  type: "document",
  name,
  blobId: "doc_0000000000000000",
  format: "pdf",
  text: "body",
});

test("a lone attachment gets no manifest — nothing is ambiguous", () => {
  assert.equal(attachmentOrderManifest(undefined), null);
  assert.equal(attachmentOrderManifest([]), null);
  assert.equal(attachmentOrderManifest([image("only.png")]), null);
});

test("the manifest numbers attachments within their kind, in attach order", () => {
  const manifest = attachmentOrderManifest([
    image("first-shot.png"),
    pdf("report.pdf"),
    image("second-shot.png"),
    image("third-shot.png"),
  ]);
  assert.ok(manifest);
  const lines = manifest.split("\n");
  assert.match(lines[0], /count="4"/);
  assert.match(manifest, /1\. "first-shot\.png" — image 1 of 3/);
  assert.match(manifest, /2\. "report\.pdf" — pdf/);
  assert.match(manifest, /3\. "second-shot\.png" — image 2 of 3/);
  assert.match(manifest, /4\. "third-shot\.png" — image 3 of 3/);
  // The rule the ordinals follow is stated, not left to be guessed.
  assert.match(manifest, /count within that kind/);
});

test("documents count by format — the second pdf is the second .pdf", () => {
  const manifest = attachmentOrderManifest([
    pdf("a.pdf"),
    { ...pdf("deck.pptx"), format: "pptx", name: "deck.pptx" },
    pdf("b.pdf"),
  ]);
  assert.match(manifest, /1\. "a\.pdf" — pdf 1 of 2/);
  assert.match(manifest, /2\. "deck\.pptx" — pptx/);
  assert.match(manifest, /3\. "b\.pdf" — pdf 2 of 2/);
});

test("both Hermes pipelines send the manifest", () => {
  // A pipeline that skips the manifest silently regresses to guessing; pin the
  // call the same way the document-text consumers are pinned.
  const consumers = [
    "src/lib/agent-runtime/adapters/hermes.ts",
    "src/lib/conversations/direct-turn-service.ts",
  ];
  for (const relative of consumers) {
    const source = fs.readFileSync(path.join(dashboard, relative), "utf8");
    assert.match(
      source,
      /attachmentOrderManifest\(/,
      `${relative} must spell out the attachment order for the model`,
    );
  }
});
