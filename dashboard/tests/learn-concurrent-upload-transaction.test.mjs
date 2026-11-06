import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(dashboardRoot, "src");
process.env.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot;
const hookUrl = pathToFileURL(path.join(dashboardRoot, "scripts", "learn-worker-import-hook.mjs"));
const knowledgeUrl = pathToFileURL(path.join(sourceRoot, "lib", "knowledge.ts"));
await import(hookUrl.href);
const { createKnowledgeWriteTransaction, recoverKnowledgeWriteTransactions } = await import(knowledgeUrl.href);
const { acquireGardenLearnLease, acquireGardenContentLease } = await import(
  pathToFileURL(path.join(sourceRoot, "lib", "learn-atomic-promotion.ts")).href
);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "learn-upload-tx-"));
  const contentPath = path.join(root, "content");
  const clusterDir = path.join(contentPath, "physics");
  fs.mkdirSync(path.join(clusterDir, "sources"), { recursive: true });
  fs.writeFileSync(path.join(clusterDir, "sources", "paper.md"), "paper\n");
  const registryRoot = path.join(root, "registry");
  const runtimeJobsRoot = path.join(root, "runtime", "jobs");
  const leases = [];
  t.after(() => { leases.forEach((lease) => lease.release()); fs.rmSync(root, { recursive: true, force: true }); });
  const learn = acquireGardenLearnLease(clusterDir, { gardenSlug: "physics", jobId: "learn_job_1", buildId: "generation:learn_job_1" }, { scope: "learn-output" });
  assert.equal(learn.acquired, true);
  leases.push(learn.lease);
  return { root, contentPath, clusterDir, registryRoot, runtimeJobsRoot, learnLease: learn.lease };
}
const options = (f, id) => ({
  registryRoot: f.registryRoot,
  transactionId: id,
  resultPath: path.join(f.runtimeJobsRoot, id, "result.json"),
  retainCommittedJournal: true,
});

test("an upload transaction commits into the live garden while Learn builds", (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.runtimeJobsRoot, "job_up"), { recursive: true });
  const transaction = createKnowledgeWriteTransaction(f.contentPath, "physics", options(f, "job_up"));
  const note = path.join(f.clusterDir, "sources", "lab.md");
  transaction.captureFile(note);
  fs.writeFileSync(note, "lab slides\n");
  const result = Buffer.from("{}");
  transaction.prepareResult(createHash("sha256").update(result).digest("hex"));
  fs.writeFileSync(options(f, "job_up").resultPath, result);
  transaction.commit();
  transaction.seal();
  assert.equal(fs.readFileSync(note, "utf8"), "lab slides\n");
  assert.equal(f.learnLease.heartbeat(), true, "Learn kept its lease throughout");
  assert.equal(acquireGardenContentLease(f.clusterDir, { learnLease: f.learnLease }).acquired, true, "Learn may publish once the upload is done");
});

test("a crashed upload beside Learn is rolled back by its journal before Learn can publish", (t) => {
  const f = fixture(t);
  const id = "job_crashed";
  const note = path.join(f.clusterDir, "sources", "half.md");
  const script = `
    import fs from "node:fs";
    await import(${JSON.stringify(hookUrl.href)});
    const { createKnowledgeWriteTransaction } = await import(${JSON.stringify(knowledgeUrl.href)});
    fs.mkdirSync(${JSON.stringify(path.join(f.runtimeJobsRoot, id))}, { recursive: true });
    const transaction = createKnowledgeWriteTransaction(${JSON.stringify(f.contentPath)}, "physics", ${JSON.stringify(options(f, id))});
    transaction.captureFile(${JSON.stringify(note)});
    fs.writeFileSync(${JSON.stringify(note)}, "half written\\n");
    process.exit(0);
  `;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", script], {
    cwd: path.resolve(dashboardRoot, ".."),
    encoding: "utf8",
    env: { ...process.env, BREADBOARD_LEARN_SOURCE_ROOT: sourceRoot, QUARTZ_AUTO_PUBLISH: "0" },
    timeout: 30_000,
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.equal(fs.existsSync(note), true);
  assert.equal(
    acquireGardenContentLease(f.clusterDir, { learnLease: f.learnLease }).acquired,
    false,
    "Learn must not publish over a half-written upload",
  );
  recoverKnowledgeWriteTransactions(f.contentPath, "physics", f.registryRoot, f.runtimeJobsRoot);
  assert.equal(fs.existsSync(note), false, "the journal removed the half-written file");
  const publish = acquireGardenContentLease(f.clusterDir, { learnLease: f.learnLease });
  assert.equal(publish.acquired, true);
  publish.lease.release();
  assert.equal(f.learnLease.heartbeat(), true);
});
