import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  executeRuntimeV2CinemaAdapter,
  RUNTIME_V2_CINEMA_ADAPTERS,
  validateRuntimeV2CinemaRequest,
} from "../scripts/runtime-v2-cinema-agent-adapters.mjs";
import {
  loadRuntimeV2CinemaLaunch,
  parseRuntimeV2CinemaStopRecord,
} from "../scripts/runtime-v2-cinema-agent-worker-core.mjs";

function vimaxRequest(overrides = {}) {
  return {
    operation: "run",
    runId: `vmxrun_${"a".repeat(32)}`,
    conversationPublicId: "conv_vimax_1",
    brief: "A lighthouse keeper befriends a whale --no-images",
    parsed: {
      brief: "A lighthouse keeper befriends a whale",
      mode: "idea2video",
      style: null,
      sceneCount: null,
      shotBudget: null,
      aspectRatio: "16:9",
      images: false,
      imageGenerator: "auto",
      userRequirement: "",
    },
    model: "test-model",
    reasoningEffort: "medium",
    baseUrl: "http://127.0.0.1:8765/v1",
    conversationContext: "",
    ...overrides,
  };
}

function voxRequest(overrides = {}) {
  return {
    operation: "run",
    runId: `voxrun_${"b".repeat(32)}`,
    conversationPublicId: "conv_vox_1",
    brief: "Explain photosynthesis --no-images --no-music",
    parsed: {
      brief: "Explain photosynthesis",
      duration: 30,
      aspectRatio: "16:9",
      style: null,
      motion: "local",
      images: false,
      music: false,
      seed: null,
    },
    model: "test-model",
    reasoningEffort: "high",
    baseUrl: "http://127.0.0.1:8765/v1",
    conversationContext: "",
    checkpoint: null,
    steps: 26,
    cfg: 6.5,
    voiceProfileId: null,
    musicTrack: null,
    ...overrides,
  };
}

function fixture(agentKind, request) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-cinema-runtime-"));
  const identity = {
    jobId: `job_${agentKind.replace("-", "_")}_1`,
    attempt: 1,
    workerInstanceId: `worker_${agentKind.replace("-", "_")}_1`,
  };
  const jobRoot = path.join(root, "runtime", "jobs", identity.jobId);
  const attemptRoot = path.join(jobRoot, "attempts", "1", identity.workerInstanceId);
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(jobRoot, "input.json"), `${JSON.stringify(request)}\n`);
  fs.writeFileSync(path.join(attemptRoot, "start.json"), `${JSON.stringify({
    protocolVersion: 1,
    identity,
    executionScope: {
      userId: 17,
      gardenId: null,
      conversationId: request.operation === "health" ? null : request.conversationPublicId,
    },
    inputManifestPath: `runtime/jobs/${identity.jobId}/input.json`,
    inputBlobs: [],
    workspacePath: `runtime/jobs/${identity.jobId}/attempts/1/${identity.workerInstanceId}/workspace`,
    checkpointPath: `runtime/jobs/${identity.jobId}/checkpoint.json`,
    resultPath: `runtime/jobs/${identity.jobId}/result.json`,
  })}\n`);
  return { root, identity, jobRoot, attemptRoot };
}

test("ViMax and Vox Director have two fixed sealed Runtime profiles", () => {
  assert.deepEqual(Object.keys(RUNTIME_V2_CINEMA_ADAPTERS), ["vimax", "vox-director"]);
  assert.deepEqual(RUNTIME_V2_CINEMA_ADAPTERS.vimax, {
    id: "vimax",
    jobType: "vimax-run",
    workerKind: "vimax-node",
    manager: ["lib", "vimax", "run-manager.ts"],
  });
  assert.deepEqual(RUNTIME_V2_CINEMA_ADAPTERS["vox-director"], {
    id: "vox-director",
    jobType: "vox-director-run",
    workerKind: "vox-director-node",
    manager: ["lib", "vox-director", "run-manager.ts"],
  });
  assert.ok(Object.isFrozen(RUNTIME_V2_CINEMA_ADAPTERS));
  assert.ok(Object.values(RUNTIME_V2_CINEMA_ADAPTERS).every(Object.isFrozen));
});

test("canonical cinema requests contain product data, never process or secret controls", () => {
  assert.equal(validateRuntimeV2CinemaRequest("vimax", vimaxRequest()).operation, "run");
  assert.equal(validateRuntimeV2CinemaRequest("vox-director", voxRequest()).operation, "run");
  assert.equal(validateRuntimeV2CinemaRequest("vox-director", {
    operation: "health",
    baseUrl: "http://127.0.0.1:8765/v1",
    checkpoint: null,
    voiceProfileId: null,
  }).operation, "health");
  for (const override of [
    { executable: "python.exe" },
    { argv: ["-c", "steal()"] },
    { env: { PATH: "attacker" } },
    { apiKey: "renderer-secret" },
  ]) {
    assert.throws(
      () => validateRuntimeV2CinemaRequest("vimax", { ...vimaxRequest(), ...override }),
      /invalid/u,
    );
    assert.throws(
      () => validateRuntimeV2CinemaRequest("vox-director", { ...voxRequest(), ...override }),
      /invalid/u,
    );
  }
  assert.throws(
    () => validateRuntimeV2CinemaRequest("vox-director", voxRequest({ steps: 1_000 })),
    /invalid/u,
  );
});

test("launch loading binds identity, scope and zero-input private paths", () => {
  const current = fixture("vimax", vimaxRequest());
  try {
    const launch = loadRuntimeV2CinemaLaunch({
      agentKind: "vimax",
      argv: ["start.json"],
      launchDirectory: current.attemptRoot,
    });
    assert.deepEqual(launch.identity, current.identity);
    assert.deepEqual(launch.executionScope, {
      userId: 17,
      gardenId: null,
      conversationId: "conv_vimax_1",
    });
    const manifestPath = path.join(current.attemptRoot, "start.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.inputBlobs = [{ blobId: "renderer_blob" }];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(
      () => loadRuntimeV2CinemaLaunch({
        agentKind: "vimax",
        argv: ["start.json"],
        launchDirectory: current.attemptRoot,
      }),
      /does not accept renderer-supplied blobs/u,
    );
  } finally {
    fs.rmSync(current.root, { recursive: true, force: true });
  }
});

test("stop input accepts one graceful fixed record and rejects force or forged fields", () => {
  assert.doesNotThrow(() => parseRuntimeV2CinemaStopRecord('{"type":"stop","force":false}\n'));
  for (const invalid of [
    '{"type":"stop","force":true}\n',
    '{"type":"stop","force":false,"pid":4}\n',
    '{"type":"stop","force":false}',
  ]) assert.throws(() => parseRuntimeV2CinemaStopRecord(invalid), /stop record/u);
});

test("the adapter forwards the worker-local event protocol without changing payloads", async () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-cinema-adapter-"));
  const managerPath = path.join(sourceRoot, "lib", "vimax", "run-manager.ts");
  fs.mkdirSync(path.dirname(managerPath), { recursive: true });
  fs.writeFileSync(managerPath, `
    const events = [
      { sequenceNumber: 1, type: "run.started", payload: { brief: "fixture" }, at: "2026-08-26T00:00:00.000Z" },
      { sequenceNumber: 2, type: "run.completed", payload: { summary: "finished" }, at: "2026-08-26T00:00:01.000Z" },
    ];
    let delivered = 0;
    export function startRuntimeWorkerRun(input) { return { runId: input.runId, status: "queued" }; }
    export function getEventsSince(_userId, _runId, cursor) {
      const next = events.filter((event) => event.sequenceNumber > cursor).slice(0, 1);
      if (next.length) delivered = next[0].sequenceNumber;
      return next;
    }
    export function isTerminal() { return delivered >= events.length; }
    export function abortRun() { return true; }
  `);
  const updates = [];
  try {
    const request = vimaxRequest();
    const outcome = await executeRuntimeV2CinemaAdapter({
      agentKind: "vimax",
      launch: {
        request,
        executionScope: { userId: 17, gardenId: null, conversationId: request.conversationPublicId },
      },
      sourceRoot,
      signal: new AbortController().signal,
      update: (events, status) => updates.push({ events: structuredClone(events), status }),
    });
    assert.equal(outcome.status, "completed");
    assert.equal(updates[0].status, "queued");
    assert.deepEqual(updates[1], {
      events: [{ sequenceNumber: 1, type: "run.started", payload: { brief: "fixture" }, at: "2026-08-26T00:00:00.000Z" }],
      status: "running",
    });
    assert.deepEqual(updates[2].events.map((event) => event.type), ["run.completed"]);
    assert.equal(updates[2].status, "completed");
    assert.deepEqual(updates[2].events[0].payload, { summary: "finished" });
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
});
