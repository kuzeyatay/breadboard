import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import { prepareTurn, mergeSelectedTools } from "../src/lib/hermes/dispatch-core.ts";
import { allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";
import { createHermesEventNormalizationState, normalizeHermesEvent } from "../src/lib/agent-runtime/hermes-events.ts";
import { parseAgentLaunchRequest } from "../src/lib/hermes/agent-launch.ts";
import { superAgentActivityLabelForTool } from "../src/lib/hermes/super-agent-activity.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
fs.mkdirSync(path.join(root, ".tmp"), { recursive: true });
const workspace = fs.mkdtempSync(path.join(root, ".tmp/multisim-super-agent-"));
// Use the shipped skill with an isolated catalogue, without the user's database.
process.env.HERMES_FIRST_PARTY_SKILLS_ROOT = path.join(workspace, "skills");
process.env.HERMES_SKILLS_APPROVED = path.join(workspace, "approved");
process.env.HERMES_SKILLS_CONDITIONAL = path.join(workspace, "conditional");
fs.cpSync(path.join(root, "hermes-skills/prebuilt/multisim-agent"),
  path.join(process.env.HERMES_FIRST_PARTY_SKILLS_ROOT, "multisim-agent"), { recursive: true });
// Exceed the forty fully described skills so a discovery failure cannot pass
// merely because Multisim was the only installed skill in the test catalogue.
for (let index = 0; index < 48; index += 1) {
  const slug = `a-document-${String(index).padStart(2, "0")}`;
  const directory = path.join(process.env.HERMES_FIRST_PARTY_SKILLS_ROOT, slug);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), `---\nname: ${slug}\ndescription: Format documents and organize meeting notes and project reports.\n---\n\n# Document helper\n\nFormat the requested document.\n`);
}
const { listApprovedSkills } = await import("../src/lib/hermes/skills.ts");

const catalogueMocks = {
  "server-only": "export {};",
  "./mcp-connections.ts": "export const listMcpConnections = () => [];",
  "./agency-agents.ts": "export const CHIEF_OF_STAFF_SLUG = 'chief-of-staff'; export const loadAgencyAgentsCatalog = () => ({status:'unavailable'});",
  "../workflows/store.ts": "export const listWorkflows = () => [];",
};
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.endsWith("/hermes/super-agent.ts") && catalogueMocks[specifier]) {
    return { url: `data:text/javascript,${encodeURIComponent(catalogueMocks[specifier])}`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const { loadSuperAgentInventory, renderSuperAgentDirective } = await import("../src/lib/hermes/super-agent.ts");
hooks.deregister();

for (const surface of ["dashboard_terminal", "garden_chat"]) {
  test(`Super Agent discovers Multisim and grants its native tool on ${surface}`, async () => {
    const request = "Create a low noise amplifier with 20dB gain";
    const skill = listApprovedSkills(surface).find((entry) => entry.slug === "multisim-agent");
    assert(skill, "shipped skill must be available without a slash command or MCP installation");
    assert.equal(skill.classification, "eligible_general");
    assert.deepEqual(skill.capabilityContract.requiredTools, ["multisim"]);
    const inventory = await loadSuperAgentInventory({ userId: 3, surface, request });
    assert(inventory.skillSlugs.includes("multisim-agent"));
    assert.match(renderSuperAgentDirective(inventory), /multisim-agent/);
    assert.match(renderSuperAgentDirective(inventory), /native `multisim` tool directly/);
    const prepared = prepareTurn({ request, surface, userId: 3, grants: [], workspaceRoot: workspace, superAgent: true });
    assert.equal(prepared.blocked, false);
    assert(allowedToolsForSurface(surface).includes("multisim"));
    assert.equal(prepared.grant.allowedTools.multisim, true);
    assert(prepared.decision.allowedTools.includes("multisim"), "persisted turn grant must authorize the callback");
    assert.equal(mergeSelectedTools(prepared.grant.allowedTools, { multisim: true }).multisim, true);
  });

  test(`ordinary electronics prompts surface the skill without a runtime agent on ${surface}`, async () => {
    for (const request of [
      "Create a low noise amplifier with 20dB gain",
      "Build an RC low-pass filter with a 1 kHz cutoff",
      "Calculate a voltage divider from 5 V to 3.3 V",
      "Simulate a MOSFET switching stage",
    ]) {
      const inventory = await loadSuperAgentInventory({ userId: 3, surface, request });
      assert(inventory.skillSlugs.length > 40, "exercise the real catalogue description cutoff");
      assert.equal(inventory.skills[0]?.slug, "multisim-agent", request);
      assert(!inventory.moreSkillSlugs.includes("multisim-agent"));
      assert(!inventory.runtimeAgents.some((agent) => /multisim/i.test(`${agent.id} ${agent.name} ${agent.command}`)));
      const directive = renderSuperAgentDirective(inventory);
      assert.match(directive, /Ordinary prompts such as/);
      assert.match(directive, /do not use `agent_launch` or create a separate agent card for Multisim/);
    }
  });
}

test("Multisim success and failure events stay in normal thinking activity, with no agent card launch", () => {
  assert.equal(superAgentActivityLabelForTool("multisim"), "Working on circuit");
  for (const success of [true, false]) {
    const state = createHermesEventNormalizationState();
    const args = { action: "run_ac_analysis", arguments: { circuit_id: "circuit-1" } };
    const result = success
      ? { success: true, run_id: "run-1", artifacts: [{ path: "bode.svg" }] }
      : { success: false, error: "The simulator did not converge" };
    const raw = [
      { type: "tool.start", session_id: "live", payload: { name: "multisim", tool_id: "call-1", args } },
      { type: "tool.complete", session_id: "live", payload: { name: "multisim", tool_id: "call-1", args, success, result } },
    ];
    const events = raw.flatMap((event) => normalizeHermesEvent(event, "live", "public", state));
    assert.deepEqual(events.map((event) => event.type), ["tool.started", "tool.completed"]);
    for (const event of [...raw, ...events]) assert.equal(parseAgentLaunchRequest(event), null);
    assert.equal(events[1].payload.success, success);
    assert.deepEqual(events[1].payload.details.result, result, "keep result and failure evidence in the normal tool stream");
    assert.equal(events[1].payload.uiResources, undefined, "circuit artifacts do not become a generated UI card");
    assert.equal(state.activeTools.size, 0);
  }
});

test("Super Agent cannot expose Multisim to public, anonymous or isolated sessions", () => {
  for (const input of [
    { surface: "quartz_ai", userId: 3 },
    { surface: "garden_chat", userId: null },
    { surface: "dashboard_terminal", userId: 3, isolated: true },
  ]) {
    const prepared = prepareTurn({ request: "Simulate a circuit", grants: [], workspaceRoot: workspace, superAgent: true, ...input });
    assert.equal(prepared.grant.allowedTools.multisim, false);
    assert(!prepared.decision.allowedTools.includes("multisim"));
    assert.equal(mergeSelectedTools(prepared.grant.allowedTools, { multisim: true }).multisim, false);
  }
});
