import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stageEditableDocumentAttachments } from "../src/lib/document-attachments-server.ts";
import { writeDocumentBlob } from "../src/lib/conversations/document-blob-store.ts";

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "document-staging-"));
  const previous = process.env.BREADBOARD_CHAT_DOCUMENT_DIR;
  process.env.BREADBOARD_CHAT_DOCUMENT_DIR = path.join(root, "blobs");
  t.after(() => {
    if (previous === undefined) delete process.env.BREADBOARD_CHAT_DOCUMENT_DIR;
    else process.env.BREADBOARD_CHAT_DOCUMENT_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
  const bytes = Buffer.from("%PDF-1.7\nOriginal annotated PDF bytes\n%%EOF");
  const blob = await writeDocumentBlob({
    userId: 7,
    format: "pdf",
    body: new Blob([bytes]).stream(),
  });
  const attachment = {
    type: "document",
    name: "studyguide-annotated.pdf",
    blobId: blob.blobId,
    format: "pdf",
    text: "Lecture 3: study guide",
  };
  return { root, workspace, bytes, blob, attachment };
}

for (const extended of [false, true]) {
  test(`PDF staging preserves bytes and edits with ${extended ? "extended Windows" : "ordinary"} workspace paths`, {
    skip: extended && process.platform !== "win32",
  }, async (t) => {
    const { workspace, bytes, blob, attachment } = await fixture(t);
    const input = {
      userId: 7,
      workspace: extended ? path.toNamespacedPath(workspace) : workspace,
      attachments: [attachment],
    };
    const staged = stageEditableDocumentAttachments(input);
    assert.equal(staged.paths.length, 1);
    const relative = staged.paths[0].path;
    assert.equal(path.isAbsolute(relative), false);
    assert.ok(relative.startsWith(".breadboard/attachments/"));
    const target = path.join(workspace, relative);
    assert.deepEqual(fs.readFileSync(target), bytes);
    assert.ok(staged.context.includes(JSON.stringify(relative)));

    fs.writeFileSync(target, "User's edited copy");
    assert.deepEqual(stageEditableDocumentAttachments(input), staged);
    assert.equal(fs.readFileSync(target, "utf8"), "User's edited copy");
    assert.deepEqual(fs.readFileSync(blob.path), bytes);
  });
}

test("staging does not copy another account's attachment", async (t) => {
  const { workspace, attachment } = await fixture(t);
  assert.deepEqual(stageEditableDocumentAttachments({
    userId: 8, workspace, attachments: [attachment],
  }), { context: "", paths: [] });
  assert.deepEqual(fs.readdirSync(path.join(workspace, ".breadboard", "attachments")), []);
});

for (const segment of [".breadboard", ".breadboard/attachments"]) {
  test(`staging refuses a linked ${segment} directory`, async (t) => {
    const { root, workspace, attachment } = await fixture(t);
    const outside = path.join(root, "outside");
    fs.mkdirSync(outside);
    const link = path.join(workspace, segment);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    assert.deepEqual(stageEditableDocumentAttachments({
      userId: 7, workspace, attachments: [attachment],
    }), { context: "", paths: [] });
    assert.deepEqual(fs.readdirSync(outside), []);
  });
}
