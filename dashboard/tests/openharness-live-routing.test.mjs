import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("both checked-in garden chat UIs bind requests to Breadboard chat sessions", () => {
  const workspace = read(
    "dashboard/src/app/gardens/[clusterSlug]/workspace-client.tsx",
  );
  const assistant = read("dashboard/src/app/garden/garden-assistant.tsx");
  assert.match(
    workspace,
    /fetch\("\/api\/chat"[\s\S]*chatSessionId:\s*sessionId/,
  );
  assert.match(
    assistant,
    /fetch\('\/api\/chat'[\s\S]*chatSessionId:\s*session\.id/,
  );
  assert.match(workspace, /event\.type === "runtime" && event\.fallback/);
  assert.match(assistant, /event\.type === 'runtime' && event\.fallback/);
  assert.match(
    workspace,
    /body:\s*JSON\.stringify\([\s\S]*model,[\s\S]*reasoningEffort/,
  );
  assert.match(
    assistant,
    /body:\s*JSON\.stringify\([\s\S]*model,[\s\S]*reasoningEffort/,
  );
});

test("garden API dispatches OpenHarness before the explicitly retained ChatMock backend", () => {
  const route = read("dashboard/src/app/api/chat/route.ts");
  assert.ok(
    route.indexOf("openGardenAgentChat(payload") < route.indexOf("new OpenAI("),
  );
  assert.match(route, /runtime\.mode === 'required'[\s\S]*apiErrorResponse/);
  assert.match(route, /X-Breadboard-AI-Fallback/);
  assert.match(route, /fallback\.used/);
});

test("garden adapter opens the event stream before prompting and aborts the server runtime", () => {
  const adapter = read("dashboard/src/lib/openharness/garden-chat-adapter.ts");
  assert.match(
    adapter,
    /const firstEvent = events\.next\(\);[\s\S]*await Promise\.race[\s\S]*await sendMessage\(\);/,
  );
  assert.match(
    adapter,
    /requestSignal\.addEventListener\("abort", abortRuntime/,
  );
  assert.match(adapter, /gateway\s*\.abortSession/);
  assert.match(
    adapter,
    /resolveOpenHarnessEngine\(\s*payload\.model,\s*payload\.reasoningEffort/,
  );
  assert.match(
    adapter,
    /model:\s*engine\.model,[\s\S]*variant:\s*engine\.variant/,
  );
  assert.match(
    adapter,
    /event\.type === "assistant\.completed"[\s\S]*type: "usage", usage/,
  );
});

test("terminal required mode cannot render the direct KnowledgeTerminal fallback", () => {
  const terminal = read(
    "dashboard/src/app/components/openharness/dashboard-agent-terminal.tsx",
  );
  assert.match(
    terminal,
    /health\.mode === "required"[\s\S]*runtimeUnavailable/,
  );
  assert.ok(
    terminal.indexOf('health.mode === "required"') <
      terminal.indexOf("<KnowledgeTerminal"),
  );
  assert.match(
    terminal,
    /Preferred and legacy modes may use the old transport/,
  );
  assert.match(terminal, /No legacy request was sent/);
});

test("terminal session hook restores a Breadboard session after refresh and aborts server-side", () => {
  const hook = read(
    "dashboard/src/app/components/openharness/use-agent-session.ts",
  );
  assert.match(hook, /\/api\/openharness\/sessions\?surface=/);
  assert.match(hook, /setSessionId\(restored\.id\)/);
  assert.match(hook, /\/abort/);
  assert.match(hook, /: connected[\s\S]*onConnected\(\)/);
  assert.match(hook, /await Promise\.race[\s\S]*const sendResponse/);
  assert.match(
    hook,
    /model:\s*options\?\.model,[\s\S]*reasoningEffort:\s*options\?\.reasoningEffort/,
  );
  const terminal = read(
    "dashboard/src/app/components/openharness/dashboard-agent-terminal.tsx",
  );
  assert.match(terminal, /session\.send\(text, \{ model, reasoningEffort \}\)/);
});

test("terminal preflight permissions create a scoped folder grant and resume the paused turn", () => {
  const hook = read(
    "dashboard/src/app/components/openharness/use-agent-session.ts",
  );
  const route = read(
    "dashboard/src/app/api/openharness/sessions/[sessionId]/messages/route.ts",
  );
  assert.match(hook, /responseBody\.blocked === true/);
  assert.match(hook, /\/api\/openharness\/filesystem-grants/);
  assert.match(hook, /scope: decision === "always" \? "remembered" : "one_time"/);
  assert.match(hook, /await send\(blocked\.text/);
  assert.match(route, /confirmedPermissionIds:/);
  const turnService = read("dashboard/src/lib/conversations/turn-service.ts");
  assert.ok(
    turnService.indexOf("reserveConversationTurn({") <
      turnService.indexOf("if (prepared.blocked)"),
    "canonical user and pending-assistant rows must be reserved before preflight",
  );
  assert.match(turnService, /if \(prepared\.blocked\)[\s\S]*failAssistantMessage\([\s\S]*error: "awaiting_permission"/);
});

test("OpenHarness model provider is environment-driven ChatMock", () => {
  const config = JSON.parse(read("openharness-config/opencode.json"));
  assert.equal(config.model, "chatmock/{env:CHATMOCK_MODEL}");
  assert.equal(
    config.provider.chatmock.options.baseURL,
    "{env:CHATMOCK_BASE_URL}",
  );
  assert.equal(
    config.provider.chatmock.options.apiKey,
    "{env:CHATMOCK_API_KEY}",
  );
  for (const id of [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4",
  ]) {
    assert.ok(config.provider.chatmock.models[id]);
    assert.equal(
      config.provider.chatmock.models[id].variants.high.reasoningEffort,
      "high",
    );
  }
  assert.equal(
    config.provider.chatmock.models["gpt-5.6-sol"].variants.max.reasoningEffort,
    "max",
  );
  assert.equal(
    config.provider.chatmock.models["gpt-5.5"].variants.max,
    undefined,
  );
});

test("OpenHarness launchers default to a registered working model", () => {
  for (const file of [
    "scripts/dev-all.mjs",
    "scripts/start-openharness.mjs",
    "scripts/start-openharness.ps1",
  ]) {
    assert.match(read(file), /gpt-5\.6-sol/);
  }
});

test("routing mode implements required, preferred, and explicit legacy semantics", () => {
  const config = read("dashboard/src/lib/openharness/config.ts");
  assert.match(
    config,
    /OpenHarnessMode = "required" \| "preferred" \| "legacy"/,
  );
  assert.match(config, /return "required"/);
  assert.match(config, /mode !== "legacy"/);
});

// The restricted per-surface agents still exist, but they are now the
// ANONYMOUS profile rather than the ceiling for every garden/Quartz session.
// An authenticated user gets the canonical assistant on every surface, with
// capability decided by the server's broker from the task plan.
test("restricted per-surface agents are retained for anonymous sessions", () => {
  const runtime = read("dashboard/src/lib/openharness/config.ts");
  const garden = read("openharness-config/agent/breadboard-garden.md");
  const quartz = read("openharness-config/agent/breadboard-quartz.md");
  assert.match(
    runtime,
    /garden:\s*envString\("OPENHARNESS_GARDEN_AGENT", "breadboard-garden"\)/,
  );
  assert.match(
    runtime,
    /quartz:\s*envString\("OPENHARNESS_QUARTZ_AGENT", "breadboard-quartz"\)/,
  );
  assert.match(garden, /bash: deny/);
  assert.match(quartz, /skill: deny/);
  // Agent selection keys off authentication, not surface.
  assert.match(runtime, /authenticated/);
});

test("authenticated garden sessions use the canonical capable agent", async () => {
  const { agentForSurface } = await import("../src/lib/openharness/config.ts");
  const config = {
    agents: {
      terminal: "breadboard-assistant",
      garden: "breadboard-garden",
      quartz: "breadboard-quartz",
      capabilityScout: "capability-scout",
    },
  };
  for (const surface of ["dashboard_terminal", "garden_chat", "quartz_ai"]) {
    assert.equal(
      agentForSurface(config, surface, { authenticated: true }),
      "breadboard-assistant",
      `${surface} should use the canonical agent when authenticated`,
    );
  }
  assert.equal(
    agentForSurface(config, "quartz_ai", { authenticated: false }),
    "breadboard-quartz",
  );
});

test("garden turn context states real capability instead of asserting none exists", () => {
  const adapter = read("dashboard/src/lib/openharness/garden-chat-adapter.ts");
  // The old prompt hard-coded that shell/file/repository capability was
  // unavailable. That became false once capability came from the task plan, and
  // a prompt that misdescribes the runtime makes the agent refuse authorized
  // work — so the claim must be gone.
  assert.doesNotMatch(
    adapter,
    /Repository, shell, Git, package, build, test, deployment/,
  );
  assert.match(adapter, /Capabilities active for this turn/);
  assert.match(adapter, /changed only through typed Breadboard proposals/);
});

test("Quartz graph emits bounded map context consumed only by dashboard proxy chat", () => {
  const graph = read("quartz/quartz/components/scripts/graph.inline.ts");
  const ai = read("quartz/quartz/components/scripts/breadboardAI.inline.ts");
  assert.match(graph, /breadboard:graph-context/);
  assert.match(graph, /visibleNodeSlugs:[\s\S]*slice\(0, 24\)/);
  assert.match(ai, /__breadboardGraphContext/);
  assert.match(ai, /\/api\/quartz-ai\/chat/);
  assert.match(ai, /prepareOnly: true/);
  assert.match(ai, /: connected[\s\S]*await dispatch\(\)/);
});

test("production code contains no placeholder skill registry or fabricated manifest fallback", () => {
  const skills = read("dashboard/src/lib/openharness/skills.ts");
  const installRoute = read(
    "dashboard/src/app/api/openharness/skills/install/route.ts",
  );
  assert.doesNotMatch(
    skills + installRoute,
    /skills\.example\.com|CURATED_REGISTRY|placeholder manifest|Source index was unreachable/,
  );
  assert.match(skills, /\["find", normalized\]/);
  assert.match(skills, /"add",\s*candidate\.repository/);
});

test("the unified slash hub embeds Skills.sh discovery and the reviewed promotion flow", () => {
  const hub = read("dashboard/src/app/components/openharness/command-hub.tsx");
  const catalog = read(
    "dashboard/src/app/components/openharness/skills-catalog-panel.tsx",
  );
  assert.match(hub, /SkillsCatalogPanel/);
  assert.match(
    catalog,
    /skills\/search[\s\S]*skills\/detail[\s\S]*skills\/install[\s\S]*skills\/promote/,
  );
  assert.match(catalog, /inactive quarantine/);
  assert.match(catalog, /All[\s\S]*Trending[\s\S]*Hot[\s\S]*Official[\s\S]*Installed[\s\S]*Updates/);
});

test("the capability palette omits filesystem and repository administration", () => {
  const hub = read("dashboard/src/app/components/openharness/command-hub.tsx");
  assert.doesNotMatch(hub, /\/api\/openharness\/settings/);
  assert.doesNotMatch(hub, /accessibleRoots|filesystemMode|activeDirectory/);
  assert.match(hub, /Use a capability/);
  assert.match(hub, /Skills/);
  assert.match(hub, /Connections/);
  assert.match(hub, /Prompts/);
});

test("terminal exposes explicit quarantine review and resumes a recorded capability gap", () => {
  const terminal = read(
    "dashboard/src/app/components/openharness/dashboard-agent-terminal.tsx",
  );
  const review = read(
    "dashboard/src/app/components/openharness/skill-review-panel.tsx",
  );
  const promote = read(
    "dashboard/src/app/api/openharness/skills/promote/route.ts",
  );
  const messages = read(
    "dashboard/src/app/api/openharness/sessions/[sessionId]/messages/route.ts",
  );
  assert.match(terminal, /Review skills/);
  assert.match(
    review,
    /skills\/search[\s\S]*skills\/install[\s\S]*skills\/promote/,
  );
  assert.match(review, /Files and SHA-256/);
  assert.match(review, /approvedPermissions/);
  assert.match(promote, /getLatestCapabilityGap[\s\S]*skill\.available/);
  const turnService = read("dashboard/src/lib/conversations/turn-service.ts");
  assert.match(messages, /startConversationTurn/);
  assert.match(turnService, /eventType: "task\.resumed"/);
});
