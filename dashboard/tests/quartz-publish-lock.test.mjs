import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const executorUrl = pathToFileURL(
  path.join(
    dashboardRoot,
    "scripts",
    "runtime-v2-quartz-publish-executor.mjs",
  ),
).href;

function workerLayout(dataRoot, identity) {
  const jobRoot = path.join(dataRoot, "runtime", "jobs", identity.jobId);
  const relativeAttempt = `runtime/jobs/${identity.jobId}/attempts/${identity.attempt}/${identity.workerInstanceId}`;
  const attemptRoot = path.join(dataRoot, ...relativeAttempt.split("/"));
  const workspacePath = path.join(attemptRoot, "workspace");
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.mkdirSync(jobRoot, { recursive: true });
  fs.writeFileSync(
    path.join(attemptRoot, "start.json"),
    `${JSON.stringify({
      protocolVersion: 1,
      identity,
      executionScope: { userId: 7, gardenId: null, conversationId: null },
      inputManifestPath: `runtime/jobs/${identity.jobId}/input.json`,
      inputBlobs: [],
      workspacePath: `${relativeAttempt}/workspace`,
      checkpointPath: `runtime/jobs/${identity.jobId}/checkpoint.json`,
      resultPath: `runtime/jobs/${identity.jobId}/result.json`,
    })}\n`,
    "utf8",
  );
  return { attemptRoot, workspacePath };
}

function runPublisher(scriptPath, attemptRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, "start.json"], {
      cwd: attemptRoot,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`publisher exited ${code}: ${stderr || stdout}`));
    });
  });
}

function createQuartzFixture(temporaryRoot) {
  const dataRoot = path.join(temporaryRoot, "data");
  const quartzRoot = path.join(dataRoot, "quartz");
  const quartzCliDir = path.join(quartzRoot, "quartz");
  const contentDir = path.join(quartzRoot, "content");
  const buildLog = path.join(quartzRoot, "builds.jsonl");
  fs.mkdirSync(quartzCliDir, { recursive: true });
  fs.mkdirSync(contentDir, { recursive: true });
  fs.mkdirSync(path.join(quartzRoot, "public"), { recursive: true });
  fs.writeFileSync(path.join(quartzRoot, "public", "old.html"), "old", "utf8");
  fs.writeFileSync(
    path.join(quartzRoot, "package.json"),
    '{"private":true,"type":"module"}\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(quartzCliDir, "bootstrap-cli.mjs"),
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      `const log = ${JSON.stringify(buildLog)};`,
      'const output = process.argv.find((value) => value.startsWith("--output="))?.slice(9);',
      'if (!output) throw new Error("missing output");',
      'fs.appendFileSync(log, JSON.stringify({ event: "start", pid: process.pid }) + "\\n");',
      "await new Promise((resolve) => setTimeout(resolve, 180));",
      'fs.mkdirSync(output, { recursive: true });',
      'fs.writeFileSync(path.join(output, `build-${process.pid}.html`), "built");',
      'fs.appendFileSync(log, JSON.stringify({ event: "end", pid: process.pid }) + "\\n");',
    ].join("\n"),
    "utf8",
  );
  return { dataRoot, quartzRoot, contentDir, buildLog };
}

test(
  "sealed Runtime V2 Quartz publication serializes independent fresh workers",
  { timeout: 20_000 },
  async () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "breadboard-quartz-lock-test-"),
    );
    try {
      const fixture = createQuartzFixture(temporaryRoot);
      const publisherScript = path.join(temporaryRoot, "publish.mjs");
      fs.writeFileSync(
        publisherScript,
        [
          `import { createSealedRuntimeV2QuartzPublishExecutor } from ${JSON.stringify(executorUrl)};`,
          'import path from "node:path";',
          `const dataRoot = ${JSON.stringify(fixture.dataRoot)};`,
          "const start = JSON.parse(await import('node:fs').then(({ readFileSync }) => readFileSync('start.json', 'utf8')));",
          "const workspacePath = path.join(process.cwd(), 'workspace');",
          "const execute = createSealedRuntimeV2QuartzPublishExecutor({ identity: start.identity, dataRoot, contentPath: `${dataRoot}/quartz/content`, sourceRoot: `${dataRoot}/quartz`, workspacePath, signal: undefined });",
          "await execute({ reasons: [`lock-test-${process.pid}`], concurrency: 1, timeoutMs: 10000, buildEnvironment: {} });",
        ].join("\n"),
        "utf8",
      );
      const first = workerLayout(fixture.dataRoot, {
        jobId: "job_quartz_one",
        attempt: 1,
        workerInstanceId: "worker_quartz_one",
      });
      const second = workerLayout(fixture.dataRoot, {
        jobId: "job_quartz_two",
        attempt: 1,
        workerInstanceId: "worker_quartz_two",
      });

      await Promise.all([
        runPublisher(publisherScript, first.attemptRoot),
        runPublisher(publisherScript, second.attemptRoot),
      ]);

      const records = fs
        .readFileSync(fixture.buildLog, "utf8")
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      assert.equal(records.length, 4);
      let activeBuilds = 0;
      let maximumActiveBuilds = 0;
      for (const record of records) {
        activeBuilds += record.event === "start" ? 1 : -1;
        maximumActiveBuilds = Math.max(maximumActiveBuilds, activeBuilds);
        assert.ok(activeBuilds >= 0);
      }
      assert.equal(activeBuilds, 0);
      assert.equal(maximumActiveBuilds, 1);
      assert.equal(
        fs.existsSync(path.join(fixture.quartzRoot, ".breadboard-quartz-publish.lock")),
        false,
      );
      assert.equal(
        fs.existsSync(
          path.join(fixture.quartzRoot, ".breadboard-quartz-publish.transaction.json"),
        ),
        false,
      );
      assert.equal(
        fs.existsSync(
          path.join(fixture.quartzRoot, "public", ".breadboard-quartz-build-complete.json"),
        ),
        false,
      );
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  },
);

test("publication recovery promotes only a complete fenced stage", async () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-quartz-recovery-test-"),
  );
  try {
    const fixture = createQuartzFixture(temporaryRoot);
    const transaction = {
      version: 1,
      jobId: "job_quartz_recovery",
      attempt: 1,
      workerInstanceId: "worker_quartz_recovery",
      stageName:
        ".breadboard-quartz-publish.stage-job_quartz_recovery-1-worker_quartz_recovery",
      previousName:
        ".breadboard-quartz-publish.previous-job_quartz_recovery-1-worker_quartz_recovery",
      state: "previous-moved",
    };
    const stage = path.join(fixture.quartzRoot, transaction.stageName);
    const previous = path.join(fixture.quartzRoot, transaction.previousName);
    fs.mkdirSync(stage);
    fs.writeFileSync(path.join(stage, "new.html"), "new", "utf8");
    fs.writeFileSync(
      path.join(stage, ".breadboard-quartz-build-complete.json"),
      `${JSON.stringify({
        version: 1,
        jobId: transaction.jobId,
        attempt: transaction.attempt,
        workerInstanceId: transaction.workerInstanceId,
      })}\n`,
      "utf8",
    );
    fs.renameSync(path.join(fixture.quartzRoot, "public"), previous);
    fs.writeFileSync(
      path.join(fixture.quartzRoot, ".breadboard-quartz-publish.transaction.json"),
      `${JSON.stringify(transaction)}\n`,
      "utf8",
    );
    const { recoverQuartzPublicationTransaction } = await import(executorUrl);
    const recovered = await recoverQuartzPublicationTransaction(fixture.quartzRoot);
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.outcome, "published-prepared-stage");
    assert.equal(fs.readFileSync(path.join(fixture.quartzRoot, "public", "new.html"), "utf8"), "new");
    assert.equal(fs.existsSync(previous), false);
    assert.equal(
      fs.existsSync(path.join(fixture.quartzRoot, ".breadboard-quartz-publish.transaction.json")),
      false,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("publication recovery discards an interrupted first-build stage", async () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-quartz-first-recovery-test-"),
  );
  try {
    const fixture = createQuartzFixture(temporaryRoot);
    fs.rmSync(path.join(fixture.quartzRoot, "public"), {
      recursive: true,
      force: true,
    });
    const transaction = {
      version: 1,
      jobId: "job_quartz_interrupted_first",
      attempt: 1,
      workerInstanceId: "worker_quartz_interrupted_first",
      stageName:
        ".breadboard-quartz-publish.stage-job_quartz_interrupted_first-1-worker_quartz_interrupted_first",
      previousName:
        ".breadboard-quartz-publish.previous-job_quartz_interrupted_first-1-worker_quartz_interrupted_first",
      state: "building",
    };
    const stage = path.join(fixture.quartzRoot, transaction.stageName);
    fs.mkdirSync(stage);
    fs.writeFileSync(path.join(stage, "partial.html"), "partial", "utf8");
    fs.writeFileSync(
      path.join(fixture.quartzRoot, ".breadboard-quartz-publish.transaction.json"),
      `${JSON.stringify(transaction)}\n`,
      "utf8",
    );
    const { recoverQuartzPublicationTransaction } = await import(executorUrl);
    assert.deepEqual(await recoverQuartzPublicationTransaction(fixture.quartzRoot), {
      recovered: true,
      outcome: "discarded-incomplete-stage",
    });
    assert.equal(fs.existsSync(stage), false);
    assert.equal(
      fs.existsSync(
        path.join(
          fixture.quartzRoot,
          ".breadboard-quartz-publish.transaction.json",
        ),
      ),
      false,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("publication recovery retries a transient Windows public-tree rename without rebuilding", async () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-quartz-rename-recovery-test-"),
  );
  const originalRenameSync = fs.renameSync;
  try {
    const fixture = createQuartzFixture(temporaryRoot);
    const transaction = {
      version: 1,
      jobId: "job_quartz_rename_recovery",
      attempt: 1,
      workerInstanceId: "worker_quartz_rename_recovery",
      stageName:
        ".breadboard-quartz-publish.stage-job_quartz_rename_recovery-1-worker_quartz_rename_recovery",
      previousName:
        ".breadboard-quartz-publish.previous-job_quartz_rename_recovery-1-worker_quartz_rename_recovery",
      state: "prepared",
    };
    const publicPath = path.join(fixture.quartzRoot, "public");
    const stagePath = path.join(fixture.quartzRoot, transaction.stageName);
    const previousPath = path.join(fixture.quartzRoot, transaction.previousName);
    fs.mkdirSync(stagePath);
    fs.writeFileSync(path.join(stagePath, "new.html"), "new", "utf8");
    fs.writeFileSync(
      path.join(stagePath, ".breadboard-quartz-build-complete.json"),
      `${JSON.stringify({
        version: 1,
        jobId: transaction.jobId,
        attempt: transaction.attempt,
        workerInstanceId: transaction.workerInstanceId,
      })}\n`,
      "utf8",
    );
    const journalPath = path.join(
      fixture.quartzRoot,
      ".breadboard-quartz-publish.transaction.json",
    );
    fs.writeFileSync(journalPath, `${JSON.stringify(transaction)}\n`, "utf8");

    let transientFailures = 0;
    fs.renameSync = (source, target) => {
      if (source === publicPath && target === previousPath && transientFailures < 2) {
        transientFailures += 1;
        throw Object.assign(new Error("EPERM: simulated open static-file handle"), {
          code: "EPERM",
        });
      }
      return originalRenameSync(source, target);
    };

    const { recoverQuartzPublicationTransaction } = await import(executorUrl);
    assert.deepEqual(
      await recoverQuartzPublicationTransaction(fixture.quartzRoot),
      { recovered: true, outcome: "published-prepared-stage" },
    );
    assert.equal(transientFailures, 2);
    assert.equal(fs.readFileSync(path.join(publicPath, "new.html"), "utf8"), "new");
    assert.equal(fs.existsSync(stagePath), false);
    assert.equal(fs.existsSync(previousPath), false);
    assert.equal(fs.existsSync(journalPath), false);
  } finally {
    fs.renameSync = originalRenameSync;
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test(
  "publication recovery completes in place when Windows keeps the public root locked",
  { timeout: 20_000 },
  async () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "breadboard-quartz-in-place-recovery-test-"),
    );
    const originalRenameSync = fs.renameSync;
    try {
      const fixture = createQuartzFixture(temporaryRoot);
      const transaction = {
        version: 1,
        jobId: "job_quartz_in_place_recovery",
        attempt: 1,
        workerInstanceId: "worker_quartz_in_place_recovery",
        stageName:
          ".breadboard-quartz-publish.stage-job_quartz_in_place_recovery-1-worker_quartz_in_place_recovery",
        previousName:
          ".breadboard-quartz-publish.previous-job_quartz_in_place_recovery-1-worker_quartz_in_place_recovery",
        state: "prepared",
      };
      const publicPath = path.join(fixture.quartzRoot, "public");
      const stagePath = path.join(fixture.quartzRoot, transaction.stageName);
      const previousPath = path.join(fixture.quartzRoot, transaction.previousName);
      fs.mkdirSync(stagePath);
      fs.writeFileSync(path.join(stagePath, "new.html"), "new", "utf8");
      fs.writeFileSync(
        path.join(stagePath, ".breadboard-quartz-build-complete.json"),
        `${JSON.stringify({
          version: 1,
          jobId: transaction.jobId,
          attempt: transaction.attempt,
          workerInstanceId: transaction.workerInstanceId,
        })}\n`,
        "utf8",
      );
      const journalPath = path.join(
        fixture.quartzRoot,
        ".breadboard-quartz-publish.transaction.json",
      );
      fs.writeFileSync(journalPath, `${JSON.stringify(transaction)}\n`, "utf8");

      let lockedRootAttempts = 0;
      fs.renameSync = (source, target) => {
        if (source === publicPath && target === previousPath) {
          lockedRootAttempts += 1;
          throw Object.assign(new Error("EPERM: simulated persistent public-root handle"), {
            code: "EPERM",
          });
        }
        return originalRenameSync(source, target);
      };

      const { recoverQuartzPublicationTransaction } = await import(executorUrl);
      assert.deepEqual(
        await recoverQuartzPublicationTransaction(fixture.quartzRoot),
        { recovered: true, outcome: "published-prepared-stage" },
      );
      assert.equal(lockedRootAttempts, 12);
      assert.equal(fs.readFileSync(path.join(publicPath, "new.html"), "utf8"), "new");
      assert.equal(fs.existsSync(path.join(publicPath, "old.html")), false);
      assert.equal(fs.existsSync(stagePath), false);
      assert.equal(fs.existsSync(previousPath), false);
      assert.equal(fs.existsSync(journalPath), false);
    } finally {
      fs.renameSync = originalRenameSync;
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  },
);

test("sealed worker cancellation never promotes a partial Quartz build", async () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-quartz-cancel-test-"),
  );
  try {
    const fixture = createQuartzFixture(temporaryRoot);
    const identity = {
      jobId: "job_quartz_cancel",
      attempt: 1,
      workerInstanceId: "worker_quartz_cancel",
    };
    const layout = workerLayout(fixture.dataRoot, identity);
    const publisherScript = path.join(temporaryRoot, "cancel.mjs");
    fs.writeFileSync(
      publisherScript,
      [
        `import { createSealedRuntimeV2QuartzPublishExecutor } from ${JSON.stringify(executorUrl)};`,
        'import path from "node:path";',
        `const dataRoot = ${JSON.stringify(fixture.dataRoot)};`,
        `const identity = ${JSON.stringify(identity)};`,
        "const controller = new AbortController();",
        "const execute = createSealedRuntimeV2QuartzPublishExecutor({ identity, dataRoot, contentPath: path.join(dataRoot, 'quartz', 'content'), sourceRoot: path.join(dataRoot, 'quartz'), workspacePath: path.join(process.cwd(), 'workspace'), signal: controller.signal });",
        "setTimeout(() => controller.abort(new Error('cancel-test')), 50);",
        "await assertRejects(execute({ reasons: ['cancel-test'], concurrency: 1, timeoutMs: 10000, buildEnvironment: {} }));",
        "async function assertRejects(promise) { try { await promise; throw new Error('publication unexpectedly succeeded'); } catch (error) { if (error?.message === 'publication unexpectedly succeeded') throw error; } }",
      ].join("\n"),
      "utf8",
    );
    await runPublisher(publisherScript, layout.attemptRoot);
    assert.equal(
      fs.readFileSync(path.join(fixture.quartzRoot, "public", "old.html"), "utf8"),
      "old",
    );
    assert.equal(
      fs.existsSync(path.join(fixture.quartzRoot, ".breadboard-quartz-publish.transaction.json")),
      false,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
