import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const stateKey = "__breadboardRuntimeV2QuartzCutoverTestState";
const buildEnvironmentNames = [
  "BREADBOARD_DASHBOARD_URL",
  "CI",
  "DASHBOARD_URL",
  "NEXT_PUBLIC_DASHBOARD_URL",
  "NEXT_PUBLIC_PENECHO_URL",
  "NEXT_PUBLIC_QUARTZ_URL",
  "PENECHO_URL",
  "QUARTZ_BASE_URL",
  "QUARTZ_CUSTOM_OG_IMAGES",
  "SECOND_BRAIN_ASSET_VERSION",
  "SHOW_LEGACY_SUBTOPIC_PAGES",
  "TERM",
];

function jobSnapshot(state = "succeeded") {
  return {
    jobId: "job_" + "1".repeat(64),
    jobType: "quartz-publish",
    workerKind: "quartz-publish-node",
    resourceClass: "large-generation",
    state,
    stage: state === "succeeded" ? "complete" : null,
    attempt: 1,
    workerInstanceId: "worker_quartz_1",
    gardenId: null,
    conversationId: null,
    createdAt: 1,
    startedAt: 2,
    updatedAt: 3,
    finishedAt: 3,
    lastHeartbeatAt: 2,
    lastWorkerSequence: 4,
    progressCurrent: state === "succeeded" ? 3 : 0,
    progressTotal: 3,
    failureCode: state === "failed" ? "WORKER_FAILED" : null,
    failureMessage: state === "failed" ? "Quartz publication failed." : null,
    resourceExhaustion: null,
    cancellationRequested: false,
  };
}

async function loadQuartzCompatibilityModule() {
  const result = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "quartz-publish.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [
      {
        name: "runtime-v2-quartz-cutover-stub",
        setup(build) {
          build.onResolve({ filter: /^server-only$/ }, () => ({
            path: "server-only",
            namespace: "quartz-cutover-stub",
          }));
          build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
            path: "supervisor-control",
            namespace: "quartz-cutover-stub",
          }));
          build.onLoad(
            { filter: /.*/, namespace: "quartz-cutover-stub" },
            (args) =>
              args.path === "server-only"
                ? { loader: "js", contents: "" }
                : ({
                    loader: "js",
                    contents: `
                const state = () => globalThis[${JSON.stringify(stateKey)}];
                export async function submitRuntimeJob(authority, submission) {
                  state().submissions.push({
                    authority: structuredClone(authority),
                    submission: structuredClone(submission),
                  });
                  return structuredClone(state().job);
                }
                export async function inspectRuntimeJob(authority, jobId) {
                  if (!state().inspectJob) {
                    throw new Error("terminal fixture must not poll");
                  }
                  return structuredClone(await state().inspectJob(authority, jobId));
                }
                export async function readRuntimeJobOutput(authority, jobId, outputKind) {
                  state().outputs.push({
                    authority: structuredClone(authority),
                    jobId,
                    outputKind,
                  });
                  return { content: structuredClone(state().result) };
                }
              `,
                  }),
          );
        },
      },
    ],
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#quartz-runtime-v2-cutover`);
}

const quartz = await loadQuartzCompatibilityModule();

function freshState(job = jobSnapshot()) {
  const state = {
    job,
    submissions: [],
    outputs: [],
    inspectJob: null,
    result: {
      protocolVersion: 1,
      identity: {
        jobId: job.jobId,
        attempt: job.attempt,
        workerInstanceId: job.workerInstanceId,
      },
      completionSequence: job.lastWorkerSequence,
      result: { published: true, durationMs: 37, reasonCount: 1 },
    },
  };
  globalThis[stateKey] = state;
  return state;
}

test("Quartz keeps mutation-call parity while submitting exact user-global authority", async () => {
  const previous = {
    autoPublish: process.env.QUARTZ_AUTO_PUBLISH,
    publishMode: process.env.QUARTZ_PUBLISH_MODE,
    concurrency: process.env.QUARTZ_BUILD_CONCURRENCY,
    timeout: process.env.QUARTZ_BUILD_TIMEOUT_MS,
    buildEnvironment: new Map(
      buildEnvironmentNames.map((name) => [name, process.env[name]]),
    ),
  };
  for (const name of buildEnvironmentNames) delete process.env[name];
  process.env.QUARTZ_AUTO_PUBLISH = "1";
  process.env.QUARTZ_PUBLISH_MODE = "await";
  process.env.QUARTZ_BUILD_CONCURRENCY = "3";
  process.env.QUARTZ_BUILD_TIMEOUT_MS = "12000";
  try {
    const state = freshState();
    const result = await quartz.publishQuartzAfterMutation(
      "update authenticated garden",
      { userId: 91, requireSuccess: true },
    );
    assert.equal(result, undefined);
    assert.equal(state.submissions.length, 1);
    assert.deepEqual(state.submissions[0].authority, {
      userId: 91,
      gardenId: null,
      conversationId: null,
    });
    const submission = state.submissions[0].submission;
    assert.equal(submission.jobType, "quartz-publish");
    assert.match(submission.idempotencyKey, /^quartz-publish-[0-9a-f-]+$/u);
    assert.deepEqual(submission.requestPayload, {
      operation: "publish",
      reasons: ["update authenticated garden"],
      concurrency: 3,
      timeoutMs: 12_000,
      buildEnvironment: {},
    });
    assert.deepEqual(state.outputs, [
      {
        authority: { userId: 91, gardenId: null, conversationId: null },
        jobId: state.job.jobId,
        outputKind: "result",
      },
    ]);
  } finally {
    if (previous.autoPublish === undefined) delete process.env.QUARTZ_AUTO_PUBLISH;
    else process.env.QUARTZ_AUTO_PUBLISH = previous.autoPublish;
    if (previous.publishMode === undefined) delete process.env.QUARTZ_PUBLISH_MODE;
    else process.env.QUARTZ_PUBLISH_MODE = previous.publishMode;
    if (previous.concurrency === undefined) delete process.env.QUARTZ_BUILD_CONCURRENCY;
    else process.env.QUARTZ_BUILD_CONCURRENCY = previous.concurrency;
    if (previous.timeout === undefined) delete process.env.QUARTZ_BUILD_TIMEOUT_MS;
    else process.env.QUARTZ_BUILD_TIMEOUT_MS = previous.timeout;
    for (const [name, value] of previous.buildEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("Runtime failure is returned without a direct Quartz fallback", async () => {
  const previousAutoPublish = process.env.QUARTZ_AUTO_PUBLISH;
  process.env.QUARTZ_AUTO_PUBLISH = "1";
  try {
    const state = freshState(jobSnapshot("failed"));
    await assert.rejects(
      quartz.publishQuartzAfterMutation("failed publication", {
        userId: 91,
        requireSuccess: true,
      }),
      /Quartz publication failed/u,
    );
    assert.equal(state.submissions.length, 1);
    assert.equal(state.outputs.length, 0);
  } finally {
    if (previousAutoPublish === undefined) delete process.env.QUARTZ_AUTO_PUBLISH;
    else process.env.QUARTZ_AUTO_PUBLISH = previousAutoPublish;
  }
});

test("a Runtime V2 hot dashboard publishes a missing public tree on first view", async () => {
  const previous = {
    autoPublish: process.env.QUARTZ_AUTO_PUBLISH,
    nodeEnv: process.env.NODE_ENV,
    controlUrl: process.env.BREADBOARD_SUPERVISOR_CONTROL_URL,
    controlToken: process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN,
    contentPath: process.env.QUARTZ_CONTENT_PATH,
  };
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-quartz-view-readiness-"),
  );
  const contentPath = path.join(temporaryRoot, "quartz", "content");
  fs.mkdirSync(contentPath, { recursive: true });
  delete process.env.QUARTZ_AUTO_PUBLISH;
  process.env.NODE_ENV = "development";
  process.env.BREADBOARD_SUPERVISOR_CONTROL_URL = "http://127.0.0.1:7711";
  process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = "t".repeat(32);
  process.env.QUARTZ_CONTENT_PATH = contentPath;
  try {
    const state = freshState();
    await Promise.all([
      quartz.ensureQuartzPublicationForView(91),
      quartz.ensureQuartzPublicationForView(91),
    ]);
    assert.equal(state.submissions.length, 1);
    assert.deepEqual(state.submissions[0].submission.requestPayload.reasons, [
      "prepare Quartz for the first garden view",
    ]);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    for (const [name, value] of [
      ["QUARTZ_AUTO_PUBLISH", previous.autoPublish],
      ["NODE_ENV", previous.nodeEnv],
      ["BREADBOARD_SUPERVISOR_CONTROL_URL", previous.controlUrl],
      ["BREADBOARD_SUPERVISOR_CONTROL_TOKEN", previous.controlToken],
      ["QUARTZ_CONTENT_PATH", previous.contentPath],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("an in-flight Quartz publication satisfies a cold view without a duplicate build", async () => {
  const previous = {
    autoPublish: process.env.QUARTZ_AUTO_PUBLISH,
    contentPath: process.env.QUARTZ_CONTENT_PATH,
  };
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-quartz-view-in-flight-"),
  );
  const contentPath = path.join(temporaryRoot, "quartz", "content");
  const publicIndex = path.join(temporaryRoot, "quartz", "public", "index.html");
  fs.mkdirSync(contentPath, { recursive: true });
  process.env.QUARTZ_AUTO_PUBLISH = "1";
  process.env.QUARTZ_CONTENT_PATH = contentPath;

  let finishPublication;
  const publicationGate = new Promise((resolve) => {
    finishPublication = resolve;
  });

  try {
    const state = freshState(jobSnapshot("running"));
    state.inspectJob = async () => {
      await publicationGate;
      fs.mkdirSync(path.dirname(publicIndex), { recursive: true });
      fs.writeFileSync(publicIndex, "published", "utf8");
      return jobSnapshot("succeeded");
    };

    const mutation = quartz.publishQuartzAfterMutation(
      "refresh private garden index",
      { userId: 91, requireSuccess: true },
    );
    const view = quartz.ensureQuartzPublicationForView(91);
    finishPublication();
    await Promise.all([mutation, view]);

    assert.equal(state.submissions.length, 1);
    assert.deepEqual(state.submissions[0].submission.requestPayload.reasons, [
      "refresh private garden index",
    ]);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    if (previous.autoPublish === undefined) delete process.env.QUARTZ_AUTO_PUBLISH;
    else process.env.QUARTZ_AUTO_PUBLISH = previous.autoPublish;
    if (previous.contentPath === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = previous.contentPath;
  }
});
