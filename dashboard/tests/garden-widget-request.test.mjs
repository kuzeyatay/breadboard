import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { gardenNavigationResourceFromSources, normalizeGenerativeUiResources } from "../src/lib/generative-ui/contracts.ts";
import { explicitlyRequestsGardenNavigator, uiResourcesForUserRequest } from "../src/lib/generative-ui/request-policy.ts";

const rewrite = "based on our conversations here on this topc, can ytou write this markdowns introduction again?";
const explicit = "Show the Garden search widget";
const resource = gardenNavigationResourceFromSources({
  id: "regression", query: explicit, createdAt: "2026-09-08T12:00:00Z",
  sources: [{ gardenSlug: "em-1", gardenName: "EM 1", pageSlug: "fields", title: "Why Electromagnetic Fields Matter" }],
});

test("only explicit requests to display Garden navigation opt in", () => {
  for (const request of [
    explicit, 'Show me the "Found in your Gardens" widget.',
    "Could you please display the Garden navigator?",
    "Open the Garden search results for electromagnetic fields.",
    "Please include the Garden search card.", "Garden widget please",
    "Rewrite the introduction. Also show the Garden search widget.",
    "Use the garden navigation panel.",
    "I'd like to see the Garden widget.", "I want the Garden search widget.",
  ]) assert.equal(explicitlyRequestsGardenNavigator(request), true, request);
  for (const request of [
    "", rewrite, "Explain this introduction using my Garden notes.",
    "Search my Gardens for the correct page and rewrite its introduction.",
    "Find my notes about fields.", "What does the Garden search widget do?",
    "Show me how the Garden widget works.", "Fix the Garden widget trigger.",
    "I want the Garden widget fixed.", "I need the Garden widget hidden.",
    "Don't show the Garden search widget.", "Show the answer without a Garden widget.",
    "Don’t show the Garden widget.",
    "Never display the Garden navigator.", "No Garden search results please.",
    `Summarize this example:\n> ${explicit}`, `Explain this code:\n\`\`\`text\n${explicit}\n\`\`\``,
    `Explain this snippet: \`${explicit}\``, `The document says "${explicit}". Explain it.`,
    `"${explicit}"`, "Show the Garden widget. Actually, don't show it; no widget please.",
  ]) assert.equal(explicitlyRequestsGardenNavigator(request), false, request);
});

test("tool queries cannot opt in and other resource kinds remain visible", () => {
  const other = { kind: "product-search", id: "products" };
  assert.deepEqual(uiResourcesForUserRequest([resource, other], rewrite), [other]);
  assert.deepEqual(uiResourcesForUserRequest([resource], explicit), [resource]);
  assert.deepEqual(uiResourcesForUserRequest([resource], ""), []);
});

test("restored resources use their own preceding user request, including verification recovery", () => {
  const source = readFileSync(new URL("../src/lib/hermes/session-presentation.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("session.ts", source, ts.ScriptTarget.Latest, true);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "uiResources") initializer = node.initializer.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(initializer);
  const project = new Function("uiResourcesForUserRequest", "persistedUiResources", "generativeUiResourcesFromVerification", "metadata", "conversationMessages", "messageIndex", `return ${initializer}`);
  const history = [
    { role: "user", content: explicit }, { role: "assistant", content: "" },
    { role: "user", content: rewrite }, { role: "assistant", content: "" },
  ];
  for (const persisted of [[resource], []]) {
    assert.deepEqual(project(uiResourcesForUserRequest, persisted, () => [resource], {}, history, 1), [resource]);
    assert.deepEqual(project(uiResourcesForUserRequest, persisted, () => [resource], {}, history, 3), []);
  }
});

// Exercise the real tool-completion branches without starting Hermes or
// reading a live user's database. The same payload is forwarded and persisted.
function completedToolBranch(file) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let body;
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(tree) === 'event.type === "tool.completed"') body = node.thenStatement.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(body, file);
  return ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

for (const file of ["../src/lib/hermes/event-stream.ts", "../src/lib/hermes/garden-chat-adapter.ts"]) {
  test(`${file}: background searches keep evidence without streaming or saving a widget`, () => {
    const body = completedToolBranch(file);
    for (const instruction of [rewrite, explicit, ""]) {
      const event = { type: "tool.completed", timestamp: "2026-09-08T12:00:00Z", payload: {
        toolName: "garden_search", toolCallId: "search-1", success: true, summary: "Found the introduction",
        uiResources: [resource], details: { result: { query: explicit, sources: ["fields"] } },
      } };
      const emitted = [], uiResources = [], toolCalls = [], evidence = [];
      const context = {
        event, streamRun: { instruction }, runId: "run-1", getRuntimeRun: () => ({ instruction }),
        uiResourcesForUserRequest, normalizeGenerativeUiResources, uiResources, toolCalls, evidence,
        associateArtifactToolCall() {}, recordAuditEvent() {},
        session: { row: { id: 1 } }, evidenceKindForTool: () => "garden", evidenceTitleForTool: () => "Garden source",
        emit: value => emitted.push(value),
        recordCompletedTool: value => { emitted.push(value.payload); uiResources.push(...value.payload.uiResources); evidence.push(value.payload.details); },
      };
      new Function(...Object.keys(context), body)(...Object.values(context));
      const expected = instruction === explicit ? [resource] : [];
      assert.deepEqual(emitted[0].uiResources, expected);
      assert.deepEqual(uiResources, expected);
      assert.equal(evidence.length, 1);
      assert.equal(event.payload.success, true);
      assert.deepEqual(event.payload.details.result.sources, ["fields"]);
    }
  });
}
