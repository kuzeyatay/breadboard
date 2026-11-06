import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { markdownFolderTitle } from "../src/lib/markdown-folder-title.ts";

test("exports use the actual parent folder title with a readable name fallback", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-folder-title-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const directory = path.join(root, "telecom", "1.-Sharing-One-Physical-Channel");
  fs.mkdirSync(directory, { recursive: true });
  const note = path.join(directory, "access-rules.md");
  assert.equal(markdownFolderTitle(root, note), "1. Sharing One Physical Channel");
  fs.writeFileSync(path.join(directory, "_index.md"), '---\ntitle: "Sharing One Physical Channel"\n---\n');
  assert.equal(markdownFolderTitle(root, note), "Sharing One Physical Channel");
  fs.writeFileSync(path.join(directory, "_index.md"), '---\ntitle: "Folder: Access Rules"\n---\n');
  assert.equal(markdownFolderTitle(root, note), "Access Rules");
});
