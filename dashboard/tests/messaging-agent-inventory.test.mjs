import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { RUNTIME_AGENT_PROFILES, runtimeAgentSupportsDelivery } from "../src/lib/hermes/capability-combinations.ts";

function source(file) {
  return fs.readFileSync(new URL(file, import.meta.url), "utf8");
}

// Exercise the real inventory and delivery prompt without loading the live
// skill catalogue, credentials, database or model runtime.
function loadFunction(file, name, scope = {}) {
  const tree = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true);
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, name);
  const { outputText } = ts.transpileModule(declaration.getText(tree), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  return new Function("exports", ...Object.keys(scope), `${outputText}\nreturn ${name};`)({}, ...Object.values(scope));
}

const loadInventory = loadFunction("../src/lib/hermes/super-agent.ts", "loadSuperAgentInventory", {
  RUNTIME_AGENT_PROFILES, runtimeAgentSupportsDelivery,
  MAX_DESCRIBED_SKILLS: 8, MAX_SLUG_ONLY_SKILLS: 432, GOAL_MODE_CONNECTION: "goal",
  listMcpConnections: () => [{ slug: "connected-app" }],
  skillEntries: () => ({ entries: [{ slug: "web-research" }], slugs: ["web-research"] }),
  loadAgencyAgentsCatalog: () => ({ status: "unavailable" }),
  localWorkflows: async () => ({ workflows: [], reachable: true }),
});

test("messaging inventories retain tools and only advertise workers that can start without a page", async () => {
  for (const deliveryChannel of ["telegram", "whatsapp"]) {
    const inventory = await loadInventory({ userId: 1, surface: "dashboard_terminal", deliveryChannel });
    assert.deepEqual(inventory.runtimeAgents.map(agent => agent.id), ["max-research"]);
    assert.deepEqual(inventory.skillSlugs, ["web-research"]);
    assert.deepEqual(inventory.connections, ["connected-app"]);
  }
});

test("desktop inventories retain their complete surface-specific worker catalogue", async () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const inventory = await loadInventory({ userId: 1, surface });
    assert.deepEqual(inventory.runtimeAgents.map(agent => agent.id),
      RUNTIME_AGENT_PROFILES.filter(agent => agent.surfaces.includes(surface)).map(agent => agent.id));
  }
});

test("phone turns carry their channel into discovery and require a result rather than a promise", () => {
  const turnService = source("../src/lib/conversations/turn-service.ts");
  assert.match(turnService, /loadSuperAgentInventory\(\{[^}]*deliveryChannel: context\.deliveryChannel/);
  const prompt = loadFunction("../src/lib/conversations/turn-service.ts", "renderDeliveryChannel");
  assert.equal(prompt(undefined), "");
  for (const channel of ["telegram", "whatsapp"]) {
    assert.match(prompt(channel), /Do not end with only 'I am checking'/);
    assert.match(prompt(channel), /worker confirmed as running server-side/);
    assert.match(prompt(channel), /try another available tool or state the specific limitation now/);
  }
});
