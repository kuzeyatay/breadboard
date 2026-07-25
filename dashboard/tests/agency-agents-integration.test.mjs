import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { composeOpenHarnessSystemPrompt } from "../src/lib/openharness/system-prompts.ts";

function source(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("CommandHub exposes Agents as the fourth keyboard-accessible tab with collision-safe history", () => {
  const hub = source("src/app/components/openharness/command-hub.tsx");
  const skill = hub.indexOf('{ id: "skill", label: "Skills" }');
  const connections = hub.indexOf('{ id: "mcp", label: "Connections" }');
  const prompts = hub.indexOf('{ id: "prompt", label: "Prompts" }');
  const agents = hub.indexOf('{ id: "agent", label: "Agents" }');
  assert.ok(skill < connections && connections < prompts && prompts < agents);
  assert.match(hub, /agents: CommandHubItem\[\]/);
  assert.match(hub, /itemIdentity\(item\)/);
  assert.match(hub, /`\$\{item\.kind\}:\$\{item\.id\}`/);
  assert.match(hub, /ArrowLeft.*ArrowRight/s);
  assert.match(hub, /item\.services\.slice\(0, 3\)/);
  assert.match(hub, /item\.divisionColor/);
  assert.match(hub, /data\?\.notices\?\.agents/);
});

test("Agents open through a described Agency agents directory and adjacent browser", () => {
  const hub = source("src/app/components/openharness/command-hub.tsx");
  assert.match(hub, /id="agency-agents-directory"/);
  assert.match(hub, />\s*Agency agents\s*</);
  assert.match(
    hub,
    /Browse specialist personas for design, engineering, marketing, strategy, and more\./,
  );
  assert.match(hub, /aria-labelledby="agency-agents-directory-title"/);
  assert.match(hub, /sm:left-\[calc\(min\(600px,calc\(100vw-2rem\)\)\+0\.5rem\)\]/);
  assert.match(hub, /placeholder="Search Agency agents"/);
  assert.match(hub, /Selecting an agent applies its persona to this conversation/);
});

test("active agent UI is server-backed, compact, clearable, and excluded from Quartz", () => {
  const composer = source("src/app/components/assistant-composer.tsx");
  assert.match(composer, /capabilitySurface === 'quartz_ai'/);
  assert.match(composer, /\/agency-agent`/);
  assert.match(composer, /method: 'DELETE'/);
  assert.match(composer, /Clear active agent/);
  assert.match(composer, /divisionLabel/);

  const endpoint = source("src/app/api/openharness/sessions/[sessionId]/agency-agent/route.ts");
  assert.match(endpoint, /requireUserId\(\)/);
  assert.match(endpoint, /authorizeRuntimeReference/);
  assert.match(endpoint, /activeAgencyAgentSlug: null/);
  assert.match(endpoint, /export async function DELETE/);
});

test("catalog endpoints are authenticated and never serialize persona instructions", () => {
  const catalogRoute = source("src/app/api/openharness/agency-agents/route.ts");
  const commandsRoute = source("src/app/api/openharness/commands/route.ts");
  assert.match(catalogRoute, /requireUserId\(\)/);
  assert.match(catalogRoute, /presentAgencyAgent/);
  assert.doesNotMatch(catalogRoute, /\.instructions/);
  assert.match(catalogRoute, /status: catalog\.status === "ready" \? 200 : 503/);
  assert.match(
    commandsRoute,
    /agents:\s*\[[\s\S]*items\.filter\([\s\S]*item\.kind === "agent"/,
  );
  assert.match(commandsRoute, /\.\.\.uiTarsItems/);
  assert.match(commandsRoute, /agents: agencyCatalog\?\.message/);

  const quartzRoute = source("src/app/api/quartz-ai/commands/route.ts");
  assert.doesNotMatch(quartzRoute, /groups:\s*\{[\s\S]*agents:/);
});

test("persona overlay follows server capability and authorized context without changing it", () => {
  const prompt = composeOpenHarnessSystemPrompt({
    surface: "dashboard_terminal",
    decision: {
      mode: "knowledge",
      requestedOutcome: "Review this",
      implementationRequired: false,
      decisionReason: "Knowledge task",
      decisionSource: "breadboard_server_policy_v1",
      authorizedRoots: [],
      authorizedPathPatterns: [],
      allowedTools: ["websearch"],
      allowedOperations: ["knowledge_work"],
      allowedCommandPatterns: [],
      selectedConditionalSkills: [],
      selectedConnections: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: null,
      revokedAt: null,
    },
    additional: "# authorized_context\nGarden: alpine",
    persona: "<agency_agent_persona>\nSubordinate test persona\n</agency_agent_persona>",
  });
  const capabilityIndex = prompt.indexOf("# server_capability_decision");
  const contextIndex = prompt.indexOf("# authorized_context");
  const personaIndex = prompt.indexOf("<agency_agent_persona>");
  assert.ok(capabilityIndex >= 0);
  assert.ok(capabilityIndex < contextIndex);
  assert.ok(contextIndex < personaIndex);
  assert.match(prompt, /Allowed operations: knowledge_work/);
  assert.match(prompt, /Authorized roots: none/);
});

test("turn dispatch applies selection to the conversation while tool maps remain brokered", () => {
  const turnService = source("src/lib/conversations/turn-service.ts");
  assert.match(turnService, /activeAgencyAgentSlug: resolved\.agencyAgentSelection\.slug/);
  assert.match(turnService, /renderAgencyAgentPersona\(activeAgencyAgent\)/);
  assert.match(turnService, /mergeSelectedTools\(prepared\.grant\.allowedTools, resolved\.tools\)/);
  assert.match(turnService, /content: resolved\.userText/);
  assert.match(turnService, /titleFromMessage\(resolved\.userText\)/);
});
