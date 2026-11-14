import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as dashboard from "../src/lib/storage/compaction-state.ts";
import * as desktop from "../../desktop/src/shared/storage-compaction.ts";

test("dashboard and desktop share the durable compaction protocol across their build boundaries", () => {
  const source = relative => fs.readFileSync(new URL(relative, import.meta.url), "utf8").replace(/\r\n/g, "\n")
    .replace(/^import .*externalRuntimeFilesystem.*$/m, 'import fs from "node:fs";')
    .replace(/^import .*externalRuntimePath.*$/m, 'import path from "node:path";');
  assert.equal(source("../src/lib/storage/compaction-state.ts").replace(/^\/\/[^\n]*\n/gm, ""),
    source("../../desktop/src/shared/storage-compaction.ts"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-compaction-boundary-"));
  try {
    const request = dashboard.requestStorageCompaction(root);
    assert.deepEqual(desktop.readStorageCompaction(root), request);
    assert.deepEqual(dashboard.requestStorageCompaction(root), request);
    const completed = { ...request, phase: "complete", finishedAt: Date.now(), bytesReleased: 4096 };
    desktop.writeStorageCompaction(root, completed);
    assert.deepEqual(dashboard.readStorageCompaction(root), completed);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
