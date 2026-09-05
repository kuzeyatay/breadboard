import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateKey = "__breadboardRuntimeV2LearnCutoverTestState";

function snapshot(jobId, state = "queued") {
  return {
    jobId,
    jobType: "learn",
    workerKind: "learn-node",
    resourceClass: "large-generation",
    state,
    stage: null,
    attempt: 0,
    workerInstanceId: null,
    gardenId: "garden-1",
    conversationId: null,
    createdAt: 1,
    startedAt: null,
    updatedAt: 1,
    finishedAt: null,
    lastHeartbeatAt: null,
    lastWorkerSequence: 0,
    progressCurrent: 0,
    progressTotal: 0,
    failureCode: null,
    failureMessage: null,
    cancellationRequested: false,
  };
}

async function loadCutoverModule() {
  const result = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "learn-operation-runtime-v2.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [
      {
        name: "runtime-v2-learn-cutover-stubs",
        setup(build) {
          build.onResolve({ filter: /^server-only$/ }, () => ({
            path: "server-only",
            namespace: "learn-cutover-stub",
          }));
          build.onResolve({ filter: /^@\/lib\/supervisor-control$/ }, () => ({
            path: "supervisor-control",
            namespace: "learn-cutover-stub",
          }));
          build.onResolve({ filter: /^@\/lib\/db$/ }, () => ({
            path: "db",
            namespace: "learn-cutover-stub",
          }));
          build.onLoad(
            { filter: /.*/, namespace: "learn-cutover-stub" },
            (args) => {
              if (args.path === "server-only") return { loader: "js", contents: "" };
              if (args.path === "db") {
                return {
                  loader: "js",
                  contents: `
                    const state = () => globalThis[${JSON.stringify(stateKey)}];
                    const db = {
                      prepare() {
                        return { get() { return state()?.latestLearnJob ?? undefined; } };
                      },
                    };
                    export default db;
                  `,
                };
              }
              return {
                loader: "js",
                contents: `
                  const state = () => globalThis[${JSON.stringify(stateKey)}];
                  export class RuntimeJobControlError extends Error {
                    constructor(code) {
                      super(code);
                      this.code = code;
                    }
                  }
                  export async function submitRuntimeJob(authority, submission) {
                    const current = state();
                    current.submissions.push({
                      authority: structuredClone(authority),
                      submission: structuredClone(submission),
                    });
                    let jobId = current.jobIds.get(submission.idempotencyKey);
                    if (!jobId) {
                      jobId = "job_" + String(current.jobIds.size + 1).padStart(64, "0");
                      current.jobIds.set(submission.idempotencyKey, jobId);
                      current.jobs.set(jobId, ${snapshot.toString()}(jobId));
                    }
                    return current.jobs.get(jobId);
                  }
                  export async function inspectRuntimeJob(authority, jobId) {
                    const current = state();
                    current.inspections.push({ authority: structuredClone(authority), jobId });
                    const job = current.jobs.get(jobId);
                    if (!job) throw new RuntimeJobControlError("JOB_NOT_FOUND");
                    return job;
                  }
                  export const inspectRuntimeJobForStatus = inspectRuntimeJob;
                  export async function cancelRuntimeJob(authority, jobId) {
                    const current = state();
                    current.cancellations.push({ authority: structuredClone(authority), jobId });
                    const job = current.jobs.get(jobId);
                    if (!job) throw new RuntimeJobControlError("JOB_NOT_FOUND");
                    const cancelled = { ...job, state: "cancelling", cancellationRequested: true };
                    current.jobs.set(jobId, cancelled);
                    return cancelled;
                  }
                  export async function replayRuntimeJobEvents(authority, jobId, after, limit) {
                    const current = state();
                    current.replays.push({
                      authority: structuredClone(authority),
                      jobId,
                      after,
                      limit,
                    });
                    if (!current.jobs.has(jobId)) {
                      throw new RuntimeJobControlError("JOB_NOT_FOUND");
                    }
                    const remaining = current.runtimeEvents.filter(
                      (event) => event.jobId === jobId && event.sequence > after,
                    );
                    const events = remaining.slice(0, limit);
                    return {
                      jobId,
                      after,
                      events,
                      nextAfter: events.at(-1)?.sequence ?? after,
                      terminal: false,
                      hasMore: remaining.length > events.length,
                    };
                  }
                  export const replayRuntimeJobEventsForStatus = replayRuntimeJobEvents;
                `,
              };
            },
          );
        },
      },
    ],
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#runtime-v2-learn-cutover`);
}

const cutover = await loadCutoverModule();

function freshState() {
  const state = {
    submissions: [],
    inspections: [],
    cancellations: [],
    replays: [],
    runtimeEvents: [],
    latestLearnJob: null,
    jobIds: new Map(),
    jobs: new Map(),
  };
  globalThis[stateKey] = state;
  return state;
}

function planRequest(contentPath) {
  return {
    operation: "plan",
    gardenId: "garden-1",
    userId: 7,
    contentPath,
    baseURL: "http://127.0.0.1:43120/v1",
    model: "gpt-test",
    includedSourceIds: ["source-b", "source-a"],
    syllabusSourceId: null,
    sourceOnly: true,
    includeSourceSnapshots: false,
    autoConfirmTopicMap: false,
  };
}

test("Learn routes submit bounded scope-free Runtime V2 input with stable retry identity", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-v2-cutover-"));
  try {
    const state = freshState();
    const request = planRequest(temporaryRoot);
    const first = await cutover.executeLearnOperationForRoute(request, "planning");
    const second = await cutover.executeLearnOperationForRoute(request, "planning retry");

    assert.equal(first.accepted, true);
    assert.equal(second.jobId, first.jobId);
    assert.equal(state.submissions.length, 2);
    assert.deepEqual(state.submissions[0].authority, {
      userId: 7,
      gardenId: "garden-1",
      conversationId: null,
    });
    assert.equal(state.submissions[0].submission.jobType, "learn");
    assert.equal(
      state.submissions[1].submission.idempotencyKey,
      state.submissions[0].submission.idempotencyKey,
    );
    assert.deepEqual(state.submissions[0].submission.requestPayload, {
      autoConfirmTopicMap: false,
      baseURL: "http://127.0.0.1:43120/v1",
      includeSourceSnapshots: false,
      includedSourceIds: ["source-b", "source-a"],
      model: "gpt-test",
      operation: "plan",
      sourceOnly: true,
      syllabusSourceId: null,
    });
    for (const field of ["userId", "gardenId", "conversationId", "contentPath"]) {
      assert.equal(
        Object.hasOwn(state.submissions[0].submission.requestPayload, field),
        false,
      );
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("a completed identical Learn request receives a new stable execution epoch", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-v2-epoch-"));
  try {
    const state = freshState();
    const request = planRequest(temporaryRoot);
    const first = await cutover.executeLearnOperationForRoute(request, "planning");
    state.jobs.set(first.jobId, snapshot(first.jobId, "succeeded"));

    const next = await cutover.executeLearnOperationForRoute(request, "planning again");
    const retry = await cutover.executeLearnOperationForRoute(request, "planning retry");

    assert.notEqual(next.jobId, first.jobId);
    assert.equal(retry.jobId, next.jobId);
    assert.notEqual(
      state.submissions[0].submission.idempotencyKey,
      state.submissions[1].submission.idempotencyKey,
    );
    assert.equal(
      state.submissions[2].submission.idempotencyKey,
      state.submissions[1].submission.idempotencyKey,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("queued Runtime Learn state and events bridge the pre-legacy handoff", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-v2-bridge-"));
  try {
    const state = freshState();
    const submitted = await cutover.executeLearnOperationForRoute(
      planRequest(temporaryRoot),
      "planning",
    );
    state.runtimeEvents.push({
      sequence: 1,
      jobId: submitted.jobId,
      eventType: "queued",
      payload: { state: "queued" },
      attempt: 0,
      workerInstanceId: null,
      workerSequence: 0,
      createdAt: 1,
    });

    const merged = await cutover.mergeRuntimeV2LearnStatus(
      { userId: 7, gardenId: "garden-1", contentPath: temporaryRoot },
      { job: null, preserved: true },
    );
    assert.equal(merged.preserved, true);
    assert.equal(merged.runtimeJob.jobId, submitted.jobId);
    assert.equal(merged.job.id, submitted.jobId);
    assert.equal(merged.job.status, "planning");
    assert.equal(merged.job.currentStep, "Waiting for Runtime admission");

    const compatibility = await cutover.getRuntimeV2LearnEventCompatibility({
      userId: 7,
      gardenId: "garden-1",
      contentPath: temporaryRoot,
      requestedJobId: submitted.jobId,
    });
    assert.equal(compatibility.legacyJobId, null);
    assert.equal(compatibility.events.length, 1);
    assert.equal(compatibility.events[0].type, "learn_runtime_queued");
    assert.equal(compatibility.events[0].jobId, submitted.jobId);
    assert.equal(state.replays.length, 1);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("a cleared garden does not resurrect a stale successful Runtime banner", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-v2-cleared-status-"));
  try {
    const state = freshState();
    const submitted = await cutover.executeLearnOperationForRoute(
      planRequest(temporaryRoot),
      "planning",
    );
    state.jobs.set(submitted.jobId, snapshot(submitted.jobId, "succeeded"));

    const merged = await cutover.mergeRuntimeV2LearnStatus(
      { userId: 7, gardenId: "garden-1", contentPath: temporaryRoot },
      {
        job: null,
        hasTextbook: false,
        latestTextbookVersionId: null,
        confirmedLearningMapId: null,
        proposedLearningMap: null,
      },
    );
    assert.equal(merged.job, null);
    assert.equal(merged.runtimeJob.jobId, submitted.jobId);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("a newer direct Learn job supersedes an older terminal Runtime receipt", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-v2-newer-direct-"));
  try {
    const state = freshState();
    const submitted = await cutover.executeLearnOperationForRoute(
      planRequest(temporaryRoot),
      "planning",
    );
    state.jobs.set(submitted.jobId, snapshot(submitted.jobId, "succeeded"));
    const directJob = {
      id: "learn_newer_direct",
      model: "gpt-newer",
      status: "planning",
      updatedAt: new Date(Date.now() + 1_000).toISOString(),
    };

    const merged = await cutover.mergeRuntimeV2LearnStatus(
      { userId: 7, gardenId: "garden-1", contentPath: temporaryRoot },
      { job: directJob },
    );
    assert.deepEqual(merged.job, directJob);
    assert.equal(merged.runtimeJob.jobId, submitted.jobId);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("an updated baseline row cannot impersonate the new Runtime Learn handoff", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-v2-binding-"));
  try {
    const state = freshState();
    state.latestLearnJob = {
      id: "learn_baseline",
      model: "gpt-test",
      status: "planning",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const submitted = await cutover.executeLearnOperationForRoute(
      planRequest(temporaryRoot),
      "planning",
    );
    state.latestLearnJob = {
      ...state.latestLearnJob,
      updatedAt: "2026-01-01T00:00:01.000Z",
    };

    const beforeBinding = await cutover.mergeRuntimeV2LearnStatus(
      { userId: 7, gardenId: "garden-1", contentPath: temporaryRoot },
      { job: state.latestLearnJob },
    );
    assert.equal(beforeBinding.job.id, submitted.jobId);

    const { writeRuntimeV2LearnBinding } = await import(
      "../src/lib/runtime-v2/learn-binding.ts"
    );
    writeRuntimeV2LearnBinding({
      contentPath: temporaryRoot,
      gardenId: "garden-1",
      userId: 7,
      runtimeJobId: submitted.jobId,
      learnJobId: "learn_runtime_owned",
    });
    assert.throws(
      () =>
        writeRuntimeV2LearnBinding({
          contentPath: temporaryRoot,
          gardenId: "garden-1",
          userId: 7,
          runtimeJobId: submitted.jobId,
          learnJobId: "learn_conflicting_owner",
        }),
      /already bound to another durable Learn job/u,
    );
    state.latestLearnJob = {
      id: "learn_runtime_owned",
      model: "gpt-test",
      status: "planning",
      updatedAt: "2026-01-01T00:00:02.000Z",
    };
    const boundSnapshot = { job: { ...state.latestLearnJob }, preserved: true };
    const afterBinding = await cutover.mergeRuntimeV2LearnStatus(
      { userId: 7, gardenId: "garden-1", contentPath: temporaryRoot },
      boundSnapshot,
    );
    assert.equal(afterBinding.job.id, "learn_runtime_owned");
    assert.equal(afterBinding.preserved, true);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("Learn binding storage rejects a redirected metadata directory", async (context) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-v2-binding-scope-"));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-v2-binding-outside-"));
  const gardenRoot = path.join(temporaryRoot, "garden-1");
  const redirectedMetadata = path.join(gardenRoot, ".breadboard");
  try {
    fs.mkdirSync(gardenRoot);
    try {
      fs.symlinkSync(
        outsideRoot,
        redirectedMetadata,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (error?.code === "EPERM" || error?.code === "EACCES") {
        context.skip("Directory links are unavailable in this test environment.");
        return;
      }
      throw error;
    }
    const { writeRuntimeV2LearnBinding } = await import(
      "../src/lib/runtime-v2/learn-binding.ts"
    );
    assert.throws(
      () =>
        writeRuntimeV2LearnBinding({
          contentPath: temporaryRoot,
          gardenId: "garden-1",
          userId: 7,
          runtimeJobId: `job_${"a".repeat(64)}`,
          learnJobId: "learn_redirect_attempt",
        }),
      /binding directory is not a regular directory/u,
    );
    assert.equal(
      fs.existsSync(path.join(outsideRoot, "runtime-v2-learn-bindings")),
      false,
    );
  } finally {
    try {
      if (fs.lstatSync(redirectedMetadata).isSymbolicLink()) {
        fs.unlinkSync(redirectedMetadata);
      }
    } catch {
      // The link may not have been created or may already be absent.
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("a validated legacy cancellation is correlated to the Runtime owner", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-v2-cancel-"));
  try {
    const state = freshState();
    const submitted = await cutover.executeLearnOperationForRoute(
      planRequest(temporaryRoot),
      "planning",
    );
    const legacyToken = await cutover.cancelRuntimeV2LearnOperation({
      userId: 7,
      gardenId: "garden-1",
      contentPath: temporaryRoot,
      expectedJobId: "learn_job_visible_to_existing_ui",
    });
    assert.equal(legacyToken.handled, false);
    assert.equal(state.cancellations.length, 0);

    const cancellation = await cutover.cancelRuntimeV2LearnOperation({
      userId: 7,
      gardenId: "garden-1",
      contentPath: temporaryRoot,
    });

    assert.equal(cancellation.handled, true);
    assert.equal(cancellation.runtimeJob.jobId, submitted.jobId);
    assert.deepEqual(state.cancellations, [
      {
        authority: { userId: 7, gardenId: "garden-1", conversationId: null },
        jobId: submitted.jobId,
      },
    ]);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("a Runtime-shaped non-Learn job ID cannot be cancelled through Learn", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-v2-cancel-scope-"));
  try {
    const state = freshState();
    const submitted = await cutover.executeLearnOperationForRoute(
      planRequest(temporaryRoot),
      "planning",
    );
    state.jobs.set(submitted.jobId, {
      ...snapshot(submitted.jobId),
      jobType: "document-ingestion",
      workerKind: "document-ingestion-node",
      resourceClass: "document-processing",
    });

    const cancellation = await cutover.cancelRuntimeV2LearnOperation({
      userId: 7,
      gardenId: "garden-1",
      contentPath: temporaryRoot,
      expectedJobId: submitted.jobId,
    });

    assert.equal(cancellation.handled, false);
    assert.equal(cancellation.runtimeJob, null);
    assert.equal(state.cancellations.length, 0);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("both Learn operation aliases are cut over without loading the detached handoff", () => {
  for (const name of [
    "learn-operation-runtime.dev.ts",
    "learn-operation-runtime.production.ts",
  ]) {
    const source = fs.readFileSync(path.join(dashboardRoot, "src", "lib", name), "utf8");
    assert.match(source, /learn-operation-runtime-v2/);
    assert.doesNotMatch(source, /handOffDedicatedLearnTask|handOffLearnTask/);
  }

  const cancelRoute = fs.readFileSync(
    path.join(
      dashboardRoot,
      "src",
      "app",
      "api",
      "gardens",
      "[gardenId]",
      "learn",
      "cancel",
      "route.ts",
    ),
    "utf8",
  );
  assert.match(cancelRoute, /await cancelRuntimeV2LearnOperation/);
  assert.ok(
    cancelRoute.indexOf("await cancelRuntimeV2LearnOperation") <
      cancelRoute.indexOf('await import("@/lib/learn")'),
  );
});

/** A job store whose `cancelling` jobs flip to `cancelled` after N reads. */
class SettlingJobs extends Map {
  constructor(entries, readsBeforeSettle) {
    super(entries);
    this.readsBeforeSettle = readsBeforeSettle;
    this.reads = 0;
  }

  get(jobId) {
    const job = super.get(jobId);
    if (job?.state !== "cancelling") return job;
    this.reads += 1;
    if (this.reads < this.readsBeforeSettle) return job;
    const cancelled = { ...job, state: "cancelled" };
    super.set(jobId, cancelled);
    return cancelled;
  }
}

test("a stopping Runtime Learn job is settled instead of blocking fresh planning", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-v2-restart-"));
  try {
    const state = freshState();
    const first = await cutover.executeLearnOperationForRoute(
      planRequest(temporaryRoot),
      "planning",
    );
    // Cancel reached Runtime, but the worker has not acknowledged yet.
    state.jobs.set(first.jobId, {
      ...snapshot(first.jobId, "cancelling"),
      cancellationRequested: true,
    });
    // The worker acknowledges on the next status poll after the route re-reads it.
    state.jobs = new SettlingJobs(state.jobs, 2);

    const restarted = await cutover.executeLearnOperationForRoute(
      { ...planRequest(temporaryRoot), includedSourceIds: ["source-a"] },
      "planning restart",
    );

    assert.equal(restarted.accepted, true);
    assert.notEqual(restarted.jobId, first.jobId);
    assert.equal(state.cancellations.length, 0);
    assert.notEqual(
      state.submissions[0].submission.idempotencyKey,
      state.submissions[1].submission.idempotencyKey,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("an orphaned Runtime Learn job whose durable row is cancelled is cancelled and superseded", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-v2-orphan-"));
  try {
    const state = freshState();
    const first = await cutover.executeLearnOperationForRoute(
      planRequest(temporaryRoot),
      "planning",
    );
    state.jobs.set(first.jobId, snapshot(first.jobId, "running"));
    const { writeRuntimeV2LearnBinding } = await import(
      "../src/lib/runtime-v2/learn-binding.ts"
    );
    writeRuntimeV2LearnBinding({
      contentPath: temporaryRoot,
      gardenId: "garden-1",
      userId: 7,
      runtimeJobId: first.jobId,
      learnJobId: "learn_runtime_owned",
    });
    // The legacy Cancel transaction already recorded the row as cancelled, but
    // the Runtime cancellation never reached the worker.
    state.latestLearnJob = {
      id: "learn_runtime_owned",
      model: "gpt-test",
      status: "cancelled",
      updatedAt: "2026-01-01T00:00:02.000Z",
    };
    state.jobs = new SettlingJobs(state.jobs, 1);

    const restarted = await cutover.executeLearnOperationForRoute(
      { ...planRequest(temporaryRoot), includedSourceIds: ["source-a"] },
      "planning restart",
    );

    assert.equal(restarted.accepted, true);
    assert.notEqual(restarted.jobId, first.jobId);
    assert.deepEqual(state.cancellations, [
      {
        authority: { userId: 7, gardenId: "garden-1", conversationId: null },
        jobId: first.jobId,
      },
    ]);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("a genuinely active different Learn request still conflicts", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-v2-conflict-"));
  try {
    const state = freshState();
    const first = await cutover.executeLearnOperationForRoute(
      planRequest(temporaryRoot),
      "planning",
    );
    state.jobs.set(first.jobId, snapshot(first.jobId, "running"));
    await assert.rejects(
      cutover.executeLearnOperationForRoute(
        { ...planRequest(temporaryRoot), includedSourceIds: ["source-a"] },
        "planning again",
      ),
      /is still active for this garden/u,
    );
    assert.equal(state.cancellations.length, 0);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("Runtime-bridged status reports the submitted selection and syllabus, not the prior job's", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-v2-selection-"));
  try {
    const state = freshState();
    // The previous run predates the Runtime job (snapshot updatedAt is epoch 1ms).
    state.latestLearnJob = {
      id: "learn_previous_cancelled",
      model: "gpt-test",
      status: "cancelled",
      updatedAt: "1970-01-01T00:00:00.000Z",
    };
    const submitted = await cutover.executeLearnOperationForRoute(
      {
        ...planRequest(temporaryRoot),
        includedSourceIds: ["source-b", "source-a", " source-a ", ""],
        syllabusSourceId: "source-syllabus",
      },
      "planning",
    );
    const projected = {
      job: { ...state.latestLearnJob },
      selectedSourceIds: ["source-old"],
      syllabusSourceId: null,
      syllabusCoverage: { unitCount: 1 },
    };
    for (const runtimeState of ["queued", "running", "failed"]) {
      state.jobs.set(submitted.jobId, snapshot(submitted.jobId, runtimeState));
      const merged = await cutover.mergeRuntimeV2LearnStatus(
        { userId: 7, gardenId: "garden-1", contentPath: temporaryRoot },
        projected,
      );
      assert.equal(merged.job.id, submitted.jobId, runtimeState);
      assert.deepEqual(merged.selectedSourceIds, ["source-b", "source-a"], runtimeState);
      assert.equal(merged.syllabusSourceId, "source-syllabus", runtimeState);
      assert.equal(merged.syllabusCoverage, null, runtimeState);
    }
    const receipt = JSON.parse(
      fs.readFileSync(
        path.join(temporaryRoot, "garden-1", ".breadboard", "runtime-v2-learn-submission.json"),
        "utf8",
      ),
    );
    assert.equal(receipt.version, 2);
    assert.deepEqual(receipt.selectedSourceIds, ["source-b", "source-a"]);
    assert.equal(receipt.syllabusSourceId, "source-syllabus");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("a version 1 receipt without a recorded selection is still honoured", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-v2-legacy-receipt-"));
  try {
    const state = freshState();
    const submitted = await cutover.executeLearnOperationForRoute(
      planRequest(temporaryRoot),
      "planning",
    );
    const receiptPath = path.join(
      temporaryRoot,
      "garden-1",
      ".breadboard",
      "runtime-v2-learn-submission.json",
    );
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    delete receipt.selectedSourceIds;
    delete receipt.syllabusSourceId;
    receipt.version = 1;
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
    state.jobs.set(submitted.jobId, snapshot(submitted.jobId, "running"));

    const projected = { job: null, selectedSourceIds: ["source-old"], syllabusSourceId: "kept" };
    const merged = await cutover.mergeRuntimeV2LearnStatus(
      { userId: 7, gardenId: "garden-1", contentPath: temporaryRoot },
      projected,
    );
    assert.equal(merged.job.id, submitted.jobId);
    assert.deepEqual(merged.selectedSourceIds, ["source-old"]);
    assert.equal(merged.syllabusSourceId, "kept");

    const retry = await cutover.executeLearnOperationForRoute(
      planRequest(temporaryRoot),
      "planning retry",
    );
    assert.equal(retry.jobId, submitted.jobId);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
