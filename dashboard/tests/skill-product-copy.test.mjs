import assert from "node:assert/strict";
import test from "node:test";
import { skillProductDescription } from "../src/lib/hermes/skill-product-copy.ts";
import { SKILL_PRODUCT_DESCRIPTIONS } from "../src/lib/hermes/skill-product-descriptions.ts";
import { directSlashCommandItems } from "../src/lib/hermes/direct-slash-commands.ts";
import { agencyAgentProductDescription } from "../src/lib/hermes/agency-agent-product-copy.ts";

test("bundled skills resolve by publisher and canonical ID, including aliased commands", () => {
  for (const [source, entries] of Object.entries(SKILL_PRODUCT_DESCRIPTIONS)) {
    for (const [slug, summary] of Object.entries(entries)) {
      const prefix = source === "breadboard" ? "breadboard:first-party" : source;
      const item = Object.freeze({ kind: "skill", source, id: `${prefix}/${slug}`, slug: `alias-${slug}`, description: "Original instructions" });
      assert.equal(skillProductDescription(item), summary, `${source}/${slug}`);
      assert.equal(item.description, "Original instructions");
      assert.doesNotMatch(summary, /use when the user|trigger this skill|clone.*repo|\[omh\]/i);
    }
  }
});

test("catalog and command menu resolve the same copy before description hydration", () => {
  const fields = { source: "Breadboard", slug: "calendar", description: "" };
  const id = "breadboard:first-party/calendar";
  const catalog = skillProductDescription({ ...fields, upstreamId: id });
  assert.ok(catalog);
  assert.equal(skillProductDescription({ ...fields, id, kind: "skill" }), catalog);
});

test("publisher matching supports canonical case and the CAD source", () => {
  assert.equal(skillProductDescription({ source: "Breadboard", id: "breadboard:first-party/cad" }),
    skillProductDescription({ source: "earthtojake/text-to-cad", id: "earthtojake/text-to-cad/cad" }));
  assert.equal(skillProductDescription({ source: "iOfficeAI/OfficeCLI", slug: "officecli" }),
    SKILL_PRODUCT_DESCRIPTIONS["iofficeai/officecli"].officecli);
});

test("custom, document, unknown, and non-skill descriptions remain unchanged", () => {
  const original = "A description written by this publisher";
  const known = { source: "Breadboard", slug: "calendar", id: "breadboard:first-party/calendar", description: original };
  for (const fields of [
    { source: "another/publisher", id: "another/publisher/calendar" },
    { sourceType: "document" },
    { sourceType: "local-install", id: "skill:calendar" },
    { kind: "prompt" }, { kind: "agent" }, { kind: "mcp" },
    { id: "breadboard:first-party/unknown" },
    { id: "different/publisher/calendar" },
    { source: "__proto__", id: "__proto__/calendar" },
    { id: "breadboard:first-party/toString" },
  ]) assert.equal(skillProductDescription({ ...known, ...fields }), original);
  assert.equal(skillProductDescription({ source: "another/publisher" }), "");
});

test("slash search finds product wording without replacing the command payload", () => {
  const item = Object.freeze({
    kind: "skill", source: "Breadboard", id: "breadboard:first-party/calendar", slug: "my-calendar",
    token: "my-calendar", name: "Calendar", description: "Original machine guidance", installed: true, enabled: true, healthy: true,
  });
  const items = directSlashCommandItems({
    surface: "dashboard_terminal", query: "availability", availableRuntimeAgentIds: [], agencyAgents: [],
    groups: { skills: [item], agents: [], prompts: [], mcp: [] },
  });
  assert.deepEqual(items, [item]);
  assert.equal(items[0], item);
});

test("persona summaries apply only to the bundled description and preserve custom variants", () => {
  const agent = Object.freeze({ slug: "agents-orchestrator", description: "Autonomous pipeline manager that orchestrates the entire development workflow. You are the leader of this process." });
  assert.notEqual(agencyAgentProductDescription(agent), agent.description);
  assert.doesNotMatch(agencyAgentProductDescription(agent), /You are/);
  const custom = { ...agent, description: "My own orchestration instructions" };
  assert.equal(agencyAgentProductDescription(custom), custom.description);
  assert.equal(agencyAgentProductDescription({slug:"__proto__",description:"Custom"}),"Custom");
});
