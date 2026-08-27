// Stock Analyst runs the cloned daily_stock_analysis backend rather than a model
// loop Breadboard drives itself, so these tests pin the things that follow from
// that:
//
//   1. The seam between the two projects — the progress-event format Breadboard
//      parses, and the configuration the backend is started with. A change on
//      either side has to fail here rather than produce a run card that quietly
//      never fills in.
//   2. The two containment promises: the clone's own `.env` is never read, its
//      scheduler never starts, and nothing is written inside the checkout. This
//      agent shares a machine with a user's personal deployment of the same
//      project, which sends messages to WeCom, Feishu and Telegram.
//   3. The restart contract. The clone caches its configuration in a
//      process-wide singleton, so a setting that changed without a restart would
//      be a lie told in a settings dialog.
//   4. The wiring every runtime agent shares: a command, a run route, a card on
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
  STOCK_ANALYST_AGENT_ID,
  STOCK_ANALYST_AGENT_NAME,
  STOCK_ANALYST_COMMAND,
  taskFromStockAnalystCommand,
  stockAnalystRunLabel,
  stockAnalystUserMessage,
} = await import("../src/lib/stock-analyst/identity.ts");

const {
  DEFAULT_STOCK_ANALYST_SETTINGS,
  normalizeWatchlist,
  settingsEnv,
  settingsEnvFile,
  stockAnalystSettingsFrom,
} = await import("../src/lib/stock-analyst/settings.ts");

const { credentialStatus, credentialFingerprint, VENDOR_CREDENTIALS } = await import(
  "../src/lib/stock-analyst/credentials.ts"
);

const { parseFrame, stageLabel, statusLine } = await import(
  "../src/lib/stock-analyst/run-manager.ts"
);

const { isClone, resolveStockAnalystRoot } = await import(
  "../src/lib/stock-analyst/runtime.ts"
);

const { effectiveModel } = await import("../src/lib/stock-analyst/service.ts");

const { findConfigurableAgent, agentSettingDefaults, normalizeAgentSettings } = await import(
  "../src/lib/agent-settings/catalog.ts"
);

const { runtimeAgentById } = await import("../src/lib/hermes/capability-combinations.ts");

const cloneRoot = path.join(repoRoot, "daily_stock_analysis");
const cloneEnvExample = fs.readFileSync(path.join(cloneRoot, ".env.example"), "utf8");

// ---- the command ------------------------------------------------------------

test("the command yields the question and keeps stacked tokens for the resolver", () => {
  assert.equal(
    taskFromStockAnalystCommand("/agents:stock-analyst is 600519 still in an uptrend?"),
    "is 600519 still in an uptrend?",
  );
  // A bare token selects the agent; the next message carries the question.
  assert.equal(taskFromStockAnalystCommand("/agents:stock-analyst"), "");
  // Anything the user stacked in front survives, so the capability resolver
  // still sees it rather than the agent receiving it as prose.
  assert.equal(
    taskFromStockAnalystCommand("/my-skill /agents:stock-analyst check AAPL"),
    "/my-skill check AAPL",
  );
  assert.equal(taskFromStockAnalystCommand("how is AAPL doing?"), null);
  // The three finance agents must not answer to each other's commands.
  assert.equal(taskFromStockAnalystCommand("/agents:vibe-trading check SPY"), null);
  assert.equal(taskFromStockAnalystCommand("/agents:trading-agent NVDA"), null);
});

test("the user message and the run label read as themselves", () => {
  assert.equal(
    stockAnalystUserMessage("what is the entry point on hk00700"),
    `${STOCK_ANALYST_COMMAND} what is the entry point on hk00700`,
  );
  assert.equal(stockAnalystUserMessage("   "), STOCK_ANALYST_COMMAND);
  assert.equal(stockAnalystRunLabel("check 2330.TW"), "check 2330.TW");
  // A pasted transcript is a normal input; the label is a glance, not the prompt.
  assert.equal(stockAnalystRunLabel("x".repeat(200)).length, 80);
  assert.equal(stockAnalystRunLabel("\n\nfirst line\nsecond"), "first line");
  assert.equal(stockAnalystRunLabel("   "), "Stock question");
});

// ---- the wire format between the two projects -------------------------------

test("the clone's data-only progress frames parse into an event object", () => {
  // Unlike most SSE producers the clone never writes an `event:` line — the type
  // lives in the JSON, which is what its own docs/agent-stream-events.md says.
  assert.deepEqual(parseFrame('data: {"type":"tool_start","step":1,"tool":"get_realtime_quote"}'), {
    type: "tool_start",
    step: 1,
    tool: "get_realtime_quote",
  });
  // Long payloads split across several data lines rejoin with newlines.
  assert.deepEqual(parseFrame('data: {"type":"done","content":"a\\nb"}'), {
    type: "done",
    content: "a\nb",
  });
  // A comment-only keepalive and a malformed payload must not end a run.
  assert.equal(parseFrame(": ping"), null);
  assert.equal(parseFrame("data: not json"), null);
  assert.equal(parseFrame(""), null);
});

test("the event vocabulary the card reads is the one the clone emits", () => {
  const runManager = source("src/lib/stock-analyst/run-manager.ts");
  // The documented contract covers the events the agent loop and the
  // orchestrator publish; `accepted` is the endpoint's own handshake and lives
  // only in its source, so both are checked.
  const contract =
    fs.readFileSync(path.join(cloneRoot, "docs", "agent-stream-events.md"), "utf8") +
    fs.readFileSync(path.join(cloneRoot, "api", "v1", "endpoints", "agent.py"), "utf8");
  for (const type of [
    "accepted",
    "thinking",
    "stage_start",
    "stage_done",
    "tool_start",
    "tool_done",
    "generating",
    "pipeline_timeout",
    "pipeline_budget_skipped",
    "done",
    "error",
  ]) {
    assert.match(runManager, new RegExp(`"${type}"`), `${type} is not translated`);
    assert.ok(contract.includes(type), `${type} is not an event the clone emits`);
  }
});

test("stages and status lines are readable, and the clone's fixed Chinese is translated", () => {
  // The orchestrator's own agent names, taken from src/agent/agents/.
  assert.equal(stageLabel("technical"), "Technical analysis");
  assert.equal(stageLabel("intel"), "News and sentiment");
  assert.equal(stageLabel("decision"), "Decision");
  // The panel depth names one stage per strategy specialist.
  assert.equal(stageLabel("skill_chan_theory"), "chan theory strategy");
  assert.equal(stageLabel("something_new"), "something new");

  // REPORT_LANGUAGE governs the report, not the progress lines hard-coded in
  // the clone's agent loop, so an English chat would otherwise show Chinese.
  assert.equal(statusLine("正在制定分析路径..."), "Planning the analysis");
  assert.equal(statusLine("正在生成最终分析..."), "Writing the analysis");
  // Anything not on the fixed list is passed through as the clone wrote it.
  assert.equal(statusLine("「获取实时行情」已完成，继续深入分析..."), "「获取实时行情」已完成，继续深入分析...");
});

// ---- containment ------------------------------------------------------------

test("the clone's deployment stays isolated behind a private Runtime profile", () => {
  const service = source("src/lib/stock-analyst/service.ts");

  // The user's `.env` holds their API keys, their watchlist, their webhooks and
  // possibly SCHEDULE_ENABLED=true. Only closed env-file contents are handed to
  // the Runtime launcher; no checkout path is accepted from the request.
  assert.match(service, /envFileContents:\s*settingsEnvFile\(options\.settings\)/);
  assert.doesNotMatch(service, /path\.join\([^\n]*,"\.env"\)/);

  // Nothing may run the daily pipeline or fire a notification.
  assert.match(service, /DSA_RUNTIME_SCHEDULER_SUPPRESS_START:\s*"1"/);
  assert.match(service, /SCHEDULE_ENABLED:\s*"false"/);
  assert.match(service, /RUN_IMMEDIATELY:\s*"false"/);

  // State belongs outside the checkout, not in the ./data and ./logs a user's
  // own `python main.py` writes to.
  assert.match(service, /database:\s*"data\/stock_analysis\.db"/);
  assert.match(service, /logs:\s*"logs"/);

  // The only dashboard write is its private, atomic Runtime profile under the
  // product data directory; process ownership and environment deletion are not
  // present in any adapter source.
  const stateHome = source("src/lib/stock-analyst/runtime.ts");
  assert.match(stateHome, /\.runtime",\s*"stock-analyst"/);
  for (const file of ["service.ts", "run-manager.ts", "setup.ts", "runtime.ts"]) {
    const text = source(`src/lib/stock-analyst/${file}`);
    assert.doesNotMatch(text, /node:child_process|spawn\(|detached:|stopService/);
  }
  assert.match(service, /runtimeServiceConfigPath\(\)/);
  assert.match(service, /flag:\s*"wx"/);
  assert.match(service, /mode:\s*0o600/);
});

test("the model layer is ChatMock, stated rather than inferred", () => {
  const service = source("src/lib/stock-analyst/service.ts");
  // litellm's `openai/` prefix plus an overridden base URL is what makes
  // ChatMock the model layer; without all three the process reaches OpenAI.
  assert.match(service, /LITELLM_MODEL:/);
  assert.match(service, /`openai\/\$\{model\}`/);
  assert.match(service, /OPENAI_BASE_URL:\s*options\.baseUrl/);
  assert.match(service, /OPENAI_API_KEY:\s*options\.apiKey/);
  // `auto` can resolve to the clone's experimental local-Codex backend when one
  // happens to be installed on this machine.
  assert.match(service, /AGENT_BACKEND:\s*"litellm"/);
  assert.match(service, /GENERATION_BACKEND:\s*"litellm"/);
});

// ---- the restart contract ---------------------------------------------------

test("every setting maps to configuration the clone reads at boot", () => {
  const environment = settingsEnv({
    model: "",
    depth: "multi-full",
    language: "ko",
    strategies: "all",
    watchlist: "600519",
    memory: true,
    temperature: 0.7,
  });
  assert.deepEqual(environment, {
    AGENT_ARCH: "multi",
    AGENT_ORCHESTRATOR_MODE: "full",
    REPORT_LANGUAGE: "ko",
    LLM_TEMPERATURE: "0.7",
    AGENT_MEMORY_ENABLED: "true",
    AGENT_SKILL_ROUTING: "manual",
    AGENT_SKILLS: "all",
  });
  // Quick answers are the single-agent loop, which is the clone's own default.
  assert.equal(settingsEnv(DEFAULT_STOCK_ANALYST_SETTINGS).AGENT_ARCH, "single");
  assert.equal(settingsEnv(DEFAULT_STOCK_ANALYST_SETTINGS).AGENT_SKILLS, "");

  // Each name has to exist in the clone's own configuration, or the setting is
  // a control that changes nothing.
  for (const name of Object.keys(environment)) {
    assert.ok(cloneEnvExample.includes(name), `${name} is not a variable the clone reads`);
  }
});

test("the watchlist goes through the env file, because the clone re-reads it there", () => {
  // STOCK_LIST is one of the keys the clone deliberately prefers from the env
  // *file* over the process environment, so passing it as environment alone
  // would be silently ignored.
  assert.ok(!Object.keys(settingsEnv(DEFAULT_STOCK_ANALYST_SETTINGS)).includes("STOCK_LIST"));
  assert.match(
    settingsEnvFile({ ...DEFAULT_STOCK_ANALYST_SETTINGS, watchlist: "600519,AAPL" }),
    /^STOCK_LIST=600519,AAPL$/m,
  );
  const config = fs.readFileSync(path.join(cloneRoot, "src", "config.py"), "utf8");
  assert.match(config, /_WEBUI_RUNTIME_ENV_FILE_PRIORITY_KEYS[\s\S]{0,200}"STOCK_LIST"/);

  // Codes are normalised the way the clone's own parser reads them: split,
  // trimmed, upper-cased. A short word is indistinguishable from a ticker and
  // is not the thing being defended against — anything carrying a path, a shell
  // character or unbounded length is.
  assert.equal(normalizeWatchlist(" 600519, hk00700 , aapl "), "600519,HK00700,AAPL");
  assert.equal(normalizeWatchlist("7203.T 005930.KS 2330.TW"), "7203.T,005930.KS,2330.TW");
  assert.equal(normalizeWatchlist("../../etc/passwd"), "");
  assert.equal(normalizeWatchlist("$(curl evil.sh)"), "");
  assert.equal(normalizeWatchlist("AAPL\nMSFT=1;DROP"), "AAPL");
  assert.equal(normalizeWatchlist(42), "");
  // Length and count are bounded, so a pasted document cannot become a config.
  assert.equal(normalizeWatchlist("A".repeat(500)), "");
  assert.ok(
    normalizeWatchlist(Array.from({ length: 200 }, (_, index) => `A${index}`).join(","))
      .split(",").length <= 40,
  );
});

test("stored settings are normalised, and an older row keeps the shipped defaults", () => {
  assert.deepEqual(stockAnalystSettingsFrom({}), DEFAULT_STOCK_ANALYST_SETTINGS);
  // A boolean absent from an older stored row must read as the default rather
  // than as false.
  assert.equal(stockAnalystSettingsFrom({}).memory, false);
  assert.equal(stockAnalystSettingsFrom({ memory: true }).memory, true);
  // Unknown values fall back rather than reaching the clone.
  assert.equal(stockAnalystSettingsFrom({ depth: "everything" }).depth, "single");
  assert.equal(stockAnalystSettingsFrom({ language: "klingon" }).language, "en");
  assert.equal(stockAnalystSettingsFrom({ strategies: "some" }).strategies, "auto");
  assert.equal(stockAnalystSettingsFrom({ temperature: "0.3" }).temperature, 0.3);
  assert.equal(stockAnalystSettingsFrom({ temperature: 99 }).temperature, 2);
  assert.equal(stockAnalystSettingsFrom({ temperature: "hot" }).temperature, 0.2);
  assert.equal(stockAnalystSettingsFrom({ model: `  ${"m".repeat(300)}  ` }).model.length, 120);
});

test("a pinned model wins over the chat's, and an empty one follows it", () => {
  const base = { baseUrl: "http://127.0.0.1:8765/v1", apiKey: "local", model: "gpt-5.6-sol" };
  assert.equal(
    effectiveModel({ ...base, settings: { ...DEFAULT_STOCK_ANALYST_SETTINGS } }),
    "gpt-5.6-sol",
  );
  assert.equal(
    effectiveModel({
      ...base,
      settings: { ...DEFAULT_STOCK_ANALYST_SETTINGS, model: "claude-opus-5" },
    }),
    "claude-opus-5",
  );
});

test("the credential fingerprint tracks which keys are set, never their values", () => {
  const secret = "super-secret-token-value";
  const withKeys = { TUSHARE_TOKEN: secret, SERPAPI_API_KEYS: "another" };
  const fingerprint = credentialFingerprint(withKeys);
  assert.ok(fingerprint.includes("tushare"));
  assert.ok(fingerprint.includes("serpapi"));
  assert.ok(!fingerprint.includes(secret), "the fingerprint leaks a key");
  // Adding a key has to change the fingerprint, or the backend would keep
  // running without it after the user saved one.
  assert.notEqual(credentialFingerprint({ TUSHARE_TOKEN: secret }), fingerprint);

  const status = credentialStatus(withKeys);
  assert.deepEqual(status.tushare, { set: true, source: "environment" });
  assert.equal(status.tavily.set, false);
  // Every credential names a variable the clone actually reads.
  for (const credential of VENDOR_CREDENTIALS) {
    assert.ok(
      cloneEnvExample.includes(credential.env),
      `${credential.env} is not a key the clone reads`,
    );
  }
});

// ---- the clone --------------------------------------------------------------

test("the clone is recognised by the files Breadboard actually runs", () => {
  const runtime = resolveStockAnalystRoot();
  assert.ok(runtime, "the daily_stock_analysis clone was not found next to the dashboard");
  assert.ok(fs.existsSync(path.join(runtime.root, "server.py")));
  assert.ok(fs.existsSync(path.join(runtime.root, "api", "v1", "endpoints", "agent.py")));
  // A main.py alone would match most Python trees on disk.
  assert.equal(isClone(repoRoot), false);
  assert.equal(isClone(path.join(repoRoot, "Vibe-Trading")), false);
});

// ---- the wiring every runtime agent shares ----------------------------------

test("the agent is registered, routed, and reachable from both chat surfaces", () => {
  const profile = runtimeAgentById(STOCK_ANALYST_AGENT_ID);
  assert.ok(profile, "Stock Analyst is missing from the runtime agent table");
  assert.equal(profile.command, STOCK_ANALYST_COMMAND);
  assert.equal(profile.name, STOCK_ANALYST_AGENT_NAME);
  // The run route hands the question to the clone verbatim, so a stacked skill
  // would arrive as prose and an attachment would have nowhere to go.
  assert.equal(profile.stacksCapabilities, false);
  assert.equal(profile.acceptsAttachments, false);
  assert.deepEqual([...profile.surfaces].sort(), ["dashboard_terminal", "garden_chat"]);

  for (const route of [
    "src/app/api/stock-analyst/health/route.ts",
    "src/app/api/stock-analyst/setup/route.ts",
    "src/app/api/stock-analyst/runs/route.ts",
    "src/app/api/stock-analyst/runs/[runId]/events/route.ts",
    "src/app/api/stock-analyst/runs/[runId]/abort/route.ts",
  ]) {
    assert.ok(fs.existsSync(path.join(dashboardRoot, route)), `${route} is missing`);
  }

  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  for (const [name, text] of [["the Terminal", terminal], ["Garden Chat", garden]]) {
    assert.match(text, /taskFromStockAnalystCommand/, `${name} does not route the command`);
    assert.match(text, /"\/api\/stock-analyst\/runs"/, `${name} does not start a run`);
  }
  // The Terminal renders its transcript through the runtime panel; Garden Chat
  // renders its own. Both have to know the card, or a run leaves an empty turn.
  for (const [name, file] of [
    ["the Terminal", "src/app/components/hermes/agent-runtime-panel.tsx"],
    ["Garden Chat", "src/app/gardens/[clusterSlug]/workspace-client.tsx"],
  ]) {
    assert.match(source(file), /<InlineStockAnalystRun/, `${name} has no card`);
  }
  // The two surfaces persist a run differently: the Terminal names the kind, and
  // the Garden writes the transcript field the save route derives the kind from.
  assert.match(terminal, /kind:\s*"stock_analyst"/, "the Terminal does not persist the run");
  assert.match(garden, /stockAnalystRun:\s*\{/, "Garden Chat does not persist the run");
});

test("the settings page offers exactly the keys a run reads", () => {
  const agent = findConfigurableAgent(STOCK_ANALYST_AGENT_ID);
  assert.ok(agent, "Stock Analyst has no settings entry");
  assert.equal(agent.command, STOCK_ANALYST_COMMAND);
  // Defaults on the page and defaults in the run have to be the same thing.
  assert.deepEqual(
    stockAnalystSettingsFrom(agentSettingDefaults(agent)),
    DEFAULT_STOCK_ANALYST_SETTINGS,
  );
  // A field the run never reads is a control that changes nothing.
  const read = new Set([
    "model",
    "depth",
    "language",
    "watchlist",
    "strategies",
    "memory",
    "temperature",
  ]);
  assert.deepEqual(new Set(agent.fields.map((field) => field.key)), read);
  // Hostile stored values still normalise to something runnable.
  const settings = stockAnalystSettingsFrom(
    normalizeAgentSettings(agent, {
      model: 42,
      depth: [],
      language: "../../etc",
      watchlist: "../../etc/passwd",
      strategies: {},
      memory: "yes",
      temperature: "nonsense",
    }),
  );
  assert.equal(settings.depth, "single");
  assert.equal(settings.language, "en");
  assert.equal(settings.watchlist, "");
  assert.equal(settings.strategies, "auto");
});

test("the run card separates the pipeline from the evidence, and is honest about the wait", () => {
  const card = source("src/app/components/hermes/inline-stock-analyst-run.tsx");
  // The backend's first start is most of a cold run's wait; saying so is the
  // difference between "slow" and "broken".
  assert.match(card, /service\.starting/);
  assert.match(card, /Starting the Stock Analyst backend/);
  // Stages are the shape of the answer; tools are the evidence under it.
  assert.match(card, /Stages · \{stages\.length\}/);
  assert.match(card, /Analysis output, not financial advice/);
  // A finished turn with saved content renders from it rather than reopening a
  // stream that no longer exists.
  assert.match(
    card,
    /if \(persistedOutcome && persistedOutcome !== "running" && persistedContent\) return;/,
  );
  // A restored turn has no steps — the run manager keeps events in memory only —
  // so the live placeholder must not survive into it. A headless render of the
  // saved state showed a completed analysis reading "Reading the question…"
  // underneath its own answer.
  assert.match(card, /\{tools\.length \|\| !terminal \? \(/);
});
