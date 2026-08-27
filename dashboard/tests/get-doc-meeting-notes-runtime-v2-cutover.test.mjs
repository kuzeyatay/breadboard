import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  executeRuntimeV2OuterAgentAdapter,
  expectedRuntimeV2OuterAgentInputCount,
  RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS,
  validateRuntimeV2GetDocDownloadRequest,
  validateRuntimeV2GetDocRequest,
  validateRuntimeV2MeetingNotesRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";
import { loadRuntimeV2OuterAgentLaunch } from "../scripts/runtime-v2-outer-agent-worker-core.mjs";
import { ScriberrClient } from "../src/lib/scriberr/client.ts";

const dashboardRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

const document = {
  id: "doc_1",
  title: "A bounded paper",
  authors: ["Ada Example"],
  year: 2026,
  venue: "Journal",
  doi: "10.1234/example",
  abstract: "Abstract",
  description: "Why this paper matches.",
  openAccess: true,
  citationCount: 7,
  landingPage: "https://example.org/paper",
  pdfUrl: "https://example.org/paper.pdf",
  pdfSource: "openalex",
  sources: ["openalex"],
};

function getDocRequest(overrides = {}) {
  return {
    request: {
      query: "bounded retrieval",
      limit: 10,
      openAccessOnly: true,
      yearFrom: null,
      yearTo: null,
      sources: null,
    },
    model: "test-model",
    reasoningEffort: "medium",
    baseUrl: "http://127.0.0.1:8765/v1",
    conversationContext: "",
    ...overrides,
  };
}

function downloadRequest(overrides = {}) {
  return {
    sourceRunId: "runtime_search_1",
    documentId: "doc_1",
    conversationPublicId: `conv_${"a".repeat(24)}`,
    document,
    ...overrides,
  };
}

function meetingRequest(overrides = {}) {
  return {
    conversationPublicId: `conv_${"b".repeat(24)}`,
    request: {
      sourceKind: "upload",
      prompt: "Write action items",
      language: "en",
      speakers: true,
      transcriptOnly: false,
    },
    source: {
      kind: "audio",
      filename: "meeting.m4a",
      title: "Meeting",
      label: "meeting.m4a",
      artifactId: null,
      byteSize: 1024,
      error: null,
    },
    engine: "scriberr",
    voiceboxModel: "base",
    model: "test-model",
    reasoningEffort: "medium",
    baseUrl: "http://127.0.0.1:8765/v1",
    conversationContext: "User: Focus on owners.",
    ...overrides,
  };
}

test("Get Doc and Meeting Notes use fixed sealed Runtime adapters", () => {
  const search = validateRuntimeV2GetDocRequest(getDocRequest());
  const download = validateRuntimeV2GetDocDownloadRequest(downloadRequest());
  const meeting = validateRuntimeV2MeetingNotesRequest(meetingRequest());
  assert.equal(expectedRuntimeV2OuterAgentInputCount("get-doc", search), 0);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("get-doc-download", download), 0);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("meeting-notes", meeting), 1);
  assert.deepEqual(
    ["get-doc", "get-doc-download", "meeting-notes"].map((key) => {
      const adapter = RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS[key];
      return [adapter.jobType, adapter.workerKind, adapter.maximumInputs];
    }),
    [
      ["get-doc-run", "outer-get-doc-node", 0],
      ["get-doc-download", "get-doc-download-node", 0],
      ["meeting-notes-run", "outer-meeting-notes-node", 1],
    ],
  );
});

test("canonical requests reject path, execution, secret and engine smuggling", () => {
  assert.throws(() => validateRuntimeV2GetDocRequest({ ...getDocRequest(), env: {} }), /invalid/u);
  assert.throws(
    () => validateRuntimeV2GetDocDownloadRequest({ ...downloadRequest(), executable: "curl" }),
    /invalid/u,
  );
  assert.throws(
    () => validateRuntimeV2GetDocDownloadRequest({
      ...downloadRequest(),
      document: { ...document, pdfUrl: "file:///etc/passwd" },
    }),
    /invalid/u,
  );
  assert.throws(
    () => validateRuntimeV2MeetingNotesRequest({ ...meetingRequest(), inputPath: "C:\\secret.wav" }),
    /invalid/u,
  );
  assert.throws(
    () => validateRuntimeV2MeetingNotesRequest({ ...meetingRequest(), engine: "powershell" }),
    /invalid/u,
  );
  assert.throws(
    () => validateRuntimeV2MeetingNotesRequest({ ...meetingRequest(), apiKey: "secret" }),
    /invalid/u,
  );
});

test("Meeting Notes cancels an oversized local transcription response while streaming", async () => {
  let pulls = 0;
  let cancelled = false;
  const client = new ScriberrClient({
    baseUrl: "http://127.0.0.1:8080",
    apiToken: "worker-owned",
    fetchImpl: async () => new Response(new ReadableStream({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    }), { status: 200 }),
  });
  await assert.rejects(
    () => client.getJobStatus("job_oversized"),
    (error) => error?.code === "scriberr_rejected" && /bounded JSON limit/u.test(error.message),
  );
  assert.ok(pulls >= 17 && pulls <= 18);
  assert.equal(cancelled, true);
});

function meetingLaunchFixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-meeting-runtime-protocol-"));
  const jobId = "job_meeting_1";
  const workerInstanceId = "worker_meeting_1";
  const jobRoot = path.join(root, "runtime", "jobs", jobId);
  const attemptRoot = path.join(jobRoot, "attempts", "1", workerInstanceId);
  const workspace = path.join(attemptRoot, "workspace");
  const blobId = "blob_meeting_1";
  const payload = path.join(jobRoot, "inputs", blobId, "payload");
  fs.mkdirSync(path.dirname(payload), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  const bytes = Buffer.from("audio-bytes");
  fs.writeFileSync(payload, bytes);
  fs.writeFileSync(path.join(jobRoot, "input.json"), JSON.stringify(meetingRequest()));
  const blob = {
    blobId,
    relativePath: `runtime/jobs/${jobId}/inputs/${blobId}/payload`,
    sizeBytes: bytes.byteLength,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    displayName: "meeting.m4a",
    mediaType: "application/octet-stream",
    ...(overrides.blob ?? {}),
  };
  fs.writeFileSync(path.join(attemptRoot, "start.json"), JSON.stringify({
    protocolVersion: 1,
    identity: { jobId, attempt: 1, workerInstanceId },
    executionScope: {
      userId: 7,
      gardenId: null,
      conversationId: `oa_meeting_notes_${"a".repeat(32)}`,
    },
    inputManifestPath: `runtime/jobs/${jobId}/input.json`,
    inputBlobs: [blob],
    workspacePath: `runtime/jobs/${jobId}/attempts/1/${workerInstanceId}/workspace`,
    checkpointPath: `runtime/jobs/${jobId}/checkpoint.json`,
    resultPath: `runtime/jobs/${jobId}/result.json`,
  }));
  return { root, attemptRoot, payload };
}

test("Meeting Notes loader fences the authenticated blob to job, scope, media and hash", (t) => {
  const good = meetingLaunchFixture();
  t.after(() => fs.rmSync(good.root, { recursive: true, force: true }));
  const launch = loadRuntimeV2OuterAgentLaunch({
    adapterId: "meeting-notes",
    argv: ["start.json"],
    launchDirectory: good.attemptRoot,
  });
  assert.equal(launch.inputPaths.length, 1);
  assert.equal(fs.realpathSync.native(launch.inputPaths[0]), fs.realpathSync.native(good.payload));

  for (const blob of [
    { mediaType: "image/png" },
    { sha256: "0".repeat(64) },
    { relativePath: "runtime/jobs/another/inputs/blob_meeting_1/payload" },
    { sizeBytes: 2 * 1024 * 1024 * 1024 + 1 },
  ]) {
    const fixture = meetingLaunchFixture({ blob });
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    assert.throws(
      () => loadRuntimeV2OuterAgentLaunch({
        adapterId: "meeting-notes",
        argv: ["start.json"],
        launchDirectory: fixture.attemptRoot,
      }),
      /invalid|integrity|bound|identity|input/u,
    );
  }
});

async function fakeMeetingAdapterRun(abort = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-meeting-adapter-"));
  const sourceRoot = path.join(root, "src");
  const managerPath = path.join(sourceRoot, "lib", "meeting-notes", "runtime-worker-run-manager.ts");
  const workspace = path.join(root, "workspace");
  const inputPath = path.join(root, "input.m4a");
  fs.mkdirSync(path.dirname(managerPath), { recursive: true });
  fs.mkdirSync(workspace);
  fs.writeFileSync(inputPath, "audio");
  fs.writeFileSync(managerPath, `
const states = new Map();
export function startRuntimeWorkerRun(input) {
  globalThis.__meetingAdapterInput = input;
  const state = { status: "running", events: [{ sequenceNumber: 1, type: "run.started", payload: { source: input.request.sourceKind }, at: new Date().toISOString() }] };
  states.set(input.runtimeJobId, state);
  setTimeout(() => {
    if (state.status !== "running") return;
    state.status = "completed";
    state.events.push({ sequenceNumber: 2, type: "run.completed", payload: { summary: "Notes complete" }, at: new Date().toISOString() });
  }, 20);
  return { runId: input.runtimeJobId, status: state.status };
}
export function getRuntimeWorkerEventsSince(_userId, runId, since) {
  return states.get(runId).events.filter((event) => event.sequenceNumber > since);
}
export function isRuntimeWorkerTerminal(_userId, runId) {
  return ["completed", "failed", "aborted"].includes(states.get(runId).status);
}
export function abortRuntimeWorkerRun(_userId, runId) {
  const state = states.get(runId);
  if (state.status !== "running") return false;
  state.status = "aborted";
  state.events.push({ sequenceNumber: state.events.length + 1, type: "run.aborted", payload: { summary: "The meeting notes run was stopped." }, at: new Date().toISOString() });
  return true;
}
`);
  const controller = new AbortController();
  const updates = [];
  const promise = executeRuntimeV2OuterAgentAdapter({
    adapterId: "meeting-notes",
    sourceRoot,
    signal: controller.signal,
    update: (events, status) => updates.push({ events, status }),
    launch: {
      identity: { jobId: "job_meeting_adapter_1", attempt: 1, workerInstanceId: "worker_meeting_adapter_1" },
      executionScope: { userId: 7, gardenId: null, conversationId: `oa_meeting_notes_${"c".repeat(32)}` },
      request: meetingRequest(),
      inputPaths: [inputPath],
      inputBlobs: [{ displayName: "meeting.m4a", mediaType: "application/octet-stream", sizeBytes: 5 }],
      workspacePath: workspace,
    },
  });
  if (abort) controller.abort();
  const outcome = await promise;
  const captured = globalThis.__meetingAdapterInput;
  delete globalThis.__meetingAdapterInput;
  fs.rmSync(root, { recursive: true, force: true });
  return { outcome, updates, captured, inputPath, workspace };
}

test("Meeting Notes adapter preserves the sealed input and Runtime cancellation", async () => {
  const completed = await fakeMeetingAdapterRun(false);
  assert.equal(completed.outcome.status, "completed");
  assert.equal(completed.captured.userId, 7);
  assert.equal(completed.captured.runtimeJobId, "job_meeting_adapter_1");
  assert.equal(completed.captured.runtimeInputPath, completed.inputPath);
  assert.equal(completed.captured.runtimeWorkspacePath, completed.workspace);
  assert.equal(completed.captured.engine, "scriberr");
  assert.ok(completed.updates.flatMap((entry) => entry.events)
    .some((event) => event.type === "run.completed"));

  const aborted = await fakeMeetingAdapterRun(true);
  assert.equal(aborted.outcome.status, "aborted");
  assert.ok(aborted.updates.flatMap((entry) => entry.events)
    .some((event) => event.type === "run.aborted"));
});

test("Next routes submit, replay and cancel durable jobs with no direct fallback", () => {
  const getDocRoute = source("src/app/api/get-doc/runs/route.ts");
  const getDocEvents = source("src/app/api/get-doc/runs/[runId]/events/route.ts");
  const getDocAbort = source("src/app/api/get-doc/runs/[runId]/abort/route.ts");
  const downloadRoute = source("src/app/api/get-doc/runs/[runId]/documents/[documentId]/download/route.ts");
  const meetingRoute = source("src/app/api/meeting-notes/runs/route.ts");
  const meetingEvents = source("src/app/api/meeting-notes/runs/[runId]/events/route.ts");
  const meetingAbort = source("src/app/api/meeting-notes/runs/[runId]/abort/route.ts");
  for (const route of [getDocRoute, meetingRoute]) {
    assert.match(route, /runtime-run-manager/);
    assert.match(route, /await startRun\(/);
    assert.doesNotMatch(route, /child_process|spawn(?:Sync)?\(|execFile(?:Sync)?\(/u);
  }
  for (const events of [getDocEvents, meetingEvents]) {
    assert.match(events, /outerAgentEventsResponse/);
    assert.doesNotMatch(events, /setInterval\(/);
  }
  for (const abort of [getDocAbort, meetingAbort]) {
    assert.match(abort, /await abortRun\(/);
  }
  assert.match(downloadRoute, /downloadDocumentViaRuntime/);
  assert.match(downloadRoute, /await findDocument\(userId, runId, documentId\)/);
  assert.doesNotMatch(downloadRoute, /downloadPdf|saveDocumentArtifact|body\.(?:url|pdfUrl)/u);
});

test("large inputs remain streamed and bounded on disk", () => {
  const facade = source("src/lib/meeting-notes/runtime-run-manager.ts");
  const core = source("scripts/runtime-v2-outer-agent-worker-core.mjs");
  const scriberr = source("src/lib/scriberr/client.ts");
  const download = source("src/lib/get-doc/download.ts");
  assert.match(facade, /Readable\.toWeb\(fs\.createReadStream\(filePath\)\)/);
  assert.match(facade, /MAX_AUDIO_BYTES = 2 \* 1024 \* 1024 \* 1024/);
  assert.match(core, /MAX_MEETING_INPUT_BYTES = 2 \* 1024 \* 1024 \* 1024/);
  assert.match(core, /verifyInput\(dataRoot, blob\)/);
  assert.match(scriberr, /openAsBlob\(filePath\)/);
  assert.match(download, /downloadPdfToFile/);
  assert.match(download, /file\.write\(value\)/);
  const streamingBody = download.slice(
    download.indexOf("export async function downloadPdfToFile"),
    download.indexOf("async function readBounded"),
  );
  assert.doesNotMatch(streamingBody, /Buffer\.concat/u);
});

test("Meeting Notes owns only one fixed ffmpeg child and gives it no secrets", () => {
  const worker = source("src/lib/meeting-notes/runtime-transcribe.ts");
  const manager = source("src/lib/meeting-notes/runtime-worker-run-manager.ts");
  const transcribe = source("src/lib/meeting-notes/transcribe.ts");
  const scriberr = source("src/lib/scriberr/client.ts");
  assert.match(worker, /spawn\(mediaExecutable\(\), args/);
  assert.match(worker, /"-segment_time", String\(SEGMENT_SECONDS\)/);
  assert.match(worker, /MAX_SEGMENTS \* SEGMENT_SECONDS \+ 1/);
  assert.match(worker, /BREADBOARD_RUNTIME_V2_MEDIA_BIN/);
  assert.match(worker, /env: childEnv/);
  assert.doesNotMatch(worker, /env: process\.env/);
  assert.doesNotMatch(worker, /shell:\s*true/u);
  assert.match(manager, /run\.controller\.abort\(\)/);
  assert.match(manager, /meetingNotesRuntimeJobId/);
  assert.match(transcribe, /signal: input\.signal/);
  assert.match(transcribe, /input\.signal\?\.aborted[^;]+client\.killJob\(jobId\)/s);
  assert.match(scriberr, /signal\?\.addEventListener\("abort", abortFromCaller/);
  assert.match(scriberr, /signal\?\.removeEventListener\("abort", abortFromCaller/);
  assert.match(worker, /MAX_VOICEBOX_RESPONSE_BYTES/);
  assert.match(worker, /response\.body\?\.getReader\(\)/);
  assert.match(scriberr, /MAX_SCRIBERR_JSON_BYTES/);
  assert.match(scriberr, /response\.body\?\.getReader\(\)/);
});

test("remaining Next-owned paths are bounded auth, DB/stat, and streaming I/O only", () => {
  for (const relative of [
    "src/lib/meeting-notes/source.ts",
    "src/lib/meeting-notes/uploads.ts",
    "src/lib/meeting-notes/runtime-run-manager.ts",
    "src/lib/get-doc/runtime-run-manager.ts",
  ]) {
    const text = source(relative);
    assert.doesNotMatch(text, /from ["']node:child_process["']|\bspawn(?:Sync)?\(|\bexecFile(?:Sync)?\(/u, relative);
  }
  const uploads = source("src/lib/meeting-notes/uploads.ts");
  assert.match(uploads, /pipeline\(/);
  assert.match(uploads, /MAX_MEETING_RECORDING_BYTES/);
  assert.doesNotMatch(uploads, /formData\(\)|readFileSync\(/);
  const sourceResolver = source("src/lib/meeting-notes/source.ts");
  assert.doesNotMatch(sourceResolver, /\bfetch\(/);
  assert.match(sourceResolver, /getArtifactForUser|findVideoBlob|findMeetingUpload/);
});

test("fixed wrapper entrypoints cannot select another adapter", () => {
  assert.match(source("scripts/runtime-v2-get-doc-worker.mjs"), /runRuntimeV2OuterAgentWorker\("get-doc"\)/);
  assert.match(source("scripts/runtime-v2-get-doc-download-worker.mjs"), /runRuntimeV2OuterAgentWorker\("get-doc-download"\)/);
  assert.match(source("scripts/runtime-v2-meeting-notes-worker.mjs"), /runRuntimeV2OuterAgentWorker\("meeting-notes"\)/);
});
