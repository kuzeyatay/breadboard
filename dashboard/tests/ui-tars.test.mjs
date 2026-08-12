import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-uitars-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
process.env.UI_TARS_MODE = "optional";

const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/ui-tars/store.ts");
const config = await import("../src/lib/ui-tars/config.ts");
const adapterConfig = await import("../src/lib/ui-tars/adapter-config.ts");
const modelProvider = await import("../src/lib/ui-tars/model-provider.ts");
const identity = await import("../src/lib/ui-tars/identity.ts");
const operatorRouting = await import("../src/lib/ui-tars/operator-routing.ts");
const chatResponse = await import("../src/lib/ui-tars/chat-response.ts");

const source = (relativePath) =>
  fs.readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

// Create a user by satisfying all NOT NULL columns without a default.
function createUser(email) {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  const names = [];
  const values = [];
  for (const c of cols) {
    if (c.pk) continue;
    if (c.notnull === 1 && c.dflt_value === null) {
      names.push(c.name);
      // Unique per user to satisfy UNIQUE columns (e.g. username).
      values.push(c.name === "email" ? email : `${c.name}-${email}`);
    }
  }
  if (!names.includes("email")) {
    names.push("email");
    values.push(email);
  }
  const placeholders = names.map(() => "?").join(", ");
  const info = db.prepare(`INSERT INTO users (${names.join(", ")}) VALUES (${placeholders})`).run(...values);
  return Number(info.lastInsertRowid);
}

const userA = createUser("a@example.com");
const userB = createUser("b@example.com");

// ---------------- pure config ----------------

test("config: browser and computer operators are valid, unknown targets are rejected", () => {
  const defaults = config.defaultAgentConfiguration();
  assert.equal(defaults.allowDownloads, true);
  assert.equal(defaults.desktopCoordinateSpace, "screen_pixels");
  assert.equal(config.validateAgentConfiguration({ ...defaults, operator: "computer" }).ok, true);
  assert.equal(config.validateAgentConfiguration({ ...defaults, operator: "phone" }).ok, false);
  assert.equal(config.validateAgentConfiguration(config.defaultAgentConfiguration()).ok, true);
  const { desktopCoordinateSpace: _legacyField, ...legacy } = defaults;
  assert.equal(
    config.validateAgentConfiguration(legacy).value.desktopCoordinateSpace,
    "screen_pixels",
  );
  assert.equal(
    config.validateAgentConfiguration({
      ...defaults,
      desktopCoordinateSpace: "normalized_1000",
    }).ok,
    true,
  );
  assert.equal(
    config.validateAgentConfiguration({
      ...defaults,
      desktopCoordinateSpace: "screen_percent",
    }).ok,
    false,
  );
});

test("config: patch preserves omitted fields and keeps operator browser", () => {
  const base = config.defaultAgentConfiguration();
  const r = config.applyConfigurationPatch(base, { model: "m", browserStrategy: "hybrid" });
  assert.equal(r.ok, true);
  assert.equal(r.value.operator, "browser");
  assert.equal(r.value.browserStrategy, "hybrid");
  assert.equal(r.value.approvalMode, base.approvalMode);
  const desktop = config.applyConfigurationPatch(base, { operator: "computer" });
  assert.equal(desktop.ok, true);
  assert.equal(desktop.value.operator, "computer");
});

test("local application tasks route generically to the approved actual desktop operator", () => {
  const browser = config.defaultAgentConfiguration();
  const localApp = operatorRouting.configurationForAgentTarsTask(
    browser,
    "launch Acme Studio and inspect the latest notification",
  );
  assert.equal(localApp.operator, "computer");
  assert.equal(localApp.allowClipboard, browser.allowClipboard);
  assert.equal(
    operatorRouting.configurationForAgentTarsTask(browser, "open https://mail.example.test").operator,
    "browser",
  );
  assert.equal(
    operatorRouting.configurationForAgentTarsTask(browser, "open Acme Studio in the browser").operator,
    "browser",
  );
  assert.equal(
    operatorRouting.configurationForAgentTarsTask(browser, "summarize this document").operator,
    "browser",
  );
  assert.equal(
    operatorRouting.configurationForAgentTarsTask(
      browser,
      "read the latest notification on my computer",
    ).operator,
    "computer",
  );
});

test("run status and the final desktop report become the visible chat response", () => {
  assert.equal(
    chatResponse.agentTarsChatResponse([
      { type: "run.status", payload: { message: "Opening Outlook" } },
    ]),
    "Opening Outlook",
  );
  assert.equal(
    chatResponse.agentTarsChatResponse([
      { type: "run.status", payload: { message: "Reading the newest email" } },
      { type: "run.completed", payload: { summary: "The newest email confirms Friday's review." } },
    ]),
    "The newest email confirms Friday's review.",
  );
  assert.equal(
    chatResponse.agentTarsChatResponse([{ type: "run.aborted", payload: {} }]),
    "Request was aborted.",
  );
  assert.equal(
    chatResponse.agentTarsChatResponse([{
      type: "runtime.disconnected",
      payload: { message: "Agent TARS stopped because its desktop runtime closed." },
    }]),
    "Agent TARS stopped because its desktop runtime closed.",
  );
  assert.equal(
    chatResponse.safeAgentTarsMessage(
      "Command failed: C:\\repo\\node_modules\\clipboardy.exe --paste thread 'main' panicked RUST_BACKTRACE=1",
    ),
    "Agent TARS could not type into the desktop application.",
  );
});

// ---------------- ChatMock as the default model provider ----------------

test("new agents default to ChatMock so a run needs no user-supplied key", () => {
  const defaults = config.defaultAgentConfiguration({});
  assert.equal(defaults.provider, "chatmock");
  // New agents follow the global background model chosen in Settings ->
  // Providers; ChatMock expands the sentinel per request.
  assert.equal(defaults.model, "default");
  assert.equal(defaults.endpoint, "http://127.0.0.1:8765/v1");
  assert.equal(config.validateAgentConfiguration(defaults).ok, true);
  assert.equal(modelProvider.providerRequiresStoredKey(defaults), false);
  assert.equal(modelProvider.providerRequiresStoredKey({ provider: "openai" }), true);
});

test("ChatMock endpoint and model follow the server environment", () => {
  const env = { CHATMOCK_BASE_URL: "127.0.0.1:9999", CHATMOCK_MODEL: "gpt-5.6-terra" };
  assert.equal(modelProvider.chatmockEndpoint(env), "http://127.0.0.1:9999/v1");
  assert.equal(modelProvider.chatmockModel(env), "gpt-5.6-terra");
  assert.equal(config.defaultAgentConfiguration(env).model, "gpt-5.6-terra");
});

test("legacy Agent TARS error envelopes are presented as failures", () => {
  assert.equal(
    identity.agentTarsFailureMessage(
      "Sorry, an error occurred while processing your request: Error: Connection error.",
    ),
    "Agent TARS could not connect to the configured model endpoint",
  );
  assert.equal(identity.agentTarsFailureMessage("Opened Instagram"), null);
});

test("run wiring: ChatMock gets the server credential; other providers are untouched", () => {
  const env = { CHATMOCK_BASE_URL: "http://127.0.0.1:8765/v1", CHATMOCK_API_KEY: "local" };
  const chatmock = { ...config.defaultAgentConfiguration(env), endpoint: "" };
  const resolved = modelProvider.resolveRunModel(chatmock, undefined, env);
  assert.equal(resolved.configuration.provider, "chatmock");
  assert.equal(resolved.configuration.endpoint, "http://127.0.0.1:8765/v1");
  assert.equal(resolved.providerApiKey, "local");

  const stale = { ...chatmock, endpoint: "http://127.0.0.1:58171/v1" };
  assert.equal(
    modelProvider.resolveRunModel(stale, undefined, env).configuration.endpoint,
    "http://127.0.0.1:8765/v1",
    "a desktop restart must replace the saved launch-specific ChatMock port",
  );

  // A stored key still wins, but ChatMock's endpoint remains server-owned.
  assert.equal(modelProvider.resolveRunModel(chatmock, "sk-user", env).providerApiKey, "sk-user");

  const openai = { ...chatmock, provider: "openai", endpoint: "https://api.openai.com/v1" };
  const passthrough = modelProvider.resolveRunModel(openai, undefined, env);
  assert.deepEqual(passthrough.configuration, openai);
  assert.equal(passthrough.providerApiKey, undefined);
});

test("mode: defaults optional; disabled/required honored", () => {
  assert.equal(adapterConfig.uiTarsMode({ UI_TARS_MODE: undefined }), "optional");
  assert.equal(adapterConfig.uiTarsMode({ UI_TARS_MODE: "disabled" }), "disabled");
  assert.equal(adapterConfig.uiTarsMode({ UI_TARS_MODE: "required" }), "required");
  assert.equal(adapterConfig.uiTarsEnabled({ UI_TARS_MODE: "disabled" }), false);
});

// ---------------- store: ownership + secrets ----------------

test("default agent is created once per user and appears in listing", () => {
  const a1 = store.ensureDefaultAgent(userA);
  const a2 = store.ensureDefaultAgent(userA);
  assert.equal(a1.id, a2.id, "idempotent");
  const list = store.listAgents(userA);
  assert.ok(list.some((a) => a.id === a1.id));
  assert.equal(store.presentAgent(a1).name, "Agent TARS");
});

test("cross-user agent access is impossible", () => {
  const a = store.ensureDefaultAgent(userA);
  assert.equal(store.getAgent(userB, a.id), null, "user B cannot read user A's agent");
  assert.ok(store.getAgent(userA, a.id));
});

test("provider key is write-only: never in presented DTO, readable only server-side", () => {
  const a = store.ensureDefaultAgent(userA);
  store.setSecret(a.id, "sk-super-secret-value-1234567890");
  assert.equal(store.hasSecret(a.id), true);
  const presented = store.presentAgent(a);
  assert.equal(presented.secretConfigured, true);
  assert.ok(!JSON.stringify(presented).includes("sk-super-secret-value"));
  // Server-side accessor still works (used only for injection into the adapter).
  assert.equal(store.getSecret(a.id), "sk-super-secret-value-1234567890");
  store.clearSecret(a.id);
  assert.equal(store.hasSecret(a.id), false);
});

test("an active run is finalized when its desktop runtime is gone", () => {
  const agent = store.ensureDefaultAgent(userA);
  const run = store.createRunRecord({
    id: store.publicId("run"),
    agentId: agent.id,
    userId: userA,
    task: "open Outlook",
    operatorType: "computer",
  });
  store.persistEvents(run.id, [{ sequenceNumber: 1, type: "run.started", payload: {} }]);
  assert.equal(store.getRun(userA, run.id)?.status, "running");
  assert.equal(store.markRunRuntimeLost(run.id), true);
  const finalized = store.getRun(userA, run.id);
  assert.equal(finalized?.status, "runtime_lost");
  assert.equal(finalized?.failure_code, "runtime_lost");
  assert.match(finalized?.failure_message ?? "", /desktop runtime closed/i);
  assert.equal(store.markRunRuntimeLost(run.id), false, "terminal runs stay idempotent");
  assert.equal(store.listEvents(userA, run.id).at(-1)?.type, "runtime.disconnected");
});

test("an unconfigured default agent adopts ChatMock; a configured one is left alone", () => {
  const legacy = (model) =>
    JSON.stringify({ ...config.defaultAgentConfiguration({}), provider: "openai", model, endpoint: undefined });
  const agent = store.ensureDefaultAgent(userB);
  const setConfig = (json) =>
    db.prepare("UPDATE ui_tars_agents SET configuration_json = ? WHERE id = ?").run(json, agent.id);

  setConfig(legacy(""));
  const adopted = store.presentAgent(store.ensureDefaultAgent(userB)).configuration;
  assert.equal(adopted.provider, "chatmock");
  assert.equal(adopted.model, config.defaultAgentConfiguration().model);

  // A model the user chose is never overwritten.
  setConfig(legacy("UI-TARS-1.5-7B"));
  const kept = store.presentAgent(store.ensureDefaultAgent(userB)).configuration;
  assert.equal(kept.provider, "openai");
  assert.equal(kept.model, "UI-TARS-1.5-7B");

  // Neither is an agent whose owner stored their own provider key.
  setConfig(legacy(""));
  store.setSecret(agent.id, "sk-user-key");
  assert.equal(store.presentAgent(store.ensureDefaultAgent(userB)).configuration.provider, "openai");
  store.clearSecret(agent.id);
});

// ---------------- surfaces: palette entry, no navbar tab ----------------

test("Agent TARS opens from the capability palette's Agents tab, not the navbar", () => {
  const navbar = source("src/app/components/navbar.tsx");
  assert.doesNotMatch(navbar, /href="\/agents"/);

  const hub = source("src/app/components/hermes/command-hub.tsx");
  assert.match(hub, /id="browser-operator-entry"/);
  assert.match(hub, />\{AGENT_TARS_SLASH_COMMAND\}<\/span>/);
  assert.match(hub, /BrowserOperatorDialog/);
  assert.match(hub, /ssr: false/);
  assert.match(hub, /setBrowserOperatorOpen\(true\)/);
  // Public surfaces never get the browser operator.
  assert.match(hub, /surface === "quartz_ai" \? null/);
});

test("Agent TARS uses one canonical slash command and the official logo", () => {
  assert.equal(identity.AGENT_TARS_SLASH_COMMAND, "/agents:agent-tars");
  assert.equal(identity.agentTarsUserMessage("open instagram"), "/agents:agent-tars open instagram");
  assert.equal(identity.agentTarsUserMessage("  open instagram  "), "/agents:agent-tars open instagram");
  assert.equal(identity.taskFromAgentTarsCommand("/agents:agent-tars browse example.com"), "browse example.com");
  assert.equal(identity.taskFromAgentTarsCommand("  /AGENTS:AGENT-TARS  inspect this page"), "inspect this page");
  assert.equal(identity.taskFromAgentTarsCommand("/agents:agent-tars"), "");
  assert.equal(identity.taskFromAgentTarsCommand("/agents:another-agent task"), null);

  const composer = source("src/app/components/assistant-composer.tsx");
  const hub = source("src/app/components/hermes/command-hub.tsx");
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const panel = source("src/app/components/agents/browser-operator.tsx");
  assert.match(composer, /insertCommandToken\(AGENT_TARS_SLASH_COMMAND\)/);
  assert.match(composer, />\{AGENT_TARS_SLASH_COMMAND\}<\/span>/);
  assert.match(terminal, /taskFromAgentTarsCommand\(text\)/);
  assert.match(terminal, /content: agentTarsUserMessage\(task\)/);
  assert.match(panel, /AGENT_TARS_LOGO_PATH/);
  assert.ok(fs.existsSync(fileURLToPath(new URL("../public/agents/agent-tars.png", import.meta.url))));
  assert.doesNotMatch(hub, /bg-\[#111\]/);
  assert.match(hub, /bg-\[var\(--paper-strong\)\]/);
  assert.doesNotMatch(panel, /bg-black\/30/);
  assert.match(panel, /bg-white\/10/);
});

test("the operator panel opens from the palette", () => {
  const panel = source("src/app/components/agents/browser-operator.tsx");
  const hub = source("src/app/components/hermes/command-hub.tsx");
  assert.match(hub, /BrowserOperatorDialog/);
  assert.match(panel, /export function BrowserOperatorDialog/);
  assert.match(panel, /CHATMOCK_PROVIDER/);
  // ChatMock agents advertise a server-held credential instead of demanding one.
  assert.match(panel, /server-managed/);
  assert.match(panel, /Not required for the local gateway/);
  assert.match(panel, />Actual desktop</);
  assert.match(panel, /real mouse and keyboard/);
  assert.match(panel, /approval before each run starts/);
});

test("browser run workspaces use the Breadboard light theme", () => {
  const inline = source("src/app/components/hermes/inline-browser-run.tsx");
  const panel = source("src/app/components/agents/browser-operator.tsx");
  const composer = source("src/app/components/assistant-composer.tsx");

  assert.match(inline, /bg-\[var\(--paper-surface\)\]/);
  assert.match(inline, /text-\[var\(--ink-heading\)\]/);
  assert.match(inline, /text-\[var\(--botanical\)\]/);
  assert.doesNotMatch(inline, /text-sky-|bg-gray-950|text-gray-|text-white/);
  assert.match(panel, /Final browser state|bg-\[var\(--paper-strong\)\]/);
  assert.doesNotMatch(panel.slice(panel.indexOf("{/* Screenshot + approval */")), /text-sky-|bg-gray-950/);
  assert.match(composer, /text-\[var\(--botanical\)\]">\{AGENT_TARS_SLASH_COMMAND\}/);
});

test("Agent TARS activity remains ordered in both compact and full run views", () => {
  const inline = source("src/app/components/hermes/inline-browser-run.tsx");
  assert.match(inline, /events\.map\(describeStep\)/);
  assert.match(inline, /steps\.map\(\(step, index\)/);
  assert.match(inline, /aria-label="Agent TARS activity timeline"/);
  assert.match(inline, /left-\[3px\].*w-px.*bg-\[var\(--line\)\]/);
  assert.match(inline, /grid-cols-\[8px_minmax\(0,1fr\)\]/);
  assert.match(inline, /mt-\[7px\] h-2 w-2 rounded-full/);
  assert.match(inline, /motion-safe:animate-pulse/);

  const operator = source("src/app/components/agents/browser-operator.tsx");
  assert.match(operator, /timelineRef/);
  assert.match(operator, /timeline\.scrollTop = timeline\.scrollHeight/);
  assert.match(operator, /followTimelineRef/);
  assert.match(operator, /onScroll=\{handleTimelineScroll\}/);
});

test("Agent TARS thinking matches normal chat metadata without metric tags", () => {
  const metrics = source("src/app/components/agent-tars-run-metrics.tsx");
  const responseMeta = source("src/app/components/assistant-response-meta.tsx");
  assert.match(metrics, /<AssistantResponseMeta/);
  assert.match(responseMeta, /label = "Thinking"/);
  assert.match(responseMeta, /\? "Thought" : label/);
  assert.match(responseMeta, /counting tokens/);
  assert.match(responseMeta, /tokens unavailable/);
  assert.match(responseMeta, /className="my-1 text-\[var\(--ink\)\]"/);
  assert.doesNotMatch(metrics, /label="(?:Input|Output|Total|Calls)"/);

  const inline = source("src/app/components/hermes/inline-browser-run.tsx");
  const operator = source("src/app/components/agents/browser-operator.tsx");
  assert.match(inline, /AssistantResponseMeta/);
  assert.match(operator, /AgentTarsRunMetrics/);
  for (const ui of [inline, operator]) {
    assert.match(ui, /"agent\.thinking"/);
    assert.match(ui, /"agent\.usage"/);
  }
  assert.ok(
    inline.indexOf("<AssistantResponseMeta") <
      inline.indexOf("bb-agent-run-card"),
    "thinking belongs above the run widget",
  );
  assert.match(inline, /agentTarsChatResponse/);
  assert.match(inline, /<ChatMarkdown content=\{terminalContent\}/);
  assert.match(
    inline,
    /<AssistantMessageActions content=\{terminalContent\} onRetry=\{onRetry\}/,
  );
});

test("Agent TARS screenshots use a clickable, browsable full-size gallery", () => {
  const inline = source("src/app/components/hermes/inline-browser-run.tsx");
  const operator = source("src/app/components/agents/browser-operator.tsx");
  assert.match(inline, /aspect-\[16\/9\]/);
  assert.match(operator, /aspect-\[8\/5\]/);
  assert.match(inline, /AgentTarsScreenshotGallery/);
  assert.match(operator, /AgentTarsScreenshotGallery/);
  const gallery = source("src/app/components/agent-tars-screenshot-gallery.tsx");
  assert.match(gallery, /cursor-zoom-in/);
  assert.match(gallery, /createPortal/);
  assert.match(gallery, /Previous Agent TARS screenshot/);
  assert.match(gallery, /Next Agent TARS screenshot/);
  assert.match(gallery, /Screenshot \{selectedIndex \+ 1\} of \{screenshots\.length\}/);
  assert.match(gallery, /onError=\{\(\) => markUnavailable\(selected\.id\)\}/);
  assert.match(gallery, /This screenshot is not available\./);
  assert.match(gallery, />\s*Retry\s*</);
});

test("historical Agent TARS screenshots are restored through the authorized dashboard service", () => {
  const client = source("src/lib/ui-tars/client.ts");
  const service = source("src/lib/ui-tars/service.ts");
  assert.match(client, /restoreScreenshotHistory/);
  assert.match(client, /\/screenshots\/restore/);
  assert.match(service, /store\.getRun\(userId, runId\)/);
  assert.match(service, /adapter\.restoreScreenshotHistory\(runId, userId\)/);
  assert.ok(
    service.indexOf("store.getRun(userId, runId)") < service.indexOf("adapter.restoreScreenshotHistory(runId, userId)"),
    "the durable dashboard run owner must be verified before legacy screenshot restoration",
  );
});

// ---------------- store: runs + idempotent events ----------------

test("run events are idempotent (duplicate sequence numbers ignored) and drive status", () => {
  const agent = store.ensureDefaultAgent(userA);
  const runId = store.publicId("run");
  store.createRunRecord({ id: runId, agentId: agent.id, userId: userA, task: "t" });
  const events = [
    { sequenceNumber: 1, type: "run.started", payload: { task: "t" } },
    { sequenceNumber: 2, type: "approval.requested", payload: { actionId: "x", action: "submit", explanation: "e", risk: "high", requestedAt: new Date().toISOString() } },
  ];
  assert.equal(store.persistEvents(runId, events), 2);
  // Re-delivering the same events inserts nothing new.
  assert.equal(store.persistEvents(runId, events), 0);
  assert.equal(store.lastSequence(runId), 2);
  const run = store.getRun(userA, runId);
  assert.equal(run.status, "awaiting_approval");
  // Cross-user cannot read the run or its events.
  assert.equal(store.getRun(userB, runId), null);
  assert.equal(store.listEvents(userB, runId, 0).length, 0);
  // Owner can resume from a sequence cursor.
  assert.equal(store.listEvents(userA, runId, 1).length, 1);
});
