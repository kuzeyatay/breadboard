import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import esbuild from "esbuild";

import {
  findGeneratedVisualBrowser,
  generatedVisualBrowserScreenshotResultIsAuthoritative,
  validateGeneratedVisualBrowserExecutionScope,
  validateGeneratedVisualBrowserRequest,
} from "../scripts/runtime-v2-generated-visual-browser-executor.mjs";
import {
  runObservedGeneratedVisualBrowserProcess,
} from "../src/lib/generated-visual-browser-process.ts";

const dashboardRoot = path.resolve(import.meta.dirname, "..");

async function loadClientParser() {
  const built = await esbuild.build({
    entryPoints: [path.join(
      dashboardRoot,
      "src/lib/runtime-v2/generated-visual-browser-job.ts",
    )],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "generated-visual-browser-runtime-stubs",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "generated-visual-browser-stub",
        }));
        build.onResolve({ filter: /generated-visuals\.ts$/ }, () => ({
          path: "generated-visuals",
          namespace: "generated-visual-browser-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "generated-visual-browser-stub",
        }));
        build.onResolve({ filter: /runtime-paths\.ts$/ }, () => ({
          path: "runtime-paths",
          namespace: "generated-visual-browser-stub",
        }));
        build.onLoad({
          filter: /.*/,
          namespace: "generated-visual-browser-stub",
        }, (args) => {
          if (args.path === "server-only") return { loader: "js", contents: "export {};" };
          if (args.path === "generated-visuals") {
            return {
              loader: "js",
              contents: "export async function runGeneratedVisualBrowserTests() { throw new Error('not used'); }",
            };
          }
          if (args.path === "runtime-paths") {
            return { loader: "js", contents: "export const repositoryRoot = () => process.cwd();" };
          }
          return {
            loader: "js",
            contents: `
              const unused = async () => { throw new Error("use injected Runtime control"); };
              export const abandonRuntimeJobInput = unused;
              export const cancelRuntimeJob = unused;
              export const inspectRuntimeJob = unused;
              export const readRuntimeJobOutput = unused;
              export const reserveRuntimeJobInput = unused;
              export const submitRuntimeJob = unused;
              export const uploadRuntimeJobInput = unused;
            `,
          };
        });
      },
    }],
  });
  const encoded = Buffer.from(built.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#generated-visual-browser`);
}

const client = await loadClientParser();

function invocationFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-generated-browser-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const htmlPath = path.join(root, "preview-mobile.html");
  const screenshotPath = path.join(root, "preview-mobile.png");
  const profilePath = path.join(root, "profile");
  fs.mkdirSync(profilePath);
  fs.writeFileSync(htmlPath, "<!doctype html><html><body></body></html>");
  return {
    htmlPath,
    screenshotPath,
    profilePath,
    invocation: {
      executable: "runtime-v2-owned-browser",
      slug: "screenshot-mobile-default",
      profilePath,
      timeoutMs: 20_000,
      args: [
        `--user-data-dir=${profilePath}`,
        "--headless=new",
        "--disable-gpu",
        "--disable-gpu-shader-disk-cache",
        "--disable-skia-graphite",
        "--disable-features=SkiaGraphiteUsePersistentCache",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--window-size=375,667",
        "--virtual-time-budget=2500",
        "--dump-dom",
        `--screenshot=${screenshotPath}`,
        new URL(`file:///${htmlPath.replaceAll("\\", "/")}`).href,
      ],
    },
  };
}

test("generated visual browser worker accepts only its sealed garden-scoped operation", () => {
  const request = {
    protocolVersion: 1,
    operation: "render-generated-visual",
    slug: "mobile-default",
    width: 375,
    height: 667,
    reducedMotion: false,
    screenshot: true,
    timeoutMs: 20_000,
  };
  const scope = { userId: 17, gardenId: "garden-one", conversationId: null };
  assert.equal(validateGeneratedVisualBrowserRequest(request), request);
  assert.equal(validateGeneratedVisualBrowserExecutionScope(scope), scope);
  for (const forged of [
    { ...request, executable: "chrome.exe" },
    { ...request, width: 99 },
    { ...request, timeoutMs: 500_000 },
    { ...request, operation: "arbitrary-command" },
  ]) assert.throws(
    () => validateGeneratedVisualBrowserRequest(forged),
    /generated visual browser request/u,
  );
  assert.throws(
    () => validateGeneratedVisualBrowserExecutionScope({ ...scope, conversationId: "forged" }),
    /garden scope/u,
  );
});

test("the dashboard translates only the fixed generated-visual Chromium contract", (t) => {
  const fixture = invocationFixture(t);
  const parsed = client.parseGeneratedVisualBrowserInvocation(fixture.invocation);
  assert.equal(parsed.htmlPath, path.resolve(fixture.htmlPath));
  assert.equal(parsed.screenshotPath, path.resolve(fixture.screenshotPath));
  assert.deepEqual(parsed.request, {
    protocolVersion: 1,
    operation: "render-generated-visual",
    slug: "screenshot-mobile-default",
    width: 375,
    height: 667,
    reducedMotion: false,
    screenshot: true,
    timeoutMs: 20_000,
  });
  for (const mutate of [
    (value) => { value.executable = process.execPath; },
    (value) => { value.args.splice(-1, 0, "--remote-debugging-port=9222"); },
    (value) => { value.args[value.args.length - 1] = "https://example.com"; },
    (value) => {
      const index = value.args.findIndex((arg) => arg.startsWith("--screenshot="));
      value.args[index] = `--screenshot=${path.join(path.dirname(fixture.htmlPath), "..", "outside.png")}`;
    },
  ]) {
    const forged = structuredClone(fixture.invocation);
    mutate(forged);
    assert.throws(
      () => client.parseGeneratedVisualBrowserInvocation(forged),
      /generated visual/u,
    );
  }
});

test("browser discovery accepts a direct trusted file and never executes it", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-generated-browser-bin-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const marker = path.join(root, "executed.txt");
  const browser = path.join(root, "browser.exe");
  fs.writeFileSync(browser, `would write ${marker}`);
  assert.equal(
    findGeneratedVisualBrowser({ BREADBOARD_VISUAL_BROWSER_PATH: browser }, "win32"),
    browser,
  );
  assert.equal(fs.existsSync(marker), false);
});

test("only a coherent successful capture may authorize a screenshot receipt", () => {
  const capture = {
    status: 0,
    signal: null,
    error: null,
    timedOut: false,
    completion: "observed_capture",
    browserExitedNaturally: false,
    cleanupMethod: "taskkill-tree",
    cleanupConfirmed: true,
  };
  assert.equal(generatedVisualBrowserScreenshotResultIsAuthoritative(capture), true);
  assert.equal(generatedVisualBrowserScreenshotResultIsAuthoritative({
    ...capture,
    completion: "process_exit",
    browserExitedNaturally: true,
    cleanupMethod: "natural-exit-lineage",
  }), true);
  assert.equal(generatedVisualBrowserScreenshotResultIsAuthoritative({
    ...capture,
    completion: "process_exit",
    browserExitedNaturally: true,
    cleanupMethod: "process-group",
  }), true);
  for (const forged of [
    { ...capture, status: null, error: { code: "ETIMEDOUT" }, timedOut: true },
    (() => {
      const withoutTimedOut = { ...capture };
      delete withoutTimedOut.timedOut;
      return withoutTimedOut;
    })(),
    (() => {
      const withoutSignal = { ...capture };
      delete withoutSignal.signal;
      return withoutSignal;
    })(),
    { ...capture, cleanupConfirmed: false, cleanupMethod: "process-kill" },
    { ...capture, completion: "observed_dom" },
    { ...capture, signal: "SIGTERM" },
    { ...capture, cleanupMethod: "natural-exit" },
    {
      ...capture,
      completion: "process_exit",
      browserExitedNaturally: true,
      cleanupMethod: "taskkill-tree",
    },
    {
      ...capture,
      completion: "process_exit",
      browserExitedNaturally: true,
      cleanupMethod: "process-group-sigkill",
    },
  ]) assert.equal(
    generatedVisualBrowserScreenshotResultIsAuthoritative(forged),
    false,
  );
});

test("the Runtime result parser accepts only the complete browser receipt vocabulary", () => {
  const job = {
    jobId: "job_generated_browser_parser",
    attempt: 2,
    workerInstanceId: "worker_generated_browser_parser",
    lastWorkerSequence: 7,
  };
  const content = (overrides = {}) => ({
    protocolVersion: 1,
    identity: {
      jobId: job.jobId,
      attempt: job.attempt,
      workerInstanceId: job.workerInstanceId,
    },
    completionSequence: job.lastWorkerSequence,
    result: {
      status: 0,
      signal: null,
      stdout: "",
      stderr: "",
      error: null,
      durationMs: 1,
      timedOut: false,
      completion: "observed_dom",
      browserExitedNaturally: false,
      cleanupMethod: "lineage-quiescence",
      cleanupConfirmed: true,
      screenshot: null,
      ...overrides,
    },
  });
  const screenshot = {
    relativePath: "runtime/jobs/example/screenshot.png",
    sizeBytes: 10,
    sha256: "a".repeat(64),
  };
  const validCompletions = [
    ["observed_dom", {}],
    ["observed_capture", { completion: "observed_capture", screenshot }],
    ["process_exit", {
      completion: "process_exit",
      browserExitedNaturally: true,
      cleanupMethod: "natural-exit-lineage",
    }],
    ["spawn_error", {
      status: null,
      error: { code: "ESPAWN", message: "spawn failed" },
      completion: "spawn_error",
      cleanupMethod: "none",
    }],
    ["deadline", {
      status: null,
      signal: "SIGTERM",
      error: { code: "ETIMEDOUT", message: "deadline" },
      timedOut: true,
      completion: "deadline",
    }],
    ["cancelled", {
      status: null,
      signal: "SIGTERM",
      error: { code: "ECANCELLED", message: "cancelled" },
      completion: "cancelled",
      cleanupMethod: "none",
    }],
    ["output_overflow", {
      status: null,
      signal: "SIGTERM",
      error: { code: "ENOBUFS", message: "overflow" },
      completion: "output_overflow",
    }],
  ];
  for (const [completion, overrides] of validCompletions) {
    assert.equal(
      client.parseGeneratedVisualBrowserRuntimeResult(
        job,
        content(overrides),
      ).result.completion,
      completion,
    );
  }
  const validCleanupMethods = [
    ["none", validCompletions[3][1]],
    ["natural-exit", {
      completion: "process_exit",
      browserExitedNaturally: true,
      cleanupMethod: "natural-exit",
    }],
    ["natural-exit-lineage", validCompletions[2][1]],
    ["natural-exit-unconfirmed", {
      error: { code: "ECLEANUP", message: "unconfirmed" },
      completion: "process_exit",
      browserExitedNaturally: true,
      cleanupMethod: "natural-exit-unconfirmed",
      cleanupConfirmed: false,
    }],
    ["taskkill-tree", { cleanupMethod: "taskkill-tree" }],
    ["lineage-quiescence", {}],
    ["natural-exit-race", {
      status: null,
      error: { code: "ECLEANUP", message: "raced" },
      completion: "observed_dom",
      browserExitedNaturally: false,
      cleanupMethod: "natural-exit-race",
      cleanupConfirmed: false,
    }],
    ["process-group", { cleanupMethod: "process-group" }],
    ["process-group-sigkill", { cleanupMethod: "process-group-sigkill" }],
    ["process-kill", {
      status: null,
      error: { code: "ECLEANUP", message: "unconfirmed" },
      cleanupMethod: "process-kill",
      cleanupConfirmed: false,
    }],
  ];
  for (const [cleanupMethod, overrides] of validCleanupMethods) {
    let parsed;
    assert.doesNotThrow(() => {
      parsed = client.parseGeneratedVisualBrowserRuntimeResult(
        job,
        content(overrides),
      );
    }, cleanupMethod);
    assert.equal(
      parsed.result.cleanupMethod,
      cleanupMethod,
    );
  }
  assert.equal(
    client.parseGeneratedVisualBrowserRuntimeResult(job, content({
      status: 9,
      completion: "process_exit",
      browserExitedNaturally: true,
      cleanupMethod: "natural-exit",
    })).result.status,
    9,
  );
  assert.equal(
    client.parseGeneratedVisualBrowserRuntimeResult(job, content({
      status: null,
      signal: "SIGTERM",
      completion: "process_exit",
      browserExitedNaturally: true,
      cleanupMethod: "natural-exit",
    })).result.signal,
    "SIGTERM",
  );
  assert.equal(
    client.parseGeneratedVisualBrowserRuntimeResult(job, content({
      completion: "process_exit",
      browserExitedNaturally: true,
      cleanupMethod: "process-group",
    })).result.cleanupMethod,
    "process-group",
  );
  for (const forged of [
    { completion: "forged-completion" },
    { cleanupMethod: "forged-cleanup" },
    { cleanupMethod: "process-kill", cleanupConfirmed: false },
    { cleanupMethod: "none" },
    { completion: "process_exit", browserExitedNaturally: false },
    { cleanupMethod: "natural-exit" },
    {
      completion: "process_exit",
      browserExitedNaturally: true,
      cleanupMethod: "taskkill-tree",
    },
    {
      completion: "process_exit",
      browserExitedNaturally: true,
      cleanupMethod: "lineage-quiescence",
    },
    {
      completion: "process_exit",
      browserExitedNaturally: true,
      cleanupMethod: "process-group-sigkill",
    },
    {
      status: 9,
      signal: "SIGTERM",
      completion: "process_exit",
      browserExitedNaturally: true,
      cleanupMethod: "natural-exit",
    },
    {
      status: null,
      signal: null,
      completion: "process_exit",
      browserExitedNaturally: true,
      cleanupMethod: "natural-exit",
    },
    { completion: "observed_capture", screenshot: null },
    {
      status: null,
      signal: "SIGTERM",
      error: { code: "ETIMEDOUT", message: "deadline" },
      timedOut: true,
      completion: "deadline",
      screenshot,
    },
  ]) assert.throws(
    () => client.parseGeneratedVisualBrowserRuntimeResult(job, content(forged)),
    /invalid generated visual browser result/u,
  );
  const missingTimedOut = content();
  delete missingTimedOut.result.timedOut;
  assert.throws(
    () => client.parseGeneratedVisualBrowserRuntimeResult(job, missingTimedOut),
    /unfenced generated visual browser result/u,
  );
  const missingSignal = content();
  delete missingSignal.result.signal;
  assert.throws(
    () => client.parseGeneratedVisualBrowserRuntimeResult(job, missingSignal),
    /unfenced generated visual browser result/u,
  );
});

test("a natural cleanup failure preserves its exit shape through the Runtime parser", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-browser-natural-cleanup-"));
  const script = path.join(root, "exit-zero.mjs");
  fs.writeFileSync(script, "process.exit(0);\n", "utf8");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const observed = await runObservedGeneratedVisualBrowserProcess({
    executable: process.execPath,
    args: [script],
    timeoutMs: 5_000,
    naturalCloseProof: async () => ({
      method: "natural-exit-unconfirmed",
      confirmed: false,
    }),
  });
  assert.equal(observed.status, 0, JSON.stringify(observed));
  assert.equal(observed.signal, null, JSON.stringify(observed));
  assert.equal(observed.error?.code, "ECLEANUP", JSON.stringify(observed));
  assert.equal(observed.completion, "process_exit");
  assert.equal(observed.cleanupMethod, "natural-exit-unconfirmed");
  assert.equal(observed.cleanupConfirmed, false);

  const job = {
    jobId: "job_generated_browser_natural_cleanup",
    attempt: 1,
    workerInstanceId: "worker_generated_browser_natural_cleanup",
    lastWorkerSequence: 3,
  };
  const parsed = client.parseGeneratedVisualBrowserRuntimeResult(job, {
    protocolVersion: 1,
    identity: {
      jobId: job.jobId,
      attempt: job.attempt,
      workerInstanceId: job.workerInstanceId,
    },
    completionSequence: job.lastWorkerSequence,
    result: {
      status: observed.status,
      signal: observed.signal,
      stdout: observed.stdout,
      stderr: observed.stderr,
      error: {
        code: String(observed.error.code),
        message: String(observed.error.message),
      },
      durationMs: observed.durationMs,
      timedOut: observed.timedOut,
      completion: observed.completion,
      browserExitedNaturally: observed.browserExitedNaturally,
      cleanupMethod: observed.cleanupMethod,
      cleanupConfirmed: observed.cleanupConfirmed,
      screenshot: null,
    },
  });
  assert.equal(parsed.result.status, 0);
  assert.equal(parsed.result.cleanupConfirmed, false);
});

test("a synthetic Runtime cancellation never masquerades as browser cleanup proof", async (t) => {
  const fixture = invocationFixture(t);
  const job = {
    jobId: "job_generated_browser_cancelled",
    jobType: "generated-visual-browser",
    workerKind: "generated-visual-browser-node",
    resourceClass: "browser-automation",
    state: "cancelled",
    attempt: 1,
    workerInstanceId: "worker_generated_browser_cancelled",
    gardenId: "garden-one",
    conversationId: null,
    lastWorkerSequence: 2,
    failureMessage: "cancelled by caller",
  };
  const control = {
    async reserve(_authority, request) {
      return { uploadId: "upload_generated_browser_cancelled", ...request };
    },
    async upload(_authority, reservation) {
      return { uploadId: reservation.uploadId };
    },
    async abandon() {},
    async submit() { return job; },
    async inspect() { throw new Error("terminal fixture must not poll"); },
    async readOutput() { throw new Error("cancelled jobs have no result output"); },
    async cancel() { return job; },
  };
  const result = await client.runGeneratedVisualBrowserInvocationViaRuntime({
    userId: 17,
    gardenId: "garden-one",
    invocation: fixture.invocation,
    control,
  });
  assert.equal(result.status, null);
  assert.equal(result.error?.code, "ECANCELLED");
  assert.equal(result.completion, "cancelled");
  assert.equal(result.cleanupMethod, "process-kill");
  assert.equal(result.cleanupConfirmed, false);
});

test("one invocation uploads one HTML blob and accepts only its fenced screenshot", async (t) => {
  const fixture = invocationFixture(t);
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-generated-browser-runtime-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const priorDataRoot = process.env.BREADBOARD_DATA_DIR;
  process.env.BREADBOARD_DATA_DIR = dataRoot;
  t.after(() => {
    if (priorDataRoot === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = priorDataRoot;
  });
  const job = {
    jobId: "job_generated_browser_1",
    jobType: "generated-visual-browser",
    workerKind: "generated-visual-browser-node",
    resourceClass: "browser-automation",
    state: "succeeded",
    attempt: 1,
    workerInstanceId: "worker_generated_browser_1",
    gardenId: "garden-one",
    conversationId: null,
    lastWorkerSequence: 4,
    failureMessage: null,
  };
  const runtimeScreenshot = path.join(
    dataRoot,
    "runtime",
    "jobs",
    job.jobId,
    "attempts",
    "1",
    job.workerInstanceId,
    "workspace",
    "generated-visual-browser-output",
    "screenshot.png",
  );
  const screenshot = Buffer.from("fenced generated visual screenshot");
  fs.mkdirSync(path.dirname(runtimeScreenshot), { recursive: true });
  fs.writeFileSync(runtimeScreenshot, screenshot);
  const relativePath = path.relative(dataRoot, runtimeScreenshot).split(path.sep).join("/");
  const calls = { reserve: [], upload: [], submit: [], output: [], abandon: [], cancel: [] };
  const control = {
    async reserve(authority, request) {
      calls.reserve.push({ authority, request });
      return { uploadId: "upload_generated_browser_1", ...request };
    },
    async upload(authority, reservation, body) {
      calls.upload.push({
        authority,
        reservation,
        bytes: Buffer.from(await new Response(body).arrayBuffer()),
      });
      return { uploadId: reservation.uploadId };
    },
    async abandon(authority, uploadId) { calls.abandon.push({ authority, uploadId }); },
    async submit(authority, submission) {
      calls.submit.push({ authority, submission });
      return job;
    },
    async inspect() { throw new Error("terminal fixture must not poll"); },
    async readOutput(authority, jobId, kind) {
      calls.output.push({ authority, jobId, kind });
      return {
        jobId,
        kind,
        content: {
          protocolVersion: 1,
          identity: {
            jobId: job.jobId,
            attempt: job.attempt,
            workerInstanceId: job.workerInstanceId,
          },
          completionSequence: job.lastWorkerSequence,
          result: {
            status: 0,
            signal: null,
            stdout: '<body data-breadboard-runtime-tests="passed"></body></html>',
            stderr: `${screenshot.byteLength} bytes written to file`,
            error: null,
            durationMs: 10,
            timedOut: false,
            completion: "observed_capture",
            browserExitedNaturally: false,
            cleanupMethod: "taskkill-tree",
            cleanupConfirmed: true,
            screenshot: {
              relativePath,
              sizeBytes: screenshot.byteLength,
              sha256: createHash("sha256").update(screenshot).digest("hex"),
            },
          },
        },
      };
    },
    async cancel(authority, jobId) {
      calls.cancel.push({ authority, jobId });
      return { ...job, state: "cancelled" };
    },
  };
  const result = await client.runGeneratedVisualBrowserInvocationViaRuntime({
    userId: 17,
    gardenId: "garden-one",
    invocation: fixture.invocation,
    control,
  });
  assert.equal(result.status, 0);
  assert.deepEqual(fs.readFileSync(fixture.screenshotPath), screenshot);
  assert.equal(calls.reserve.length, 1);
  assert.equal(calls.upload.length, 1);
  assert.deepEqual(calls.upload[0].bytes, fs.readFileSync(fixture.htmlPath));
  assert.equal(calls.submit.length, 1);
  assert.equal(calls.submit[0].submission.jobType, "generated-visual-browser");
  assert.deepEqual(calls.submit[0].submission.inputUploads, [
    { uploadId: "upload_generated_browser_1" },
  ]);
  assert.doesNotMatch(
    JSON.stringify(calls.submit[0].submission),
    /chrome|edge|executable|argv|user-data-dir|file:\/\//iu,
  );
  assert.deepEqual(calls.abandon, []);
  assert.deepEqual(calls.cancel, []);

  fs.rmSync(fixture.screenshotPath, { force: true });
  const failureControl = {
    ...control,
    async readOutput(authority, jobId, kind) {
      const output = await control.readOutput(authority, jobId, kind);
      output.content.result = {
        ...output.content.result,
        status: null,
        signal: "SIGTERM",
        error: { code: "ETIMEDOUT", message: "partial screenshot deadline" },
        timedOut: true,
        completion: "deadline",
        browserExitedNaturally: false,
      };
      return output;
    },
  };
  await assert.rejects(
    client.runGeneratedVisualBrowserInvocationViaRuntime({
      userId: 17,
      gardenId: "garden-one",
      invocation: fixture.invocation,
      control: failureControl,
    }),
    /invalid generated visual browser result/u,
  );
  assert.equal(fs.existsSync(fixture.screenshotPath), false);
});

test("the regeneration route owns no browser process and submits through Runtime", () => {
  const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
  const route = read("src/app/api/gardens/[gardenId]/visualizations/[visualId]/regenerate/route.ts");
  const clientSource = read("src/lib/runtime-v2/generated-visual-browser-job.ts");
  const worker = read("scripts/runtime-v2-generated-visual-browser-worker.mjs");
  const processOwner = read("src/lib/generated-visual-browser-process.ts");
  assert.match(route, /runGeneratedVisualBrowserTestsViaRuntime/u);
  assert.match(route, /abortSignal:\s*request\.signal/u);
  assert.doesNotMatch(route, /node:child_process|worker_threads|\bspawn(?:Sync)?\s*\(/u);
  assert.doesNotMatch(clientSource, /node:child_process|worker_threads|\bspawn(?:Sync)?\s*\(/u);
  assert.match(clientSource, /jobType:\s*JOB_TYPE/u);
  assert.match(worker, /expectedInputCount:\s*\(\)\s*=>\s*1/u);
  assert.doesNotMatch(processOwner, /node:worker_threads|new Worker\s*\(|Atomics\.wait/u);
});
