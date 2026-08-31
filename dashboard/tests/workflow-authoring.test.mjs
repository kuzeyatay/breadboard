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

  assert.equal(Object.keys(state.blocks).length, 2);
  assert.equal(state.edges.length, 1, "omitted edges connect listed steps in order");
  assert.equal(warnings.length, 0);
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
