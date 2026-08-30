import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  validateRuntimeV2AgentTarsRequest,
  validateRuntimeV2BoltSlidesRequest,
  validateRuntimeV2CareerOpsRequest,
  validateRuntimeV2CodexRequest,
  validateRuntimeV2DeepTutorRequest,
  validateRuntimeV2HyperframesRequest,
  validateRuntimeV2OpenCodeRequest,
  validateRuntimeV2OpenGymRequest,
  validateRuntimeV2OpenMontageRequest,
  validateRuntimeV2OpenPlanterRequest,
  validateRuntimeV2OpenworkRequest,
  validateRuntimeV2MatraixRequest,
  validateRuntimeV2Resource2SkillRequest,
  validateRuntimeV2RufloRequest,
  validateRuntimeV2ShortsRequest,
  validateRuntimeV2TradingAgentRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";
import {
  loadRuntimeV2OuterAgentLaunch,
  parseRuntimeV2OuterAgentStopRecord,
} from "../scripts/runtime-v2-outer-agent-worker-core.mjs";

const dashboardRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = (relativePath) => fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");

function codingRequest(repositoryPath, overrides = {}) {
  return {
    task: "Fix the bounded issue",
    instruction: "Fix the bounded issue",
    skill: null,
    model: "test-model",
    reasoningEffort: "high",
    baseUrl: "http://127.0.0.1:8765/v1",
    repositoryPath,
    repositoryName: "project",
    gardenSlug: "project",
    attachmentCount: 0,
    graftEnabled: true,
    ...overrides,
  };
}

function rufloRequest(repositoryPath, overrides = {}) {
  return {
    objective: "Fix the bounded issue",
    instruction: "Fix the bounded issue",
    skill: null,
    workers: 6,
    queenType: "strategic",
    consensus: "byzantine",
    topology: "hierarchical-mesh",
    repositoryPath,
    repositoryName: "project",
    gardenSlug: "project",
    attachmentCount: 0,
    graftEnabled: true,
    ...overrides,
  };
}

function tutorRequest(overrides = {}) {
  return {
    request: {
      message: "Explain this idea",
      capability: "chat",
      tools: ["reason"],
      fresh: false,
      useMaterial: true,
      questionCount: 5,
      language: "en",
    },
    scope: {
      surface: "dashboard_terminal",
      clusterSlug: null,
      gardenName: null,
    },
    model: "test-model",
    reasoningEffort: "medium",
    baseUrl: "http://127.0.0.1:8765/v1",
    conversationContext: "",
    ...overrides,
  };
}

function tradingRequest(overrides = {}) {
  return {
    request: {
      ticker: "NVDA",
      tradeDate: "2026-08-04",
      analysts: ["market", "news"],
      researchDepth: 2,
      riskRounds: 1,
      assetType: "stock",
    },
    settings: {
      analysts: ["market", "news"],
      researchDepth: 2,
      riskRounds: 1,
      assetType: "stock",
      deepModel: "",
      quickModel: "",
      reasoningEffort: "",
      outputLanguage: "English",
      marketVendor: "yfinance",
      newsVendor: "yfinance",
    },
    model: "test-model",
    reasoningEffort: "medium",
    baseUrl: "http://127.0.0.1:8765/v1",
    ...overrides,
  };
}

function careerOpsRequest(overrides = {}) {
  return {
    task: "Evaluate this role against my background",
    model: "test-model",
    reasoningEffort: "medium",
    baseUrl: "http://127.0.0.1:8765/v1",
    maxSteps: 24,
    conversationContext: "User: I prefer infrastructure roles.",
    ...overrides,
  };
}

function shortsRequest(overrides = {}) {
  return {
    request: {
      source: { kind: "url", url: "https://example.com/talk.mp4" },
      clipCount: 3,
      aspectRatio: "9:16",
      resolution: "720",
      language: "",
    },
    conversationPublicId: `conv_${"a".repeat(24)}`,
    model: "test-model",
    whisperModel: "base",
    baseUrl: "http://127.0.0.1:8765/v1",
    ...overrides,
  };
}

function openGymRequest(overrides = {}) {
  return {
    task: "Build a three-day strength program",
    model: "test-model",
    reasoningEffort: "medium",
    baseUrl: "http://127.0.0.1:8765/v1",
    conversationContext: "User: I train at home.",
    conversationPublicId: `conv_${"b".repeat(24)}`,
    maxSteps: 16,
    ...overrides,
  };
}

function openPlanterRequest(overrides = {}) {
  return {
    task: "Map the evidence across the supplied context",
    model: "test-model",
    reasoningEffort: "medium",
    baseUrl: "http://127.0.0.1:8765/v1",
    conversationContext: "User: Focus on ownership links.",
    ...overrides,
  };
}

function resource2SkillRequest(overrides = {}) {
  return {
    task: "Build an eight-slide launch presentation",
    domain: "ppt",
    model: "test-model",
    reasoningEffort: "medium",
    maxIterations: 60,
    baseUrl: "http://127.0.0.1:8765/v1",
    conversationContext: "User: Keep the existing visual identity.",
    ...overrides,
  };
}

function matraixRequest(overrides = {}) {
  return {
    request: {
      brief: "Would parents pay four dollars per month?",
      respondents: 12,
      seed: 42,
      filters: { life_stage: ["Parent of young kids"] },
      stratify: [],
      groupBy: ["region"],
      sources: [],
      allocation: "equalTotal",
      pool: null,
    },
    model: "test-model",
    reasoningEffort: "",
    baseUrl: "http://127.0.0.1:8765/v1",
    conversationContext: "User: The product is a family planner.",
    ...overrides,
  };
}

function hyperframesRequest(overrides = {}) {
  return {
    brief: "Make a ten-second launch video with kinetic type.",
    model: "test-model",
    reasoningEffort: "high",
    baseUrl: "http://127.0.0.1:8765/v1",
    conversationContext: "User: Keep the black and amber visual identity.",
    ...overrides,
  };
}

function openMontageRequest(overrides = {}) {
  return {
    brief: "Make a sixty-second documentary montage about deep time.",
    model: "test-model",
    reasoningEffort: "high",
    baseUrl: "http://127.0.0.1:8765/v1",
    conversationContext: "User: Use the restrained tone we discussed.",
    ...overrides,
  };
}

function boltSlidesRequest(overrides = {}) {
  return {
    brief: "Make a launch deck --slides 8 --theme swiss",
    request: {
      brief: "Make a launch deck",
      slides: 8,
      theme: "swiss",
      brandUrl: "https://example.com/brand",
    },
    model: "test-model",
    reasoningEffort: "high",
    baseUrl: "http://127.0.0.1:8765/v1",
    conversationPublicId: `conv_${"c".repeat(24)}`,
    conversationContext: "User: Use the positioning from the prior turn.",
    ...overrides,
  };
}

function runtimeFixture({ adapterId = "codex", request, image = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-outer-runtime-"));
  const repositoryPath = path.join(root, "repository");
  fs.mkdirSync(repositoryPath);
  const jobId = "job_outer_1";
  const workerInstanceId = "worker_outer_1";
  const attemptRoot = path.join(
    root,
    "runtime",
    "jobs",
    jobId,
    "attempts",
    "1",
    workerInstanceId,
  );
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  const jobRoot = path.join(root, "runtime", "jobs", jobId);
  const inputBlobs = [];
  if (image) {
    const blobId = "blob_outer_1";
    const inputPath = path.join(jobRoot, "inputs", blobId, "payload");
    fs.mkdirSync(path.dirname(inputPath), { recursive: true });
    fs.writeFileSync(inputPath, image);
    inputBlobs.push({
      blobId,
      relativePath: `runtime/jobs/${jobId}/inputs/${blobId}/payload`,
      sizeBytes: image.byteLength,
      sha256: crypto.createHash("sha256").update(image).digest("hex"),
      displayName: "screenshot-1.png",
      mediaType: "image/png",
    });
  }
  const canonicalRequest = request ?? codingRequest(repositoryPath, {
    attachmentCount: inputBlobs.length,
  });
  fs.writeFileSync(path.join(jobRoot, "input.json"), JSON.stringify(canonicalRequest));
  const adapter = RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS[adapterId];
  fs.writeFileSync(path.join(attemptRoot, "start.json"), JSON.stringify({
    protocolVersion: 1,
    identity: { jobId, attempt: 1, workerInstanceId },
    executionScope: {
      userId: 7,
      gardenId: null,
      conversationId: `${adapter.scopePrefix}${"a".repeat(32)}`,
    },
    inputManifestPath: `runtime/jobs/${jobId}/input.json`,
    inputBlobs,
    workspacePath: `runtime/jobs/${jobId}/attempts/1/${workerInstanceId}/workspace`,
    checkpointPath: `runtime/jobs/${jobId}/checkpoint.json`,
    resultPath: `runtime/jobs/${jobId}/result.json`,
  }));
  return {
    root,
    repositoryPath,
    attemptRoot,
    jobRoot,
    jobId,
    inputBlobs,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("outer-agent Runtime adapters are one sealed registry", () => {
  assert.deepEqual(Object.keys(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS).sort(), [
    "agent-reach",
    "agent-tars",
    "bolt-slides",
    "career-ops",
    "codex",
    "deep-research",
    "deep-tutor",
    "deer-flow",
    "get-doc",
    "get-doc-download",
    "hardware-blueprint",
    "hyperframes",
    "inbox-zero",
    "legal",
    "matraix",
    "max-research",
    "meeting-notes",
    "money-printer",
    "open-gym",
    "opencode",
    "openmontage",
    "openplanter",
    "openscience",
    "openwork",
    "parametric-cad",
    "resource2skill",
    "ruflo",
    "shorts",
    "socials-manager",
    "stock-analyst",
    "trading-agent",
    "vibe-trading",
    "video-use",
    "wardrobe",
  ]);
  assert.deepEqual(
    Object.values(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS).map((adapter) => adapter.workerKind),
    [
      "outer-codex-node",
      "outer-ruflo-node",
      "outer-deep-tutor-node",
      "outer-deer-flow-node",
      "outer-deep-research-node",
      "outer-video-use-node",
      "outer-openscience-node",
      "outer-opencode-node",
      "outer-trading-agent-node",
      "outer-career-ops-node",
      "outer-agent-reach-node",
      "outer-agent-tars-node",
      "outer-openwork-node",
      "outer-shorts-node",
      "outer-open-gym-node",
      "outer-legal-node",
      "outer-openplanter-node",
      "outer-resource2skill-node",
      "outer-matraix-node",
      "outer-hyperframes-node",
      "outer-openmontage-node",
      "outer-bolt-slides-node",
      "outer-hardware-blueprint-node",
      "outer-inbox-zero-node",
      "outer-socials-manager-node",
      "outer-get-doc-node",
      "get-doc-download-node",
      "outer-meeting-notes-node",
      "outer-money-printer-node",
      "outer-max-research-node",
      "outer-wardrobe-node",
      "outer-parametric-cad-node",
      "outer-stock-analyst-node",
      "outer-vibe-trading-node",
    ],
  );
  assert.ok(Object.isFrozen(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS));
  for (const adapter of Object.values(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS)) {
    assert.ok(Object.isFrozen(adapter));
  }
});

test("canonical requests contain product inputs, never execution or secret overrides", () => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-outer-request-"));
  try {
    const codex = validateRuntimeV2CodexRequest(codingRequest(repository));
    assert.equal(expectedRuntimeV2OuterAgentInputCount("codex", codex), 0);
    const opencode = validateRuntimeV2OpenCodeRequest(codingRequest(repository, {
      reasoningEffort: "max",
    }));
    assert.equal(expectedRuntimeV2OuterAgentInputCount("opencode", opencode), 0);
    validateRuntimeV2RufloRequest(rufloRequest(repository));
    validateRuntimeV2DeepTutorRequest(tutorRequest());
    const trading = validateRuntimeV2TradingAgentRequest(tradingRequest());
    assert.equal(expectedRuntimeV2OuterAgentInputCount("trading-agent", trading), 0);
    const career = validateRuntimeV2CareerOpsRequest(careerOpsRequest());
    assert.equal(expectedRuntimeV2OuterAgentInputCount("career-ops", career), 0);
    const agentTars = validateRuntimeV2AgentTarsRequest({
      agentId: `uta_${"a".repeat(32)}`,
      task: "Open the browser and inspect the current page.",
      profileId: `utp_${"b".repeat(32)}`,
    });
    assert.equal(expectedRuntimeV2OuterAgentInputCount("agent-tars", agentTars), 0);
    const openwork = validateRuntimeV2OpenworkRequest({
      task: "Build the requested workspace artifact.",
      model: "test-model",
      reasoningEffort: "max",
      prompt: { deliverFiles: true, allowCommands: true },
      conversationContext: "The user asked for a durable file.",
      serviceScopeId: "openwork-request-1",
    });
    assert.equal(expectedRuntimeV2OuterAgentInputCount("openwork", openwork), 0);
    const shorts = validateRuntimeV2ShortsRequest(shortsRequest());
    assert.equal(expectedRuntimeV2OuterAgentInputCount("shorts", shorts), 0);
    const openGym = validateRuntimeV2OpenGymRequest(openGymRequest());
    assert.equal(expectedRuntimeV2OuterAgentInputCount("open-gym", openGym), 0);
    const openPlanter = validateRuntimeV2OpenPlanterRequest(openPlanterRequest());
    assert.equal(expectedRuntimeV2OuterAgentInputCount("openplanter", openPlanter), 0);
    const resource2skill = validateRuntimeV2Resource2SkillRequest(resource2SkillRequest());
    assert.equal(expectedRuntimeV2OuterAgentInputCount("resource2skill", resource2skill), 0);
    const matraix = validateRuntimeV2MatraixRequest(matraixRequest());
    assert.equal(expectedRuntimeV2OuterAgentInputCount("matraix", matraix), 0);
    const hyperframes = validateRuntimeV2HyperframesRequest(hyperframesRequest());
    assert.equal(expectedRuntimeV2OuterAgentInputCount("hyperframes", hyperframes), 0);
    const openmontage = validateRuntimeV2OpenMontageRequest(openMontageRequest());
    assert.equal(expectedRuntimeV2OuterAgentInputCount("openmontage", openmontage), 0);
    const boltSlides = validateRuntimeV2BoltSlidesRequest(boltSlidesRequest());
    assert.equal(expectedRuntimeV2OuterAgentInputCount("bolt-slides", boltSlides), 0);
    for (const override of [
      { argv: ["--dangerously-bypass"] },
      { env: { HOME: "elsewhere" } },
      { executable: "attacker.exe" },
      { apiKey: "browser-secret" },
    ]) {
      assert.throws(
        () => validateRuntimeV2CodexRequest({ ...codingRequest(repository), ...override }),
        /invalid/u,
      );
      assert.throws(
        () => validateRuntimeV2OpenCodeRequest({ ...codingRequest(repository), ...override }),
        /invalid/u,
      );
      assert.throws(
        () => validateRuntimeV2TradingAgentRequest({ ...tradingRequest(), ...override }),
        /invalid/u,
      );
      assert.throws(
        () => validateRuntimeV2CareerOpsRequest({ ...careerOpsRequest(), ...override }),
        /invalid/u,
      );
      assert.throws(
        () => validateRuntimeV2AgentTarsRequest({ ...agentTars, ...override }),
        /invalid/u,
      );
      assert.throws(
        () => validateRuntimeV2OpenworkRequest({ ...openwork, ...override }),
        /invalid/u,
      );
      assert.throws(
        () => validateRuntimeV2ShortsRequest({ ...shortsRequest(), ...override }),
        /invalid/u,
      );
      assert.throws(
        () => validateRuntimeV2OpenGymRequest({ ...openGymRequest(), ...override }),
        /invalid/u,
      );
      assert.throws(
        () => validateRuntimeV2OpenPlanterRequest({ ...openPlanterRequest(), ...override }),
        /invalid/u,
      );
      assert.throws(
        () => validateRuntimeV2Resource2SkillRequest({ ...resource2SkillRequest(), ...override }),
        /invalid/u,
      );
      assert.throws(
        () => validateRuntimeV2MatraixRequest({ ...matraixRequest(), ...override }),
        /invalid/u,
      );
      assert.throws(
        () => validateRuntimeV2HyperframesRequest({ ...hyperframesRequest(), ...override }),
        /invalid/u,
      );
      assert.throws(
        () => validateRuntimeV2OpenMontageRequest({ ...openMontageRequest(), ...override }),
        /invalid/u,
      );
      assert.throws(
        () => validateRuntimeV2BoltSlidesRequest({ ...boltSlidesRequest(), ...override }),
        /invalid/u,
      );
    }
    assert.throws(
      () => validateRuntimeV2DeepTutorRequest(tutorRequest({
        scope: { surface: "garden_chat", clusterSlug: "../other", gardenName: "Other" },
      })),
      /invalid/u,
    );
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});

test("launch loading binds identity, scope, paths, count, size, and SHA-256", () => {
  const fixture = runtimeFixture({ image: Buffer.from("not-a-real-png-but-bounded") });
  try {
    const launch = loadRuntimeV2OuterAgentLaunch({
      adapterId: "codex",
      argv: ["start.json"],
      launchDirectory: fixture.attemptRoot,
    });
    assert.equal(launch.identity.jobId, fixture.jobId);
    assert.equal(launch.inputPaths.length, 1);
    assert.equal(fs.realpathSync.native(launch.inputPaths[0]), launch.inputPaths[0]);

    const payload = path.join(
      fixture.jobRoot,
      "inputs",
      fixture.inputBlobs[0].blobId,
      "payload",
    );
    fs.appendFileSync(payload, "tamper");
    assert.throws(
      () => loadRuntimeV2OuterAgentLaunch({
        adapterId: "codex",
        argv: ["start.json"],
        launchDirectory: fixture.attemptRoot,
      }),
      /invalid|integrity/u,
    );
  } finally {
    fixture.cleanup();
  }
});

test("stop input accepts one graceful Runtime record and no force or extra argv", () => {
  assert.deepEqual(parseRuntimeV2OuterAgentStopRecord('{"type":"stop","force":false}\n'), {
    type: "stop",
    force: false,
  });
  assert.throws(
    () => parseRuntimeV2OuterAgentStopRecord('{"type":"stop","force":true}\n'),
    /invalid/u,
  );
  const fixture = runtimeFixture();
  try {
    assert.throws(
      () => loadRuntimeV2OuterAgentLaunch({
        adapterId: "codex",
        argv: ["start.json", "--extra"],
        launchDirectory: fixture.attemptRoot,
      }),
      /exactly/u,
    );
  } finally {
    fixture.cleanup();
  }
});

function fakeCodexManagerSource() {
  return `
import fs from "node:fs";
import path from "node:path";
const runs = new Map();
export function startRuntimeWorkerRun(input) {
  const run = { sequence: 1, terminal: false, events: [{
    sequenceNumber: 1,
    type: "run.started",
    payload: { model: input.model },
    at: new Date().toISOString(),
  }] };
  runs.set(input.runtimeJobId, run);
  fs.writeFileSync(path.join(input.repositoryPath, "runtime-agent-edit.ts"), "export const changed = true;\\n");
  setTimeout(() => {
    if (run.terminal) return;
    run.terminal = true;
    run.sequence += 1;
    run.events.push({
      sequenceNumber: run.sequence,
      type: "run.completed",
      payload: { summary: "done" },
      at: new Date().toISOString(),
    });
  }, 20);
  return { runId: input.runtimeJobId, status: "running" };
}
export function getRuntimeWorkerEventsSince(_userId, runId, since) {
  return runs.get(runId).events.filter((event) => event.sequenceNumber > since);
}
export function isRuntimeWorkerTerminal(_userId, runId) {
  return runs.get(runId).terminal;
}
export function abortRuntimeWorkerRun(_userId, runId) {
  const run = runs.get(runId);
  if (run.terminal) return false;
  run.terminal = true;
  run.sequence += 1;
  run.events.push({
    sequenceNumber: run.sequence,
    type: "run.aborted",
    payload: { summary: "stopped" },
    at: new Date().toISOString(),
  });
  return true;
}
`;
}

async function fakeAdapterRun({ abort = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-outer-adapter-"));
  const sourceRoot = path.join(root, "src");
  const managerPath = path.join(sourceRoot, "lib", "codex", "run-manager.ts");
  fs.mkdirSync(path.dirname(managerPath), { recursive: true });
  fs.writeFileSync(managerPath, fakeCodexManagerSource());
  const repositoryPath = path.join(root, "repository");
  fs.mkdirSync(repositoryPath);
  execFileSync("git", ["-C", repositoryPath, "init", "--initial-branch=main"], {
    windowsHide: true,
  });
  execFileSync("git", ["-C", repositoryPath, "config", "user.email", "runtime@test.invalid"]);
  execFileSync("git", ["-C", repositoryPath, "config", "user.name", "Runtime Test"]);
  fs.writeFileSync(path.join(repositoryPath, "base.ts"), "export const base = true;\n");
  execFileSync("git", ["-C", repositoryPath, "add", "-A"]);
  execFileSync("git", ["-C", repositoryPath, "commit", "-m", "initial"]);
  const controller = new AbortController();
  const updates = [];
  const promise = executeRuntimeV2OuterAgentAdapter({
    adapterId: "codex",
    launch: {
      identity: { jobId: "job_adapter_1", attempt: 1, workerInstanceId: "worker_adapter_1" },
      executionScope: {
        userId: 7,
        gardenId: null,
        conversationId: `oa_codex_${"b".repeat(32)}`,
      },
      request: codingRequest(repositoryPath, { graftEnabled: false }),
      inputBlobs: [],
      inputPaths: [],
    },
    sourceRoot,
    signal: controller.signal,
    update: (events, status) => updates.push({ events, status }),
  });
  if (abort) setTimeout(() => controller.abort(), 5);
  try {
    return { outcome: await promise, updates };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("the adapter projects completion and turns Runtime cancellation into local abort", async () => {
  const completed = await fakeAdapterRun();
  assert.equal(completed.outcome.status, "completed");
  assert.ok(completed.updates.flatMap((update) => update.events)
    .some((event) => event.type === "run.completed"));
  const completedTerminal = completed.updates.flatMap((update) => update.events)
    .find((event) => event.type === "run.completed");
  assert.match(completedTerminal.payload.edits.before, /^[0-9a-f]{40}$/u);
  assert.match(completedTerminal.payload.edits.after, /^[0-9a-f]{40}$/u);

  const aborted = await fakeAdapterRun({ abort: true });
  assert.equal(aborted.outcome.status, "aborted");
  assert.ok(aborted.updates.flatMap((update) => update.events)
    .some((event) => event.type === "run.aborted"));
});

test("the Resource2Skill adapter preserves domain progress and artifact receipts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-resource2skill-adapter-"));
  const sourceRoot = path.join(root, "src");
  const managerPath = path.join(sourceRoot, "lib", "resource2skill", "run-manager.ts");
  const workspacePath = path.join(root, "workspace");
  fs.mkdirSync(path.dirname(managerPath), { recursive: true });
  fs.mkdirSync(workspacePath);
  fs.writeFileSync(managerPath, `
import fs from "node:fs";
import path from "node:path";
const runs = new Map();
export function startRuntimeWorkerRun(input) {
  const output = path.join(input.runtimeWorkspacePath, "output");
  fs.mkdirSync(output);
  const target = path.join(output, "presentation.pptx");
  fs.writeFileSync(target, "pptx");
  const artifact = {
    id: Buffer.from("presentation.pptx").toString("base64url"),
    relativePath: "presentation.pptx",
    name: "presentation.pptx",
    kind: "presentation",
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    size: 4,
    modifiedAt: fs.statSync(target).mtime.toISOString(),
  };
  const run = { terminal: false, events: [{
    sequenceNumber: 1,
    type: "run.started",
    payload: { domain: input.domain, maxIterations: input.maxIterations },
    at: new Date().toISOString(),
  }] };
  runs.set(input.runtimeJobId, run);
  setTimeout(() => {
    run.terminal = true;
    run.events.push({
      sequenceNumber: 2,
      type: "run.completed",
      payload: { summary: "created", artifacts: [artifact] },
      at: new Date().toISOString(),
    });
  }, 20);
  return { runId: input.runtimeJobId, status: "running" };
}
export function getRuntimeWorkerEventsSince(_userId, runId, since) {
  return runs.get(runId).events.filter((event) => event.sequenceNumber > since);
}
export function isRuntimeWorkerTerminal(_userId, runId) {
  return runs.get(runId).terminal;
}
export function abortRuntimeWorkerRun(_userId, runId) {
  const run = runs.get(runId);
  if (run.terminal) return false;
  run.terminal = true;
  run.events.push({ sequenceNumber: 2, type: "run.aborted", payload: {}, at: new Date().toISOString() });
  return true;
}
`);
  const updates = [];
  try {
    const outcome = await executeRuntimeV2OuterAgentAdapter({
      adapterId: "resource2skill",
      launch: {
        identity: {
          jobId: "job_resource2skill_1",
          attempt: 1,
          workerInstanceId: "worker_resource2skill_1",
        },
        executionScope: {
          userId: 7,
          gardenId: null,
          conversationId: `oa_resource2skill_${"c".repeat(32)}`,
        },
        request: resource2SkillRequest(),
        inputBlobs: [],
        inputPaths: [],
        workspacePath,
      },
      sourceRoot,
      signal: new AbortController().signal,
      update: (events, status) => updates.push({ events, status }),
    });
    assert.equal(outcome.status, "completed");
    const events = updates.flatMap((update) => update.events);
    assert.equal(events.find((event) => event.type === "run.started")?.payload.domain, "ppt");
    assert.equal(events.find((event) => event.type === "run.started")?.payload.maxIterations, 60);
    const terminal = events.find((event) => event.type === "run.completed");
    assert.equal(terminal?.payload.artifacts?.[0]?.relativePath, "presentation.pptx");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the MatrAIx adapter preserves the study request and report receipt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-matraix-adapter-"));
  const sourceRoot = path.join(root, "src");
  const managerPath = path.join(sourceRoot, "lib", "matraix", "run-manager.ts");
  const workspacePath = path.join(root, "workspace");
  fs.mkdirSync(path.dirname(managerPath), { recursive: true });
  fs.mkdirSync(workspacePath);
  fs.writeFileSync(managerPath, `
import fs from "node:fs";
import path from "node:path";
const runs = new Map();
export function startRuntimeWorkerRun(input) {
  const output = path.join(input.runtimeWorkspacePath, "output");
  fs.mkdirSync(output);
  const target = path.join(output, "study.md");
  fs.writeFileSync(target, "# Study\\n");
  const artifact = {
    id: Buffer.from("study.md").toString("base64url"),
    relativePath: "study.md",
    name: "study.md",
    kind: "report",
    contentType: "text/markdown; charset=utf-8",
    size: fs.statSync(target).size,
    modifiedAt: fs.statSync(target).mtime.toISOString(),
  };
  const run = { terminal: false, events: [{
    sequenceNumber: 1,
    type: "study.designed",
    payload: {
      brief: input.request.brief,
      respondents: input.request.respondents,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      conversationContext: input.conversationContext,
    },
    at: new Date().toISOString(),
  }] };
  runs.set(input.runtimeJobId, run);
  setTimeout(() => {
    run.terminal = true;
    run.events.push({
      sequenceNumber: 2,
      type: "run.completed",
      payload: { summary: "study complete", artifacts: [artifact], report: "# Study\\n" },
      at: new Date().toISOString(),
    });
  }, 20);
  return { runId: input.runtimeJobId, status: "running" };
}
export function getRuntimeWorkerEventsSince(_userId, runId, since) {
  return runs.get(runId).events.filter((event) => event.sequenceNumber > since);
}
export function isRuntimeWorkerTerminal(_userId, runId) {
  return runs.get(runId).terminal;
}
export function abortRuntimeWorkerRun(_userId, runId) {
  const run = runs.get(runId);
  if (run.terminal) return false;
  run.terminal = true;
  run.events.push({ sequenceNumber: 2, type: "run.aborted", payload: {}, at: new Date().toISOString() });
  return true;
}
`);
  const updates = [];
  try {
    const outcome = await executeRuntimeV2OuterAgentAdapter({
      adapterId: "matraix",
      launch: {
        identity: {
          jobId: "job_matraix_1",
          attempt: 1,
          workerInstanceId: "worker_matraix_1",
        },
        executionScope: {
          userId: 7,
          gardenId: null,
          conversationId: `oa_matraix_${"d".repeat(32)}`,
        },
        request: matraixRequest(),
        inputBlobs: [],
        inputPaths: [],
        workspacePath,
      },
      sourceRoot,
      signal: new AbortController().signal,
      update: (events, status) => updates.push({ events, status }),
    });
    assert.equal(outcome.status, "completed");
    const events = updates.flatMap((update) => update.events);
    const designed = events.find((event) => event.type === "study.designed");
    assert.equal(designed?.payload.brief, "Would parents pay four dollars per month?");
    assert.equal(designed?.payload.respondents, 12);
    assert.equal(designed?.payload.model, "test-model");
    assert.equal(designed?.payload.reasoningEffort, "");
    assert.equal(designed?.payload.conversationContext, "User: The product is a family planner.");
    const terminal = events.find((event) => event.type === "run.completed");
    assert.equal(terminal?.payload.report, "# Study\n");
    assert.equal(terminal?.payload.artifacts?.[0]?.relativePath, "study.md");
    assert.equal(terminal?.payload.artifacts?.[0]?.kind, "report");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function fakeHyperframesAdapterRun({ abort = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-hyperframes-adapter-"));
  const sourceRoot = path.join(root, "src");
  const managerPath = path.join(sourceRoot, "lib", "hyperframes", "run-manager.ts");
  const workspacePath = path.join(root, "workspace");
  fs.mkdirSync(path.dirname(managerPath), { recursive: true });
  fs.mkdirSync(workspacePath);
  fs.writeFileSync(managerPath, `
import fs from "node:fs";
import path from "node:path";
const runs = new Map();
export function startRuntimeWorkerRun(input) {
  const output = path.join(input.runtimeWorkspacePath, "project", "out");
  fs.mkdirSync(output, { recursive: true });
  const target = path.join(output, "video.mp4");
  fs.writeFileSync(target, "video");
  const artifact = {
    id: Buffer.from("out/video.mp4").toString("base64url"),
    relativePath: "out/video.mp4",
    name: "video.mp4",
    kind: "video",
    contentType: "video/mp4",
    size: fs.statSync(target).size,
    modifiedAt: fs.statSync(target).mtime.toISOString(),
  };
  const run = { terminal: false, events: [{
    sequenceNumber: 1,
    type: "run.started",
    payload: {
      brief: input.brief,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      context: input.conversationContext,
      apiKey: input.apiKey,
      workspace: input.runtimeWorkspacePath,
    },
    at: new Date().toISOString(),
  }] };
  runs.set(input.runtimeJobId, run);
  setTimeout(() => {
    if (run.terminal) return;
    run.terminal = true;
    run.events.push({
      sequenceNumber: 2,
      type: "run.completed",
      payload: { summary: "rendered", video: artifact, artifacts: [artifact] },
      at: new Date().toISOString(),
    });
  }, 30);
  return { runId: input.runtimeJobId, status: "running" };
}
export function getRuntimeWorkerEventsSince(_userId, runId, since) {
  return runs.get(runId).events.filter((event) => event.sequenceNumber > since);
}
export function isRuntimeWorkerTerminal(_userId, runId) {
  return runs.get(runId).terminal;
}
export function abortRuntimeWorkerRun(_userId, runId) {
  const run = runs.get(runId);
  if (run.terminal) return false;
  run.terminal = true;
  run.events.push({
    sequenceNumber: 2,
    type: "run.aborted",
    payload: { summary: "Video build stopped." },
    at: new Date().toISOString(),
  });
  return true;
}
`);
  const controller = new AbortController();
  const updates = [];
  const promise = executeRuntimeV2OuterAgentAdapter({
    adapterId: "hyperframes",
    launch: {
      identity: {
        jobId: "job_hyperframes_1",
        attempt: 1,
        workerInstanceId: "worker_hyperframes_1",
      },
      executionScope: {
        userId: 7,
        gardenId: null,
        conversationId: `oa_hyperframes_${"e".repeat(32)}`,
      },
      request: hyperframesRequest(),
      inputBlobs: [],
      inputPaths: [],
      workspacePath,
    },
    sourceRoot,
    signal: controller.signal,
    update: (events, status) => updates.push({ events, status }),
  });
  if (abort) setTimeout(() => controller.abort(), 5);
  try {
    return { outcome: await promise, updates, workspacePath };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("the HyperFrames adapter preserves context, video receipts, and cancellation", async () => {
  const completed = await fakeHyperframesAdapterRun();
  assert.equal(completed.outcome.status, "completed");
  const events = completed.updates.flatMap((update) => update.events);
  const started = events.find((event) => event.type === "run.started");
  assert.equal(started?.payload.brief, hyperframesRequest().brief);
  assert.equal(started?.payload.model, "test-model");
  assert.equal(started?.payload.reasoningEffort, "high");
  assert.equal(started?.payload.context, hyperframesRequest().conversationContext);
  assert.equal(started?.payload.apiKey, "local");
  assert.equal(started?.payload.workspace, completed.workspacePath);
  const terminal = events.find((event) => event.type === "run.completed");
  assert.equal(terminal?.payload.video?.relativePath, "out/video.mp4");
  assert.equal(terminal?.payload.artifacts?.[0]?.contentType, "video/mp4");

  const aborted = await fakeHyperframesAdapterRun({ abort: true });
  assert.equal(aborted.outcome.status, "aborted");
  assert.ok(aborted.updates.flatMap((update) => update.events)
    .some((event) => event.type === "run.aborted"));
});

async function fakeOpenMontageAdapterRun({ abort = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-openmontage-adapter-"));
  const sourceRoot = path.join(root, "src");
  const managerPath = path.join(sourceRoot, "lib", "openmontage", "run-manager.ts");
  const workspacePath = path.join(root, "workspace");
  fs.mkdirSync(path.dirname(managerPath), { recursive: true });
  fs.mkdirSync(workspacePath);
  fs.writeFileSync(managerPath, `
import fs from "node:fs";
import path from "node:path";
const runs = new Map();
export function startRuntimeWorkerRun(input) {
  const output = path.join(input.runtimeWorkspacePath, "projects", "production-test", "renders");
  fs.mkdirSync(output, { recursive: true });
  const target = path.join(output, "final.mp4");
  fs.writeFileSync(target, "film");
  const artifact = {
    id: Buffer.from("production-test/renders/final.mp4").toString("base64url"),
    relativePath: "production-test/renders/final.mp4",
    name: "final.mp4",
    kind: "video",
    contentType: "video/mp4",
    size: fs.statSync(target).size,
    modifiedAt: fs.statSync(target).mtime.toISOString(),
  };
  const production = {
    projectId: "production-test",
    title: "Deep Time",
    pipelineType: "documentary-montage",
    stages: ["idea", "scene_plan", "compose"],
    completedStages: ["idea", "scene_plan", "compose"],
    currentStage: "compose",
    decisions: [],
    spendUsd: 0,
  };
  const run = { terminal: false, events: [{
    sequenceNumber: 1,
    type: "run.started",
    payload: {
      brief: input.brief,
      model: input.model,
      context: input.conversationContext,
      apiKey: input.apiKey,
      workspace: input.runtimeWorkspacePath,
    },
    at: new Date().toISOString(),
  }, {
    sequenceNumber: 2,
    type: "production.updated",
    payload: { production, artifacts: [artifact] },
    at: new Date().toISOString(),
  }] };
  runs.set(input.runtimeJobId, run);
  setTimeout(() => {
    if (run.terminal) return;
    run.terminal = true;
    run.events.push({
      sequenceNumber: 3,
      type: "run.completed",
      payload: { summary: "film complete", production, video: artifact, artifacts: [artifact] },
      at: new Date().toISOString(),
    });
  }, 30);
  return { runId: input.runtimeJobId, status: "running" };
}
export function getRuntimeWorkerEventsSince(_userId, runId, since) {
  return runs.get(runId).events.filter((event) => event.sequenceNumber > since);
}
export function isRuntimeWorkerTerminal(_userId, runId) {
  return runs.get(runId).terminal;
}
export function abortRuntimeWorkerRun(_userId, runId) {
  const run = runs.get(runId);
  if (run.terminal) return false;
  run.terminal = true;
  run.events.push({
    sequenceNumber: 3,
    type: "run.aborted",
    payload: { summary: "Production stopped." },
    at: new Date().toISOString(),
  });
  return true;
}
`);
  const controller = new AbortController();
  const updates = [];
  const promise = executeRuntimeV2OuterAgentAdapter({
    adapterId: "openmontage",
    launch: {
      identity: {
        jobId: "job_openmontage_1",
        attempt: 1,
        workerInstanceId: "worker_openmontage_1",
      },
      executionScope: {
        userId: 7,
        gardenId: null,
        conversationId: `oa_openmontage_${"f".repeat(32)}`,
      },
      request: openMontageRequest(),
      inputBlobs: [],
      inputPaths: [],
      workspacePath,
    },
    sourceRoot,
    signal: controller.signal,
    update: (events, status) => updates.push({ events, status }),
  });
  if (abort) setTimeout(() => controller.abort(), 5);
  try {
    return { outcome: await promise, updates, workspacePath };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("the OpenMontage adapter preserves production progress, receipts, and cancellation", async () => {
  const completed = await fakeOpenMontageAdapterRun();
  assert.equal(completed.outcome.status, "completed");
  const events = completed.updates.flatMap((update) => update.events);
  const started = events.find((event) => event.type === "run.started");
  assert.equal(started?.payload.brief, openMontageRequest().brief);
  assert.equal(started?.payload.context, openMontageRequest().conversationContext);
  assert.equal(started?.payload.apiKey, "local");
  assert.equal(started?.payload.workspace, completed.workspacePath);
  const production = events.find((event) => event.type === "production.updated");
  assert.equal(production?.payload.production?.currentStage, "compose");
  const terminal = events.find((event) => event.type === "run.completed");
  assert.equal(terminal?.payload.video?.relativePath, "production-test/renders/final.mp4");
  assert.equal(terminal?.payload.artifacts?.[0]?.kind, "video");

  const aborted = await fakeOpenMontageAdapterRun({ abort: true });
  assert.equal(aborted.outcome.status, "aborted");
  assert.ok(aborted.updates.flatMap((update) => update.events)
    .some((event) => event.type === "run.aborted"));
});

async function fakeBoltSlidesAdapterRun({ abort = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-bolt-slides-adapter-"));
  const sourceRoot = path.join(root, "src");
  const managerPath = path.join(sourceRoot, "lib", "bolt-slides", "run-manager.ts");
  const workspacePath = path.join(root, "workspace");
  fs.mkdirSync(path.dirname(managerPath), { recursive: true });
  fs.mkdirSync(workspacePath);
  fs.writeFileSync(managerPath, `
import fs from "node:fs";
import path from "node:path";
const runs = new Map();
export function startRuntimeWorkerRun(input) {
  const source = path.join(input.runtimeWorkspacePath, "src");
  fs.mkdirSync(source, { recursive: true });
  const target = path.join(source, "App.tsx");
  fs.writeFileSync(target, "export default function App() { return null; }\\n");
  const artifact = {
    id: Buffer.from("src/App.tsx").toString("base64url"),
    relativePath: "src/App.tsx",
    name: "App.tsx",
    kind: "deck",
    contentType: "text/plain; charset=utf-8",
    size: fs.statSync(target).size,
    modifiedAt: fs.statSync(target).mtime.toISOString(),
  };
  const run = { terminal: false, events: [{
    sequenceNumber: 1,
    type: "run.queued",
    payload: {
      brief: input.brief,
      request: input.request,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      conversationPublicId: input.conversationPublicId,
      conversationContext: input.conversationContext,
      apiKey: input.apiKey,
      workspace: input.runtimeWorkspacePath,
    },
    at: new Date().toISOString(),
  }] };
  runs.set(input.runtimeJobId, run);
  setTimeout(() => {
    if (run.terminal) return;
    run.terminal = true;
    run.events.push({
      sequenceNumber: 2,
      type: "run.completed",
      payload: {
        title: "Launch",
        url: "/api/bolt-slides/runs/" + input.runtimeJobId + "/deck/",
        slides: input.request.slides,
        report: "The deck is ready.",
        artifacts: [artifact],
      },
      at: new Date().toISOString(),
    });
  }, 30);
  return { runId: input.runtimeJobId, status: "running" };
}
export function getRuntimeWorkerEventsSince(_userId, runId, since) {
  return runs.get(runId).events.filter((event) => event.sequenceNumber > since);
}
export function isRuntimeWorkerTerminal(_userId, runId) {
  return runs.get(runId).terminal;
}
export function abortRuntimeWorkerRun(_userId, runId) {
  const run = runs.get(runId);
  if (run.terminal) return false;
  run.terminal = true;
  run.events.push({
    sequenceNumber: 2,
    type: "run.aborted",
    payload: { summary: "The deck was stopped." },
    at: new Date().toISOString(),
  });
  return true;
}
`);
  const controller = new AbortController();
  const updates = [];
  const promise = executeRuntimeV2OuterAgentAdapter({
    adapterId: "bolt-slides",
    launch: {
      identity: {
        jobId: "job_bolt_slides_1",
        attempt: 1,
        workerInstanceId: "worker_bolt_slides_1",
      },
      executionScope: {
        userId: 7,
        gardenId: null,
        conversationId: `oa_bolt_slides_${"g".repeat(32)}`,
      },
      request: boltSlidesRequest(),
      inputBlobs: [],
      inputPaths: [],
      workspacePath,
    },
    sourceRoot,
    signal: controller.signal,
    update: (events, status) => updates.push({ events, status }),
  });
  if (abort) setTimeout(() => controller.abort(), 5);
  try {
    return { outcome: await promise, updates, workspacePath };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("the Bolt Slides adapter preserves request, chat context, receipts, and cancellation", async () => {
  const completed = await fakeBoltSlidesAdapterRun();
  assert.equal(completed.outcome.status, "completed");
  const events = completed.updates.flatMap((update) => update.events);
  const started = events.find((event) => event.type === "run.queued");
  assert.equal(started?.payload.brief, boltSlidesRequest().brief);
  assert.deepEqual(started?.payload.request, boltSlidesRequest().request);
  assert.equal(started?.payload.model, "test-model");
  assert.equal(started?.payload.reasoningEffort, "high");
  assert.equal(started?.payload.conversationPublicId, boltSlidesRequest().conversationPublicId);
  assert.equal(started?.payload.conversationContext, boltSlidesRequest().conversationContext);
  assert.equal(started?.payload.apiKey, "local");
  assert.equal(started?.payload.workspace, completed.workspacePath);
  const terminal = events.find((event) => event.type === "run.completed");
  assert.equal(terminal?.payload.slides, 8);
  assert.equal(terminal?.payload.artifacts?.[0]?.relativePath, "src/App.tsx");

  const aborted = await fakeBoltSlidesAdapterRun({ abort: true });
  assert.equal(aborted.outcome.status, "aborted");
  assert.ok(aborted.updates.flatMap((update) => update.events)
    .some((event) => event.type === "run.aborted"));
});

test("routes and managers cross the Runtime boundary without changing run APIs", () => {
  for (const { adapter, path: agentPath } of [
    { adapter: "codex", path: "codex" },
    { adapter: "ruflo", path: "ruflo" },
    { adapter: "deep-tutor", path: "deep-tutor" },
    { adapter: "opencode", path: "opencode" },
    { adapter: "trading-agent", path: "tradingagents" },
    { adapter: "career-ops", path: "career-ops" },
    { adapter: "shorts", path: "shorts" },
    { adapter: "open-gym", path: "open-gym" },
  ]) {
    const manager = source(`src/lib/${agentPath}/run-manager.ts`);
    const route = source(`src/app/api/${agentPath}/runs/route.ts`);
    const events = source(`src/app/api/${agentPath}/runs/[runId]/events/route.ts`);
    const abort = source(`src/app/api/${agentPath}/runs/[runId]/abort/route.ts`);
    assert.match(manager, /startOuterAgentRun/);
    assert.match(manager, /startRuntimeWorkerRun/);
    assert.match(route, /await startRun\(/);
    assert.match(events, /outerAgentEventsResponse/);
    assert.doesNotMatch(events, /setInterval\(/);
    assert.match(abort, /await abortRun\(/);
    assert.ok(adapter in RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS);
  }
  const commonEvents = source("src/lib/runtime-v2/outer-agent-events-route.ts");
  assert.match(commonEvents, /request\.signal\.addEventListener\("abort"/);
  assert.match(commonEvents, /cancel\(\)/);
  assert.match(commonEvents, /setTimeout\(\(\) => void flush\(\)/);

  const openPlanterFacade = source("src/lib/openplanter/runtime-run-manager.ts");
  const openPlanterWorker = source("src/lib/openplanter/run-manager.ts");
  const openPlanterRoute = source("src/app/api/openplanter/runs/route.ts");
  const openPlanterEvents = source("src/app/api/openplanter/runs/[runId]/events/route.ts");
  const openPlanterAbort = source("src/app/api/openplanter/runs/[runId]/abort/route.ts");
  assert.match(openPlanterFacade, /startOuterAgentRun/);
  assert.match(openPlanterWorker, /startRuntimeWorkerRun/);
  assert.match(openPlanterRoute, /await startRun\(/);
  assert.match(openPlanterEvents, /outerAgentEventsResponse/);
  assert.doesNotMatch(openPlanterEvents, /setInterval\(/);
  assert.match(openPlanterAbort, /await abortRun\(/);

  const resource2SkillFacade = source("src/lib/resource2skill/runtime-run-manager.ts");
  const resource2SkillWorker = source("src/lib/resource2skill/run-manager.ts");
  const resource2SkillRoute = source("src/app/api/resource2skill/runs/route.ts");
  const resource2SkillEvents = source("src/app/api/resource2skill/runs/[runId]/events/route.ts");
  const resource2SkillAbort = source("src/app/api/resource2skill/runs/[runId]/abort/route.ts");
  assert.match(resource2SkillFacade, /startOuterAgentRun/);
  assert.match(resource2SkillWorker, /startRuntimeWorkerRun/);
  assert.match(resource2SkillRoute, /await startRun\(/);
  assert.match(resource2SkillEvents, /outerAgentEventsResponse/);
  assert.doesNotMatch(resource2SkillEvents, /setInterval\(/);
  assert.match(resource2SkillAbort, /await abortRun\(/);

  const matraixFacade = source("src/lib/matraix/runtime-run-manager.ts");
  const matraixWorker = source("src/lib/matraix/run-manager.ts");
  const matraixRoute = source("src/app/api/matraix/runs/route.ts");
  const matraixEvents = source("src/app/api/matraix/runs/[runId]/events/route.ts");
  const matraixAbort = source("src/app/api/matraix/runs/[runId]/abort/route.ts");
  assert.match(matraixFacade, /startOuterAgentRun/);
  assert.match(matraixWorker, /startRuntimeWorkerRun/);
  assert.match(matraixRoute, /await startRun\(/);
  assert.match(matraixEvents, /outerAgentEventsResponse/);
  assert.doesNotMatch(matraixEvents, /setInterval\(/);
  assert.match(matraixAbort, /await abortRun\(/);

  const hyperframesFacade = source("src/lib/hyperframes/runtime-run-manager.ts");
  const hyperframesWorker = source("src/lib/hyperframes/run-manager.ts");
  const hyperframesRoute = source("src/app/api/hyperframes/runs/route.ts");
  const hyperframesEvents = source("src/app/api/hyperframes/runs/[runId]/events/route.ts");
  const hyperframesAbort = source("src/app/api/hyperframes/runs/[runId]/abort/route.ts");
  assert.match(hyperframesFacade, /startOuterAgentRun/);
  assert.match(hyperframesWorker, /startRuntimeWorkerRun/);
  assert.match(hyperframesRoute, /await startRun\(/);
  assert.match(hyperframesEvents, /outerAgentEventsResponse/);
  assert.doesNotMatch(hyperframesEvents, /setInterval\(/);
  assert.match(hyperframesAbort, /await abortRun\(/);

  const openMontageFacade = source("src/lib/openmontage/runtime-run-manager.ts");
  const openMontageWorker = source("src/lib/openmontage/run-manager.ts");
  const openMontageRoute = source("src/app/api/openmontage/runs/route.ts");
  const openMontageEvents = source("src/app/api/openmontage/runs/[runId]/events/route.ts");
  const openMontageAbort = source("src/app/api/openmontage/runs/[runId]/abort/route.ts");
  assert.match(openMontageFacade, /startOuterAgentRun/);
  assert.match(openMontageWorker, /startRuntimeWorkerRun/);
  assert.match(openMontageRoute, /await startRun\(/);
  assert.match(openMontageEvents, /outerAgentEventsResponse/);
  assert.doesNotMatch(openMontageEvents, /setInterval\(/);
  assert.match(openMontageAbort, /await abortRun\(/);

  const boltSlidesFacade = source("src/lib/bolt-slides/runtime-run-manager.ts");
  const boltSlidesWorker = source("src/lib/bolt-slides/run-manager.ts");
  const boltSlidesRoute = source("src/app/api/bolt-slides/runs/route.ts");
  const boltSlidesEvents = source("src/app/api/bolt-slides/runs/[runId]/events/route.ts");
  const boltSlidesAbort = source("src/app/api/bolt-slides/runs/[runId]/abort/route.ts");
  assert.match(boltSlidesFacade, /startOuterAgentRun/);
  assert.match(boltSlidesWorker, /startRuntimeWorkerRun/);
  assert.match(boltSlidesRoute, /await startRun\(/);
  assert.match(boltSlidesEvents, /outerAgentEventsResponse/);
  assert.doesNotMatch(boltSlidesEvents, /setInterval\(/);
  assert.match(boltSlidesAbort, /await abortRun\(/);
});

test("only fixed worker adapters can reach direct local run entrypoints", () => {
  const adapters = source("scripts/runtime-v2-outer-agent-adapters.mjs");
  assert.match(adapters, /manager\.startRuntimeWorkerRun/);
  for (const kind of ["codex", "ruflo", "deep-tutor", "deer-flow", "deep-research", "video-use", "opencode", "tradingagents", "career-ops", "shorts", "open-gym", "openplanter", "openwork", "openscience", "resource2skill", "matraix", "hyperframes", "openmontage", "bolt-slides", "max-research", "wardrobe", "cad", "stock-analyst", "vibe-trading", "money-printer"]) {
    const routeTree = source(`src/app/api/${kind}/runs/route.ts`);
    assert.doesNotMatch(routeTree, /startRuntimeWorkerRun/);
  }
  assert.match(source("scripts/runtime-v2-codex-worker.mjs"), /runRuntimeV2OuterAgentWorker\("codex"\)/);
  assert.match(source("scripts/runtime-v2-ruflo-worker.mjs"), /runRuntimeV2OuterAgentWorker\("ruflo"\)/);
  assert.match(source("scripts/runtime-v2-deep-tutor-worker.mjs"), /runRuntimeV2OuterAgentWorker\("deep-tutor"\)/);
  assert.match(source("scripts/runtime-v2-deer-flow-worker.mjs"), /runRuntimeV2OuterAgentWorker\("deer-flow"\)/);
  assert.match(source("scripts/runtime-v2-deep-research-worker.mjs"), /runRuntimeV2OuterAgentWorker\("deep-research"\)/);
  assert.match(source("scripts/runtime-v2-video-use-worker.mjs"), /runRuntimeV2OuterAgentWorker\("video-use"\)/);
  assert.match(source("scripts/runtime-v2-openscience-worker.mjs"), /runRuntimeV2OuterAgentWorker\("openscience"\)/);
  assert.match(source("scripts/runtime-v2-agent-tars-worker.mjs"), /runRuntimeV2OuterAgentWorker\("agent-tars"\)/);
  assert.match(source("scripts/runtime-v2-openwork-worker.mjs"), /runRuntimeV2OuterAgentWorker\("openwork"\)/);
  assert.match(source("scripts/runtime-v2-opencode-worker.mjs"), /runRuntimeV2OuterAgentWorker\("opencode"\)/);
  assert.match(source("scripts/runtime-v2-trading-agent-worker.mjs"), /runRuntimeV2OuterAgentWorker\("trading-agent"\)/);
  assert.match(source("scripts/runtime-v2-career-ops-worker.mjs"), /runRuntimeV2OuterAgentWorker\("career-ops"\)/);
  assert.match(source("scripts/runtime-v2-shorts-worker.mjs"), /runRuntimeV2OuterAgentWorker\("shorts"\)/);
  assert.match(source("scripts/runtime-v2-open-gym-worker.mjs"), /runRuntimeV2OuterAgentWorker\("open-gym"\)/);
  assert.match(source("scripts/runtime-v2-openplanter-worker.mjs"), /runRuntimeV2OuterAgentWorker\("openplanter"\)/);
  assert.match(source("scripts/runtime-v2-resource2skill-worker.mjs"), /runRuntimeV2OuterAgentWorker\("resource2skill"\)/);
  assert.match(source("scripts/runtime-v2-matraix-worker.mjs"), /runRuntimeV2OuterAgentWorker\("matraix"\)/);
  assert.match(source("scripts/runtime-v2-hyperframes-worker.mjs"), /runRuntimeV2OuterAgentWorker\("hyperframes"\)/);
  assert.match(source("scripts/runtime-v2-openmontage-worker.mjs"), /runRuntimeV2OuterAgentWorker\("openmontage"\)/);
  assert.match(source("scripts/runtime-v2-bolt-slides-worker.mjs"), /runRuntimeV2OuterAgentWorker\("bolt-slides"\)/);
  assert.match(source("scripts/runtime-v2-max-research-worker.mjs"), /runRuntimeV2OuterAgentWorker\("max-research"\)/);
  assert.match(source("scripts/runtime-v2-wardrobe-worker.mjs"), /runRuntimeV2OuterAgentWorker\("wardrobe"\)/);
  assert.match(source("scripts/runtime-v2-parametric-cad-worker.mjs"), /runRuntimeV2OuterAgentWorker\("parametric-cad"\)/);
  assert.match(source("scripts/runtime-v2-stock-analyst-worker.mjs"), /runRuntimeV2OuterAgentWorker\("stock-analyst"\)/);
  assert.match(source("scripts/runtime-v2-vibe-trading-worker.mjs"), /runRuntimeV2OuterAgentWorker\("vibe-trading"\)/);
  assert.match(source("scripts/runtime-v2-money-printer-worker.mjs"), /runRuntimeV2OuterAgentWorker\("money-printer"\)/);
});

test("Codex launcher consumers used by HyperFrames and OpenMontage remain compatible", () => {
  const codex = source("src/lib/codex/run-manager.ts");
  assert.match(codex, /export type CodexLauncher = Launcher/);
  assert.match(codex, /export function resolveCodexLauncher/);
  for (const consumer of [
    "src/lib/hyperframes/run-manager.ts",
    "src/lib/openmontage/run-manager.ts",
    "src/lib/openmontage/setup.ts",
  ]) {
    assert.match(source(consumer), /resolveCodexLauncher/);
  }
  assert.doesNotMatch(source("src/lib/hyperframes/setup.ts"), /resolveCodexLauncher/);
});

test("Deep Tutor consumes only a ready index inside its disposable run worker", () => {
  const manager = source("src/lib/deep-tutor/run-manager.ts");
  assert.match(manager, /indexState\(run\.userId, run\.scope\)/);
  assert.doesNotMatch(manager, /ensureIndex\(run\.userId, run\.scope\)/);
  assert.match(manager, /separate Runtime V2 job/);
});
