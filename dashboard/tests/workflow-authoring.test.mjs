import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

register("./teach-support/server-only-stub.mjs", import.meta.url);

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-workflow-authoring-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const authoringBundle = path.join(dataRoot, "workflow-authoring.mjs");
await build({
  absWorkingDir: path.join(import.meta.dirname, ".."),
  entryPoints: ["src/lib/workflows/authoring.ts"],
  outfile: authoringBundle,
  bundle: true,
  format: "esm",
  platform: "node",
  sourcemap: false,
});
const authoring = await import(pathToFileURL(authoringBundle).href);

after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));

test("Hermes reads the native block catalogue before authoring", () => {
  const catalog = authoring.workflowAuthoringCatalog();
  assert.deepEqual(
    catalog.map((block) => block.type).sort(),
    [
      "agent",
      "api",
      "condition",
      "evaluator",
      "function",
      "generic_webhook",
      "response",
      "router",
      "schedule",
    ].sort(),
    "the Hermes tool schema and native visible registry stay in sync",
  );
  const api = catalog.find((block) => block.type === "api");
  assert.ok(api, "the API block is authorable");
  assert.ok(api.inputs.some((input) => input.id === "url"));
  assert.ok(api.inputs.some((input) => input.id === "method"));
  assert.equal(catalog.some((block) => block.type === "starter"), false, "hidden legacy blocks stay hidden");
});

test("a bounded Hermes definition becomes a native connected workflow", () => {
  const { state, warnings } = authoring.buildAuthoredWorkflowState({
    steps: [
      {
        key: "fetch",
        type: "api",
        name: "Fetch report",
        inputs: { url: "https://example.test/report", method: "GET" },
      },
      {
        key: "format",
        type: "function",
        name: "Format report",
        inputs: { language: "javascript", code: "return <Fetch report.data>" },
      },
    ],
  });

  assert.equal(Object.keys(state.blocks).length, 3, "the two steps plus the automatic Start block");
  assert.equal(state.edges.length, 2, "Start feeds the first step, and omitted edges connect steps in order");
  assert.equal(warnings.length, 0);
  const start = Object.values(state.blocks).find((block) => block.type === "starter");
  assert.equal(start.name, "Start");
  const fetchBlock = Object.values(state.blocks).find((block) => block.name === "Fetch report");
  assert.ok(state.edges.some((edge) => edge.source === start.id && edge.target === fetchBlock.id));
  const api = Object.values(state.blocks).find((block) => block.type === "api");
  assert.equal(api.subBlocks.url.value, "https://example.test/report");
  assert.equal(api.subBlocks.method.value, "GET");
});

test("invalid fields and cyclic definitions are refused before persistence", () => {
  assert.throws(
    () =>
      authoring.buildAuthoredWorkflowState({
        steps: [{ key: "fetch", type: "api", inputs: { inventedField: "x" } }],
      }),
    /unknown input.*catalog/i,
  );
  assert.throws(
    () =>
      authoring.buildAuthoredWorkflowState({
        steps: [
          { key: "one", type: "function", inputs: { code: "return 1" } },
          { key: "two", type: "function", inputs: { code: "return 2" } },
        ],
        edges: [
          { from: "one", to: "two" },
          { from: "two", to: "one" },
        ],
      }),
    /must not contain a cycle/i,
  );
});

test("direct creation requires an explicit user request", () => {
  assert.equal(authoring.explicitlyRequestsWorkflowCreation("Create a workflow that files receipts"), true);
  assert.equal(authoring.explicitlyRequestsWorkflowCreation("Please automate this weekly report"), true);
  assert.equal(authoring.explicitlyRequestsWorkflowCreation("How do I create a workflow?"), false);
  assert.equal(authoring.explicitlyRequestsWorkflowCreation("Do not create an automation; just explain it"), false);
});

test("a yes counts only as the answer to the assistant's own workflow offer", () => {
  const offer = "I can turn this into a workflow you run each week. Want me to build it?";
  assert.equal(authoring.explicitlyRequestsWorkflowCreation("yes please", offer), true);
  assert.equal(authoring.explicitlyRequestsWorkflowCreation("go ahead", offer), true);
  assert.equal(authoring.explicitlyRequestsWorkflowCreation("yes please", "Here is the summary you asked for."), false);
  assert.equal(authoring.explicitlyRequestsWorkflowCreation("no, not now", offer), false);
  assert.equal(authoring.explicitlyRequestsWorkflowCreation("yes"), false);
});

test("the run input reaches the workflow through the automatic Start block", () => {
  const { state } = authoring.buildAuthoredWorkflowState({
    steps: [
      {
        key: "summarize",
        type: "agent",
        name: "Summary",
        inputs: { messages: [{ role: "system", content: "Summarize." }, { role: "user", content: "<start.input>" }] },
      },
      {
        key: "polish",
        type: "agent",
        name: "Polish",
        inputs: { messages: [{ role: "user", content: "Tighten this: <summary.content>" }] },
      },
    ],
  });
  const names = Object.values(state.blocks).map((block) => block.name).sort();
  assert.deepEqual(names, ["Polish", "Start", "Summary"]);
  const xs = Object.values(state.blocks).map((block) => block.position.x);
  assert.equal(new Set(xs).size, 3, "each step sits in its own column");
});

test("a trigger step replaces the automatic Start block", () => {
  const { state } = authoring.buildAuthoredWorkflowState({
    steps: [
      { key: "hook", type: "generic_webhook", name: "Webhook" },
      { key: "work", type: "function", inputs: { code: "return <webhook.body>" } },
    ],
  });
  assert.equal(Object.values(state.blocks).some((block) => block.type === "starter"), false);
});

test("a reference to a block that does not exist is refused with the names that do", () => {
  assert.throws(
    () =>
      authoring.buildAuthoredWorkflowState({
        steps: [{ key: "a", type: "agent", name: "Draft", inputs: { messages: [{ role: "user", content: "<writer.content>" }] } }],
      }),
    /refers to <writer\.…>.*(?=.*<start\.)(?=.*<draft\.)/,
  );
  assert.throws(
    () => authoring.buildAuthoredWorkflowState({ steps: [{ key: "a", type: "function", name: "Start", inputs: { code: "return 1" } }] }),
    /automatic Start block/,
  );
});

test("condition branches are wired to the handles the executor routes on", () => {
  const { state } = authoring.buildAuthoredWorkflowState({
    steps: [
      { key: "check", type: "condition", name: "Is urgent", inputs: { conditions: ["<start.input>.includes('urgent')", "else"] } },
      { key: "fast", type: "function", name: "Escalate", inputs: { code: "return 'now'" } },
      { key: "slow", type: "function", name: "Queue", inputs: { code: "return 'later'" } },
    ],
    edges: [
      { from: "check", to: "fast", sourceHandle: "if" },
      { from: "check", to: "slow", sourceHandle: "else" },
    ],
  });
  const condition = Object.values(state.blocks).find((block) => block.type === "condition");
  const rows = JSON.parse(condition.subBlocks.conditions.value);
  assert.deepEqual(rows.map((row) => row.title), ["if", "else"]);
  const handles = state.edges.filter((edge) => edge.source === condition.id).map((edge) => edge.sourceHandle).sort();
  assert.deepEqual(handles, rows.map((row) => `condition-${row.id}`).sort());
  const escalate = Object.values(state.blocks).find((block) => block.name === "Escalate");
  const queue = Object.values(state.blocks).find((block) => block.name === "Queue");
  assert.notEqual(escalate.position.y, queue.position.y, "branches do not overlap");
  assert.throws(
    () =>
      authoring.buildAuthoredWorkflowState({
        steps: [
          { key: "check", type: "condition", inputs: { conditions: ["true"] } },
          { key: "x", type: "function", inputs: { code: "return 1" } },
        ],
        edges: [{ from: "check", to: "x", sourceHandle: "else if 3" }],
      }),
    /does not have/,
  );
});

test("a Router is authorable and fans out to the blocks it chooses between", () => {
  const { state } = authoring.buildAuthoredWorkflowState({
    steps: [
      { key: "route", type: "router", name: "Route", inputs: { prompt: "Which team? <start.input>" } },
      { key: "billing", type: "agent", name: "Billing", inputs: { messages: [{ role: "user", content: "<start.input>" }] } },
      { key: "support", type: "agent", name: "Support", inputs: { messages: [{ role: "user", content: "<start.input>" }] } },
    ],
    edges: [
      { from: "route", to: "billing" },
      { from: "route", to: "support" },
    ],
  });
  const router = Object.values(state.blocks).find((block) => block.type === "router");
  assert.ok(router);
  const out = state.edges.filter((edge) => edge.source === router.id);
  assert.equal(out.length, 2);
});

test("a saved workflow reads back as the definition that rebuilds it", () => {
  const original = {
    steps: [
      { key: "classify", type: "agent", name: "Classify", inputs: { messages: [{ role: "user", content: "<start.input>" }] } },
      { key: "gate", type: "condition", name: "Gate", inputs: { conditions: ["<classify.content>.includes('urgent')", "<classify.content>.includes('soon')"] } },
      { key: "urgent", type: "agent", name: "Urgent reply", inputs: { messages: [{ role: "user", content: "<classify.content>" }] } },
      { key: "soon", type: "agent", name: "Soon reply", inputs: { messages: [{ role: "user", content: "<classify.content>" }] } },
      { key: "later", type: "agent", name: "Later reply", inputs: { messages: [{ role: "user", content: "<classify.content>" }] } },
    ],
    edges: [
      { from: "classify", to: "gate" },
      { from: "gate", to: "urgent", sourceHandle: "if" },
      { from: "gate", to: "soon", sourceHandle: "else if 1" },
      { from: "gate", to: "later", sourceHandle: "else" },
    ],
  };
  const { state } = authoring.buildAuthoredWorkflowState(original);
  const read = authoring.workflowStateToDefinition(state);
  assert.deepEqual(read.unsupported, []);
  assert.equal(read.steps.some((step) => step.name === "Start"), false, "the automatic Start block is not listed");
  assert.deepEqual(read.steps.map((step) => step.key), ["classify", "gate", "urgent_reply", "soon_reply", "later_reply"]);
  assert.deepEqual(read.steps[1].inputs.conditions, original.steps[1].inputs.conditions);
  assert.deepEqual(
    read.edges.filter((edge) => edge.from === "gate").map((edge) => edge.sourceHandle).sort(),
    ["else", "else if 1", "if"],
  );

  // Rebuilding the read-back definition gives the same graph shape.
  const again = authoring.buildAuthoredWorkflowState({ steps: read.steps, edges: read.edges }).state;
  assert.equal(Object.keys(again.blocks).length, Object.keys(state.blocks).length);
  assert.equal(again.edges.length, state.edges.length);
  const handles = (s) => s.edges.map((edge) => edge.sourceHandle.replace(/condition-[^-]+(?:-[^-]+)*?-(if|else-if-\d+|else)$/, "$1")).sort();
  assert.deepEqual(handles(again), handles(state));
});

test("editing a workflow needs a request for a change, not a question about it", () => {
  assert.equal(authoring.explicitlyRequestsWorkflowEdit("add a step that translates the summary to Dutch"), true);
  assert.equal(authoring.explicitlyRequestsWorkflowEdit("rename it to Weekly digest"), true);
  assert.equal(authoring.explicitlyRequestsWorkflowEdit("what does this workflow do?"), false);
  assert.equal(authoring.explicitlyRequestsWorkflowEdit("don't change anything, just explain the gate"), false);
  assert.equal(authoring.explicitlyRequestsWorkflowEdit("yes", "Want me to add a review step to this workflow?"), true);
  assert.equal(authoring.explicitlyRequestsWorkflowEdit("yes", "The weather is nice today."), false);
});
