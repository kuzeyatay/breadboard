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
  validateRuntimeV2ParametricCadRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";

const dashboardRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workerPath = path.join(
  dashboardRoot,
  "scripts",
  "runtime-v2-parametric-cad-worker.mjs",
);
const source = (relativePath) => fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");

function seedConversation(dataRoot) {
  const dbUrl = pathToFileURL(path.join(dashboardRoot, "src", "lib", "db.ts")).href;
  const storeUrl = pathToFileURL(
    path.join(dashboardRoot, "src", "lib", "conversations", "store.ts"),
  ).href;
  const script = [
    `process.env.BREADBOARD_DATA_DIR = ${JSON.stringify(dataRoot)};`,
    `const { default: db } = await import(${JSON.stringify(dbUrl)});`,
    "db.prepare(\"INSERT INTO users(id, username, email, password_hash) VALUES (7, 'cad-runtime', 'cad-runtime@example.test', 'x')\").run();",
    `const { createConversation } = await import(${JSON.stringify(storeUrl)});`,
    "const conversation = createConversation({ userId: 7, title: 'Runtime CAD test' });",
    "process.stdout.write(conversation.public_id);",
  ].join("\n");
  const seeded = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: dashboardRoot,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
  });
  assert.equal(seeded.status, 0, seeded.stderr);
  assert.match(seeded.stdout, /^conv_[A-Za-z0-9_-]{24}$/u);
  return seeded.stdout;
}

function seedCadProject(dataRoot) {
  const dbUrl = pathToFileURL(path.join(dashboardRoot, "src", "lib", "db.ts")).href;
  const conversationUrl = pathToFileURL(
    path.join(dashboardRoot, "src", "lib", "conversations", "store.ts"),
  ).href;
  const projectStoreUrl = pathToFileURL(
    path.join(dashboardRoot, "src", "lib", "cad", "project-store.ts"),
  ).href;
  const script = [
    `process.env.BREADBOARD_DATA_DIR = ${JSON.stringify(dataRoot)};`,
    `const { default: db } = await import(${JSON.stringify(dbUrl)});`,
    "db.prepare(\"INSERT INTO users(id, username, email, password_hash) VALUES (7, 'cad-parameter-runtime', 'cad-parameter-runtime@example.test', 'x')\").run();",
    `const { createConversation } = await import(${JSON.stringify(conversationUrl)});`,
    `const { createCadProject, recordCadRevision } = await import(${JSON.stringify(projectStoreUrl)});`,
    "const conversation = createConversation({ userId: 7, title: 'Runtime CAD parameter test' });",
    "const project = createCadProject({ userId: 7, conversationId: conversation.id, clusterId: null, name: 'runtime-plate', units: 'mm', process: 'fdm' });",
    "const designSpec = { schemaVersion: 1, projectId: project.id, name: 'Runtime plate', description: 'A width-adjustable rectangular plate.', units: 'mm', manufacturingProcess: 'fdm', parameters: [{ id: 'width', label: 'Width', value: 20, unit: 'mm', minimum: 5, maximum: 200, editable: true, source: 'user' }], components: [{ id: 'body', name: 'Plate', quantity: 1, bodyRole: 'primary' }], constraints: [], assumptions: [], exportSettings: { stlLinearTolerance: 0.1, stlAngularTolerance: 0.2, generateStep: true, generateStl: true, generateGlb: true, generate3mf: false } };",
    "const source = ['import cadquery as cq', 'DEFAULT_PARAMS = {\\\"width\\\": 20}', 'def build_model(params):', '    return {\\\"body\\\": cq.Workplane(\\\"XY\\\").box(params[\\\"width\\\"], 10, 5)}'].join('\\n');",
    "recordCadRevision({ projectId: project.id, revision: 1, parentRevision: null, status: 'valid', instruction: 'Initial plate', source, entrypoint: 'build_model', parameters: { width: 20 }, designSpec, measurements: { boundingBox: { x: 20, y: 10, z: 5, unit: 'mm' }, volume: 1000, surfaceArea: 700, solidCount: 1, triangleCount: 12, bodies: [{ name: 'body', volume: 1000, surfaceArea: 700, boundingBox: { x: 20, y: 10, z: 5 }, valid: true, watertight: true }] }, validation: { passed: true, checkedAt: new Date().toISOString(), issues: [] }, provenance: { engine: 'cadquery', engineVersion: '2.5', kernel: 'opencascade', kernelVersion: '7.8', pythonVersion: '3.13', serviceVersion: 'test', model: 'seed', generatedAt: new Date().toISOString() }, generationLog: [], model: 'seed', files: [] });",
    "process.stdout.write(JSON.stringify({ conversationPublicId: conversation.public_id, projectId: project.id }));",
  ].join("\n");
  const seeded = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: dashboardRoot,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
  });
  assert.equal(seeded.status, 0, seeded.stderr);
  const result = JSON.parse(seeded.stdout);
  assert.match(result.conversationPublicId, /^conv_[A-Za-z0-9_-]{24}$/u);
  assert.match(result.projectId, /^cadp_[0-9a-f]{32}$/u);
  return result;
}

function canonicalRequest(conversationPublicId, baseUrl, overrides = {}) {
  return {
    operation: "run",
    conversationPublicId,
    clientMessageId: "client-cad-runtime-1",
    brief: "Design a small rectangular mounting block --fdm",
    parsed: {
      brief: "Design a small rectangular mounting block",
      process: "fdm",
      printerBed: null,
      units: null,
      fresh: false,
    },
    model: "test-model",
    reasoningEffort: "medium",
    baseUrl,
    ...overrides,
  };
}

function runtimeFixture(request, dataRoot) {
  const jobId = "job_parametric_cad_1";
  const workerInstanceId = "worker_parametric_cad_1";
  const jobRoot = path.join(dataRoot, "runtime", "jobs", jobId);
  const attemptRoot = path.join(jobRoot, "attempts", "1", workerInstanceId);
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(jobRoot, "input.json"), `${JSON.stringify(request)}\n`);
  fs.writeFileSync(path.join(attemptRoot, "start.json"), `${JSON.stringify({
    protocolVersion: 1,
    identity: { jobId, attempt: 1, workerInstanceId },
    executionScope: {
      userId: 7,
      gardenId: null,
      conversationId: `oa_parametric_cad_${"a".repeat(32)}`,
    },
    inputManifestPath: `runtime/jobs/${jobId}/input.json`,
    inputBlobs: [],
    workspacePath: `runtime/jobs/${jobId}/attempts/1/${workerInstanceId}/workspace`,
    checkpointPath: `runtime/jobs/${jobId}/checkpoint.json`,
    resultPath: `runtime/jobs/${jobId}/result.json`,
  })}\n`);
  return { dataRoot, jobRoot, attemptRoot };
}

function localServices({ hangModel = false, hangCad = false } = {}) {
  const pending = new Set();
  let modelRequestedResolve;
  let executeRequestedResolve;
  const modelRequested = new Promise((resolve) => {
    modelRequestedResolve = resolve;
  });
  const executeRequested = new Promise((resolve) => {
    executeRequestedResolve = resolve;
  });
  const server = http.createServer((request, response) => {
    pending.add(response);
    response.on("close", () => pending.delete(response));
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        status: "ok",
        serviceVersion: "test",
        pythonVersion: "3.13",
        cadqueryVersion: "2.5",
        ocpVersion: "7.8",
        exportFormats: ["step", "stl", "glb"],
        engines: ["cadquery"],
        detail: "",
      }));
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (request.url === "/execute") {
        executeRequestedResolve();
        if (hangCad) return;
        const execution = JSON.parse(body);
        const bytes = Buffer.from("sealed-test-cad-file");
        const width = typeof execution.parameters?.width === "number"
          ? execution.parameters.width
          : 20;
        const files = Object.fromEntries(
          execution.exports.map((entry) => [entry.format, bytes.toString("base64")]),
        );
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          ok: true,
          failure: null,
          solids: [{
            name: "body",
            volume: width * 10 * 5,
            surfaceArea: 2 * (width * 10 + 10 * 5 + width * 5),
            boundingBox: { x: width, y: 10, z: 5 },
            valid: true,
            watertight: true,
            faceCount: 6,
            edgeCount: 12,
          }],
          solidCount: 1,
          volume: width * 10 * 5,
          surfaceArea: 2 * (width * 10 + 10 * 5 + width * 5),
          boundingBox: { x: width, y: 10, z: 5 },
          tessellation: {
            linearTolerance: 0.1,
            angularTolerance: 0.2,
            vertexCount: 8,
            triangleCount: 12,
            degenerateTriangleCount: 0,
            nonManifoldEdgeCount: 0,
            openEdgeCount: 0,
            hasNonFiniteCoordinates: false,
          },
          exports: execution.exports.map((entry) => ({
            format: entry.format,
            filename: entry.filename,
            byteSize: bytes.byteLength,
            sha256: "0".repeat(64),
            linearTolerance: entry.linearTolerance ?? null,
            angularTolerance: entry.angularTolerance ?? null,
          })),
          issues: [],
          effectiveParameters: execution.parameters ?? {},
          stdout: "",
          stderr: "",
          durationMs: 5,
          engine: "cadquery",
          engineVersion: "2.5",
          kernelVersion: "7.8",
          pythonVersion: "3.13",
          files,
        }));
        return;
      }

      modelRequestedResolve();
      if (hangModel) return;
      const completion = JSON.parse(body);
      const toolName = completion.tools?.[0]?.function?.name;
      const argumentsValue = toolName === "cad_create_project"
        ? {
            name: "runtime-block",
            units: "mm",
            parameters: {},
            design_spec: {
              name: "Runtime mounting block",
              description: "A small rectangular mounting block.",
              units: "mm",
              manufacturingProcess: "fdm",
              parameters: [],
              components: [{ id: "body", name: "Block", quantity: 1, bodyRole: "primary" }],
              constraints: [],
              assumptions: [],
              exportSettings: {
                stlLinearTolerance: 0.1,
                stlAngularTolerance: 0.2,
                generateStep: true,
                generateStl: true,
                generateGlb: true,
                generate3mf: false,
              },
            },
          }
        : {
            source: [
              "import cadquery as cq",
              "DEFAULT_PARAMS = {}",
              "def build_model(params):",
              '    return {"body": cq.Workplane("XY").box(20, 10, 5)}',
            ].join("\n"),
            parameters: {},
          };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: `call_${toolName}`,
              type: "function",
              function: { name: toolName, arguments: JSON.stringify(argumentsValue) },
            }],
          },
        }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }));
    });
  });
  return {
    server,
    modelRequested,
    executeRequested,
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      server.unref();
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server unavailable");
      return `http://127.0.0.1:${address.port}`;
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
        BREADBOARD_SUPERVISOR_CONTROL_URL: "",
        BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "",
        BREADBOARD_RUNTIME_V2_ACTIVE: "",
        CAD_SERVICE_URL: serviceUrl,
        CAD_SERVICE_SECRET: "runtime-cad-test-secret",
        CHATMOCK_API_KEY: "test-runtime-key",
        NODE_NO_WARNINGS: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Parametric CAD Runtime worker timed out.\n${stderr}`));
    }, 30_000);
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

test("Parametric CAD accepts one sealed design request and no execution overrides", () => {
  const request = canonicalRequest(`conv_${"c".repeat(24)}`, "http://127.0.0.1:8765/v1");
  assert.equal(validateRuntimeV2ParametricCadRequest(request), request);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("parametric-cad", request), 0);
  assert.deepEqual(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS["parametric-cad"], {
    id: "parametric-cad",
    workerKind: "outer-parametric-cad-node",
    jobType: "parametric-cad-run",
    scopePrefix: "oa_parametric_cad_",
    maximumInputs: 0,
  });
  const parameterUpdate = {
    operation: "parameter-update",
    conversationPublicId: `conv_${"c".repeat(24)}`,
    projectId: `cadp_${"d".repeat(32)}`,
    values: { width: 24, label: "wide", enabled: true },
  };
  assert.equal(validateRuntimeV2ParametricCadRequest(parameterUpdate), parameterUpdate);
  for (const forged of [
    { ...request, executable: "node.exe" },
    { ...request, argv: ["attacker.mjs"] },
    { ...request, apiKey: "renderer-secret" },
    { ...request, conversationPublicId: "conv_other" },
    { ...request, parsed: { ...request.parsed, process: "metal" } },
    { ...request, parsed: { ...request.parsed, printerBed: { x: 1, y: -2, z: 3 } } },
  ]) {
    assert.throws(() => validateRuntimeV2ParametricCadRequest(forged), /invalid/u);
  }
  for (const forged of [
    { ...parameterUpdate, values: {} },
    { ...parameterUpdate, projectId: "../../other" },
    { ...parameterUpdate, values: { width: Number.POSITIVE_INFINITY } },
    { ...parameterUpdate, command: "python attacker.py" },
  ]) {
    assert.throws(() => validateRuntimeV2ParametricCadRequest(forged), /invalid/u);
  }
});

test("CAD compatibility routes only submit, replay, observe, and cancel Runtime jobs", () => {
  const facade = source("src/lib/cad/runtime-run-manager.ts");
  const workerManager = source("src/lib/cad/run-manager.ts");
  const route = source("src/app/api/cad/runs/route.ts");
  const events = source("src/app/api/cad/runs/[runId]/events/route.ts");
  const abort = source("src/app/api/cad/runs/[runId]/abort/route.ts");
  const parameterRoute = source("src/app/api/cad/projects/[projectId]/parameters/route.ts");
  const parameterFacade = source("src/lib/cad/runtime-parameter-action.ts");
  const workerAdapter = source("src/lib/cad/runtime-worker-adapter.ts");
  assert.match(workerManager, /export function startRuntimeWorkerRun/);
  assert.match(facade, /startOuterAgentRun\(\{/);
  assert.match(facade, /readOuterAgentRunView\("parametric-cad"/);
  assert.match(facade, /abortOuterAgentRun\("parametric-cad"/);
  assert.doesNotMatch(
    facade,
    /from "\.\/(?:artifact|design-service|model-client|project-store|service|tools)|node:child_process/u,
  );
  assert.match(route, /await startRun\(/);
  assert.doesNotMatch(route, /startRuntimeWorkerRun|node:child_process|\bspawn\s*\(/u);
  assert.doesNotMatch(route, /cad\/run-manager\.ts/u);
  assert.match(events, /outerAgentEventsResponse/);
  assert.doesNotMatch(events, /setInterval\(/);
  assert.match(abort, /await abortRun\(/);
  assert.match(
    source("scripts/runtime-v2-parametric-cad-worker.mjs"),
    /runRuntimeV2OuterAgentWorker\("parametric-cad"\)/,
  );
  assert.match(parameterRoute, /applyParameterUpdateViaRuntime/);
  assert.doesNotMatch(
    parameterRoute,
    /from ["']@\/lib\/cad\/parameter-action|buildAndRecord|cadServiceExecute/u,
  );
  assert.match(parameterFacade, /operation: "parameter-update"/);
  assert.doesNotMatch(parameterFacade, /parameter-action|buildAndRecord|cadServiceExecute/u);
  assert.match(workerAdapter, /applyParameterUpdate/);
});

test("the real disposable worker builds and seals a Parametric CAD event projection", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-parametric-runtime-"));
  const services = localServices();
  const serviceUrl = await services.listen();
  const conversationPublicId = seedConversation(dataRoot);
  const fixture = runtimeFixture(
    canonicalRequest(conversationPublicId, `${serviceUrl}/v1`),
    dataRoot,
  );
  try {
    const child = await runWorker(fixture, serviceUrl);
    assert.equal(child.code, 0, child.stderr);
    const result = JSON.parse(fs.readFileSync(path.join(fixture.jobRoot, "result.json"), "utf8"));
    assert.equal(result.protocolVersion, 1);
    assert.equal(result.run.adapterId, "parametric-cad");
    assert.equal(result.run.status, "completed");
    const terminal = result.run.events.find((event) => event.type === "run.completed");
    assert.equal(terminal.payload.status, "valid");
    assert.equal(terminal.payload.designTitle, "Runtime mounting block");
    assert.equal(terminal.payload.state.kind, "parametric-cad");
    assert.equal(terminal.payload.state.completedAt, terminal.at);
    assert.ok(result.run.events.some((event) => event.type === "cad.execution.completed"));
    assert.ok(result.run.events.some((event) => event.type === "artifact.unavailable"));
    assert.match(child.stdout, /"type":"ready"/);
    assert.match(child.stdout, /"type":"complete"/);
  } finally {
    await services.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("the same real worker owns a parameter rebuild and seals its compatibility result", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-parametric-parameter-"));
  const services = localServices();
  const serviceUrl = await services.listen();
  const { conversationPublicId, projectId } = seedCadProject(dataRoot);
  const fixture = runtimeFixture({
    operation: "parameter-update",
    conversationPublicId,
    projectId,
    values: { width: 24 },
  }, dataRoot);
  try {
    const child = await runWorker(fixture, serviceUrl);
    assert.equal(child.code, 0, child.stderr);
    const result = JSON.parse(fs.readFileSync(path.join(fixture.jobRoot, "result.json"), "utf8"));
    assert.equal(result.run.adapterId, "parametric-cad");
    assert.equal(result.run.status, "completed");
    const terminal = result.run.events.find((event) => event.type === "run.completed");
    assert.equal(terminal.payload.revision, 2);
    assert.equal(terminal.payload.status, "valid");
    assert.equal(terminal.payload.validationPassed, true);
    assert.deepEqual(terminal.payload.changed, [{ id: "width", from: 20, to: 24 }]);
    assert.ok(result.run.events.some((event) => event.type === "cad.parameter_update.started"));
    assert.ok(result.run.events.some((event) => event.type === "cad.parameter_update.completed"));
  } finally {
    await services.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("a Runtime stop also aborts an in-flight parameter rebuild", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-parametric-param-cancel-"));
  const services = localServices({ hangCad: true });
  const serviceUrl = await services.listen();
  const { conversationPublicId, projectId } = seedCadProject(dataRoot);
  const fixture = runtimeFixture({
    operation: "parameter-update",
    conversationPublicId,
    projectId,
    values: { width: 24 },
  }, dataRoot);
  try {
    const child = await runWorker(fixture, serviceUrl, {
      cancelWhen: services.executeRequested,
    });
    assert.equal(child.code, 0, child.stderr);
    assert.equal(fs.existsSync(path.join(fixture.jobRoot, "result.json")), false);
    const checkpoint = JSON.parse(
      fs.readFileSync(path.join(fixture.jobRoot, "checkpoint.json"), "utf8"),
    );
    assert.equal(checkpoint.status, "aborted");
    assert.ok(checkpoint.events.some((event) => event.type === "cad.parameter_update.started"));
    assert.ok(checkpoint.events.some((event) => event.type === "run.aborted"));
    assert.match(child.stdout, /"type":"cancellation-acknowledged"/);
  } finally {
    await services.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("a Runtime stop aborts the real CAD worker without publishing a result", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-parametric-cancel-"));
  const services = localServices({ hangModel: true });
  const serviceUrl = await services.listen();
  const conversationPublicId = seedConversation(dataRoot);
  const fixture = runtimeFixture(
    canonicalRequest(conversationPublicId, `${serviceUrl}/v1`),
    dataRoot,
  );
  try {
    const child = await runWorker(fixture, serviceUrl, {
      cancelWhen: services.modelRequested,
    });
    assert.equal(child.code, 0, child.stderr);
    assert.equal(fs.existsSync(path.join(fixture.jobRoot, "result.json")), false);
    const checkpoint = JSON.parse(
      fs.readFileSync(path.join(fixture.jobRoot, "checkpoint.json"), "utf8"),
    );
    assert.equal(checkpoint.status, "aborted");
    assert.ok(checkpoint.events.some((event) => event.type === "run.aborted"));
    assert.match(child.stdout, /"type":"cancellation-acknowledged"/);
  } finally {
    await services.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
