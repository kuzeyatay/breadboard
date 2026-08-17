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

test("garden API dispatches Hermes before the explicitly retained ChatMock backend", () => {
  const route = read("dashboard/src/app/api/chat/route.ts");
  assert.ok(
    route.indexOf("openGardenAgentChat(payload") < route.indexOf("new OpenAI("),
  );
  assert.match(route, /runtime\.mode === 'required'[\s\S]*apiErrorResponse/);
  assert.match(route, /X-Breadboard-AI-Fallback/);
  assert.match(route, /fallback\.used/);
});

test("garden adapter opens the event stream before prompting without aborting a run on disconnect", () => {
  const adapter = read("dashboard/src/lib/hermes/garden-chat-adapter.ts");
  assert.match(
    adapter,
    /const firstEvent = events\.next\(\);[\s\S]*await Promise\.race[\s\S]*await sendMessage\(\);/,
  );
  assert.match(
    adapter,
    /acquireDetachedEventPump\([\s\S]*`legacy-garden:\$\{runId\}`/,
  );
  assert.match(adapter, /return pump\.response\(requestSignal/);
  assert.doesNotMatch(adapter, /requestSignal\.addEventListener\("abort"/);
  assert.match(adapter, /getAgentRuntimeByKind\(session\.runtimeKind\)/);
  assert.match(adapter, /runtime\s*\.streamSession/);
  assert.doesNotMatch(adapter, /const disconnectSubscription/);
  assert.match(
    adapter,
    /resolveHermesEngine\(\s*payload\.model,\s*payload\.reasoningEffort/,
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
    "dashboard/src/app/components/hermes/dashboard-agent-terminal.tsx",
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
    "dashboard/src/app/components/hermes/use-agent-session.ts",
  );
  assert.match(hook, /\/api\/hermes\/sessions\?surface=/);
  assert.match(hook, /setSessionId\(restored\.id\)/);
  assert.match(hook, /\/abort/);
  assert.match(hook, /: connected[\s\S]*onConnected\(\)/);
  assert.match(hook, /await Promise\.race[\s\S]*const sendResponse/);
  assert.match(
    hook,
    /model:\s*options\?\.model,[\s\S]*reasoningEffort:\s*options\?\.reasoningEffort/,
  );
  const terminal = read(
    "dashboard/src/app/components/hermes/dashboard-agent-terminal.tsx",
  );
  assert.match(terminal, /session\.send\(text, \{ model, reasoningEffort \}\)/);
  const eventStream = read("dashboard/src/lib/hermes/event-stream.ts");
  assert.match(eventStream, /streamRun \?\?= getActiveRuntimeRun\(session\.row\.id\)/);
  assert.match(eventStream, /resolveActiveTurn: activeRunReference/);
});

test("Terminal navbar uses a runtime-neutral health dot without an engine badge", () => {
  const terminal = read(
    "dashboard/src/app/components/hermes/dashboard-agent-terminal.tsx",
  );
  assert.doesNotMatch(terminal, /function runtimeLabel/);
  assert.match(terminal, /aria-label=\{`Agent runtime is/);
  assert.match(terminal, /runtimeOnline \? "bg-\[#4F805E\]" : "bg-\[#B65B5B\]"/);
  assert.doesNotMatch(terminal, /Review skills/);
  assert.doesNotMatch(terminal, /session\.connection === "idle" \? "ready"/);
});

test("terminal preflight permissions create a scoped folder grant and resume the paused turn", () => {
  const hook = read(
    "dashboard/src/app/components/hermes/use-agent-session.ts",
  );
  const route = read(
    "dashboard/src/app/api/hermes/sessions/[sessionId]/messages/route.ts",
  );
  assert.match(hook, /responseBody\.blocked === true/);
  assert.match(hook, /\/api\/hermes\/filesystem-grants/);
  assert.match(hook, /scope: decision === "always" \? "remembered" : "one_time"/);
  assert.match(hook, /await send\(blocked\.text/);
  assert.match(hook, /responseBody\.clarified === true/);
  assert.match(route, /confirmedPermissionIds:/);
  const turnService = read("dashboard/src/lib/conversations/turn-service.ts");
  assert.ok(
    turnService.indexOf("reserveConversationTurn({") <
      turnService.indexOf("if (prepared.blocked)"),
    "canonical user and pending-assistant rows must be reserved before preflight",
  );
  assert.match(turnService, /if \(prepared\.blocked\)[\s\S]*failAssistantMessage\([\s\S]*error: "awaiting_permission"/);
  assert.match(turnService, /clarification: "filesystem_target_required"/);
});

test("terminal planning receives the current conversation's recent user requests", () => {
  const turnService = read("dashboard/src/lib/conversations/turn-service.ts");
  assert.match(
    turnService,
    /priorRequests: currentConversationMessages[\s\S]*filter\(\(message\) => message\.role === "user"\)[\s\S]*slice\(-8\)[\s\S]*map\(\(message\) => message\.content\)/,
  );
});

test("Hermes model provider is environment-driven ChatMock", () => {
  const config = JSON.parse(read("hermes-config/opencode.json"));
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

test("Hermes launchers default to a registered working model", () => {
  // ChatMock's `default` sentinel is the stable model entry shared by the
  // dashboard and Hermes require a shared model entry; it must be
  // there — otherwise the runtime starts with an unresolvable model.
  for (const file of ["scripts/dev-all.mjs", "scripts/start-hermes.mjs"]) {
    assert.match(
      read(file),
      /CHATMOCK_MODEL[^\n]*?\|\|\s*"default"/,
      `${file} should default CHATMOCK_MODEL to ChatMock's default sentinel`,
    );
  }
});

test("routing mode implements required, preferred, and explicit legacy semantics", () => {
  const config = read("dashboard/src/lib/hermes/config.ts");
  assert.match(
    config,
    /HermesMode = "required" \| "preferred" \| "legacy"/,
  );
  assert.match(config, /return "required"/);
  assert.match(config, /mode !== "legacy"/);
});

// The restricted per-surface agents still exist, but they are now the
// ANONYMOUS profile rather than the ceiling for every garden/Quartz session.
// An authenticated user gets the canonical assistant on every surface, with
// capability decided by the server's broker from the task plan.
test("restricted per-surface agents are retained for anonymous sessions", () => {
  const runtime = read("dashboard/src/lib/hermes/config.ts");
  const garden = read("hermes-config/agent/breadboard-garden.md");
  const quartz = read("hermes-config/agent/breadboard-quartz.md");
  assert.match(
    runtime,
    /garden:\s*envString\("HERMES_GARDEN_AGENT", "breadboard-garden"\)/,
  );
  assert.match(
    runtime,
    /quartz:\s*envString\("HERMES_QUARTZ_AGENT", "breadboard-quartz"\)/,
  );
  assert.match(garden, /bash: deny/);
  assert.match(quartz, /skill: deny/);
  // Agent selection keys off authentication, not surface.
  assert.match(runtime, /authenticated/);
});

test("authenticated garden sessions use the canonical capable agent", async () => {
  const { agentForSurface } = await import("../src/lib/hermes/config.ts");
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
  const adapter = read("dashboard/src/lib/hermes/garden-chat-adapter.ts");
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
  const skills = read("dashboard/src/lib/hermes/skills.ts");
  const installRoute = read(
    "dashboard/src/app/api/hermes/skills/install/route.ts",
  );
  assert.doesNotMatch(
    skills + installRoute,
    /skills\.example\.com|CURATED_REGISTRY|placeholder manifest|Source index was unreachable/,
  );
  assert.doesNotMatch(skills + installRoute, /from "node:child_process"|execFile\(|spawnSync\(/);
  assert.match(installRoute, /client!\.detail\(catalogSkill\.source, catalogSkill\.slug\)/);
  assert.match(installRoute, /quarantineCatalogSkillSnapshot\(/);
  assert.match(skills, /flag: "wx"/);
});

test("the unified slash hub embeds Skills.sh discovery and the reviewed promotion flow", () => {
  const hub = read("dashboard/src/app/components/hermes/command-hub.tsx");
  const catalog = read(
    "dashboard/src/app/components/hermes/skills-catalog-panel.tsx",
  );
  assert.match(hub, /SkillsCatalogPanel/);
  assert.match(
    catalog,
    /skills\/search[\s\S]*skills\/detail[\s\S]*skills\/install[\s\S]*skills\/promote/,
  );
  assert.match(catalog, /inactive quarantine/);
  assert.match(catalog, /aria-label=\{`Filter skills:/);
  assert.match(catalog, /role="menuitemradio"/);
  for (const label of [
    "All",
    "Featured",
    "Scientific",
    "Official",
    "OpenCode",
    "Trending",
    "Hot",
    "Installed",
    "Updates",
  ]) {
    assert.match(catalog, new RegExp(`label: "${label}"`));
  }
});

test("catalog coding skills use review quarantine and conditional OpenCode approval regardless of source", () => {
  const detail = read(
    "dashboard/src/app/api/hermes/skills/detail/route.ts",
  );
  const install = read(
    "dashboard/src/app/api/hermes/skills/install/route.ts",
  );
  const promote = read(
    "dashboard/src/app/api/hermes/skills/promote/route.ts",
  );
  assert.doesNotMatch(detail + install + promote, /skill_incompatible_coding/);
  assert.match(
    install,
    /const classification = classifySkill\([\s\S]*classification,[\s\S]*quarantineCatalogSkillSnapshot/,
  );
  assert.match(
    promote,
    /conditionalCoding[\s\S]*"eligible_coding_conditional"[\s\S]*\["breadboard-assistant", "breadboard-garden"\][\s\S]*allowConditional: conditionalCoding/,
  );
  assert.match(promote, /inspectQuarantine\(name\)/);
  assert.match(promote, /approvedHash: report\.exactVersion/);
});

test("the capability palette omits filesystem and repository administration", () => {
  const hub = read("dashboard/src/app/components/hermes/command-hub.tsx");
  assert.doesNotMatch(hub, /\/api\/hermes\/settings/);
  assert.doesNotMatch(hub, /accessibleRoots|filesystemMode|activeDirectory/);
  assert.match(hub, /Use a capability/);
  assert.match(hub, /Skills/);
  assert.match(hub, /Connections/);
  assert.match(hub, /Prompts/);
});

test("quarantine review remains available without a terminal navbar control", () => {
  const terminal = read(
    "dashboard/src/app/components/hermes/dashboard-agent-terminal.tsx",
  );
  const review = read(
    "dashboard/src/app/components/hermes/skill-review-panel.tsx",
  );
  const promote = read(
    "dashboard/src/app/api/hermes/skills/promote/route.ts",
  );
  const messages = read(
    "dashboard/src/app/api/hermes/sessions/[sessionId]/messages/route.ts",
  );
  assert.doesNotMatch(terminal, /Review skills/);
  assert.doesNotMatch(terminal, /SkillReviewPanel/);
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
