import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(dashboardRoot, "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
const identity = await import("../src/lib/aris/identity.ts");
const aris = await import("../src/lib/aris/agent.ts");
const agency = await import("../src/lib/hermes/agency-agents.ts");

test("ARIS resolves the cloned 82-skill research harness", () => {
  const previous = process.env.ARIS_ROOT;
  process.env.ARIS_ROOT = path.join(repoRoot, "auto-claude-code-research-in-sleep");
  try {
    const status = aris.arisAvailability();
    assert.equal(status.available, true);
    assert.equal(status.installed, true);
    assert.equal(status.skillCount, 82);
    assert.equal(aris.isArisSkillSlug("idea-discovery"), true);
    assert.equal(aris.isArisSkillSlug("not-an-aris-workflow"), false);
    const definition = aris.loadArisAgentDefinition();
    assert.equal(definition?.id, "builtin-agent:aris");
    assert.equal(definition?.name, "ARIS");
    assert.equal(definition?.emoji, "");
    assert.match(definition?.instructions ?? "", /ARIS Agent Guide/);
    assert.equal(agency.findAgencyAgent("ARIS")?.slug, "aris");
  } finally {
    if (previous === undefined) delete process.env.ARIS_ROOT;
    else process.env.ARIS_ROOT = previous;
  }
});

test("ARIS lazily loads the cloned skill that matches each research turn", () => {
  const previous = process.env.ARIS_ROOT;
  process.env.ARIS_ROOT = path.join(repoRoot, "auto-claude-code-research-in-sleep");
  try {
    const literature = aris.renderArisTurnGuidance(
      "Survey the literature on diffusion policies and identify prior work.",
    );
    assert.match(literature, /<aris_skill name="research-lit">/);
    assert.match(literature, /literature/i);

    const rebuttal = aris.renderArisTurnGuidance(
      "Prepare a reviewer rebuttal for these comments.",
    );
    assert.match(rebuttal, /<aris_skill name="rebuttal">/);
    assert.match(rebuttal, /same-family\/provisional/);

    const conversational = aris.renderArisTurnGuidance("What can you help me research?");
    assert.doesNotMatch(conversational, /<aris_skill/);
    assert.match(conversational, /No single ARIS workflow was forced/);
  } finally {
    if (previous === undefined) delete process.env.ARIS_ROOT;
    else process.env.ARIS_ROOT = previous;
  }
});

test("ARIS accepts its upstream slash workflows without treating them as capabilities", async () => {
  const previous = process.env.ARIS_ROOT;
  process.env.ARIS_ROOT = path.join(repoRoot, "auto-claude-code-research-in-sleep");
  try {
    const { resolveCommandMessage } = await import("../src/lib/hermes/commands.ts");
    const selected = await resolveCommandMessage(
      1,
      "/agent:aris /idea-discovery find a robust evaluation direction",
      undefined,
      { mode: "knowledge", surface: "dashboard_terminal" },
    );
    assert.deepEqual(selected.agencyAgentSelection, {
      action: "set",
      slug: "aris",
      id: "builtin-agent:aris",
    });
    assert.equal(
      selected.userText,
      "/idea-discovery find a robust evaluation direction",
    );

    const persistent = await resolveCommandMessage(
      1,
      "/research-lit survey the prior work",
      undefined,
      {
        mode: "knowledge",
        surface: "dashboard_terminal",
        activeAgentSlug: "aris",
      },
    );
    assert.equal(persistent.userText, "/research-lit survey the prior work");
    assert.deepEqual(persistent.invocations, []);
  } finally {
    if (previous === undefined) delete process.env.ARIS_ROOT;
    else process.env.ARIS_ROOT = previous;
  }
});

test("ARIS is a persistent Bread agent in the Agents UI and conversation prompt", () => {
  assert.equal(identity.ARIS_AGENT_COMMAND, "/agent:aris");
  const commands = source("src/lib/hermes/commands.ts");
  const hub = source("src/app/components/hermes/command-hub.tsx");
  const turnService = source("src/lib/conversations/turn-service.ts");
  const composer = source("src/app/components/assistant-composer.tsx");
  const health = source("src/app/api/aris/health/route.ts");

  assert.match(commands, /loadArisAgentDefinition\(\)/);
  assert.match(commands, /arisSelected && isArisSkillSlug\(token\)/);
  assert.match(commands, /context\.activeAgentSlug/);
  assert.match(hub, /id="aris-entry"/);
  assert.match(hub, /\{ARIS_AGENT_COMMAND\}/);
  assert.doesNotMatch(hub, /text-\[#b3923e\]/);
  assert.doesNotMatch(hub, /bg-\[#f3e8b8\]/);
  assert.match(turnService, /renderArisTurnGuidance\(resolved\.userText \|\| input\.text\)/);
  assert.match(turnService, /activeAgentSlug: reservation\.conversation\.active_agency_agent_slug/);
  assert.match(composer, /activeAgencyAgent/);
  // Agents are reached from the palette; there is no separate agents page.
  assert.equal(fs.existsSync(path.join(dashboardRoot, "src", "app", "agents")), false);
  assert.match(health, /arisAvailability\(\)/);
});

test("desktop builds bundle ARIS and pass its controlled source path to Bread", () => {
  const definitions = source("../desktop/src/main/service-definitions.ts");
  const packager = source("../desktop/scripts/prepare-app-resources.mjs");
  assert.match(definitions, /ARIS_ROOT/);
  assert.match(definitions, /auto-claude-code-research-in-sleep/);
  assert.match(packager, /staging ARIS/);
  assert.match(packager, /AGENT_GUIDE\.md/);
  assert.match(packager, /BREADBOARD_UPSTREAM_COMMIT/);
});
