import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createKnowledgeWriteTransaction,
  hashKnowledgeFile,
} from "../src/lib/knowledge-write-transaction.ts";
import {
  acquireGardenLearnLease,
  readGardenLearnLock,
} from "../src/lib/learn-atomic-promotion.ts";

function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-windows-path-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const contentPath = path.join(root, "content");
  const garden = path.join(contentPath, "garden");
  const resultPath = path.join(root, "jobs", "import", "result.json");
  fs.mkdirSync(garden, { recursive: true });
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  return { root, contentPath, garden, resultPath };
}

for (const outcome of ["rollback", "commit"]) {
  test(`Windows namespace paths support knowledge ${outcome}`, { skip: process.platform !== "win32" }, (t) => {
    const f = fixture(t);
    const target = path.join(f.garden, "source.md");
    fs.writeFileSync(target, "original\n");
    const transaction = createKnowledgeWriteTransaction(path.toNamespacedPath(f.contentPath), "garden", {
      registryRoot: path.toNamespacedPath(path.join(f.root, "registry")),
      transactionId: "import",
      resultPath: path.toNamespacedPath(f.resultPath),
    });
    transaction.captureFile(path.toNamespacedPath(target));
    assert.deepEqual(hashKnowledgeFile(path.toNamespacedPath(target)), hashKnowledgeFile(target));
    fs.writeFileSync(target, "imported\n");
    if (outcome === "rollback") {
      transaction.rollback();
      assert.equal(fs.readFileSync(target, "utf8"), "original\n");
    } else {
      const bytes = Buffer.from('{"success":true}\n');
      transaction.prepareResult(createHash("sha256").update(bytes).digest("hex"));
      fs.writeFileSync(f.resultPath, bytes);
      transaction.commit();
      assert.deepEqual(transaction.readCommittedResult(), bytes);
      transaction.finalize();
      assert.equal(fs.readFileSync(target, "utf8"), "imported\n");
    }
  });
}

test("a namespace path cannot replace an active Learn lease", { skip: process.platform !== "win32" }, (t) => {
  const f = fixture(t);
  const learn = acquireGardenLearnLease(f.garden, {
    gardenSlug: "garden", jobId: "learn-active", buildId: "learn-build",
  });
  assert.equal(learn.acquired, true);
  try {
    assert.throws(() => createKnowledgeWriteTransaction(path.toNamespacedPath(f.contentPath), "garden", {
      registryRoot: path.join(f.root, "registry"),
      transactionId: "import",
      resultPath: f.resultPath,
    }), error => error?.code === "GARDEN_MUTATION_BUSY");
    assert.equal(readGardenLearnLock(f.garden)?.leaseId, learn.lease.lock.leaseId);
    assert.equal(learn.lease.confirmOwnership(), "owned");
  } finally {
    learn.lease.release();
  }
});

test("namespace comparison still rejects an indirect garden ancestor", (t) => {
  const f = fixture(t);
  const alias = path.join(f.root, "alias");
  fs.symlinkSync(f.contentPath, alias, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => createKnowledgeWriteTransaction(path.toNamespacedPath(alias), "garden", {
    registryRoot: path.join(f.root, "registry"),
    transactionId: "import",
    resultPath: f.resultPath,
  }), /contains an indirect path/);
  assert.equal(fs.existsSync(path.join(f.root, "registry")), false);
});
