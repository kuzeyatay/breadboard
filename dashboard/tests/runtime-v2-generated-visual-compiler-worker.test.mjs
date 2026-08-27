import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import {
  executeGeneratedVisualCompilerOperation,
  validateGeneratedVisualCompilerExecutionScope,
  validateGeneratedVisualCompilerRequest,
} from "../scripts/runtime-v2-generated-visual-compiler-executor.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const opportunity = Object.freeze({
  id: "generated-visual-runtime-test",
  gardenId: "garden-runtime-test",
  learningUnitId: "unit-runtime-test",
  targetPage: "learning/runtime-test.md",
  requiredInputs: [],
  requiredOutputs: [],
  sourceAnchorIds: [],
});

const sourceCode = `import { defineVisualization } from "@breadboard/visual-sdk";
export default defineVisualization({ schemaVersion: 1 });`;

async function loadClient() {
  const built = await esbuild.build({
    entryPoints: [path.join(
      dashboardRoot,
      "src",
      "lib",
      "runtime-v2",
      "generated-visual-compiler-job.ts",
    )],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "generated-visual-compiler-runtime-stubs",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "generated-visual-compiler-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "generated-visual-compiler-stub",
        }));
        build.onLoad({
          filter: /server-only/,
          namespace: "generated-visual-compiler-stub",
        }, () => ({ loader: "js", contents: "export {};" }));
        build.onLoad({
          filter: /supervisor-control/,
          namespace: "generated-visual-compiler-stub",
        }, () => ({
          loader: "js",
          contents: `
            const unused = async () => { throw new Error("use injected compiler control"); };
            export const cancelRuntimeJob = unused;
            export const inspectRuntimeJob = unused;
            export const readRuntimeJobOutput = unused;
            export const submitRuntimeJob = unused;
          `,
        }));
      },
    }],
  });
  const bundled = built.outputFiles[0].text;
  assert.doesNotMatch(bundled, /node_modules[\\/]typescript|from\s*["']typescript["']/u);
  const encoded = Buffer.from(bundled).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#generated-visual-compiler-runtime-v2`);
}

const client = await loadClient();

function snapshot(overrides = {}) {
  return {
    jobId: "job_generated_visual_compile_1",
    jobType: "generated-visual-compile",
    workerKind: "generated-visual-compiler-node",
    resourceClass: "document-processing",
    state: "succeeded",
    stage: "finalizing",
    attempt: 1,
    workerInstanceId: "worker_generated_visual_compile_1",
    gardenId: opportunity.gardenId,
    conversationId: null,
    createdAt: 1,
    startedAt: 2,
    updatedAt: 3,
    finishedAt: 3,
    lastHeartbeatAt: 2,
    lastWorkerSequence: 4,
    progressCurrent: 1,
    progressTotal: 1,
    failureCode: null,
    failureMessage: null,
    resourceExhaustion: null,
    cancellationRequested: false,
    ...overrides,
  };
}

function compilation() {
  return {
    definition: null,
    validation: {
      valid: false,
      checkedAt: "2026-08-26T00:00:00.000Z",
      astNodeCount: 12,
      sourceBytes: Buffer.byteLength(sourceCode),
      imports: ["@breadboard/visual-sdk"],
      errors: ["definition.schemaVersion is invalid"],
      warnings: [],
    },
    sourceHash: createHash("sha256").update(sourceCode, "utf8").digest("hex"),
    compiledHash: "",
    compiledJavaScript: "",
    cacheHit: false,
  };
}

function envelope(job, result, identity = {}) {
  return {
    protocolVersion: 1,
    identity: {
      jobId: job.jobId,
      attempt: job.attempt,
      workerInstanceId: job.workerInstanceId,
      ...identity,
    },
    completionSequence: job.lastWorkerSequence,
    result,
  };
}

test("compiler worker accepts only one bounded garden-scoped request", () => {
  const request = {
    protocolVersion: 1,
    operation: "compile-generated-visual",
    sourceCode,
    opportunity,
  };
  const scope = {
    userId: 17,
    gardenId: opportunity.gardenId,
    conversationId: null,
  };
  assert.equal(validateGeneratedVisualCompilerRequest(request), request);
  assert.equal(validateGeneratedVisualCompilerExecutionScope(scope), scope);
  assert.throws(
    () => validateGeneratedVisualCompilerRequest({ ...request, executable: "node.exe" }),
    /canonical generated-visual compiler request/u,
  );
  assert.throws(
    () => validateGeneratedVisualCompilerExecutionScope({ ...scope, conversationId: "forged" }),
    /authenticated garden scope/u,
  );
});

test("compiler executor loads the trusted TypeScript closure only inside its finite worker", async () => {
  const result = await executeGeneratedVisualCompilerOperation({
    executionScope: {
      userId: 17,
      gardenId: opportunity.gardenId,
      conversationId: null,
    },
    request: {
      protocolVersion: 1,
      operation: "compile-generated-visual",
      sourceCode,
      opportunity,
    },
  });
  assert.equal(result.validation.valid, false);
  assert.match(result.sourceHash, /^[0-9a-f]{64}$/u);
  assert.equal(result.cacheHit, false);
});

test("authenticated client submits one fresh fenced compiler job", async () => {
  const job = snapshot();
  const calls = { submissions: [], outputs: [], cancellations: [] };
  const control = {
    async submit(authority, submission) {
      calls.submissions.push({ authority, submission });
      return job;
    },
    async inspect() { throw new Error("terminal fixture must not poll"); },
    async readOutput(authority, jobId, kind) {
      calls.outputs.push({ authority, jobId, kind });
      return { jobId, kind, content: envelope(job, compilation()) };
    },
    async cancel(authority, jobId) {
      calls.cancellations.push({ authority, jobId });
      return snapshot({ state: "cancelled" });
    },
  };
  const result = await client.compileGeneratedVisualizationViaRuntime({
    userId: 17,
    gardenId: opportunity.gardenId,
    sourceCode,
    opportunity,
    control,
  });
  assert.equal(result.validation.valid, false);
  assert.deepEqual(calls.submissions[0].authority, {
    userId: 17,
    gardenId: opportunity.gardenId,
    conversationId: null,
  });
  const submission = calls.submissions[0].submission;
  assert.equal(submission.jobType, "generated-visual-compile");
  assert.match(submission.idempotencyKey, /^generated-visual-compile-v2:[0-9a-f]{64}:/u);
  assert.deepEqual(submission.requestPayload, {
    protocolVersion: 1,
    operation: "compile-generated-visual",
    sourceCode,
    opportunity,
  });
  assert.doesNotMatch(JSON.stringify(submission), /executable|argv|CONTROL_TOKEN/u);
  assert.deepEqual(calls.outputs.map(({ kind }) => kind), ["result"]);
  assert.deepEqual(calls.cancellations, []);
});

test("forged worker identity is rejected", async () => {
  const job = snapshot();
  const control = {
    async submit() { return job; },
    async inspect() { throw new Error("terminal fixture must not poll"); },
    async readOutput(authority, jobId, kind) {
      return {
        jobId,
        kind,
        content: envelope(job, compilation(), { workerInstanceId: "forged" }),
      };
    },
    async cancel() { return snapshot({ state: "cancelled" }); },
  };
  await assert.rejects(
    client.compileGeneratedVisualizationViaRuntime({
      userId: 17,
      gardenId: opportunity.gardenId,
      sourceCode,
      opportunity,
      control,
    }),
    /outside its worker fence/u,
  );
});

test("fenced output remains bound to the exact submitted source and canonical compilation", async () => {
  const job = snapshot();
  const invoke = (result) => client.compileGeneratedVisualizationViaRuntime({
    userId: 17,
    gardenId: opportunity.gardenId,
    sourceCode,
    opportunity,
    control: {
      async submit() { return job; },
      async inspect() { throw new Error("terminal fixture must not poll"); },
      async readOutput(authority, jobId, kind) {
        return { jobId, kind, content: envelope(job, result) };
      },
      async cancel() { return snapshot({ state: "cancelled" }); },
    },
  });
  await assert.rejects(
    invoke({ ...compilation(), sourceHash: "b".repeat(64) }),
    /does not match its submitted source/u,
  );
  await assert.rejects(
    invoke({
      ...compilation(),
      definition: { schemaVersion: 1 },
      validation: { ...compilation().validation, valid: true },
      compiledJavaScript: "globalThis.__BREADBOARD_GENERATED_VISUAL__ = Object.freeze({});\n",
      compiledHash: "c".repeat(64),
    }),
    /does not match its submitted source/u,
  );
});

test("manual regeneration injects Runtime compilation and static routes have no compiler import", () => {
  const route = fs.readFileSync(path.join(
    dashboardRoot,
    "src",
    "app",
    "api",
    "gardens",
    "[gardenId]",
    "visualizations",
    "[visualId]",
    "regenerate",
    "route.ts",
  ), "utf8");
  const service = fs.readFileSync(path.join(
    dashboardRoot,
    "src",
    "lib",
    "generated-visuals.ts",
  ), "utf8");
  const compiler = fs.readFileSync(path.join(
    dashboardRoot,
    "src",
    "lib",
    "generated-visual-compiler.ts",
  ), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(
    dashboardRoot,
    "..",
    "desktop",
    "runtime-v2",
    "manifests",
    "workers.json",
  ), "utf8"));
  assert.match(route, /compileGeneratedVisualizationViaRuntime/u);
  assert.match(route, /compilerRunner:/u);
  assert.doesNotMatch(route, /generated-visual-compiler(?:\.ts)?["']/u);
  assert.doesNotMatch(service, /from\s+["']typescript["']|createRequire|runtimeTypeScript/u);
  assert.doesNotMatch(service, /function\s+compileGeneratedVisualization\s*\(/u);
  assert.match(service, /compilerRunner:\s*\(/u);
  assert.doesNotMatch(service, /input\.compilerRunner\s*\?/u);
  assert.match(compiler, /^import\s+ts\s+from\s+["']typescript["']/mu);
  assert.match(compiler, /export function compileGeneratedVisualization/u);
  assert.ok(manifest.workers.some((worker) =>
    worker.kind === "generated-visual-compiler-node" &&
    worker.jobTypes?.includes("generated-visual-compile") &&
    worker.exitAfterJob === true &&
    worker.maximumConcurrency === 1
  ));
});
