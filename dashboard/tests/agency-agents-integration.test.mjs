import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { composeHermesSystemPrompt } from "../src/lib/hermes/system-prompts.ts";

function source(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("CommandHub keeps setup-free capability tabs with collision-safe history", () => {
  const hub = source("src/app/components/hermes/command-hub.tsx");
  const skill = hub.indexOf('{ id: "skill", label: "Skills" }');
  const workflows = hub.indexOf('{ id: "workflow", label: "Workflows" }');
  const agents = hub.indexOf('{ id: "agent", label: "Agents" }');
  const prompts = hub.indexOf('{ id: "prompt", label: "Prompts" }');
  assert.ok(skill < workflows && workflows < agents && agents < prompts);
  assert.doesNotMatch(hub, /\{ id: "mcp", label: "MCP" \}/);
  assert.match(hub, /agents: CommandHubItem\[\]/);
  assert.match(hub, /itemIdentity\(item\)/);
  assert.match(hub, /`\$\{item\.kind\}:\$\{item\.id\}`/);
  assert.match(hub, /ArrowLeft.*ArrowRight/s);
  assert.match(hub, /tab === "agent"[\s\S]*?data\.groups\.agents/);
  assert.match(hub, /data\?\.notices\?\.agents/);
});

test("Agency agents toggle beside the Agents page and render as skill-style rows without logos", () => {
  const hub = source("src/app/components/hermes/command-hub.tsx");
  const agencyPanel = hub.slice(
    hub.indexOf('id="agency-agents-directory-panel"'),
    hub.indexOf("</aside>", hub.indexOf('id="agency-agents-directory-panel"')),
  );
  const agencyRows = agencyPanel.slice(agencyPanel.indexOf("{agencyDirectoryGroups.flatMap"));
  assert.match(hub, /id="agency-agents-directory"/);
  assert.match(hub, />\s*Agency agents\s*</);
  assert.match(hub, /onClick=\{\(\) => void toggleAgentDirectory\(\)\}/);
  assert.match(hub, /loadAgencyAgentsClientCatalog\(\{ force \}\)/);
  assert.match(hub, /aria-expanded=\{agentDirectoryOpen\}/);
  assert.match(hub, /aria-controls="agency-agents-directory-panel"/);
  assert.match(hub, /agentDirectoryOpen && tab === "agent" && !detail/);
  assert.match(hub, /sm:left-\[calc\(min\(600px,calc\(100vw-2rem\)\)\+0\.5rem\)\]/);
  assert.doesNotMatch(hub, /Back to agents/);
  assert.match(hub, /aria-label="Agency agents" className="divide-y divide-\[var\(--line\)\]"/);
  assert.match(hub, /placeholder="Search Agency agents"/);
  assert.doesNotMatch(hub, /Agent catalog summary|Agency specialists/);
  assert.doesNotMatch(
    hub,
    /function AgentSectionHeading[\s\S]*?uppercase tracking-[\s\S]*?function SettingsSlidersIcon/,
  );
  // The Agents tab is one alphabetical list. It used to be grouped under
  // classifier headings ("Research & browse", "Work & creation", …), which put
  // the burden of guessing Breadboard's taxonomy on the person before they
  // could find an agent they already knew the name of. Every row now carries a
  // sort name and the list orders itself, so there is nowhere for a heading to
  // live and no group for a new agent to be filed into wrongly.
  assert.doesNotMatch(hub, /Research & browse|Work & creation|Specialist teams & studios|Code & software/);
  assert.doesNotMatch(hub, /function AgentSectionHeading/);
  assert.match(hub, /\.sort\(\(left, right\) => left\.name\.localeCompare\(right\.name\)\)/);
  assert.match(hub, /agencyDirectoryGroups\.flatMap/);
  assert.match(hub, /Loading Agency agents/);
  assert.doesNotMatch(hub, /agencyAgentsLoading \? "…" : agencyAgents\.length/);
  assert.match(hub, /Selecting an agent applies its persona to this conversation/);
  assert.match(agencyRows, /font-mono text-sm font-medium/);
  assert.doesNotMatch(agencyRows, /item\.emoji|item\.divisionIcon|CapabilityIcon/);
  assert.doesNotMatch(hub, /\{ id: "agency", label: "Agency agents" \}/);
});

test("active agent UI is server-backed, compact, clearable, and excluded from Quartz", () => {
  const composer = source("src/app/components/assistant-composer.tsx");
  assert.match(composer, /capabilitySurface === 'quartz_ai'/);
  assert.match(composer, /\/agency-agent`/);
  assert.match(composer, /method: 'DELETE'/);
  assert.match(composer, /Clear active agent/);
  assert.match(composer, /divisionLabel/);

  const endpoint = source("src/app/api/hermes/sessions/[sessionId]/agency-agent/route.ts");
  assert.match(endpoint, /requireUserId\(\)/);
  assert.match(endpoint, /authorizeRuntimeReference/);
  assert.match(endpoint, /activeAgencyAgentSlug: null/);
  assert.match(endpoint, /export async function DELETE/);
});

test("catalog endpoints are authenticated and never serialize persona instructions", () => {
  const catalogRoute = source("src/app/api/hermes/agency-agents/route.ts");
  const commandsRoute = source("src/app/api/hermes/commands/route.ts");
  assert.match(catalogRoute, /requireUserId\(\)/);
  assert.match(catalogRoute, /presentAgencyAgent/);
  assert.doesNotMatch(catalogRoute, /\.instructions/);
  assert.match(catalogRoute, /status: catalog\.status === "ready" \? 200 : 503/);
  assert.match(
    commandsRoute,
    /agents:\s*items\.filter\([\s\S]*item\.kind === "agent"/,
  );
  const commandsLibrary = source("src/lib/hermes/commands.ts");
  // The primary palette excludes the large roster. Its dedicated authenticated
  // endpoint is loaded only when the directory is opened.
  assert.match(
    commandsLibrary,
    /options\.includeAgencyAgents === false[\s\S]*loadAgencyAgentsCatalog\(\)\.agents/,
  );
  assert.match(commandsRoute, /includeAgencyAgents: false/);
  assert.doesNotMatch(commandsRoute, /loadAgencyAgentsCatalog/);

  const quartzRoute = source("src/app/api/quartz-ai/commands/route.ts");
  assert.doesNotMatch(quartzRoute, /groups:\s*\{[\s\S]*agents:/);
});

test("persona overlay follows server capability and authorized context without changing it", () => {
  const prompt = composeHermesSystemPrompt({
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

test("turn dispatch applies selection and delegates first-prompt naming to the LLM", () => {
  const turnService = source("src/lib/conversations/turn-service.ts");
  const conversationStore = source("src/lib/conversations/store.ts");
  assert.match(turnService, /activeAgencyAgentSlug: resolved\.agencyAgentSelection\.slug/);
  assert.match(turnService, /renderAgencyAgentPersona\(activeAgencyAgent\)/);
  assert.match(
    turnService,
    /mergeSelectedTools\(prepared\.grant\.allowedTools, \{\s*\.\.\.resolved\.tools,\s*\.\.\.connectedApps\.tools,/,
  );
  assert.match(turnService, /content: resolved\.userText/);
  assert.match(turnService, /generateAndApplyConversationTitle\(\{/);
  assert.match(turnService, /reservation\.userMessage\.order_index === 0/);
  assert.doesNotMatch(conversationStore, /chatTitleFromFirstMessage/);
});
