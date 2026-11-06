import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { composeHermesSystemPrompt } from "../src/lib/hermes/system-prompts.ts";

// A Garden Chat turn asked for a 13-day exam plan "based on the material I
// need to cover" against a Garden holding 60 sources, including the study
// guide and the tutorial set. It made zero tool calls, told the user it did
// not have the material, and asked them to upload the study guide. Told "its
// uploaded in the garden", it asked a second time; handed the guide, it
// produced a plan built from topic names and closed by asking for another
// upload.
//
// Two things were missing and both are held here: the model was never shown
// what the Garden contains (the topology packet names concepts, never
// sources), and nothing told it to search before asking the user to supply
// material it already has.

const source = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const decision = (overrides = {}) => ({
  mode: "knowledge",
  requestedOutcome: "plan the exam preparation",
  implementationRequired: false,
  decisionReason: "test",
  decisionSource: "breadboard_server_policy_v1",
  authorizedRoots: [],
  authorizedPathPatterns: [],
  allowedTools: [],
  allowedOperations: ["knowledge_work"],
  allowedCommandPatterns: [],
  selectedConditionalSkills: [],
  selectedConnections: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  expiresAt: null,
  revokedAt: null,
  ...overrides,
});

test("the supplied Garden inventory identifies existing material and directs source reads", async () => {
  const adapter = source("src/lib/hermes/garden-chat-adapter.ts");
  const tree = ts.createSourceFile('adapter.ts', adapter, ts.ScriptTarget.Latest, true);
  const fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'gardenSourceInventoryContext');
  const code = ts.transpileModule(fn.getText(tree).replace('await import("../knowledge.ts")', 'knowledgeModule'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const documents = Array.from({ length: 60 }, (_, i) => ({ source: { title: `Source ${i}`, slug: `source-${i}`, type: 'source-document' }, topics: [] }));
  const inventory = new Function('process', 'knowledgeModule', `${code}\nreturn gardenSourceInventoryContext;`)(
    { env: { QUARTZ_CONTENT_PATH: '/test/content' } },
    { scanClusterKnowledge: () => ({ tree: documents, stats: { documents: 60, topics: 0 } }) },
  );
  const prompt = composeHermesSystemPrompt({
    surface: "garden_chat", decision: decision(),
    userText: "form me a 13 day study plan from the material for this exam",
    additional: await inventory('course'),
  });
  const flat = prompt.replace(/\s+/g, " ");
  assert.match(flat, /active_garden_source_inventory/);
  assert.match(flat, /does not need to upload, paste, or re-send/);
  assert.match(flat, /Use garden_search or garden_list_files to find sources not shown/);
  assert.match(flat, /Read a source with garden_search, garden_get_page, or garden_get_source_excerpt before making any claim/);
  assert.match(flat, /partial title index \(20 of 60 entries\), not source contents/);
  assert.ok(flat.includes('source-19'));
  assert.ok(!flat.includes('source-20'));
});

test("the inventory reaches the turn without the whole Garden topology packet", () => {
  const adapter = source("src/lib/hermes/garden-chat-adapter.ts");
  assert.match(adapter, /const gardenSourceInventory = await gardenSourceInventoryContext\(clusterSlug\)/);
  const additional = adapter.slice(adapter.indexOf("additional: ["));
  assert.ok(additional.includes("gardenSourceInventory,"), "the inventory is passed into the composed prompt");
  assert.doesNotMatch(additional, /gardenTopologyContext\(clusterSlug/);
});

test("the inventory rides the cached scan rather than rescanning every turn", () => {
  const adapter = source("src/lib/hermes/garden-chat-adapter.ts");
  const fn = adapter.slice(
    adapter.indexOf("async function gardenSourceInventoryContext"),
    adapter.indexOf("function gardenTurnContext"),
  );
  assert.match(fn, /maxStaleMs: 60_000/);
  assert.match(fn, /migrateSources: false/);
  // Titles only: the bodies stay behind the read tools.
  assert.doesNotMatch(fn, /\bexcerpt\b|\bbody\b/);
});
