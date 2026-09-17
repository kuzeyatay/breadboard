import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const executorUrl = pathToFileURL(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "scripts",
    "runtime-v2-quartz-publish-executor.mjs",
  ),
).href;

/**
 * A stand-in Quartz CLI: for every `--scope` root it emits one page per
 * Markdown file under that root plus a partial content index, and always
 * writes the site-wide static resources a real build regenerates. Site-wide
 * pages (home, tags) appear only in an unscoped build, like the real emitters.
 */
function writeFakeQuartzCli(quartzRoot, buildLog) {
  const cliDir = path.join(quartzRoot, "quartz");
  fs.mkdirSync(cliDir, { recursive: true });
  fs.writeFileSync(
    path.join(quartzRoot, "package.json"),
    '{"private":true,"type":"module"}\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(cliDir, "bootstrap-cli.mjs"),
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      "const argv = process.argv.slice(2);",
      "const option = (name) => argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);",
      'const scope = argv.filter((value) => value.startsWith("--scope=")).map((value) => value.slice(8));',
      'const directory = option("directory");',
      'const output = option("output");',
      `fs.appendFileSync(${JSON.stringify(buildLog)}, JSON.stringify({ scope }) + "\\n");`,
      "fs.mkdirSync(path.join(output, 'static'), { recursive: true });",
      "fs.writeFileSync(path.join(output, 'index.css'), 'css-' + process.pid);",
      "fs.writeFileSync(path.join(output, '404.html'), 'not found');",
      "const roots = scope.length > 0 ? scope : fs.readdirSync(directory);",
      "const index = {};",
      "for (const root of roots) {",
      "  const rootDir = path.join(directory, root);",
      "  if (!fs.existsSync(rootDir)) continue;",
      "  for (const name of fs.readdirSync(rootDir)) {",
      "    if (!name.endsWith('.md')) continue;",
      "    const slug = `${root}/${name.slice(0, -3)}`;",
      "    fs.mkdirSync(path.join(output, root), { recursive: true });",
      "    fs.writeFileSync(path.join(output, root, `${name.slice(0, -3)}.html`), `page ${slug}`);",
      "    index[slug] = { slug, title: slug, content: fs.readFileSync(path.join(rootDir, name), 'utf8') };",
      "  }",
      "}",
      "if (scope.length === 0) {",
      "  fs.mkdirSync(path.join(output, 'tags'), { recursive: true });",
      "  fs.writeFileSync(path.join(output, 'tags', 'index.html'), 'all tags');",
      "  fs.writeFileSync(path.join(output, 'index.html'), 'home');",
      "}",
      "fs.writeFileSync(path.join(output, 'static', 'contentIndex.json'), JSON.stringify(index));",
    ].join("\n"),
    "utf8",
  );
}

let workerSequence = 0;

/** One fresh sealed worker launch directory, as the Runtime lays it out. */
function workerLayout(dataRoot) {
  workerSequence += 1;
  const identity = {
    jobId: `job_quartz_scoped_${workerSequence}`,
    attempt: 1,
    workerInstanceId: `worker_quartz_scoped_${workerSequence}`,
  };
  const relativeAttempt = `runtime/jobs/${identity.jobId}/attempts/${identity.attempt}/${identity.workerInstanceId}`;
  const attemptRoot = path.join(dataRoot, ...relativeAttempt.split("/"));
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  fs.mkdirSync(path.join(dataRoot, "runtime", "jobs", identity.jobId), {
    recursive: true,
  });
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
  return attemptRoot;
}

function writePublisherScript(temporaryRoot, dataRoot) {
  const publisherScript = path.join(temporaryRoot, "publish.mjs");
  fs.writeFileSync(
    publisherScript,
    [
      `import { createSealedRuntimeV2QuartzPublishExecutor } from ${JSON.stringify(executorUrl)};`,
      'import fs from "node:fs";',
      'import path from "node:path";',
      `const dataRoot = ${JSON.stringify(dataRoot)};`,
      "const start = JSON.parse(fs.readFileSync('start.json', 'utf8'));",
      "const execute = createSealedRuntimeV2QuartzPublishExecutor({ identity: start.identity, dataRoot, contentPath: path.join(dataRoot, 'quartz', 'content'), sourceRoot: path.join(dataRoot, 'quartz'), workspacePath: path.join(process.cwd(), 'workspace'), signal: undefined });",
      "const result = await execute({ reasons: ['scoped-test'], concurrency: 1, timeoutMs: 10000, buildEnvironment: {}, scope: JSON.parse(process.env.QUARTZ_TEST_SCOPE) });",
      "process.stdout.write(JSON.stringify(result));",
    ].join("\n"),
    "utf8",
  );
  return publisherScript;
}

function runPublisher(publisherScript, attemptRoot, scope) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [publisherScript, "start.json"], {
      cwd: attemptRoot,
      env: { ...process.env, QUARTZ_TEST_SCOPE: JSON.stringify(scope) },
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
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`publisher exited ${code}: ${stderr || stdout}`));
    });
  });
}

function writeGarden(contentDir, root, pages) {
  fs.mkdirSync(path.join(contentDir, root), { recursive: true });
  for (const [name, body] of Object.entries(pages)) {
    fs.writeFileSync(path.join(contentDir, root, `${name}.md`), body, "utf8");
  }
}

function readIndex(publicDir) {
  return JSON.parse(
    fs.readFileSync(path.join(publicDir, "static", "contentIndex.json"), "utf8"),
  );
}

function lastBuild(buildLog) {
  return JSON.parse(fs.readFileSync(buildLog, "utf8").trim().split(/\r?\n/).at(-1));
}

test(
  "a scoped publication rebuilds one Garden on top of the current site",
  { timeout: 30_000 },
  async () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "breadboard-quartz-scoped-test-"),
    );
    try {
      const dataRoot = path.join(temporaryRoot, "data");
      const quartzRoot = path.join(dataRoot, "quartz");
      const contentDir = path.join(quartzRoot, "content");
      const publicDir = path.join(quartzRoot, "public");
      const buildLog = path.join(temporaryRoot, "builds.jsonl");
      fs.mkdirSync(contentDir, { recursive: true });
      writeFakeQuartzCli(quartzRoot, buildLog);
      writeGarden(contentDir, "math-1", { vectors: "v1", matrices: "m1" });
      writeGarden(contentDir, "telecom-1", { ofdm: "o1" });
      writeGarden(contentDir, "old-garden", { relic: "r1" });
      const publisherScript = writePublisherScript(temporaryRoot, dataRoot);

      // A scope request with no previous publication builds the whole site.
      await runPublisher(publisherScript, workerLayout(dataRoot), ["math-1"]);
      assert.deepEqual(lastBuild(buildLog), { scope: [] });
      assert.equal(fs.readFileSync(path.join(publicDir, "index.html"), "utf8"), "home");
      const firstCss = fs.readFileSync(path.join(publicDir, "index.css"), "utf8");
      assert.deepEqual(Object.keys(readIndex(publicDir)).sort(), [
        "math-1/matrices",
        "math-1/vectors",
        "old-garden/relic",
        "telecom-1/ofdm",
      ]);

      // Change math-1, delete old-garden, and publish only those roots.
      fs.writeFileSync(path.join(contentDir, "math-1", "vectors.md"), "v2", "utf8");
      fs.rmSync(path.join(contentDir, "math-1", "matrices.md"));
      fs.writeFileSync(path.join(contentDir, "math-1", "spans.md"), "s1", "utf8");
      fs.rmSync(path.join(contentDir, "old-garden"), { recursive: true });
      const scoped = await runPublisher(publisherScript, workerLayout(dataRoot), [
        "math-1",
        "old-garden",
      ]);
      assert.deepEqual(lastBuild(buildLog), { scope: ["math-1", "old-garden"] });
      assert.match(scoped.stdout, /Scoped publication of math-1, old-garden carried over/u);
      const result = JSON.parse(scoped.stdout.slice(scoped.stdout.lastIndexOf("{")));
      assert.equal(result.published, true);
      assert.equal(result.reasonCount, 1);

      // Scoped roots reflect the new build, including removals.
      assert.equal(
        fs.readFileSync(path.join(publicDir, "math-1", "vectors.html"), "utf8"),
        "page math-1/vectors",
      );
      assert.equal(fs.existsSync(path.join(publicDir, "math-1", "matrices.html")), false);
      assert.equal(fs.existsSync(path.join(publicDir, "math-1", "spans.html")), true);
      assert.equal(fs.existsSync(path.join(publicDir, "old-garden")), false);
      // Everything outside the scope is carried over from the previous site.
      assert.equal(
        fs.readFileSync(path.join(publicDir, "telecom-1", "ofdm.html"), "utf8"),
        "page telecom-1/ofdm",
      );
      assert.equal(fs.readFileSync(path.join(publicDir, "index.html"), "utf8"), "home");
      assert.equal(
        fs.readFileSync(path.join(publicDir, "tags", "index.html"), "utf8"),
        "all tags",
      );
      // Site-wide resources the build regenerates come from the new build.
      assert.notEqual(fs.readFileSync(path.join(publicDir, "index.css"), "utf8"), firstCss);
      // The content index is spliced: new scoped entries, old entries elsewhere.
      const index = readIndex(publicDir);
      assert.deepEqual(Object.keys(index).sort(), [
        "math-1/spans",
        "math-1/vectors",
        "telecom-1/ofdm",
      ]);
      assert.equal(index["math-1/vectors"].content, "v2");
      assert.equal(index["telecom-1/ofdm"].content, "o1");
      // The transaction finished cleanly.
      assert.deepEqual(
        fs.readdirSync(quartzRoot).filter((name) => name.startsWith(".breadboard-quartz")),
        [],
      );
      assert.equal(
        fs.existsSync(path.join(publicDir, ".breadboard-quartz-build-complete.json")),
        false,
      );
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  },
);

test("a scoped publication rejects unsafe roots", { timeout: 30_000 }, async () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-quartz-scoped-invalid-"),
  );
  try {
    const dataRoot = path.join(temporaryRoot, "data");
    const quartzRoot = path.join(dataRoot, "quartz");
    fs.mkdirSync(path.join(quartzRoot, "content"), { recursive: true });
    writeFakeQuartzCli(quartzRoot, path.join(temporaryRoot, "builds.jsonl"));
    const publisherScript = writePublisherScript(temporaryRoot, dataRoot);
    for (const scope of [["../public"], [".hidden"], [""], ["a//b"], "math-1"]) {
      await assert.rejects(
        runPublisher(publisherScript, workerLayout(dataRoot), scope),
        /Quartz publication scope is invalid/u,
      );
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
