import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import Database from "better-sqlite3";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-cad-timeout-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { default: appDatabase } = await import("../src/lib/db.ts");
const { runCadAgentLoop, runCadProjectBuildPhase } = await import("../src/lib/cad/model-client.ts");
const { designCadPart } = await import("../src/lib/cad/design-service.ts");
const { cadDefaults } = await import("../src/lib/cad/defaults.ts");
const { assessCadSafety } = await import("../src/lib/cad/safety.ts");
const { ensureCadSchema } = await import("../src/lib/cad/schema.ts");

after(() => {
  appDatabase.close();
  assert.equal(path.dirname(dataRoot), os.tmpdir());
  assert.ok(path.basename(dataRoot).startsWith("breadboard-cad-timeout-"));
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

const spec = {
  name: "Articulated hand",
  description: "A palm and articulated digits with mating joints.",
  units: "mm",
  manufacturingProcess: "fdm",
  parameters: [{ id: "width", label: "Width", value: 80, editable: true, source: "user" }],
  components: [{ id: "palm", name: "Palm", quantity: 1, bodyRole: "primary" }],
  constraints: [],
  assumptions: [],
  exportSettings: {
    stlLinearTolerance: 0.1, stlAngularTolerance: 0.2,
    generateStep: true, generateStl: true, generateGlb: true, generate3mf: false,
  },
};
const project = {
  id: "cadp_timeout_test", current_revision: 0,
  design_spec_json: JSON.stringify({ ...spec, schemaVersion: 1, projectId: "cadp_timeout_test" }),
};

function context(overrides = {}) {
  return {
    userId: 1, conversationId: 1, clusterId: null,
    model: "test-model", instruction: "Design an articulated hand",
    safety: assessCadSafety("Design an articulated hand"), defaults: cadDefaults("fdm"),
    attemptsRemaining: 3, ...overrides,
  };
}

function response(name = "cad_generate_model") {
  return new Response(JSON.stringify({
    choices: [{ message: { tool_calls: [{
      id: "call_generated", type: "function",
      function: {
        name,
        arguments: JSON.stringify(name === "cad_create_project"
          ? { name: spec.name, design_spec: spec, parameters: { width: 80 } }
          : { projectId: "cadp_wrong", source: "generated source", parameters: { width: 999 } }),
      },
    }] } }],
    usage: { input_tokens: 10, output_tokens: 20 },
  }), { headers: { "content-type": "application/json" } });
}

function stalled(signal) {
  return new Promise((_, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

const target = {
  baseUrl: "http://model.test/v1", model: "test-model", reasoningEffort: "max",
  requestTimeoutMs: 15_000,
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("planning timeout saves exactly one project and shares its recovery budget with source generation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const database = new Database(":memory:");
  t.after(() => database.close());
  database.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY);
    INSERT INTO users VALUES (1);
    INSERT INTO conversations VALUES (1);
  `);
  ensureCadSchema(database);
  const events = [];
  const toolContext = context({ database, emit: (type, payload) => events.push({ type, payload }) });
  const bodies = [];
  t.mock.method(globalThis, "fetch", (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return bodies.length === 2 ? Promise.resolve(response("cad_create_project")) : stalled(init.signal);
  });
  const resultPromise = runCadAgentLoop({
    ...target, toolContext, systemPrompt: "Save the specification", userMessage: "An articulated hand",
    maxSteps: 1, allowedToolNames: ["cad_create_project"], forcedToolName: "cad_create_project",
  });
  t.mock.timers.tick(15_000);
  const result = await resultPromise;
  assert.equal(bodies.length, 2);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].ok, true);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM cad_projects").get().n, 1);
  assert.equal(toolContext.attemptsRemaining, 3);
  assert.equal(toolContext.modelTimeoutRecoveriesRemaining, 0);
  assert.equal(bodies[1].reasoning_effort, "low");
  assert.deepEqual(bodies[1].tool_choice, bodies[0].tool_choice);
  assert.deepEqual(bodies[1].messages.slice(0, -1), bodies[0].messages);
  assert.equal(events.filter((event) => event.type === "cad.model.retrying").length, 1);
  assert.equal(events[0].payload.phase, "spec");

  let builds = 0;
  const saved = database.prepare("SELECT * FROM cad_projects").get();
  const build = runCadProjectBuildPhase({
    ...target, project: saved, toolContext,
    runTool: async () => { builds += 1; return { ok: true, validationPassed: true }; },
  });
  const rejection = assert.rejects(build, { code: "model_timeout" });
  t.mock.timers.tick(15_000);
  await rejection;
  assert.equal(bodies.length, 3, "a new phase must not reset the turn's recovery budget");
  assert.equal(builds, 0);
});

for (const phase of ["headers", "body"]) {
  test(`source timeout during ${phase} retries once, then validates and repairs the generated build`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const bodies = [];
    const toolCalls = [];
    const usages = [];
    const toolContext = context({ projectId: project.id });
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length > 1) return response();
      if (phase === "headers") return stalled(init.signal);
      return { ok: true, json: () => stalled(init.signal) };
    });
    const run = runCadProjectBuildPhase({
      ...target, project, toolContext, onUsage: (usage) => usages.push(usage),
      runTool: async (name, args) => {
        toolCalls.push({ name, args });
        toolContext.attemptsRemaining -= 1;
        return toolCalls.length === 1
          ? { ok: false, validationPassed: false, message: "Joint clearance overlaps" }
          : { ok: true, validationPassed: true, revision: 2 };
      },
    });
    await flush();
    t.mock.timers.tick(15_000);
    const result = await run;
    assert.equal(result.stoppedBecause, "answered");
    assert.equal(bodies.length, 3);
    assert.equal(bodies[1].reasoning_effort, "low");
    assert.equal(toolCalls.length, 2, "the timed-out completion must not execute a tool");
    assert.ok(toolCalls.every(({ args }) => args.projectId === project.id));
    assert.ok(toolCalls.every(({ args }) => args.parameters.width === 80));
    assert.equal(toolContext.attemptsRemaining, 1);
    assert.equal(usages.length, 2);
    assert.ok(bodies[2].messages.some((message) => message.content.includes("Joint clearance overlaps")));
  });
}

test("a repeated model timeout terminates without a build or a third model request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requests = 0;
  let builds = 0;
  t.mock.method(globalThis, "fetch", (_url, init) => { requests += 1; return stalled(init.signal); });
  const run = runCadProjectBuildPhase({
    ...target, project, toolContext: context(),
    runTool: async () => { builds += 1; return { ok: true, validationPassed: true }; },
  });
  const rejection = assert.rejects(run, { code: "model_timeout" });
  t.mock.timers.tick(15_000);
  await flush();
  assert.equal(requests, 2);
  t.mock.timers.tick(15_000);
  await rejection;
  assert.equal(requests, 2);
  assert.equal(builds, 0);
});

for (const stage of ["before-request", "body", "retry-event"]) {
  test(`Stop during ${stage} prevents further model calls and CAD execution`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const controller = new AbortController();
    let requests = 0;
    let builds = 0;
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      requests += 1;
      return { ok: true, json: () => stalled(init.signal) };
    });
    if (stage === "before-request") controller.abort();
    const run = runCadProjectBuildPhase({
      ...target, signal: controller.signal, project,
      toolContext: context({ emit: () => controller.abort() }),
      runTool: async () => { builds += 1; return { ok: true, validationPassed: true }; },
    });
    if (stage === "before-request") assert.equal((await run).stoppedBecause, "aborted");
    else {
      const rejection = assert.rejects(run, { code: "aborted" });
      await flush();
      if (stage === "retry-event") t.mock.timers.tick(15_000);
      else controller.abort();
      await rejection;
    }
    assert.equal(requests, stage === "before-request" ? 0 : 1);
    assert.equal(builds, 0);
  });
}

for (const status of [429, 503, "invalid-json"]) {
  test(`${status} is not retried as a CAD model timeout`, async (t) => {
    let requests = 0;
    t.mock.method(globalThis, "fetch", async () => {
      requests += 1;
      return status === "invalid-json"
        ? new Response("{broken", { status: 200 })
        : new Response(JSON.stringify({ error: { message: "model unavailable" } }), { status });
    });
    await assert.rejects(runCadProjectBuildPhase({ ...target, project, toolContext: context() }), {
      code: status === "invalid-json" ? "invalid_response" : status === 429 ? "model_rate_limited" : "model_unavailable",
    });
    assert.equal(requests, 1);
  });
}

test("new designs receive a focused specification prompt before any source generation", async (t) => {
  let body;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ error: "unavailable" }), { status: 503 });
  });
  const result = await designCadPart({
    ...target, userId: 1, conversationId: 1, clusterId: null,
    brief: "Design a human hand with moving joints", reasoningEffort: "max",
  });
  assert.equal(result.ok, false);
  assert.equal("manifest" in result, false);
  assert.equal(body.tool_choice.function.name, "cad_create_project");
  assert.equal(body.reasoning_effort, "medium");
  const prompt = body.messages[0].content;
  assert.match(prompt, /specification phase/);
  assert.match(prompt, /joint axes, motion limits/);
  assert.match(prompt, /separate phase writes and validates/);
  assert.doesNotMatch(prompt, /import cadquery|DEFAULT_PARAMS|undefined/);
});

function streamHarness(t) {
  let streamController;
  let requests = 0;
  const encoder = new TextEncoder();
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requests += 1;
    assert.equal(JSON.parse(init.body).stream, true);
    const body = new ReadableStream({ start(controller) { streamController = controller; } });
    init.signal.addEventListener("abort", () => streamController.error(init.signal.reason), { once: true });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  });
  return {
    get requests() { return requests; },
    raw(value) { streamController.enqueue(encoder.encode(value)); },
    chunk(value) { streamController.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\r\n\r\n`)); },
    close() { streamController.close(); },
  };
}

test("active streaming outlives the idle deadline and assembles fragmented tool arguments before execution", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stream = streamHarness(t);
  const executed = [];
  const usages = [];
  const run = runCadProjectBuildPhase({
    ...target, requestTimeoutMs: 60_000, requestIdleTimeoutMs: 15_000,
    project, toolContext: context(), onUsage: (value) => usages.push(value),
    runTool: async (_name, args) => { executed.push(args); return { ok: true, validationPassed: true }; },
  });
  await flush();
  stream.chunk({ choices: [{ index: 0, delta: { reasoning_content: "private planning text" } }] });
  await flush();
  const args = JSON.stringify({ projectId: "cadp_wrong", source: "complete source with a café label" });
  stream.chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_stream", function: { name: "cad_generate_model", arguments: args.slice(0, 10) } }] } }] });
  await flush();
  for (let offset = 10; offset < args.length; offset += 20) {
    t.mock.timers.tick(10_000);
    stream.chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(offset, offset + 20) } }] } }] });
    await flush();
    assert.equal(executed.length, 0);
  }
  // Network boundaries need not coincide with SSE frames or JSON tokens.
  stream.raw('data: {"choices":[{"index":0,"delta":{},"finish_');
  stream.raw('reason":"tool_calls"}]}\r\n\r\n');
  stream.chunk({ choices: [], usage: { input_tokens: 10, output_tokens: 20 } });
  stream.raw("data: [DONE]\r\n\r\n");
  const result = await run;
  assert.equal(result.stoppedBecause, "answered");
  assert.equal(stream.requests, 1);
  assert.equal(executed.length, 1);
  assert.equal(executed[0].source, "complete source with a café label");
  assert.equal(executed[0].projectId, project.id);
  assert.equal(usages.length, 1);
  assert.doesNotMatch(result.answer, /private planning text/);
});

test("SSE heartbeats cannot keep an unresponsive CAD model alive", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stream = streamHarness(t);
  const run = runCadProjectBuildPhase({
    ...target, requestTimeoutMs: 60_000, requestIdleTimeoutMs: 15_000,
    project, toolContext: context({ modelTimeoutRecoveriesRemaining: 0 }),
    runTool: async () => assert.fail("an idle stream cannot produce a CAD build"),
  });
  const rejection = assert.rejects(run, (error) => error.code === "model_timeout" && /progress for 15s/.test(error.message));
  await flush();
  t.mock.timers.tick(10_000);
  stream.raw(": ping\r\n\r\n");
  await flush();
  t.mock.timers.tick(5_000);
  await rejection;
  assert.equal(stream.requests, 1);
});

test("continuous model progress still respects the absolute request deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stream = streamHarness(t);
  const run = runCadProjectBuildPhase({
    ...target, requestTimeoutMs: 40_000, requestIdleTimeoutMs: 15_000,
    project, toolContext: context({ modelTimeoutRecoveriesRemaining: 0 }),
    runTool: async () => assert.fail("unfinished reasoning cannot produce a build"),
  });
  const rejection = assert.rejects(run, { code: "model_timeout" });
  await flush();
  for (let i = 0; i < 3; i += 1) {
    t.mock.timers.tick(10_000);
    stream.chunk({ choices: [{ delta: { reasoning_content: "Still working" } }] });
    await flush();
  }
  t.mock.timers.tick(10_000);
  await rejection;
  assert.equal(stream.requests, 1);
});

for (const ending of ["eof", "done", "length", "malformed"]) {
  test(`a stream ending with ${ending} cannot execute an unconfirmed tool call`, async (t) => {
    const stream = streamHarness(t);
    const run = runCadProjectBuildPhase({
      ...target, project, toolContext: context(),
      runTool: async () => assert.fail("incomplete streamed calls must not run"),
    });
    const rejection = assert.rejects(run, { code: ending === "malformed" ? "invalid_response" : "incomplete_response" });
    await flush();
    stream.chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: "partial", function: { name: "cad_generate_model", arguments: JSON.stringify({ source: "partial source" }) } }] } }] });
    if (ending === "length") stream.chunk({ choices: [{ delta: {}, finish_reason: "length" }] });
    if (ending === "done") stream.raw("data: [DONE]\n\n");
    if (ending === "malformed") stream.raw("data: {broken\n\n");
    if (ending === "eof") stream.close();
    await rejection;
    assert.equal(stream.requests, 1);
  });
}
