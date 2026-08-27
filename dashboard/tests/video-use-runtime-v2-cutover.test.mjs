import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  expectedRuntimeV2OuterAgentInputCount,
  RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS,
  validateRuntimeV2VideoUseRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";

const dashboardRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = path.dirname(dashboardRoot);
const workerPath = path.join(dashboardRoot, "scripts", "runtime-v2-video-use-worker.mjs");
const CONTROL_TOKEN = "video-use-runtime-control-token-000001";
const CHATMOCK_KEY = "video-use-runtime-chatmock-key";
const SOURCE_VIDEO = Buffer.alloc(96);
SOURCE_VIDEO.write("ftyp", 4, "ascii");
const RENDERED_VIDEO = Buffer.alloc(128);
RENDERED_VIDEO.write("ftyp", 4, "ascii");

const source = (relativePath) =>
  fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");

function canonicalRequest(conversationPublicId, baseUrl, artifactId, overrides = {}) {
  return {
    conversationPublicId,
    request: {
      source: { kind: "artifact", artifactId },
      prompt: "Trim the ending and keep the opening beat.",
      quality: "final",
    },
    model: "test-model",
    reasoningEffort: "medium",
    baseUrl,
    conversationContext: "User: Keep the opening exactly as it is.",
    ...overrides,
  };
}

function isolated(script, dataRoot) {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: dashboardRoot,
    env: {
      ...process.env,
      BREADBOARD_DATA_DIR: dataRoot,
      NODE_NO_WARNINGS: "1",
    },
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function seedConversationAndVideo(dataRoot) {
  const dbUrl = pathToFileURL(path.join(dashboardRoot, "src", "lib", "db.ts")).href;
  const conversationsUrl = pathToFileURL(
    path.join(dashboardRoot, "src", "lib", "conversations", "store.ts"),
  ).href;
  const runtimeUrl = pathToFileURL(
    path.join(dashboardRoot, "src", "lib", "hermes", "runtime-store.ts"),
  ).href;
  const runsUrl = pathToFileURL(
    path.join(dashboardRoot, "src", "lib", "hermes", "run-store.ts"),
  ).href;
  const artifactsUrl = pathToFileURL(
    path.join(dashboardRoot, "src", "lib", "hermes", "artifact-store.ts"),
  ).href;
  const seedRoot = path.join(dataRoot, "seed-video");
  const videoPath = path.join(seedRoot, "source.mp4");
  fs.mkdirSync(seedRoot, { recursive: true });
  fs.writeFileSync(videoPath, SOURCE_VIDEO);
  const script = [
    `const { default: db } = await import(${JSON.stringify(dbUrl)});`,
    `const conversations = await import(${JSON.stringify(conversationsUrl)});`,
    `const runtime = await import(${JSON.stringify(runtimeUrl)});`,
    `const runs = await import(${JSON.stringify(runsUrl)});`,
    `const artifacts = await import(${JSON.stringify(artifactsUrl)});`,
    "db.prepare(\"INSERT INTO users(id, username, email, password_hash) VALUES (7, 'video-use-runtime', 'video-use-runtime@example.test', 'x')\").run();",
    "db.prepare(\"INSERT INTO users(id, username, email, password_hash) VALUES (8, 'video-use-foreign', 'video-use-foreign@example.test', 'x')\").run();",
    "const conversation = conversations.createConversation({ userId: 7, title: 'Runtime Video Use test' });",
    "const foreignConversation = conversations.createConversation({ userId: 8, title: 'Foreign Video Use test' });",
    `const session = runtime.createRuntimeSession({ conversationId: conversation.id, surface: "dashboard_terminal", userId: 7, chatSessionId: null, agentName: "Breadboard", clusterId: null, gardenId: null, pageSlug: null, workspaceKey: "video-use-runtime", activeDirectory: ${JSON.stringify(dataRoot)}, filesystemMode: "restricted", hermesSessionId: "hermes_video_use_runtime" });`,
    "const run = runs.beginRuntimeRun({ runtimeSessionId: session.id, instruction: 'Seed video', dispatch: { conversationPublicId: conversation.public_id, runtimeText: 'Seed video' } });",
    `const artifact = await artifacts.createImportedArtifact({ userId: 7, runtimeSessionId: session.id, hermesSessionId: "hermes_video_use_runtime", conversationId: conversation.id, clusterId: null, runId: run.id, assistantMessageId: null, toolCallId: null, surface: "dashboard_terminal", kind: "video", title: "Runtime source", filename: "source.mp4", authorizedRoot: ${JSON.stringify(seedRoot)}, filePath: ${JSON.stringify(videoPath)}, parentArtifactId: null, metadata: { videoUseSourceName: "source.mp4" }, sourceHermesTool: "video_use_runtime_seed" });`,
    "runs.finishRuntimeRun(run.id, 'completed');",
    "process.stdout.write(JSON.stringify({ conversationId: conversation.id, conversationPublicId: conversation.public_id, foreignConversationPublicId: foreignConversation.public_id, artifactId: artifact.id }));",
  ].join("\n");
  const seeded = JSON.parse(isolated(script, dataRoot));
  assert.match(seeded.conversationPublicId, /^conv_[A-Za-z0-9_-]{24}$/u);
  assert.match(seeded.foreignConversationPublicId, /^conv_[A-Za-z0-9_-]{24}$/u);
  assert.match(seeded.artifactId, /^art_[a-z0-9-]{6,64}$/iu);
  return seeded;
}

function inspectArtifact(dataRoot, artifactId) {
  const artifactsUrl = pathToFileURL(
    path.join(dashboardRoot, "src", "lib", "hermes", "artifact-store.ts"),
  ).href;
  const script = [
    `const fs = await import("node:fs");`,
    `const artifacts = await import(${JSON.stringify(artifactsUrl)});`,
    `const row = artifacts.getArtifactById(${JSON.stringify(artifactId)});`,
    "const file = artifacts.artifactFile({ artifact: row, version: row.current_version, purpose: 'download' });",
    "process.stdout.write(JSON.stringify({ row, bytes: fs.readFileSync(file.path).toString('base64') }));",
  ].join("\n");
  return JSON.parse(isolated(script, dataRoot));
}

function runtimeFixture(request, dataRoot) {
  const jobId = "job_video_use_1";
  const workerInstanceId = "worker_video_use_1";
  const jobRoot = path.join(dataRoot, "runtime", "jobs", jobId);
  const attemptRoot = path.join(jobRoot, "attempts", "1", workerInstanceId);
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(jobRoot, "input.json"), `${JSON.stringify(request)}\n`);
  fs.writeFileSync(
    path.join(attemptRoot, "start.json"),
    `${JSON.stringify({
      protocolVersion: 1,
      identity: { jobId, attempt: 1, workerInstanceId },
      executionScope: {
        userId: 7,
        gardenId: null,
        conversationId: `oa_video_use_${"a".repeat(32)}`,
      },
      inputManifestPath: `runtime/jobs/${jobId}/input.json`,
      inputBlobs: [],
      workspacePath: `runtime/jobs/${jobId}/attempts/1/${workerInstanceId}/workspace`,
      checkpointPath: `runtime/jobs/${jobId}/checkpoint.json`,
      resultPath: `runtime/jobs/${jobId}/result.json`,
    })}\n`,
  );
  return { dataRoot, jobRoot, attemptRoot };
}

function jobSnapshot(jobId, scope, state) {
  const now = Date.now();
  const terminal = state === "succeeded" || state === "cancelled";
  return {
    jobId,
    jobType: "speech-media",
    workerKind: "speech-media-node",
    resourceClass: "media-processing",
    state,
    stage: state === "succeeded" ? "finalizing" : state === "cancelled" ? "cancelling" : "processing",
    attempt: 1,
    workerInstanceId: `worker_${jobId}`,
    gardenId: null,
    conversationId: scope,
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    finishedAt: terminal ? now : null,
    lastHeartbeatAt: now,
    lastWorkerSequence: state === "succeeded" ? 3 : state === "cancelled" ? 2 : 1,
    progressCurrent: 0,
    progressTotal: 0,
    failureCode: null,
    failureMessage: null,
    resourceExhaustion: null,
    cancellationRequested: state === "cancelled",
  };
}

function runtimeGateway(dataRoot, { holdProbe = false } = {}) {
  const jobs = new Map();
  const submissions = [];
  const pending = new Set();
  let origin = "";
  let probeSubmittedResolve;
  let cancellationSeenResolve;
  const probeSubmitted = new Promise((resolve) => {
    probeSubmittedResolve = resolve;
  });
  const cancellationSeen = new Promise((resolve) => {
    cancellationSeenResolve = resolve;
  });
  let modelAuthorization = "";
  let modelRequest = null;

  const send = (response, status, value) => {
    const body = JSON.stringify(value);
    response.writeHead(status, {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    });
    response.end(body);
  };
  const server = http.createServer((request, response) => {
    pending.add(response);
    response.on("close", () => pending.delete(response));
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (request.url === "/v1/chat/completions" && request.method === "POST") {
        modelAuthorization = request.headers.authorization ?? "";
        modelRequest = JSON.parse(body);
        send(response, 200, {
          choices: [{
            message: {
              content: JSON.stringify({
                summary: "Trimmed the ending while preserving the opening beat.",
                ranges: [{ start: 0, end: 1, reason: "Keep the requested opening." }],
                grade: null,
                aspect: "original",
                subtitles: "none",
                transform: {
                  speed: 1,
                  mute: false,
                  volumeDb: 0,
                  fadeInSeconds: 0,
                  fadeOutSeconds: 0,
                  reverse: false,
                },
              }),
            },
          }],
          usage: { prompt_tokens: 31, completion_tokens: 17 },
        });
        return;
      }

      if (request.url === "/v1/jobs" && request.method === "POST") {
        assert.equal(request.headers.authorization, `Bearer ${CONTROL_TOKEN}`);
        assert.equal(request.headers["x-breadboard-user-id"], "7");
        const submitted = JSON.parse(body);
        assert.equal(submitted.jobType, "speech-media");
        assert.equal(request.headers["x-breadboard-conversation-id"], submitted.conversationId);
        assert.doesNotMatch(body, /executable|argv|environment|CHATMOCK_API_KEY|CONTROL_TOKEN/u);
        const operation = submitted.requestPayload.operation;
        const jobId = `job_media_${jobs.size + 1}`;
        const state = holdProbe && operation === "video-probe" ? "running" : "succeeded";
        const snapshot = jobSnapshot(jobId, submitted.conversationId, state);
        const record = { snapshot, request: submitted, result: null };
        if (operation === "video-probe") {
          record.result = {
            ok: true,
            operation,
            probe: {
              durationSeconds: 2,
              width: 640,
              height: 360,
              fps: 30,
              hasAudio: false,
              videoCodec: "h264",
              audioCodec: null,
              sizeBytes: SOURCE_VIDEO.byteLength,
              portrait: false,
            },
          };
          probeSubmittedResolve();
        } else if (operation === "video-render") {
          const relative = `${submitted.requestPayload.sessionRootRelativePath}/edit/final.mp4`;
          const output = path.resolve(dataRoot, ...relative.split("/"));
          fs.mkdirSync(path.dirname(output), { recursive: true });
          fs.writeFileSync(output, RENDERED_VIDEO);
          record.result = {
            ok: true,
            operation,
            outputRelativePath: relative,
            durationSeconds: 1,
            sizeBytes: RENDERED_VIDEO.byteLength,
            width: 640,
            height: 360,
          };
        } else {
          assert.fail(`unexpected nested media operation ${operation}`);
        }
        jobs.set(jobId, record);
        submissions.push(submitted);
        send(response, 200, { type: "runtime-job", protocolVersion: 1, job: snapshot });
        return;
      }

      const match = /^\/v1\/jobs\/([A-Za-z0-9_-]+)(?:\/(result|cancel))?$/u.exec(
        request.url ?? "",
      );
      if (match) {
        const record = jobs.get(match[1]);
        assert.ok(record, "nested Runtime job must exist");
        if (match[2] === "result") {
          assert.equal(record.snapshot.state, "succeeded");
          send(response, 200, {
            type: "runtime-job-output",
            protocolVersion: 1,
            jobId: record.snapshot.jobId,
            kind: "result",
            content: {
              protocolVersion: 1,
              identity: {
                jobId: record.snapshot.jobId,
                attempt: record.snapshot.attempt,
                workerInstanceId: record.snapshot.workerInstanceId,
              },
              completionSequence: record.snapshot.lastWorkerSequence,
              result: record.result,
            },
          });
          return;
        }
        if (match[2] === "cancel") {
          record.snapshot = jobSnapshot(
            record.snapshot.jobId,
            record.snapshot.conversationId,
            "cancelled",
          );
          cancellationSeenResolve(record.request);
          send(response, 200, {
            type: "runtime-job",
            protocolVersion: 1,
            job: record.snapshot,
          });
          return;
        }
        send(response, 200, {
          type: "runtime-job",
          protocolVersion: 1,
          job: record.snapshot,
        });
        return;
      }
      send(response, 404, { error: "not_found" });
    });
  });
  return {
    submissions,
    probeSubmitted,
    cancellationSeen,
    get modelAuthorization() {
      return modelAuthorization;
    },
    get modelRequest() {
      return modelRequest;
    },
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      server.unref();
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server unavailable");
      origin = `http://127.0.0.1:${address.port}`;
      return origin;
    },
    async close() {
      for (const response of pending) response.destroy();
      server.closeAllConnections?.();
      await Promise.race([
        new Promise((resolve) => server.close(resolve)),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
    },
  };
}

function runWorker(fixture, serviceUrl, { cancelWhen } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, "start.json"], {
      cwd: fixture.attemptRoot,
      env: {
        ...process.env,
        BREADBOARD_DATA_DIR: fixture.dataRoot,
        BREADBOARD_RUNTIME_V2_ACTIVE: "true",
        BREADBOARD_SUPERVISOR_CONTROL_URL: serviceUrl,
        BREADBOARD_SUPERVISOR_CONTROL_TOKEN: CONTROL_TOKEN,
        BREADBOARD_RUNTIME_V2_MEDIA_PYTHON_PATH: process.execPath,
        BREADBOARD_RUNTIME_V2_MEDIA_FFMPEG_PATH: process.execPath,
        BREADBOARD_RUNTIME_V2_MEDIA_FFPROBE_PATH: process.execPath,
        VIDEO_USE_ROOT: path.join(repositoryRoot, "video-use"),
        VIDEO_TRANSCRIPTION_ENABLED: "false",
        SUBSAI_ROOT: path.join(fixture.dataRoot, "missing-subsai"),
        CHATMOCK_API_KEY: CHATMOCK_KEY,
        NODE_NO_WARNINGS: "1",
        BREADBOARD_QA_MODE: "",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Video Use Runtime worker timed out.\n${stderr}`));
    }, 45_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    if (cancelWhen) {
      void cancelWhen.then(() => {
        if (child.exitCode === null) child.stdin.write('{"type":"stop","force":false}\n');
      });
    }
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test("Video Use accepts one exact zero-input request with no execution or secret authority", () => {
  const request = canonicalRequest(
    `conv_${"v".repeat(24)}`,
    "http://127.0.0.1:8765/v1",
    "art_abcdef",
  );
  assert.equal(validateRuntimeV2VideoUseRequest(request), request);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("video-use", request), 0);
  assert.deepEqual(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS["video-use"], {
    id: "video-use",
    workerKind: "outer-video-use-node",
    jobType: "video-use-run",
    scopePrefix: "oa_video_use_",
    maximumInputs: 0,
    maximumProjectionBytes: 4 * 1024 * 1024,
  });
  const validAttachment = canonicalRequest(
    request.conversationPublicId,
    request.baseUrl,
    "art_abcdef",
    {
      request: {
        source: { kind: "attachment", blobId: `vid_${"a".repeat(32)}`, filename: "talk.mp4" },
        prompt: "Remove the pauses.",
        quality: "preview",
      },
    },
  );
  const validUrl = canonicalRequest(request.conversationPublicId, request.baseUrl, "art_abcdef", {
    request: {
      source: { kind: "url", url: "https://www.youtube.com/watch?v=T-MUZP_rtzE" },
      prompt: "Make this vertical.",
      quality: "final",
    },
  });
  assert.equal(validateRuntimeV2VideoUseRequest(validAttachment), validAttachment);
  assert.equal(validateRuntimeV2VideoUseRequest(validUrl), validUrl);
  for (const invalid of [
    { ...request, executable: "python.exe" },
    { ...request, argv: ["attacker.py"] },
    { ...request, env: { CHATMOCK_API_KEY: "renderer-secret" } },
    { ...request, apiKey: "renderer-secret" },
    { ...request, conversationPublicId: "conv_other" },
    { ...request, reasoningEffort: "max" },
    { ...request, baseUrl: "http://user:secret@127.0.0.1:8765/v1" },
    { ...request, request: { ...request.request, prompt: "x".repeat(4_001) } },
    { ...request, request: { ...request.request, quality: "lossless" } },
    { ...validAttachment, request: { ...validAttachment.request, source: { ...validAttachment.request.source, filename: "../../talk.mp4" } } },
    { ...validUrl, request: { ...validUrl.request, source: { kind: "url", url: "file:///etc/passwd" } } },
  ]) {
    assert.throws(
      () => validateRuntimeV2VideoUseRequest(invalid),
      /canonical Video Use Runtime request is invalid/u,
    );
  }
});

test("Video Use routes are a durable idempotent facade with no Next-owned pipeline", () => {
  const facade = source("src/lib/video-use/runtime-run-manager.ts");
  const manager = source("src/lib/video-use/run-manager.ts");
  const plan = source("src/lib/video-use/plan.ts");
  const launch = source("src/app/api/video-use/runs/route.ts");
  const events = source("src/app/api/video-use/runs/[runId]/events/route.ts");
  const abort = source("src/app/api/video-use/runs/[runId]/abort/route.ts");
  const cancellation = source("src/lib/conversations/external-agent-cancel.ts");
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const artifactStudio = source("src/app/components/hermes/artifact-video-studio.tsx");
  const terminalLauncher = terminal.slice(
    terminal.indexOf("const launchVideoUseRun = useCallback"),
    terminal.indexOf("const videoUseSource = useCallback"),
  );
  const terminalLaunchBody = terminalLauncher.slice(
    terminalLauncher.indexOf("body: JSON.stringify({"),
    terminalLauncher.indexOf("const data = await response.json"),
  );

  assert.match(facade, /kind: "video-use"/u);
  assert.match(facade, /requestId: input\.clientMessageId/u);
  assert.doesNotMatch(facade, /node:child_process|startRuntimeWorkerRun|\.\/artifact|\.\/plan|\.\/render/u);
  assert.match(manager, /export function startRuntimeWorkerRun/u);
  assert.match(manager, /runtimeJobId/u);
  assert.match(manager, /export async function abortRuntimeWorkerRun/u);
  assert.match(manager, /await run\.settled/u);
  assert.doesNotMatch(manager, /export function (?:startRun|abortRun)\s*\(/u);
  assert.match(plan, /MAX_MODEL_REQUEST_BYTES/u);
  assert.match(plan, /MAX_MODEL_RESPONSE_BYTES/u);
  assert.match(plan, /chatmockApiKeyValue\(\)/u);
  assert.match(launch, /video-use\/runtime-run-manager\.ts/u);
  assert.match(launch, /clientMessageId/u);
  assert.match(launch, /await startRun\(/u);
  assert.doesNotMatch(launch, /video-use\/run-manager|node:child_process|\bspawn\s*\(/u);
  assert.match(events, /outerAgentEventsResponse/u);
  assert.match(events, /readOuterAgentRunView\("video-use"/u);
  assert.doesNotMatch(events, /setInterval|video-use\/run-manager/u);
  assert.match(abort, /await abortRun\(userId, runId\)/u);
  assert.match(cancellation, /video-use\/runtime-run-manager\.ts/u);
  assert.match(terminalLaunchBody, /conversationPublicId,/u);
  assert.match(terminalLaunchBody, /clientMessageId,/u);
  assert.match(artifactStudio, /clientMessageId: crypto\.randomUUID\(\)/u);
  assert.match(
    source("scripts/runtime-v2-video-use-worker.mjs"),
    /runRuntimeV2OuterAgentWorker\("video-use"\)/u,
  );
  for (const relative of [
    "src/lib/video-use/run-manager.ts",
    "src/lib/video-use/media.ts",
    "src/lib/video-use/render.ts",
    "src/lib/video-use/transcript.ts",
    "src/lib/video-sources/download.ts",
  ]) {
    assert.doesNotMatch(source(relative), /node:child_process|\bspawn\s*\(|\bspawnSync\s*\(/u, relative);
  }
});

test("the real disposable Video Use worker publishes one conversation-bound video revision", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-video-use-runtime-"));
  const seeded = seedConversationAndVideo(dataRoot);
  const gateway = runtimeGateway(dataRoot);
  const serviceUrl = await gateway.listen();
  const request = canonicalRequest(
    seeded.conversationPublicId,
    `${serviceUrl}/v1`,
    seeded.artifactId,
  );
  const fixture = runtimeFixture(request, dataRoot);
  try {
    const child = await runWorker(fixture, serviceUrl);
    assert.equal(child.code, 0, child.stderr);
    assert.equal(gateway.modelAuthorization, `Bearer ${CHATMOCK_KEY}`);
    assert.equal(gateway.modelRequest.model, request.model);
    assert.equal(gateway.submissions.length, 2);
    assert.deepEqual(
      gateway.submissions.map((entry) => entry.requestPayload.operation),
      ["video-probe", "video-render"],
    );
    assert.ok(
      gateway.submissions.every(
        (entry) => entry.conversationId === seeded.conversationPublicId,
      ),
    );

    const result = JSON.parse(fs.readFileSync(path.join(fixture.jobRoot, "result.json"), "utf8"));
    assert.equal(result.protocolVersion, 1);
    assert.equal(result.run.adapterId, "video-use");
    assert.equal(result.run.status, "completed");
    const terminal = result.run.events.find((event) => event.type === "run.completed");
    assert.equal(terminal.payload.artifactId, seeded.artifactId);
    assert.equal(terminal.payload.version, 2);
    assert.match(terminal.payload.summary, /Trimmed the ending while preserving the opening beat/u);
    assert.ok(result.run.events.some((event) => event.type === "source.probed"));
    assert.ok(result.run.events.some((event) => event.type === "plan.ready"));
    assert.ok(result.run.events.some((event) => event.type === "artifact.stored"));

    const artifact = inspectArtifact(dataRoot, seeded.artifactId);
    assert.equal(artifact.row.user_id, 7);
    assert.equal(artifact.row.conversation_id, seeded.conversationId);
    assert.equal(artifact.row.kind, "video");
    assert.equal(artifact.row.current_version, 2);
    assert.equal(artifact.bytes, RENDERED_VIDEO.toString("base64"));
    const metadata = JSON.parse(artifact.row.metadata_json);
    assert.equal(metadata.videoUseEdited, true);
    assert.equal(metadata.videoUseLastPrompt, request.request.prompt);
    assert.match(child.stdout, /"type":"ready"/u);
    assert.match(child.stdout, /"type":"complete"/u);
  } finally {
    await gateway.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("the worker cannot move a user's video into another user's conversation", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-video-use-scope-"));
  const seeded = seedConversationAndVideo(dataRoot);
  const gateway = runtimeGateway(dataRoot);
  const serviceUrl = await gateway.listen();
  const fixture = runtimeFixture(
    canonicalRequest(
      seeded.foreignConversationPublicId,
      `${serviceUrl}/v1`,
      seeded.artifactId,
    ),
    dataRoot,
  );
  try {
    const child = await runWorker(fixture, serviceUrl);
    assert.equal(child.code, 1, child.stderr);
    assert.equal(fs.existsSync(path.join(fixture.jobRoot, "result.json")), false);
    const checkpoint = JSON.parse(
      fs.readFileSync(path.join(fixture.jobRoot, "checkpoint.json"), "utf8"),
    );
    assert.equal(checkpoint.status, "failed");
    assert.ok(checkpoint.events.some((event) => event.type === "run.failed"));
    assert.ok(
      checkpoint.events.every((event) =>
        !JSON.stringify(event).includes(seeded.conversationPublicId)
      ),
    );
    const artifact = inspectArtifact(dataRoot, seeded.artifactId);
    assert.equal(artifact.row.current_version, 1);
    assert.equal(artifact.bytes, SOURCE_VIDEO.toString("base64"));
  } finally {
    await gateway.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("a Runtime stop awaits nested media cancellation and publishes no video revision", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-video-use-cancel-"));
  const seeded = seedConversationAndVideo(dataRoot);
  const gateway = runtimeGateway(dataRoot, { holdProbe: true });
  const serviceUrl = await gateway.listen();
  const fixture = runtimeFixture(
    canonicalRequest(seeded.conversationPublicId, `${serviceUrl}/v1`, seeded.artifactId),
    dataRoot,
  );
  try {
    const child = await runWorker(fixture, serviceUrl, { cancelWhen: gateway.probeSubmitted });
    assert.equal(child.code, 0, child.stderr);
    const cancelledRequest = await Promise.race([
      gateway.cancellationSeen,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("nested media cancellation was not awaited")), 2_000),
      ),
    ]);
    assert.equal(cancelledRequest.requestPayload.operation, "video-probe");
    assert.equal(fs.existsSync(path.join(fixture.jobRoot, "result.json")), false);
    const checkpoint = JSON.parse(
      fs.readFileSync(path.join(fixture.jobRoot, "checkpoint.json"), "utf8"),
    );
    assert.equal(checkpoint.status, "aborted");
    assert.ok(checkpoint.events.some((event) => event.type === "run.started"));
    assert.ok(checkpoint.events.some((event) => event.type === "run.aborted"));
    assert.match(child.stdout, /"type":"cancellation-acknowledged"/u);

    const artifact = inspectArtifact(dataRoot, seeded.artifactId);
    assert.equal(artifact.row.current_version, 1);
    assert.equal(artifact.bytes, SOURCE_VIDEO.toString("base64"));
  } finally {
    await gateway.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
