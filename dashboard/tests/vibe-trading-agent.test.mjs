// Vibe Trading is the first agent Breadboard hosts by running the clone's own
// HTTP service rather than by driving a model loop itself. These tests pin the
// three things that follow from that:
//
//   1. The seam between the two projects — the SSE wire format Breadboard
//      parses, and the environment the service is started with. A change on
//      either side has to fail here rather than produce a run card that quietly
//      never fills in.
//   2. The restart contract. The clone caches its configuration in a
//      process-wide singleton, so a setting that changed without a restart
//      would be a lie told in a settings dialog.
//   3. The wiring every runtime agent shares: a command, a run route, a card on
//      both chat surfaces, and a settings entry whose keys the run actually
//      reads.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
const repoRoot = path.join(dashboardRoot, "..");

const {
  VIBE_TRADING_AGENT_ID,
  VIBE_TRADING_AGENT_NAME,
  VIBE_TRADING_COMMAND,
  taskFromVibeTradingCommand,
  vibeTradingRunLabel,
  vibeTradingUserMessage,
} = await import("../src/lib/vibe-trading/identity.ts");

const {
  DEFAULT_VIBE_TRADING_SETTINGS,
  settingsEnv,
  vibeTradingSettingsFrom,
} = await import("../src/lib/vibe-trading/settings.ts");

const { credentialStatus, credentialFingerprint, VENDOR_CREDENTIALS } = await import(
  "../src/lib/vibe-trading/credentials.ts"
);

const { describeArguments, parseFrame } = await import(
  "../src/lib/vibe-trading/run-manager.ts"
);

const { isClone, resolveVibeTradingRoot } = await import(
  "../src/lib/vibe-trading/runtime.ts"
);

const { effectiveModel } = await import("../src/lib/vibe-trading/service.ts");

const { findConfigurableAgent, agentSettingDefaults, normalizeAgentSettings } = await import(
  "../src/lib/agent-settings/catalog.ts"
);

const { runtimeAgentById } = await import("../src/lib/hermes/capability-combinations.ts");

// ---- the command ------------------------------------------------------------

test("the command yields the prompt and keeps stacked tokens for the resolver", () => {
  assert.equal(
    taskFromVibeTradingCommand("/agents:vibe-trading backtest a 50/200 SMA cross on SPY"),
    "backtest a 50/200 SMA cross on SPY",
  );
  // A bare token selects the agent; the next message carries the question.
  assert.equal(taskFromVibeTradingCommand("/agents:vibe-trading"), "");
  // Anything the user stacked in front survives, so the capability resolver
  // still sees it rather than the agent receiving it as prose.
  assert.equal(
    taskFromVibeTradingCommand("/my-skill /agents:vibe-trading check SPY"),
    "/my-skill check SPY",
  );
  assert.equal(taskFromVibeTradingCommand("what is the SPY drawdown?"), null);
  assert.equal(taskFromVibeTradingCommand("/agents:trading-agent NVDA"), null);
});

test("the user message and the run label read as themselves", () => {
  assert.equal(
    vibeTradingUserMessage("test momentum on BTC"),
    `${VIBE_TRADING_COMMAND} test momentum on BTC`,
  );
  assert.equal(vibeTradingUserMessage("   "), VIBE_TRADING_COMMAND);
  assert.equal(vibeTradingRunLabel("test momentum on BTC"), "test momentum on BTC");
  // A pasted filing is a normal input; the label is a glance, not the prompt.
  assert.equal(vibeTradingRunLabel("x".repeat(200)).length, 80);
  assert.equal(vibeTradingRunLabel("\n\nfirst line\nsecond"), "first line");
  assert.equal(vibeTradingRunLabel("   "), "Finance research");
});

// ---- the wire format between the two projects -------------------------------

test("the clone's SSE frames parse into an event and a payload", () => {
  assert.deepEqual(
    parseFrame('id: abc123\nevent: tool_call\ndata: {"tool":"get_market_data","iter":1}'),
    { id: "abc123", event: "tool_call", data: { tool: "get_market_data", iter: 1 } },
  );
  // The clone writes `data: ` with a leading space, and splits long payloads
  // across several data lines, which SSE says to rejoin with newlines.
  assert.deepEqual(parseFrame('event: text_delta\ndata: {"delta":"a\\nb"}').data, {
    delta: "a\nb",
  });
  // A comment-only keepalive and a malformed payload must not end a run.
  assert.equal(parseFrame(": ping"), null);
  assert.equal(parseFrame("event: tool_call\ndata: not json"), null);
  assert.equal(parseFrame(""), null);
  // No event field means SSE's default, which the translator ignores.
  assert.equal(parseFrame('data: {"ts":1}').event, "message");
});

test("tool arguments become one readable line and never a wall of text", () => {
  assert.equal(
    describeArguments({ symbol: "SPY", start: "2020-01-01", empty: "", missing: null }),
    "symbol=SPY start=2020-01-01",
  );
  assert.ok(describeArguments({ code: "x".repeat(500) }).length <= 200);
  assert.equal(describeArguments("not an object"), "");
  assert.equal(describeArguments(null), "");
});

// ---- the restart contract ---------------------------------------------------

test("every setting maps to an environment variable the clone reads at boot", () => {
  const environment = settingsEnv({
    model: "",
    temperature: 0.3,
    memory: "full",
    dataCache: false,
    cryptoExchange: "kraken",
  });
  assert.deepEqual(environment, {
    LANGCHAIN_TEMPERATURE: "0.3",
    VT_MEMORY: "full",
    VIBE_TRADING_DATA_CACHE: "0",
    CCXT_EXCHANGE: "kraken",
  });

  // Each name has to exist in the clone's own schema, or the setting is inert.
  const schema = fs.readFileSync(
    path.join(repoRoot, "Vibe-Trading", "agent", "src", "config", "env_schema.py"),
    "utf8",
  );
  for (const name of Object.keys(environment)) {
    assert.ok(schema.includes(name), `${name} is not a variable the clone reads`);
  }
});

test("stored settings are normalised, and an older row keeps the shipped defaults", () => {
  assert.deepEqual(vibeTradingSettingsFrom({}), DEFAULT_VIBE_TRADING_SETTINGS);
  // A boolean absent from an older stored row must read as the default, not as
  // false — that would silently disable the market-data cache for everyone who
  // saved settings before the field existed.
  assert.equal(vibeTradingSettingsFrom({}).dataCache, true);
  assert.equal(vibeTradingSettingsFrom({ dataCache: false }).dataCache, false);
  // Unknown values fall back rather than reaching the clone.
  assert.equal(vibeTradingSettingsFrom({ memory: "everything" }).memory, "off");
  assert.equal(vibeTradingSettingsFrom({ cryptoExchange: "mtgox" }).cryptoExchange, "binance");
  assert.equal(vibeTradingSettingsFrom({ temperature: "0.3" }).temperature, 0.3);
  assert.equal(vibeTradingSettingsFrom({ temperature: 99 }).temperature, 2);
  assert.equal(vibeTradingSettingsFrom({ temperature: "hot" }).temperature, 0);
  assert.equal(vibeTradingSettingsFrom({ model: `  ${"m".repeat(300)}  ` }).model.length, 120);
});

test("a pinned model wins over the chat's, and an empty one follows it", () => {
  const base = {
    baseUrl: "http://127.0.0.1:8765/v1",
    apiKey: "local",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
  };
  assert.equal(
    effectiveModel({ ...base, settings: { ...DEFAULT_VIBE_TRADING_SETTINGS } }),
    "gpt-5.6-sol",
  );
  assert.equal(
    effectiveModel({
      ...base,
      settings: { ...DEFAULT_VIBE_TRADING_SETTINGS, model: "claude-opus-5" },
    }),
    "claude-opus-5",
  );
});

test("the credential fingerprint tracks which keys are set, never their values", () => {
  const secret = "super-secret-token-value";
  const withKeys = { TUSHARE_TOKEN: secret, FRED_API_KEY: "another" };
  const fingerprint = credentialFingerprint(withKeys);
  assert.ok(fingerprint.includes("tushare"));
  assert.ok(fingerprint.includes("fred"));
  assert.ok(!fingerprint.includes(secret), "the fingerprint leaks a key");
  // Adding a key has to change the fingerprint, or the service would keep
  // running without it after the user saved one.
  assert.notEqual(credentialFingerprint({ TUSHARE_TOKEN: secret }), fingerprint);

  const status = credentialStatus(withKeys);
  assert.deepEqual(status.tushare, { set: true, source: "environment" });
  assert.equal(status.finnhub.set, false);
  // Every credential names a variable the clone actually reads.
  const schema = fs.readFileSync(
    path.join(repoRoot, "Vibe-Trading", "agent", ".env.example"),
    "utf8",
  );
  for (const credential of VENDOR_CREDENTIALS) {
    assert.ok(schema.includes(credential.env), `${credential.env} is not a key the clone reads`);
  }
});

// ---- the clone --------------------------------------------------------------

test("the clone is recognised by the two files Breadboard actually runs", () => {
  const runtime = resolveVibeTradingRoot();
  assert.ok(runtime, "the Vibe-Trading clone was not found next to the dashboard");
  assert.ok(fs.existsSync(path.join(runtime.root, "agent", "api_server.py")));
  // A pyproject.toml alone would match half the Python trees on disk.
  assert.equal(isClone(repoRoot), false);
  assert.equal(isClone(path.join(repoRoot, "tradingagents")), false);
});

test("the Runtime profile pins ChatMock, authentication, and shell safety", () => {
  const service = source("src/lib/vibe-trading/service.ts");
  const runtimeFacade = source("src/lib/vibe-trading/runtime-run-manager.ts");
  // The clone's `openai` provider with an overridden base URL is what makes
  // ChatMock the model layer; without all three the process reaches OpenAI.
  assert.match(service, /LANGCHAIN_PROVIDER:\s*"openai"/);
  assert.match(service, /OPENAI_BASE_URL:\s*options\.baseUrl/);
  assert.match(service, /OPENAI_API_KEY:\s*options\.apiKey/);
  // Reasoning is selected per chat turn and reaches the closed launch profile.
  assert.match(service, /LANGCHAIN_REASONING_EFFORT:\s*options\.reasoningEffort/);
  assert.match(runtimeFacade, /reasoningEffort:\s*input\.reasoningEffort/);
  // Runtime injects the per-launch bearer into both sides; it is never minted
  // or returned by the renderer-facing adapter.
  assert.match(service, /serviceAuthentication:\s*"runtime-injected"/);
  assert.match(service, /apiKey:\s*endpoint\.apiKey/);
  assert.match(service, /VIBE_TRADING_ENABLE_SHELL_TOOLS:\s*"0"/);
  // The clone's settings API and direct process ownership stay absent.
  for (const file of ["service.ts", "run-manager.ts", "setup.ts"]) {
    const text = source(`src/lib/vibe-trading/${file}`);
    assert.doesNotMatch(text, /\/settings\//, `${file} mutates the clone's settings`);
    assert.doesNotMatch(text, /node:child_process|spawn\(|detached:|stopService/);
  }
  assert.match(service, /runtimeServiceConfigPath\(\)/);
  assert.match(service, /flag:\s*"wx"/);
});

test("one empty ChatMock turn is retried before Vibe becomes unavailable", () => {
  const loop = source("../Vibe-Trading/agent/src/agent/loop.py");
  assert.match(loop, /empty_model_response_retries < 1/);
  assert.match(loop, /reason": "empty_model_response_retry"/);
  assert.match(loop, /if iteration >= self\.max_iterations:\s*iteration -= 1/);
});

// ---- the wiring every runtime agent shares ----------------------------------

test("the agent is registered, routed, and reachable from both chat surfaces", () => {
  const profile = runtimeAgentById(VIBE_TRADING_AGENT_ID);
  assert.ok(profile, "Vibe Trading is missing from the runtime agent table");
  assert.equal(profile.command, VIBE_TRADING_COMMAND);
  assert.equal(profile.name, VIBE_TRADING_AGENT_NAME);
  // The run route hands the prompt to the clone verbatim, so a stacked skill
  // would arrive as prose and an attachment would have nowhere to go.
  assert.equal(profile.stacksCapabilities, false);
  assert.equal(profile.acceptsAttachments, false);
  assert.deepEqual([...profile.surfaces].sort(), ["dashboard_terminal", "garden_chat"]);

  for (const route of [
    "src/app/api/vibe-trading/health/route.ts",
    "src/app/api/vibe-trading/setup/route.ts",
    "src/app/api/vibe-trading/runs/route.ts",
    "src/app/api/vibe-trading/runs/[runId]/events/route.ts",
    "src/app/api/vibe-trading/runs/[runId]/abort/route.ts",
  ]) {
    assert.ok(fs.existsSync(path.join(dashboardRoot, route)), `${route} is missing`);
  }

  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  for (const [name, text] of [["the Terminal", terminal], ["Garden Chat", garden]]) {
    assert.match(text, /taskFromVibeTradingCommand/, `${name} does not route the command`);
    assert.match(text, /"\/api\/vibe-trading\/runs"/, `${name} does not start a run`);
  }
  // The two surfaces persist a run differently: the Terminal names the kind, and
  // the Garden writes the transcript field the save route derives the kind from.
  assert.match(terminal, /kind:\s*"vibe_trading"/, "the Terminal does not persist the run");
  assert.match(garden, /vibeTradingRun:\s*\{/, "Garden Chat does not persist the run");
});

test("the settings page offers exactly the keys a run reads", () => {
  const agent = findConfigurableAgent(VIBE_TRADING_AGENT_ID);
  assert.ok(agent, "Vibe Trading has no settings entry");
  assert.equal(agent.command, VIBE_TRADING_COMMAND);
  // Defaults on the page and defaults in the run have to be the same thing.
  assert.deepEqual(
    vibeTradingSettingsFrom(agentSettingDefaults(agent)),
    DEFAULT_VIBE_TRADING_SETTINGS,
  );
  // A field the run never reads is a control that changes nothing.
  const read = new Set(["model", "temperature", "memory", "dataCache", "cryptoExchange"]);
  assert.deepEqual(new Set(agent.fields.map((field) => field.key)), read);
  // Hostile stored values still normalise to something runnable.
  const hostile = normalizeAgentSettings(agent, {
    model: 42,
    temperature: "nonsense",
    memory: [],
    dataCache: "yes",
    cryptoExchange: "../../etc",
  });
  const settings = vibeTradingSettingsFrom(hostile);
  assert.equal(settings.memory, "off");
  assert.equal(settings.cryptoExchange, "binance");
  assert.equal(settings.temperature, 0);
});

test("the run card streams the answer and reports the cold start honestly", () => {
  const card = source("src/app/components/hermes/inline-vibe-trading-run.tsx");
  // The service's first start is most of a cold run's wait; saying so is the
  // difference between "slow" and "broken".
  assert.match(card, /service\.starting/);
  assert.match(card, /Starting the Vibe Trading service/);
  // The answer arrives token by token while the tools are still running.
  assert.match(card, /answer\.delta/);
  assert.match(card, /Research output, not financial advice/);
  // A finished turn with saved content renders from it rather than reopening a
  // stream that no longer exists.
  assert.match(card, /if \(persistedOutcome && persistedOutcome !== "running" && persistedContent\) return;/);
});
