import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("both checked-in garden chat UIs bind requests to Breadboard chat sessions", () => {
  const workspace = read("dashboard/src/app/gardens/[clusterSlug]/workspace-client.tsx");
  const assistant = read("dashboard/src/app/garden/garden-assistant.tsx");
  assert.match(workspace, /fetch\("\/api\/chat"[\s\S]*chatSessionId:\s*sessionId/);
  assert.match(assistant, /fetch\('\/api\/chat'[\s\S]*chatSessionId:\s*session\.id/);
  assert.match(workspace, /event\.type === "runtime" && event\.fallback/);
  assert.match(assistant, /event\.type === 'runtime' && event\.fallback/);
  assert.match(workspace, /body:\s*JSON\.stringify\([\s\S]*model,[\s\S]*reasoningEffort/);
  assert.match(assistant, /body:\s*JSON\.stringify\([\s\S]*model,[\s\S]*reasoningEffort/);
});

test("garden API dispatches OpenHarness before the explicitly retained ChatMock backend", () => {
  const route = read("dashboard/src/app/api/chat/route.ts");
  assert.ok(route.indexOf("openGardenAgentChat(payload") < route.indexOf("new OpenAI("));
  assert.match(route, /runtime\.mode === 'required'[\s\S]*apiErrorResponse/);
  assert.match(route, /X-Breadboard-AI-Fallback/);
  assert.match(route, /fallback\.used/);
});

test("garden adapter opens the event stream before prompting and aborts the server runtime", () => {
  const adapter = read("dashboard/src/lib/openharness/garden-chat-adapter.ts");
  assert.match(adapter, /const firstEvent = events\.next\(\);[\s\S]*await Promise\.race[\s\S]*await sendMessage\(\);/);
  assert.match(adapter, /requestSignal\.addEventListener\("abort", abortRuntime/);
  assert.match(adapter, /gateway\.abortSession/);
  assert.match(adapter, /resolveOpenHarnessEngine\(payload\.model, payload\.reasoningEffort\)/);
  assert.match(adapter, /model:\s*engine\.model,[\s\S]*variant:\s*engine\.variant/);
});

test("terminal required mode cannot render the direct KnowledgeTerminal fallback", () => {
  const terminal = read("dashboard/src/app/components/openharness/dashboard-agent-terminal.tsx");
  assert.match(terminal, /health\.mode === "required"[\s\S]*runtimeUnavailable/);
  assert.ok(terminal.indexOf('health.mode === "required"') < terminal.indexOf("<KnowledgeTerminal"));
  assert.match(terminal, /Preferred and legacy modes may use the old transport/);
  assert.match(terminal, /No legacy request was sent/);
});

test("terminal session hook restores a Breadboard session after refresh and aborts server-side", () => {
  const hook = read("dashboard/src/app/components/openharness/use-agent-session.ts");
  assert.match(hook, /\/api\/openharness\/sessions\?surface=/);
  assert.match(hook, /setSessionId\(restored\.id\)/);
  assert.match(hook, /\/abort/);
  assert.match(hook, /: connected[\s\S]*onConnected\(\)/);
  assert.match(hook, /await Promise\.race[\s\S]*const sendResponse/);
  assert.match(hook, /model:\s*options\?\.model,[\s\S]*reasoningEffort:\s*options\?\.reasoningEffort/);
  const terminal = read("dashboard/src/app/components/openharness/dashboard-agent-terminal.tsx");
  assert.match(terminal, /session\.send\(text, \{ model, reasoningEffort \}\)/);
});

test("OpenHarness model provider is environment-driven ChatMock", () => {
  const config = JSON.parse(read("openharness-config/opencode.json"));
  assert.equal(config.model, "chatmock/{env:CHATMOCK_MODEL}");
  assert.equal(config.provider.chatmock.options.baseURL, "{env:CHATMOCK_BASE_URL}");
  assert.equal(config.provider.chatmock.options.apiKey, "{env:CHATMOCK_API_KEY}");
  for (const id of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4"]) {
    assert.ok(config.provider.chatmock.models[id]);
    assert.equal(config.provider.chatmock.models[id].variants.high.reasoningEffort, "high");
  }
  assert.equal(config.provider.chatmock.models["gpt-5.6-sol"].variants.max.reasoningEffort, "max");
  assert.equal(config.provider.chatmock.models["gpt-5.5"].variants.max, undefined);
});

test("OpenHarness launchers default to a registered working model", () => {
  for (const file of ["scripts/dev-all.mjs", "scripts/start-openharness.mjs", "scripts/start-openharness.ps1"]) {
    assert.match(read(file), /gpt-5\.6-sol/);
  }
});

test("routing mode implements required, preferred, and explicit legacy semantics", () => {
  const config = read("dashboard/src/lib/openharness/config.ts");
  assert.match(config, /OpenHarnessMode = "required" \| "preferred" \| "legacy"/);
  assert.match(config, /return "required"/);
  assert.match(config, /mode !== "legacy"/);
});

test("garden and Quartz agents cannot inherit engineering or capability-discovery tools", () => {
  for (const file of ["breadboard-garden.md", "breadboard-quartz.md"]) {
    const source = read(`openharness-config/agent/${file}`);
    assert.match(source, /tools:\s*\n\s+"\*": false/);
    assert.match(source, /bash: deny/);
    assert.match(source, /task: deny/);
    assert.match(source, /skill: deny/);
    assert.doesNotMatch(source, /capability_search: true|capability_gap: true/);
  }
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
  const installRoute = read("dashboard/src/app/api/openharness/skills/install/route.ts");
  assert.doesNotMatch(skills + installRoute, /skills\.example\.com|CURATED_REGISTRY|placeholder manifest|Source index was unreachable/);
  assert.match(skills, /\["find", normalized\]/);
  assert.match(skills, /"add",\s*candidate\.repository/);
});

test("terminal exposes explicit quarantine review and resumes a recorded capability gap", () => {
  const terminal = read("dashboard/src/app/components/openharness/dashboard-agent-terminal.tsx");
  const review = read("dashboard/src/app/components/openharness/skill-review-panel.tsx");
  const promote = read("dashboard/src/app/api/openharness/skills/promote/route.ts");
  const messages = read("dashboard/src/app/api/openharness/sessions/[sessionId]/messages/route.ts");
  assert.match(terminal, /Review skills/);
  assert.match(review, /skills\/search[\s\S]*skills\/install[\s\S]*skills\/promote/);
  assert.match(review, /Files and SHA-256/);
  assert.match(review, /approvedPermissions/);
  assert.match(promote, /getLatestCapabilityGap[\s\S]*skill\.available/);
  assert.match(messages, /task\.resumed/);
});
