// TradingAgents is the one agent Breadboard hosts that takes no prompt: the
// cloned framework analyses one instrument on one date, and there is nowhere in
// its graph for a sentence to go. These tests pin the two things that follow
// from that — the request is validated as a typed object, and the composer is
// wired to collect one instead of leaving a message field open — plus the
// report composition and the bridge protocol the run manager parses.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
const repoSource = (relative) =>
  fs.readFileSync(path.join(dashboardRoot, "..", relative), "utf8");

const {
  DEFAULT_TRADINGAGENTS_REQUEST,
  TRADINGAGENTS_AGENT_ID,
  TRADINGAGENTS_COMMAND,
  isValidTicker,
  isValidTradeDate,
  parseAnalysts,
  parseTradingAgentsCommand,
  tradingAgentsRunLabel,
  tradingAgentsUserMessage,
  validateTradingAgentsRequest,
} = await import("../src/lib/tradingagents/identity.ts");

const { dataVendorsFor, tradingAgentsSettingsFrom, DEFAULT_TRADINGAGENTS_SETTINGS } = await import(
  "../src/lib/tradingagents/settings.ts"
);

const { composeReport } = await import("../src/lib/tradingagents/run-manager.ts");

const { findConfigurableAgent, agentSettingDefaults, normalizeAgentSettings } = await import(
  "../src/lib/agent-settings/catalog.ts"
);

const TODAY = "2026-08-05";
const validRequest = {
  ticker: "nvda",
  tradeDate: "2026-08-04",
  analysts: ["news", "market"],
  researchDepth: 2,
  riskRounds: 1,
  assetType: "stock",
};

// ---- the request model ------------------------------------------------------

test("a valid request is normalised, not merely accepted", () => {
  const result = validateTradingAgentsRequest(validRequest, { today: TODAY });
  assert.equal(result.ok, true);
  assert.equal(result.request.ticker, "NVDA");
  // The analysts run in the graph's own order regardless of how they arrived:
  // the first one is the graph's entry node.
  assert.deepEqual(result.request.analysts, ["market", "news"]);
  assert.equal(result.request.researchDepth, 2);
  assert.equal(result.request.assetType, "stock");
});

test("a request without a runnable instrument or analyst is refused", () => {
  const refusals = [
    [{ ...validRequest, ticker: "" }, /symbol/i],
    [{ ...validRequest, ticker: "NV DA" }, /vendors can look up/i],
    [{ ...validRequest, ticker: "../../etc/passwd" }, /vendors can look up/i],
    [{ ...validRequest, tradeDate: "05-08-2026" }, /YYYY-MM-DD/],
    [{ ...validRequest, tradeDate: "2026-02-31" }, /YYYY-MM-DD/],
    [{ ...validRequest, tradeDate: "2026-09-01" }, /future/i],
    [{ ...validRequest, analysts: [] }, /at least one analyst/i],
    [{ ...validRequest, analysts: ["astrology"] }, /at least one analyst/i],
    ["NVDA please", /not readable/i],
  ];
  for (const [candidate, pattern] of refusals) {
    const result = validateTradingAgentsRequest(candidate, { today: TODAY });
    assert.equal(result.ok, false, `expected ${JSON.stringify(candidate)} to be refused`);
    assert.match(result.error, pattern);
  }
});

test("round counts are clamped rather than trusted", () => {
  const high = validateTradingAgentsRequest(
    { ...validRequest, researchDepth: 99, riskRounds: 0 },
    { today: TODAY },
  );
  assert.equal(high.ok, true);
  assert.equal(high.request.researchDepth, 5);
  assert.equal(high.request.riskRounds, 1);
});

test("real-world symbol shapes are accepted", () => {
  for (const ticker of ["NVDA", "BRK.B", "BTC-USD", "ASML.AS", "7203.T", "^GSPC"]) {
    assert.equal(isValidTicker(ticker), true, ticker);
  }
  for (const ticker of ["", " ", "A B", "NVDA;rm", "../x", "a".repeat(20)]) {
    assert.equal(isValidTicker(ticker), false, JSON.stringify(ticker));
  }
  assert.equal(isValidTradeDate("2026-08-04"), true);
  assert.equal(isValidTradeDate("2026-13-01"), false);
});

test("the sentiment analyst answers to both its label and its wire key", () => {
  assert.deepEqual(parseAnalysts(["sentiment"]), ["social"]);
  assert.deepEqual(parseAnalysts(["SOCIAL", "market"]), ["market", "social"]);
  assert.deepEqual(parseAnalysts("market"), []);
});

// ---- the chat turn ----------------------------------------------------------

test("the user half of the turn is rendered from the request", () => {
  const { request } = validateTradingAgentsRequest(validRequest, { today: TODAY });
  const message = tradingAgentsUserMessage(request);
  assert.match(message, new RegExp(`^${TRADINGAGENTS_COMMAND.replace(/[/:]/g, "\\$&")} `));
  assert.match(message, /NVDA on 2026-08-04/);
  assert.match(message, /analysts: Market, News/);
  assert.match(message, /research depth 2/);
  assert.equal(tradingAgentsRunLabel(request), "NVDA · 2026-08-04");
});

test("a typed command pre-fills the form and never carries free text through", () => {
  const parsed = parseTradingAgentsCommand("/agents:trading-agent NVDA 2026-08-04 depth 3");
  assert.ok(parsed);
  assert.equal(parsed.partial.ticker, "NVDA");
  assert.equal(parsed.partial.tradeDate, "2026-08-04");
  assert.equal(parsed.partial.researchDepth, 3);
  // The parse result has no field a sentence could travel in.
  assert.deepEqual(
    Object.keys(parsed.partial).filter((key) => !(key in { ...DEFAULT_TRADINGAGENTS_REQUEST, ticker: "", tradeDate: "" })),
    [],
  );

  const prose = parseTradingAgentsCommand(
    "/agents:trading-agent tell me whether to buy something good",
  );
  assert.ok(prose);
  assert.equal(prose.partial.ticker, undefined, "prose must not become a symbol");
  assert.equal(parseTradingAgentsCommand("what should I buy?"), null);
});

test("the rendered message round-trips back into the same request", () => {
  const { request } = validateTradingAgentsRequest(validRequest, { today: TODAY });
  const parsed = parseTradingAgentsCommand(tradingAgentsUserMessage(request));
  assert.ok(parsed);
  assert.equal(parsed.partial.ticker, request.ticker);
  assert.equal(parsed.partial.tradeDate, request.tradeDate);
  assert.deepEqual(parsed.partial.analysts, request.analysts);
  assert.equal(parsed.partial.researchDepth, request.researchDepth);
  assert.equal(parsed.partial.riskRounds, request.riskRounds);
});

// ---- settings ---------------------------------------------------------------

test("the agent is configurable through the shared settings catalog", () => {
  const agent = findConfigurableAgent(TRADINGAGENTS_AGENT_ID);
  assert.ok(agent, "TradingAgents must appear in the settings catalog");
  assert.equal(agent.command, TRADINGAGENTS_COMMAND);
  const keys = agent.fields.map((field) => field.key);
  for (const key of ["analysts", "researchDepth", "riskRounds", "deepModel", "marketVendor"]) {
    assert.ok(keys.includes(key), `expected a ${key} field`);
  }
});

test("stored settings translate into run settings, with defaults for the gaps", () => {
  const agent = findConfigurableAgent(TRADINGAGENTS_AGENT_ID);
  const defaults = tradingAgentsSettingsFrom(agentSettingDefaults(agent));
  assert.deepEqual(defaults, DEFAULT_TRADINGAGENTS_SETTINGS);
  // Empty means "follow the chat", which is how the agent stays consistent with
  // every other Breadboard surface.
  assert.equal(defaults.deepModel, "");
  assert.equal(defaults.reasoningEffort, "");

  const stored = tradingAgentsSettingsFrom(
    normalizeAgentSettings(agent, {
      analysts: ["social", "market"],
      researchDepth: 3,
      deepModel: " gpt-5.6-sol ",
      reasoningEffort: "high",
      marketVendor: "yfinance,alpha_vantage",
      newsVendor: "nonsense",
    }),
  );
  assert.deepEqual(stored.analysts, ["market", "social"]);
  assert.equal(stored.researchDepth, 3);
  assert.equal(stored.deepModel, "gpt-5.6-sol");
  assert.equal(stored.reasoningEffort, "high");
  assert.equal(stored.marketVendor, "yfinance,alpha_vantage");
  assert.equal(stored.newsVendor, "yfinance", "an unknown vendor falls back to the keyless one");
});

test("the vendor override names only the categories the settings expose", () => {
  const vendors = dataVendorsFor({ ...DEFAULT_TRADINGAGENTS_SETTINGS, newsVendor: "alpha_vantage" });
  assert.deepEqual(Object.keys(vendors).sort(), [
    "core_stock_apis",
    "fundamental_data",
    "news_data",
    "technical_indicators",
  ]);
  assert.equal(vendors.news_data, "alpha_vantage");
  assert.equal(vendors.core_stock_apis, "yfinance");
});

// ---- the finished report ----------------------------------------------------

test("the report keeps every section and says what it is not", () => {
  const { request } = validateTradingAgentsRequest(validRequest, { today: TODAY });
  const report = composeReport(request, "Buy", [
    { section: "market_report", label: "Market analysis", content: "MACD is positive." },
    { section: "final_trade_decision", label: "Portfolio manager decision", content: "Rating: Buy" },
  ]);
  assert.match(report, /^# NVDA — 2026-08-04/);
  assert.match(report, /\*\*Rating: Buy\*\*/);
  assert.match(report, /## Market analysis\n\nMACD is positive\./);
  assert.match(report, /## Portfolio manager decision/);
  assert.match(report, /not financial advice/i);
});

// ---- the wiring that makes "no prompt" true ---------------------------------

test("the composer replaces the message field instead of leaving it open", () => {
  const composer = source("src/app/components/assistant-composer.tsx");
  assert.match(composer, /tradingAgentsAgent \? \(/);
  assert.match(composer, /reads a symbol and a date, not a message/);
  // The send button must run the request, not submit whatever is in `value`.
  // Shorts replaces the field the same way, so both go through one submit
  // that dispatches to whichever of them is selected.
  assert.match(composer, /if \(tradingAgentsAgent\) submitTradingAgents\(\);/);
  assert.match(composer, /const formAgent = tradingAgentsAgent \?\? shortsAgent \?\?/);
  assert.match(
    composer.replace(/\s+/g, " "),
    /onClick=\{\(\) => formAgent \? submitFormAgent\(\)/,
  );
  // Dictation writes into the message field, which no longer exists.
  assert.match(composer, /disabled=\{disabled \|\| isSending \|\| Boolean\(formAgent\)\}/);

  const form = source("src/app/components/hermes/tradingagents-request-form.tsx");
  assert.doesNotMatch(form, /<textarea/, "the request form must not reintroduce a prompt field");
});

test("the run route takes a typed request and refuses a prompt", () => {
  const route = source("src/app/api/tradingagents/runs/route.ts");
  assert.match(route, /validateTradingAgentsRequest\(body\.request\)/);
  assert.doesNotMatch(route, /body\.task/, "there is no task string on this agent");
});

test("the transcript can restore a finished analysis", () => {
  const runs = source("src/lib/conversations/external-agent-runs.ts");
  assert.match(runs, /"trading_agents"/);
  assert.match(runs, /tradingAgentsRun\?: \{ runId: string; task: string \}/);
});

// ---- the bridge protocol ----------------------------------------------------

test("the run manager and the bridge agree on the event names", () => {
  const bridge = repoSource("scripts/tradingagents-bridge.py");
  const manager = source("src/lib/tradingagents/run-manager.ts");
  for (const type of ["started", "stage", "report", "tools", "completed", "failed"]) {
    assert.ok(bridge.includes(`"${type}"`), `the bridge must emit ${type}`);
    assert.match(manager, new RegExp(`type === "${type}"`), `the manager must handle ${type}`);
  }
  // ChatMock is reached through the framework's own generic endpoint provider,
  // which is what makes any model id and a keyless local relay acceptable.
  assert.match(bridge, /llm_provider"\] = "openai_compatible"/);
  assert.match(manager, /OPENAI_COMPATIBLE_API_KEY/);
});

test("the bridge streams the graph the way the framework's own CLI does", () => {
  const bridge = repoSource("scripts/tradingagents-bridge.py");
  // Reimplementing the pipeline would fork it; these are upstream's own entry
  // points, so an upgrade of the clone keeps working.
  for (const call of [
    "graph.propagator.create_initial_state",
    "graph.graph.stream",
    "graph.process_signal",
    "write_report_tree",
  ]) {
    assert.ok(bridge.includes(call), `the bridge must use ${call}`);
  }
});
