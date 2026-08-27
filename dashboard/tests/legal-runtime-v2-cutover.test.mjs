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
  validateRuntimeV2LegalRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";
import { loadRuntimeV2OuterAgentLaunch } from
  "../scripts/runtime-v2-outer-agent-worker-core.mjs";
import {
  createLegalRuntimeBundleInput,
  readLegalRuntimeBundle,
} from "../src/lib/legal/runtime-attachment-bundle.ts";
import { prepareRuntimeWorkspace } from "../src/lib/legal/workspace.ts";

const dashboardRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = (relativePath) => fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");

function canonicalLegalRequest(overrides = {}) {
  return {
    request: {
      maxTurns: 60,
      skills: ["docx", "xlsx", "pptx"],
      effort: null,
      allowShell: true,
    },
    settings: { shellTimeout: 120 },
    model: "test-model",
    reasoningEffort: "medium",
    baseUrl: "http://127.0.0.1:8765/v1",
    conversationPublicId: `conv_${"a".repeat(24)}`,
    contentInputIndex: 0,
    content: { taskBytes: 15, memoryBytes: 0, conversationBytes: 0 },
    attachments: [],
    ...overrides,
  };
}

async function writeStream(filePath, stream) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const descriptor = fs.openSync(filePath, "wx", 0o600);
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fs.writeSync(descriptor, value);
    }
    fs.fsyncSync(descriptor);
  } finally {
    reader.releaseLock();
    fs.closeSync(descriptor);
  }
}

async function legalRuntimeFixture(request, inputs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-legal-runtime-"));
  const jobId = "job_legal_1";
  const workerInstanceId = "worker_legal_1";
  const jobRoot = path.join(root, "runtime", "jobs", jobId);
  const attemptRoot = path.join(jobRoot, "attempts", "1", workerInstanceId);
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  const inputBlobs = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const blobId = `blob_legal_${index + 1}`;
    const inputPath = path.join(jobRoot, "inputs", blobId, "payload");
    await writeStream(inputPath, input.stream());
    const bytes = fs.readFileSync(inputPath);
    assert.equal(bytes.byteLength, input.sizeBytes);
    inputBlobs.push({
      blobId,
      relativePath: `runtime/jobs/${jobId}/inputs/${blobId}/payload`,
      sizeBytes: bytes.byteLength,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      displayName: input.displayName,
      mediaType: input.mediaType,
    });
  }
  fs.writeFileSync(path.join(jobRoot, "input.json"), JSON.stringify(request));
  fs.writeFileSync(path.join(attemptRoot, "start.json"), JSON.stringify({
    protocolVersion: 1,
    identity: { jobId, attempt: 1, workerInstanceId },
    executionScope: {
      userId: 7,
      gardenId: null,
      conversationId: `oa_legal_${"b".repeat(32)}`,
    },
    inputManifestPath: `runtime/jobs/${jobId}/input.json`,
    inputBlobs,
    workspacePath: `runtime/jobs/${jobId}/attempts/1/${workerInstanceId}/workspace`,
    checkpointPath: `runtime/jobs/${jobId}/checkpoint.json`,
    resultPath: `runtime/jobs/${jobId}/result.json`,
  }));
  return {
    root,
    jobRoot,
    attemptRoot,
    inputBlobs,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("Legal canonical JSON is bounded metadata, never document bytes, paths, or secrets", () => {
  const document = {
    kind: "document",
    name: "agreement.docx",
    format: "docx",
    inputIndex: 1,
    description: "2 pages",
    editable: true,
    hasExtractedText: true,
    figures: ["figure-1.png"],
  };
  const request = validateRuntimeV2LegalRequest(canonicalLegalRequest({
    content: { taskBytes: 32, memoryBytes: 14, conversationBytes: 20 },
    attachments: [document],
  }));
  assert.equal(expectedRuntimeV2OuterAgentInputCount("legal", request), 2);
  assert.doesNotMatch(
    JSON.stringify(request),
    /sourcePath|workspacePath|blobId|dataUrl|documentBytes|memoryContext|conversationContext|apiKey/u,
  );
  for (const override of [
    { executable: "python.exe" },
    { argv: ["legal-bridge.py"] },
    { env: { PATH: "attacker" } },
    { apiKey: "renderer-secret" },
  ]) {
    assert.throws(
      () => validateRuntimeV2LegalRequest({ ...request, ...override }),
      /invalid/u,
    );
  }
  assert.throws(
    () => validateRuntimeV2LegalRequest({
      ...request,
      attachments: [{ ...document, inputIndex: 2 }],
    }),
    /manifest/u,
  );
  assert.throws(
    () => validateRuntimeV2LegalRequest({
      ...request,
      attachments: [{ ...document, sourcePath: "C:\\private\\agreement.docx" }],
    }),
    /invalid/u,
  );
});

test("the Legal sidecar rejects repeated content and document segment declarations", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "legal-runtime-bundle-"));
  try {
    for (const sources of [
      [
        { kind: "task", attachmentIndex: null, name: null, bytes: Buffer.from("one") },
        { kind: "task", attachmentIndex: null, name: null, bytes: Buffer.from("two") },
      ],
      [
        { kind: "task", attachmentIndex: null, name: null, bytes: Buffer.from("task") },
        {
          kind: "document-figure",
          attachmentIndex: 0,
          name: "figure-1.png",
          bytes: Buffer.from("one"),
        },
        {
          kind: "document-figure",
          attachmentIndex: 0,
          name: "figure-1.png",
          bytes: Buffer.from("two"),
        },
      ],
    ]) {
      const bundle = createLegalRuntimeBundleInput(sources);
      const bundlePath = path.join(root, `${crypto.randomUUID()}.bundle`);
      await writeStream(bundlePath, bundle.stream());
      assert.throws(() => readLegalRuntimeBundle(bundlePath), /repeated/u);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("owned originals and sidecars cross as sealed blobs and rebuild the same workspace", async () => {
  const blobRoot = fs.mkdtempSync(path.join(os.tmpdir(), "legal-runtime-docs-"));
  process.env.BREADBOARD_CHAT_DOCUMENT_DIR = blobRoot;
  try {
    const store = await import("../src/lib/conversations/document-blob-store.ts");
    const { prepareLegalRuntimeInputs } = await import("../src/lib/legal/runtime-inputs.ts");
    const original = Buffer.from("not-a-zip-in-this-protocol-test");
    const figure = Buffer.from("bounded-figure");
    const stored = await store.writeDocumentBlob({
      userId: 7,
      format: "docx",
      body: new Blob([original]).stream(),
    });
    store.writeDocumentFigures({
      userId: 7,
      blobId: stored.blobId,
      figures: [{ extension: "png", bytes: figure }],
    });
    const prepared = prepareLegalRuntimeInputs({
      userId: 7,
      task: "Review the deed",
      memoryContext: "The user prefers concise risk tables.",
      conversationContext: "User: Focus on indemnities.",
      attachments: [
        {
          type: "document",
          name: "deed.docx",
          blobId: stored.blobId,
          format: "docx",
          text: "# Deed\n\nOperative text.",
          figures: ["figure-1.png"],
        },
        { type: "text", name: "notes.md", text: "Negotiation notes" },
        {
          type: "image",
          name: "signature.png",
          dataUrl: `data:image/png;base64,${Buffer.from("image-bytes").toString("base64")}`,
        },
        { type: "video", name: "hearing.mp4", blobId: "a".repeat(32), format: "mp4" },
      ],
    });
    const request = validateRuntimeV2LegalRequest(canonicalLegalRequest({
      content: prepared.content,
      attachments: prepared.attachments,
    }));
    assert.equal(prepared.inputBlobs.length, 4, "one sidecar plus three usable attachments");
    assert.equal(expectedRuntimeV2OuterAgentInputCount("legal", request), 4);
    assert.doesNotMatch(JSON.stringify(request), new RegExp(stored.blobId, "u"));

    const fixture = await legalRuntimeFixture(request, prepared.inputBlobs);
    try {
      const launch = loadRuntimeV2OuterAgentLaunch({
        adapterId: "legal",
        argv: ["start.json"],
        launchDirectory: fixture.attemptRoot,
      });
      const staged = prepareRuntimeWorkspace({
        runtimeWorkspacePath: launch.workspacePath,
        inputPaths: launch.inputPaths,
        content: launch.request.content,
        attachments: launch.request.attachments,
      });
      assert.equal(staged.task, "Review the deed");
      assert.equal(staged.memoryContext, "The user prefers concise risk tables.");
      assert.equal(staged.conversationContext, "User: Focus on indemnities.");
      assert.deepEqual(fs.readFileSync(path.join(staged.workspace.documentsDir, "deed.docx")), original);
      assert.equal(
        fs.readFileSync(path.join(staged.workspace.documentsDir, "deed.extracted.md"), "utf8"),
        "# Deed\n\nOperative text.",
      );
      assert.deepEqual(
        fs.readFileSync(path.join(staged.workspace.documentsDir, "deed.figures", "figure-1.png")),
        figure,
      );
      assert.equal(
        fs.readFileSync(path.join(staged.workspace.documentsDir, "notes.md"), "utf8"),
        "Negotiation notes",
      );
      assert.match(staged.workspace.skipped[0], /hearing\.mp4 is not a document/u);

      fs.appendFileSync(
        path.join(fixture.jobRoot, "inputs", fixture.inputBlobs[0].blobId, "payload"),
        "tamper",
      );
      assert.throws(
        () => loadRuntimeV2OuterAgentLaunch({
          adapterId: "legal",
          argv: ["start.json"],
          launchDirectory: fixture.attemptRoot,
        }),
        /invalid|integrity/u,
      );
    } finally {
      fixture.cleanup();
    }
  } finally {
    delete process.env.BREADBOARD_CHAT_DOCUMENT_DIR;
    fs.rmSync(blobRoot, { recursive: true, force: true });
  }
});

function fakeLegalManagerSource() {
  return `
const runs = new Map();
export function startRuntimeWorkerRun(input) {
  if (input.apiKey !== "trusted-local" || input.runtimeInputPaths.length !== 1 ||
      !input.runtimeWorkspacePath.endsWith("workspace")) throw new Error("bad worker handoff");
  const run = { terminal: false, events: [{
    sequenceNumber: 1, type: "run.started", payload: { documents: [] }, at: new Date().toISOString(),
  }] };
  runs.set(input.runtimeJobId, run);
  setTimeout(() => {
    if (run.terminal) return;
    run.terminal = true;
    run.events.push({
      sequenceNumber: 2, type: "run.completed", payload: { summary: "Legal answer", files: [] },
      at: new Date().toISOString(),
    });
  }, 10);
  return { runId: input.runtimeJobId, status: "running" };
}
export function getRuntimeWorkerEventsSince(_userId, runId, since) {
  return runs.get(runId).events.filter((event) => event.sequenceNumber > since);
}
export function isRuntimeWorkerTerminal(_userId, runId) { return runs.get(runId).terminal; }
export function abortRuntimeWorkerRun(_userId, runId) {
  const run = runs.get(runId);
  if (run.terminal) return false;
  run.terminal = true;
  run.events.push({
    sequenceNumber: 2, type: "run.aborted", payload: { summary: "stopped" },
    at: new Date().toISOString(),
  });
  return true;
}
`;
}

test("the fixed Legal adapter preserves progress and cancellation semantics", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "legal-adapter-"));
  const sourceRoot = path.join(root, "src");
  const managerPath = path.join(sourceRoot, "lib", "legal", "run-manager.ts");
  fs.mkdirSync(path.dirname(managerPath), { recursive: true });
  fs.writeFileSync(managerPath, fakeLegalManagerSource());
  const prior = process.env.CHATMOCK_API_KEY;
  process.env.CHATMOCK_API_KEY = "trusted-local";
  try {
    const run = async (abort) => {
      const controller = new AbortController();
      const updates = [];
      const promise = executeRuntimeV2OuterAgentAdapter({
        adapterId: "legal",
        launch: {
          identity: { jobId: "job_legal_adapter", attempt: 1, workerInstanceId: "worker_legal" },
          executionScope: {
            userId: 7,
            gardenId: null,
            conversationId: `oa_legal_${"c".repeat(32)}`,
          },
          request: canonicalLegalRequest(),
          inputBlobs: [{}],
          inputPaths: [path.join(root, "bundle")],
          workspacePath: path.join(root, "workspace"),
        },
        sourceRoot,
        signal: controller.signal,
        update: (events, status) => updates.push({ events, status }),
      });
      if (abort) setTimeout(() => controller.abort(), 2);
      return { outcome: await promise, updates };
    };
    const completed = await run(false);
    assert.equal(completed.outcome.status, "completed");
    assert.deepEqual(
      completed.updates.flatMap((entry) => entry.events).map((event) => event.type),
      ["run.started", "run.completed"],
    );
    const aborted = await run(true);
    assert.equal(aborted.outcome.status, "aborted");
    assert.equal(aborted.updates.flatMap((entry) => entry.events).at(-1).type, "run.aborted");
  } finally {
    if (prior === undefined) delete process.env.CHATMOCK_API_KEY;
    else process.env.CHATMOCK_API_KEY = prior;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("all Next Legal boundaries use the durable façade and cannot own Python", () => {
  const route = source("src/app/api/legal/runs/route.ts");
  const events = source("src/app/api/legal/runs/[runId]/events/route.ts");
  const abort = source("src/app/api/legal/runs/[runId]/abort/route.ts");
  const files = source("src/app/api/legal/runs/[runId]/files/[...path]/route.ts");
  const facade = source("src/lib/legal/runtime-run-manager.ts");
  const manager = source("src/lib/legal/run-manager.ts");
  const core = source("scripts/runtime-v2-outer-agent-worker-core.mjs");
  for (const boundary of [route, events, abort, files, facade]) {
    assert.doesNotMatch(boundary, /node:child_process|\bspawn\s*\(/u);
    assert.doesNotMatch(boundary, /from ["']@\/lib\/legal\/run-manager/u);
  }
  assert.match(route, /await startRun\(/u);
  assert.match(events, /outerAgentEventsResponse/u);
  assert.match(abort, /await abortRun\(/u);
  assert.match(files, /await readDeliverable\(/u);
  assert.match(facade, /kind: "legal"/u);
  assert.match(facade, /inputBlobs: prepared\.inputBlobs/u);
  assert.match(manager, /export function startRuntimeWorkerRun/u);
  assert.match(manager, /export function abortRuntimeWorkerRun/u);
  assert.doesNotMatch(manager, /export function startRun\b/u);
  assert.match(manager, /legalWorkerChildEnvironment/u);
  assert.doesNotMatch(manager, /legalEnv\([^\n]+process\.env/u);
  const childEnvironment = manager.slice(
    manager.indexOf("const LEGAL_CHILD_ENV_KEYS"),
    manager.indexOf("] as const;", manager.indexOf("const LEGAL_CHILD_ENV_KEYS")),
  );
  for (const name of ["PATH", "TEMP", "LEGAL_AGENT_BASH", "NO_PROXY", "SSL_CERT_FILE"]) {
    assert.match(childEnvironment, new RegExp(`"${name}"`, "u"));
  }
  assert.doesNotMatch(
    childEnvironment,
    /BREADBOARD_SUPERVISOR|CHATMOCK_API_KEY|OPENAI_API_KEY|GBRAIN_ADAPTER_SECRET/u,
  );
  assert.doesNotMatch(core, /createHash\("sha256"\)\.update\(fs\.readFileSync/u);
  assert.match(source("scripts/runtime-v2-legal-worker.mjs"), /runRuntimeV2OuterAgentWorker\("legal"\)/u);
});
