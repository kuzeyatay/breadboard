import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

const identity = await import("../src/lib/paper-trader/identity.ts");
const settingsModule = await import("../src/lib/paper-trader/settings.ts");
const decisions = await import("../src/lib/paper-trader/decisions.ts");
const equityUniverse = await import("../src/lib/paper-trader/equity-universe.ts");
const { PaperTraderStore } = await import("../src/lib/paper-trader/store.ts");

const source = (relativePath) =>
  fs.readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");

const SETTINGS = settingsModule.DEFAULT_PAPER_TRADER_SETTINGS;

class FakeArenaChild extends EventEmitter {
  constructor() {
    super();
    this.exitCode = null;
    this.signalCode = null;
    this.pid = 98_765;
    this.kills = [];
  }

  kill(signal) {
    this.kills.push(signal ?? "SIGTERM");
    return true;
  }

  finish() {
    if (this.exitCode !== null) return;
    this.exitCode = 0;
    this.emit("exit", 0, null);
  }
}

const PAPER_LIFECYCLE_GLOBALS = [
  "__breadboardPaperTraderArena",
  "__breadboardPaperTraderStarting",
  "__breadboardPaperTraderStopping",
  "__breadboardPaperTraderStopGeneration",
  "__breadboardPaperTraderIntentGeneration",
  "__breadboardPaperTraderDeskStart",
];

function resetPaperLifecycleGlobals() {
  for (const key of PAPER_LIFECYCLE_GLOBALS) delete globalThis[key];
}

const position = (symbol, side, extra = {}) => ({
  id: 1,
  symbol,
  name: symbol,
  quantity: 1,
  availableQuantity: 1,
  avgCost: 100,
  leverage: 3,
  side,
  lastPrice: null,
  marketValue: null,
  unrealisedPnl: null,
  ...extra,
});

// ---- the command ------------------------------------------------------------

test("Paper Trader has one canonical slash command", () => {
  assert.equal(identity.PAPER_TRADER_COMMAND, "/agents:paper-trader");
  assert.equal(identity.PAPER_TRADER_AGENT_ID, "paper-trader");
  assert.equal(identity.PAPER_TRADER_AGENT_NAME, "Paper Trader");
  assert.equal(identity.paperTraderUserMessage("stop"), "/agents:paper-trader stop");
  assert.equal(identity.paperTraderUserMessage("  "), "/agents:paper-trader");
});

test("the command parser strips its own token, keeps the others, and ignores the rest", () => {
  assert.equal(identity.taskFromPaperTraderCommand("  /AGENTS:PAPER-TRADER  stop  "), "stop");
  // A bare token is the ordinary instruction here, not an empty task.
  assert.equal(identity.taskFromPaperTraderCommand("/agents:paper-trader"), "");
  // Stacked tokens survive so the capability resolver still sees them.
  assert.equal(
    identity.taskFromPaperTraderCommand("/skills:foo /agents:paper-trader how is it doing"),
    "/skills:foo how is it doing",
  );
  assert.equal(identity.taskFromPaperTraderCommand("/agents:stock-analyst NVDA"), null);
  assert.equal(identity.taskFromPaperTraderCommand("what is bitcoin doing"), null);
});

test("a message to the desk is only ever start, stop or show", () => {
  assert.equal(identity.paperTraderIntent(""), "start");
  assert.equal(identity.paperTraderIntent("go"), "start");
  assert.equal(identity.paperTraderIntent("stop trading"), "stop");
  assert.equal(identity.paperTraderIntent("shut down the desk"), "stop");
  assert.equal(identity.paperTraderIntent("how is it doing"), "status");
  assert.equal(identity.paperTraderIntent("show me the portfolio"), "status");
  // Prose never becomes a parameter: anything unrecognised opens the desk
  // rather than being forwarded somewhere as a prompt.
  assert.equal(identity.paperTraderIntent("buy me a lot of dogecoin right now"), "start");
});

test("every offered coin is one the arena can actually price and trade", () => {
  const clone = source("../open-alpha-arena/backend/src/services/aiDecision.ts");
  for (const entry of identity.PAPER_TRADER_SYMBOLS) {
    assert.match(
      clone,
      new RegExp(`^\\s*${entry.value}:\\s*'`, "m"),
      `${entry.value} is offered but is not in the clone's SUPPORTED_SYMBOLS`,
    );
    assert.equal(identity.tickerFor(entry.value), `${entry.value}-USD`);
  }
});

// ---- company shares ---------------------------------------------------------

test("a stock list is read the way people actually paste one", () => {
  assert.deepEqual(identity.parseStockTickers("NVDA, AAPL MSFT\nBRK.B; RDS-A"), [
    "NVDA",
    "AAPL",
    "MSFT",
    "BRK.B",
    "RDS-A",
  ]);
  assert.deepEqual(identity.parseStockTickers("nvda,NVDA"), ["NVDA"], "duplicates collapse");
  // A ticker reaches a data vendor as a URL path component, so the shape is
  // pinned rather than trusted.
  assert.deepEqual(identity.parseStockTickers("../etc/passwd, <script>, 1234, ''"), []);
  // A coin and a company cannot share a symbol: the arena keys a position by
  // symbol alone, so one register entry per symbol is the whole invariant.
  assert.deepEqual(identity.parseStockTickers("BTC, ETH, NVDA"), ["NVDA"]);
  assert.deepEqual(identity.parseStockTickers(""), []);
  assert.deepEqual(identity.parseStockTickers(null), []);
  assert.equal(identity.parseStockTickers("A B C D E F G H I J K L M N", 3).length, 3);
});

test("the register tells coins and companies apart, and the vendors agree", () => {
  const instruments = identity.instrumentsFor({ symbols: ["BTC", "ETH"], stocks: ["NVDA"] });
  assert.deepEqual(
    instruments.map((entry) => `${entry.symbol}:${entry.kind}`),
    ["BTC:CRYPTO", "ETH:CRYPTO", "NVDA:EQUITY"],
  );
  assert.equal(identity.kindOf("NVDA", instruments), "EQUITY");
  assert.equal(identity.kindOf("BTC", instruments), "CRYPTO");
  // Safe non-coin tickers are automatic equity candidates; no settings
  // allowlist is required before a company can be analysed.
  assert.equal(identity.kindOf("TSLA", instruments), "EQUITY");
  // A coin carries its quote currency to the vendors; a listed company does not.
  assert.equal(identity.tickerFor("BTC", "CRYPTO"), "BTC-USD");
  assert.equal(identity.tickerFor("NVDA", "EQUITY"), "NVDA");
});

test("shares are bought outright, however much leverage the settings allow", () => {
  const settings = settingsModule.paperTraderSettingsFrom({
    symbols: ["btc"],
    stocks: "NVDA",
    leverage: 5,
    positionSize: 25,
  });
  const instruments = settingsModule.instrumentsOf(settings);
  assert.deepEqual(settings.stocks, ["NVDA"]);

  const coin = decisions.decisionFor({
    verdict: "BUY",
    symbol: "BTC",
    reasoning: "",
    positions: [],
    settings,
    instruments,
  });
  assert.equal(coin.leverage, 5);

  // The arena's leverage path is a crypto perpetual desk — hourly interest on
  // borrowed notional, a taker fee, a 50x ceiling — and none of it describes a
  // margin account at an equity broker.
  const share = decisions.decisionFor({
    verdict: "BUY",
    symbol: "NVDA",
    reasoning: "",
    positions: [],
    settings,
    instruments,
  });
  assert.equal(share.leverage, 1);
  assert.equal(share.operation, "open");
  assert.equal(share.target_portion_of_balance, 0.25);
});

test("the rotation covers companies as well as coins", () => {
  const settings = settingsModule.paperTraderSettingsFrom({
    symbols: ["btc"],
    stocks: "NVDA, AAPL",
  });
  assert.equal(decisions.chooseSymbol(settings, [], []), "BTC");
  assert.equal(decisions.chooseSymbol(settings, [], ["BTC"]), "NVDA");
  assert.equal(decisions.chooseSymbol(settings, [], ["NVDA", "BTC"]), "AAPL");
  // A directory candidate is eligible even though it was never stored in the
  // old manual ticker field.
  assert.equal(decisions.chooseSymbol(SETTINGS, [], ["BTC", "ETH", "SOL"], ["TSLA"]), "TSLA");
});

test("the automatic universe keeps company shares and rejects non-company issues", () => {
  const nasdaq = [
    "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
    "AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N",
    "FAKE|Fake Test Security|Q|Y|N|100|N|N",
    "QQQ|Invesco QQQ Trust|Q|N|N|100|Y|N",
    "ACMEW|Acme Corp. Warrant|S|N|N|100|N|N",
    "File Creation Time: 0810202617:00|||||||",
  ].join("\n");
  assert.deepEqual(equityUniverse.parseEquityDirectory(nasdaq), [
    { symbol: "AAPL", name: "Apple Inc. - Common Stock" },
  ]);

  const listings = [
    { symbol: "AAPL", name: "Apple" },
    { symbol: "MSFT", name: "Microsoft" },
  ];
  const chosen = equityUniverse.chooseAutomaticEquity(listings, ["AAPL"], 10);
  assert.equal(chosen.symbol, "MSFT", "a recently analysed company was repeated");
});

test("the arena is handed one register, and it round-trips", async () => {
  const { deskSymbolsEnv } = await import("../src/lib/paper-trader/overlay.ts");
  const env = deskSymbolsEnv([
    { symbol: "btc", kind: "CRYPTO", name: "Bitcoin" },
    { symbol: "NVDA", kind: "EQUITY", name: "NVIDIA Corporation" },
  ]);
  assert.equal(env, "BTC|CRYPTO|Bitcoin,NVDA|EQUITY|NVIDIA Corporation");
  // The separator has to be one neither a ticker nor a company name uses, and a
  // name that contains one anyway must not be able to forge a second entry.
  const forged = deskSymbolsEnv([{ symbol: "X", kind: "EQUITY", name: "Evil,Corp|CRYPTO|Fake" }]);
  assert.equal(forged.split(",").length, 1);
  assert.equal(forged.split("|").length, 3);
});

test("a share is only traded while its exchange is open", () => {
  const route = source("src/app/api/paper-trader/decide/chat/completions/route.ts");
  // Yahoo keeps quoting Friday's close all weekend, so without this the desk
  // would fill against a market that cannot move.
  assert.match(route, /kindOf\(ready\.symbol, instruments\) === "EQUITY"/);
  assert.match(route, /marketStatus\(base, ready\.symbol\)/);
  assert.match(route, /shut && !shut\.open/);
  const equity = source("../scripts/paper-trader-overlay/equity.ts");
  // Only the regular session counts: a paper fill at a thin pre-market print is
  // the kind of thing that flatters a record and means nothing.
  assert.match(equity, /result\.state === 'REGULAR'/);
  // Closed-market companies are also skipped before a slow analysis begins, so
  // the overnight desk keeps cycling through its always-open crypto universe.
  const selectionAt = route.indexOf("let automaticEquity =", route.indexOf("recentlyAnalysed"));
  const chooseAt = route.indexOf("const symbol = chooseSymbol", selectionAt);
  const selection = route.slice(selectionAt, chooseAt);
  assert.match(selection, /marketStatus\(base, automaticEquity\.symbol\)/);
  assert.match(selection, /if \(!session\?\.open\) automaticEquity = null/);
});

test("the desk card makes automatic stock trading visible", () => {
  const card = source("src/app/components/hermes/inline-paper-trader-run.tsx");
  assert.match(card, /U\.S\. shares auto/);
});

test("the desk card explains analysis, safeguards, and execution as one decision path", () => {
  const decide = source("src/app/api/paper-trader/decide/chat/completions/route.ts");
  const snapshot = source("src/app/api/paper-trader/snapshot/route.ts");
  const card = source("src/app/components/hermes/inline-paper-trader-run.tsx");

  // Store the facts at decision time. Reconstructing the chair's confidence or
  // the risk officer's intervention from a later portfolio snapshot is wrong.
  assert.match(decide, /mappedVerdict: action\.verdict/);
  assert.match(decide, /chairConfidence: chair\.confidence/);
  assert.match(decide, /selectedAllocation:/);
  assert.match(decide, /marketState: shut\?\.state \?\? null/);
  assert.match(decide, /marketBlocked: Boolean\(shut && !shut\.open\)/);
  assert.match(decide, /riskIntervention: constrained\.intervention/);

  // Join the final payload to the arena log by its stable reason, and classify
  // automatic equities even though they were not typed into settings.
  assert.match(snapshot, /function decisionActivity\(/);
  assert.match(snapshot, /entry\.reason === reason/);
  assert.match(snapshot, /kind: kindOf\(record\.symbol, instruments\)/);
  assert.match(snapshot, /auditedMarketBlocked \?\?/);
  assert.match(snapshot, /marketState\.toUpperCase\(\) !== "REGULAR"/);
  assert.match(snapshot, /estimatedNotional/);
  assert.match(snapshot, /estimatedMargin/);
  assert.match(snapshot, /activity: decisionActivity\(recentRecords, tables\.decisions/);

  // What a person sees is the same sequence the desk followed.
  assert.match(card, /Decision activity/);
  assert.match(card, /Rotation: \{snapshot\.analysis\.rotation\.label\}/);
  assert.match(card, /mappedActionLabel\(activity\)/);
  assert.match(card, /Chair: \{activity\.chairVerdict\}/);
  assert.match(card, /Market: \{activity\.marketState\.toLowerCase\(\)\}/);
  assert.match(card, /Risk: \{activity\.riskIntervention \|\| activity\.riskStance\}/);
  assert.match(card, /activity\.targetPortion \* 100/);
  assert.match(card, /activity\.estimatedNotional/);
  assert.match(card, /activity\.estimatedMargin/);
});

test("the equity feed needs no account, and refuses what it cannot book", () => {
  const equity = source("../scripts/paper-trader-overlay/equity.ts");
  // The whole reason this module exists rather than one of the alternatives.
  assert.ok(
    !/API_KEY|apiKey|api_key|token/i.test(equity),
    "the equity feed reads a credential from somewhere",
  );
  assert.match(equity, /yahoo-finance2/);
  // One cash balance and no FX, so a share quoted in euros would be added to a
  // dollar book at face value and every return figure would be wrong.
  assert.match(equity, /currency && currency !== 'USD'/);
});

test("the patch set is anchored, and refuses to half-apply", async () => {
  const { PATCHES, applyPatch, PatchError } = await import("../src/lib/paper-trader/overlay.ts");
  assert.ok(PATCHES.length > 0);
  for (const patch of PATCHES) {
    assert.ok(patch.name && patch.anchor && patch.replacement, `${patch.file} has an empty patch`);
    // Applying one to a file that does not contain it must fail loudly: a
    // silently skipped patch is an arena that compiles and cannot price a share.
    assert.throws(() => applyPatch("nothing here", patch), PatchError);
    // And to one that contains it twice, for the same reason.
    assert.throws(() => applyPatch(`${patch.anchor}\n${patch.anchor}`, patch), PatchError);
    assert.equal(applyPatch(patch.anchor, patch), patch.replacement);
  }
});

test("every anchor still matches the clone exactly once", async () => {
  const { PATCHES } = await import("../src/lib/paper-trader/overlay.ts");
  for (const patch of PATCHES) {
    const file = path.join(
      dashboardRoot,
      "..",
      "open-alpha-arena",
      "backend",
      "src",
      ...patch.file.split("/"),
    );
    if (!fs.existsSync(file)) continue; // The clone is optional in CI.
    const contents = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    assert.equal(
      contents.split(patch.anchor).length - 1,
      1,
      `patch "${patch.name}" no longer matches the clone — update lib/paper-trader/overlay.ts`,
    );
  }
});

test("the build never writes into the user's checkout", () => {
  const setup = source("src/lib/paper-trader/setup.ts");
  const runtime = source("src/lib/paper-trader/runtime.ts");
  // Everything is staged into Breadboard's own workspace and compiled there.
  assert.match(setup, /workspaceDirectory\(\)/);
  assert.match(runtime, /stateHome\(\), "backend"/);
  // The clone's backend directory may be read from, never installed into.
  assert.ok(
    !/cwd:\s*backendDirectory/.test(setup),
    "a command runs with the user's checkout as its working directory",
  );
});

// ---- settings ---------------------------------------------------------------

test("stored settings are read back, and unknown values fall back to the defaults", () => {
  const read = settingsModule.paperTraderSettingsFrom({
    startingCapital: 25_000,
    symbols: ["ETH", "nonsense", "BTC"],
    cycleMinutes: "30",
    positionSize: 35,
    leverage: 4,
    allowShorts: false,
    analysts: ["news", "sentiment"],
    researchDepth: 2,
    riskRounds: 3,
  });
  assert.equal(read.startingCapital, 25_000);
  // Catalog order, not the order they were listed in, so the rotation is stable.
  assert.deepEqual(read.symbols, ["BTC", "ETH"]);
  assert.equal(read.cycleMinutes, 30);
  // The page asks for a percentage; the arena wants the fraction.
  assert.equal(read.positionSize, 0.35);
  assert.equal(read.leverage, 4);
  assert.equal(read.allowShorts, false);
  // "sentiment" is the label; "social" is the wire key the graph indexes by.
  assert.deepEqual(read.analysts, ["social", "news"]);
  assert.equal(read.researchDepth, 2);
  assert.equal(read.riskRounds, 3);

  const empty = settingsModule.paperTraderSettingsFrom({});
  assert.deepEqual(empty, SETTINGS);

  const nonsense = settingsModule.paperTraderSettingsFrom({
    startingCapital: "not a number",
    symbols: ["nothing"],
    cycleMinutes: 7,
    positionSize: 900,
    leverage: 40,
    analysts: ["fundamentals"],
  });
  assert.equal(nonsense.startingCapital, settingsModule.DEFAULT_STARTING_CAPITAL);
  assert.deepEqual(nonsense.symbols, SETTINGS.symbols);
  assert.equal(nonsense.cycleMinutes, SETTINGS.cycleMinutes);
  assert.equal(nonsense.positionSize, 1);
  assert.equal(nonsense.leverage, 10);
  // Fundamentals is not offered for a coin, so it cannot arrive through settings.
  assert.deepEqual(nonsense.analysts, SETTINGS.analysts);
});

test("starting capital is bounded on both sides", () => {
  const low = settingsModule.paperTraderSettingsFrom({ startingCapital: 1 });
  const high = settingsModule.paperTraderSettingsFrom({ startingCapital: 99_000_000 });
  assert.equal(low.startingCapital, settingsModule.MIN_STARTING_CAPITAL);
  assert.equal(high.startingCapital, settingsModule.MAX_STARTING_CAPITAL);
});

test("the settings page and the runtime agree on what a setting is called", async () => {
  const { findConfigurableAgent } = await import("../src/lib/agent-settings/catalog.ts");
  const { agentSettingDefaults } = await import("../src/lib/agent-settings/catalog.ts");
  const agent = findConfigurableAgent(identity.PAPER_TRADER_AGENT_ID);
  assert.ok(agent, "Paper Trader has no settings entry");
  assert.equal(agent.command, identity.PAPER_TRADER_COMMAND);
  // The catalog's own shipped values have to survive the translation unchanged,
  // or a user who never opened the page runs on something else.
  assert.deepEqual(settingsModule.paperTraderSettingsFrom(agentSettingDefaults(agent)), SETTINGS);
  // The catalog folds every stored multiselect value to lower case, so an option
  // written in caps normalises to nothing and the setting silently empties. The
  // coin list is the one place here that could be written either way.
  const { normalizeAgentSettings } = await import("../src/lib/agent-settings/catalog.ts");
  for (const field of agent.fields.filter((entry) => entry.kind === "multiselect")) {
    for (const option of field.options) {
      assert.equal(
        option.value,
        option.value.toLowerCase(),
        `${field.key}: "${option.value}" cannot survive the catalog's normaliser`,
      );
    }
  }
  assert.deepEqual(normalizeAgentSettings(agent, agentSettingDefaults(agent)), agentSettingDefaults(agent));

  const capital = agent.fields.find((field) => field.key === "startingCapital");
  assert.ok(capital, "starting capital is not editable");
  assert.equal(capital.kind, "number");
  assert.equal(capital.default, settingsModule.DEFAULT_STARTING_CAPITAL);
  // The consequence has to be on the page: changing it opens a new portfolio.
  assert.match(capital.help, /fresh portfolio/i);
  assert.equal(
    agent.fields.some((field) => field.key === "stocks"),
    false,
    "the settings page still asks people to type an equity allowlist",
  );
});

test("shorting permission reaches only Paper Trader's TradingAgents run", () => {
  const decisionRunner = source("src/lib/paper-trader/decisions.ts");
  const bridge = source("../scripts/tradingagents-bridge.py");
  const defaults = source("../TradingAgents/tradingagents/default_config.py");
  const graph = source("../TradingAgents/tradingagents/graph/trading_graph.py");
  const setup = source("../TradingAgents/tradingagents/graph/setup.py");

  assert.match(decisionRunner, /paperTraderAllowShorts:\s*settings\.allowShorts/);
  assert.match(
    bridge,
    /config\["paper_trader_allow_shorts"\]\s*=\s*job\.get\("paperTraderAllowShorts"\) is True/,
  );
  // Missing/false flags retain the clone's normal long-only Portfolio Manager.
  assert.match(defaults, /"paper_trader_allow_shorts": False/);
  assert.match(
    graph,
    /paper_trader_allow_shorts=\(\s*self\.config\.get\("paper_trader_allow_shorts"\) is True\s*\)/,
  );
  assert.match(
    setup,
    /create_portfolio_manager\(\s*self\.deep_thinking_llm,\s*paper_trader_allow_shorts=self\.paper_trader_allow_shorts/,
  );
});

// ---- a verdict becomes an order --------------------------------------------

test("a verdict is read against the position as it stands, not as it was", () => {
  const open = decisions.decisionFor({
    verdict: "BUY",
    symbol: "BTC",
    reasoning: "Momentum is intact and funding is neutral.",
    positions: [],
    settings: SETTINGS,
  });
  assert.equal(open.operation, "open");
  assert.equal(open.direction, "long");
  assert.equal(open.symbol, "BTC");
  assert.equal(open.target_portion_of_balance, SETTINGS.positionSize);
  assert.equal(open.leverage, SETTINGS.leverage);
  assert.match(open.reason, /^TradingAgents: BUY BTC\./);

  // A BUY on a coin already held long is not a second position: the arena
  // allows one per coin and would refuse it.
  const already = decisions.decisionFor({
    verdict: "BUY",
    symbol: "BTC",
    reasoning: "",
    positions: [position("BTC", "LONG")],
    settings: SETTINGS,
  });
  assert.equal(already.operation, "hold");

  // A BUY while short closes the short, whole, at the position's own leverage.
  const cover = decisions.decisionFor({
    verdict: "BUY",
    symbol: "BTC",
    reasoning: "",
    positions: [position("BTC", "SHORT")],
    settings: SETTINGS,
  });
  assert.equal(cover.operation, "close");
  assert.equal(cover.direction, "short");
  assert.equal(cover.target_portion_of_balance, 1);
  assert.equal(cover.leverage, 3);

  const exit = decisions.decisionFor({
    verdict: "SELL",
    symbol: "ETH",
    reasoning: "",
    positions: [position("ETH", "LONG")],
    settings: SETTINGS,
  });
  assert.equal(exit.operation, "close");
  assert.equal(exit.direction, "long");

  const short = decisions.decisionFor({
    verdict: "SELL",
    symbol: "ETH",
    reasoning: "",
    positions: [],
    settings: SETTINGS,
  });
  assert.equal(short.operation, "open");
  assert.equal(short.direction, "short");

  const noShorting = decisions.decisionFor({
    verdict: "SELL",
    symbol: "ETH",
    reasoning: "",
    positions: [],
    settings: { ...SETTINGS, allowShorts: false },
  });
  assert.equal(noShorting.operation, "hold");
  assert.match(noShorting.reason, /Shorting is turned off/);

  const hold = decisions.decisionFor({
    verdict: "HOLD",
    symbol: "SOL",
    reasoning: "",
    positions: [],
    settings: SETTINGS,
  });
  assert.equal(hold.operation, "hold");
  assert.equal(hold.target_portion_of_balance, 0);
});

test("the decision the arena receives is exactly the shape its own path parses", () => {
  const clone = source("../open-alpha-arena/backend/src/services/tradingCommands.ts");
  const made = decisions.decisionFor({
    verdict: "BUY",
    symbol: "BTC",
    reasoning: "",
    positions: [],
    settings: SETTINGS,
  });
  // Every field the clone reads off the decision has to be one this produces.
  for (const key of [
    "operation",
    "symbol",
    "direction",
    "target_portion_of_balance",
    "leverage",
    "reason",
  ]) {
    assert.ok(clone.includes(`decision.${key}`), `the clone does not read ${key}`);
    assert.ok(key in made, `the decision does not carry ${key}`);
  }
  // And the clone refuses anything outside these three operations.
  assert.match(clone, /\['open', 'close', 'hold'\]\.includes\(operation\)/);
  assert.ok(["open", "close", "hold"].includes(made.operation));
});

test("the rotation looks at whatever has been waiting longest, held coins included", () => {
  // Nothing analysed yet: the first configured coin.
  assert.equal(decisions.chooseSymbol(SETTINGS, [], []), "BTC");
  // BTC was the most recent, so it sorts last.
  assert.equal(decisions.chooseSymbol(SETTINGS, [], ["BTC"]), "ETH");
  assert.equal(decisions.chooseSymbol(SETTINGS, [], ["ETH", "BTC"]), "SOL");
  // A held coin the settings no longer list is still in play — otherwise its
  // position could never be closed.
  assert.equal(
    decisions.chooseSymbol({ ...SETTINGS, symbols: ["BTC"] }, ["DOGE"], ["BTC"]),
    "DOGE",
  );
  assert.equal(decisions.chooseSymbol({ ...SETTINGS, symbols: [] }, [], []), null);
});

// ---- the durable half -------------------------------------------------------

function freshDb() {
  const db = new Database(":memory:");
  // The desk records who started it, so the table that owns that reference has
  // to exist here the way it does on the real app database.
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT);");
  db.prepare("INSERT INTO users (id, username) VALUES (7, 'tester')").run();
  return db;
}

function freshStore() {
  return new PaperTraderStore(freshDb());
}

test("the desk's intent survives, because that is what a restart reads", () => {
  const store = freshStore();
  assert.equal(store.state().enabled, false);
  const pinned = { ...SETTINGS, cycleMinutes: 5 };
  store.markEnabled({
    userId: 7,
    callbackOrigin: "http://127.0.0.1:9129",
    settings: pinned,
  });
  assert.equal(store.state().enabled, true);
  assert.equal(store.state().ownerUserId, 7);
  assert.equal(store.state().callbackOrigin, "http://127.0.0.1:9129");
  assert.deepEqual(store.state().runSettings, pinned);
  store.recordAccount({ accountId: 3, capital: 25_000 });
  assert.equal(store.state().accountId, 3);
  assert.equal(store.state().accountCapital, 25_000);
  store.markDisabled();
  assert.equal(store.state().enabled, false);
  // Stopping does not forget the portfolio: starting again resumes it.
  assert.equal(store.state().accountId, 3);
});

test("the simulated arena never inherits broker or model credentials", async () => {
  const { paperTraderEnv } = await import("../src/lib/paper-trader/runtime.ts");
  const env = paperTraderEnv(
    { DATABASE_PATH: "paper.db" },
    {
      PATH: "C:\\tools",
      ALPACA_API_KEY: "must-not-cross",
      IBKR_TOKEN: "must-not-cross",
      OPENAI_API_KEY: "must-not-cross",
    },
  );
  assert.equal(env.PATH, "C:\\tools");
  assert.equal(env.DATABASE_PATH, "paper.db");
  assert.equal(env.ALPACA_API_KEY, undefined);
  assert.equal(env.IBKR_TOKEN, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
});

test("startup does not waste the first cycle, and the configured schedule reaches the arena", () => {
  const route = source("src/app/api/paper-trader/decide/chat/completions/route.ts");
  assert.match(route, /if \(!state\.enabled\)/);
  assert.doesNotMatch(route, /!state\.enabled \|\| state\.accountId === null/);
  assert.match(route, /state\.accountId === null[\s\S]*positions: \[\]/);

  const supervisor = source("src/lib/paper-trader/supervisor.ts");
  assert.match(supervisor, /options\.settings\.cycleMinutes/);
  const service = source("src/lib/paper-trader/service.ts");
  assert.match(service, /DESK_CYCLE_SECONDS: String\(cycleSeconds\)/);
  const overlay = source("src/lib/paper-trader/overlay.ts");
  assert.match(overlay, /process\.env\.DESK_CYCLE_SECONDS/);
});

test("one analysis at a time, and a prepared verdict is served exactly once", () => {
  const store = freshStore();
  const first = store.claimAnalysis("btc");
  assert.equal(typeof first, "number");
  assert.equal(store.pendingDecision().symbol, "BTC");
  // A cycle that overlaps a slow analysis waits rather than starting a second.
  assert.equal(store.claimAnalysis("ETH"), null);

  assert.equal(store.takeReadyDecision(), null);
  store.settleAnalysis({
    id: first,
    rating: "BUY",
    decision: { verdict: "BUY", symbol: "BTC" },
    reasoning: "Because.",
  });
  const taken = store.takeReadyDecision();
  assert.equal(taken.rating, "BUY");
  assert.equal(taken.symbol, "BTC");
  // Served twice would place the same trade twice.
  assert.equal(store.takeReadyDecision(), null);
  assert.equal(store.pendingDecision(), null);

  const second = store.claimAnalysis("ETH");
  store.failAnalysis(second, "yfinance said no");
  assert.equal(store.takeReadyDecision(), null);
  assert.equal(store.recentDecisions()[0].state, "failed");
  // Newest first, which is what the rotation reads staleness from.
  assert.deepEqual(store.recentlyAnalysedSymbols(), ["ETH", "BTC"]);
});

test("stopping discards every decision that has not been served yet", () => {
  const store = freshStore();
  const pending = store.claimAnalysis("BTC");
  assert.equal(typeof pending, "number");
  const ready = store.claimAnalysis("ETH");
  assert.equal(ready, null, "the store allowed two analyses at once");
  store.settleAnalysis({
    id: pending,
    rating: "UNDERWEIGHT",
    decision: { verdict: "UNDERWEIGHT", symbol: "BTC" },
    reasoning: "Bearish.",
  });
  const next = store.claimAnalysis("ETH");
  assert.equal(typeof next, "number");

  assert.equal(store.failUnservedAnalyses("desk stopped"), 2);
  assert.equal(store.takeReadyDecision(), null);
  assert.equal(store.pendingDecision(), null);
  assert.ok(store.recentDecisions(2).every((decision) => decision.state === "failed"));
});

test("a decision request already in flight cannot launch analysis after Stop", () => {
  const store = freshStore();
  assert.equal(store.claimAnalysisIfEnabled("BTC"), null);
  store.markEnabled({
    userId: 7,
    callbackOrigin: "http://127.0.0.1:9129",
    settings: SETTINGS,
  });
  const claimed = store.claimAnalysisIfEnabled("BTC");
  assert.equal(typeof claimed, "number");
  store.failUnservedAnalyses("desk stopped");
  store.markDisabled();
  assert.equal(store.claimAnalysisIfEnabled("ETH"), null);
});

test("an analysis orphaned by a restart is written off so the next cycle can run", () => {
  const db = freshDb();
  const store = new PaperTraderStore(db);
  const claimed = store.claimAnalysis("BTC");
  // A live analysis is never swept, whatever the caller asks for: an argument of
  // zero would otherwise kill the run that is still going.
  assert.equal(store.failStaleAnalyses(60), 0, "a fresh analysis was swept");
  assert.equal(store.failStaleAnalyses(0), 0, "the sweep has no lower bound");
  assert.equal(store.claimAnalysis("ETH"), null);

  // The child process died with the app an hour ago; nothing is waiting on it.
  db.prepare(
    "UPDATE paper_trader_decisions SET requested_at = datetime('now', '-90 minutes') WHERE id = ?",
  ).run(claimed);
  assert.equal(store.failStaleAnalyses(35), 1);
  assert.equal(store.pendingDecision(), null);
  assert.equal(store.recentDecisions()[0].id, claimed);
  assert.match(store.recentDecisions()[0].error, /restarted/);
  assert.equal(typeof store.claimAnalysis("ETH"), "number");
});

// ---- the committee ----------------------------------------------------------

test("the desk seats every trading capability Breadboard has, and says which", async () => {
  const { SEATS } = await import("../src/lib/paper-trader/committee.ts");
  const { RUNTIME_AGENT_PROFILES } = await import("../src/lib/hermes/capability-combinations.ts");
  const seated = SEATS.map((seat) => seat.id);
  assert.deepEqual(seated, ["trading-agent", "vibe-trading", "stock-analyst", "risk"]);
  // Every advisory seat is a real Breadboard agent, not a name invented here.
  for (const id of ["trading-agent", "vibe-trading", "stock-analyst"]) {
    assert.ok(
      RUNTIME_AGENT_PROFILES.some((agent) => agent.id === id),
      `${id} is seated on the desk but is not a Breadboard agent`,
    );
  }
});

test("an adviser is consulted on its own slow clock, and only by one cycle at a time", () => {
  const db = freshDb();
  const store = new PaperTraderStore(db);
  const settings = settingsModule.paperTraderSettingsFrom({
    cycleMinutes: "15",
    adviceEveryCycles: 8,
  });
  const maxAge = settings.cycleMinutes * settings.adviceEveryCycles;

  assert.equal(store.claimAdvice("vibe-trading", maxAge), true, "a seat with no note is asked");
  // A second cycle overlapping the first must not start another consultation.
  assert.equal(store.claimAdvice("vibe-trading", maxAge), false);
  assert.equal(store.adviceFor("vibe-trading").pending, true);

  store.recordAdvice({ seat: "vibe-trading", stance: "note", note: "Choppy.\nREGIME: chop" });
  const recorded = store.adviceFor("vibe-trading");
  assert.equal(recorded.pending, false);
  assert.equal(recorded.stance, "note");
  // And a fresh note is not re-asked on the very next cycle.
  assert.equal(store.claimAdvice("vibe-trading", maxAge), false);

  store.failAdvice("vibe-trading", "the service would not start");
  assert.equal(store.adviceFor("vibe-trading").stance, "abstain");
  // A transient model/relay failure should not leave the seat unavailable for
  // the full multi-cycle note TTL. It gets a short backoff, then the next desk
  // cycle may ask again and clears the stale error while it does so.
  assert.equal(store.claimAdvice("vibe-trading", maxAge), false);
  db
    .prepare(
      "UPDATE paper_trader_advice SET updated_at = datetime('now', '-2 minutes') WHERE seat = ?",
    )
    .run("vibe-trading");
  assert.equal(store.claimAdvice("vibe-trading", maxAge), true);
  assert.equal(store.adviceFor("vibe-trading").error, "");
});

test("an adviser left mid-consultation by a restart is released", () => {
  const db = freshDb();
  const store = new PaperTraderStore(db);
  store.claimAdvice("stock-analyst", 60);
  assert.equal(store.releaseStaleAdvice(30), 0, "a live consultation was released");
  db.prepare(
    "UPDATE paper_trader_advice SET asked_at = datetime('now', '-120 minutes') WHERE seat = ?",
  ).run("stock-analyst");
  assert.equal(store.releaseStaleAdvice(30), 1);
  assert.equal(store.adviceFor("stock-analyst").pending, false);
  assert.match(store.adviceFor("stock-analyst").error, /restarted/);
});

test("the adviser briefs never ask an agent about something it cannot see", async () => {
  const committee = source("src/lib/paper-trader/committee.ts");
  // The Stock Analyst's data sources are equity markets across six exchanges.
  // Asking it about a coin would produce an answer with nothing behind it.
  assert.match(committee, /Do not mention cryptocurrency/);
  // And Vibe Trading is a research loop, not a trade desk.
  assert.match(committee, /Do not recommend a specific trade/);
  assert.match(committee, /\$\{symbol\}-USD/);
  assert.doesNotMatch(committee, /\$\{symbol\}\/USD/);
});

test("the chair's answer is read out of whatever wrapping the model used", async () => {
  const { parseVerdict } = await import("../src/lib/paper-trader/committee.ts");
  assert.deepEqual(parseVerdict('{"verdict":"BUY","confidence":0.8,"rationale":"Momentum."}'), {
    verdict: "BUY",
    confidence: 0.8,
    rationale: "Momentum.",
  });
  assert.equal(
    parseVerdict('```json\n{"verdict":"sell","confidence":2,"rationale":""}\n```').verdict,
    "SELL",
  );
  // Confidence is clamped, not trusted.
  assert.equal(parseVerdict('{"verdict":"sell","confidence":2}').confidence, 1);
  assert.equal(parseVerdict('{"verdict":"x","confidence":"nope"}').confidence, 0.5);
  assert.equal(parseVerdict('{"verdict":"x"}').verdict, "HOLD");
  assert.equal(parseVerdict("no json here"), null);
});

// ---- the risk officer -------------------------------------------------------

const trade = (id, symbol, side, price, quantity, commission = 0, interestCharged = 0) => ({
  id,
  symbol,
  side,
  price,
  quantity,
  commission,
  interestCharged,
  tradeTime: `2026-08-10 12:0${id}:00`,
});

test("realised profit is reconstructed from the fills that actually happened", async () => {
  const { readHistory } = await import("../src/lib/paper-trader/risk.ts");
  // A long round trip: bought at 100, sold at 110, a dollar of fees each way.
  const won = readHistory([
    trade(1, "BTC", "BUY", 100, 1, 1),
    trade(2, "BTC", "SELL", 110, 1, 1),
  ]);
  assert.equal(Math.round(won.realised * 100) / 100, 8);
  assert.equal(won.bySymbol.BTC.losingStreak, 0);

  // A short round trip that went the wrong way: sold at 100, bought back at 120.
  const lost = readHistory([
    trade(1, "ETH", "SELL", 100, 2),
    trade(2, "ETH", "BUY", 120, 2),
  ]);
  assert.equal(lost.realised, -40);
  assert.equal(lost.bySymbol.ETH.losingStreak, 1);

  // Losses in a row are what the cooldown counts, and a win resets it.
  const streak = readHistory([
    trade(1, "SOL", "BUY", 100, 1),
    trade(2, "SOL", "SELL", 90, 1),
    trade(3, "SOL", "BUY", 100, 1),
    trade(4, "SOL", "SELL", 80, 1),
    trade(5, "SOL", "BUY", 100, 1),
    trade(6, "SOL", "SELL", 130, 1),
  ]);
  assert.equal(streak.bySymbol.SOL.losingStreak, 0);
  assert.equal(streak.bySymbol.SOL.realised, 0 - 10 - 20 + 30);
});

test("the leverage executor's four wire sides and settled interest reach P&L", async () => {
  const { readHistory } = await import("../src/lib/paper-trader/risk.ts");

  // Actual arena shape: LONG opens and SELL closes a long.
  const long = readHistory([
    trade(1, "BTC", "LONG", 100, 2, 1),
    trade(2, "BTC", "SELL", 110, 2, 1, 3),
  ]);
  assert.equal(long.realised, 15, "long P&L omitted a fee or settled interest");

  // Actual arena shape: SHORT opens and BUY closes a short. Previously SHORT
  // was treated as another buy, so this loss/win could never be realised.
  const short = readHistory([
    trade(1, "ETH", "SHORT", 100, 2, 1),
    trade(2, "ETH", "BUY", 80, 2, 1, 3),
  ]);
  assert.equal(short.realised, 35, "short P&L was reconstructed in the wrong direction");
  assert.equal(short.bySymbol.ETH.losingStreak, 0);
});

test("arena trade reads deduplicate taker fees, retain interest, and are unbounded for risk", async () => {
  const arena = await import("../src/lib/paper-trader/arena.ts");
  const cache = path.join(dashboardRoot, "node_modules", ".cache");
  fs.mkdirSync(cache, { recursive: true });
  const directory = fs.mkdtempSync(path.join(cache, "breadboard-paper-history-"));
  const database = path.join(directory, "arena.db");
  const previous = process.env.PAPER_TRADER_DATABASE_PATH;
  process.env.PAPER_TRADER_DATABASE_PATH = database;

  try {
    const db = new Database(database);
    db.exec(`CREATE TABLE trades (
      id INTEGER PRIMARY KEY,
      account_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      quantity REAL NOT NULL,
      commission REAL NOT NULL,
      taker_fee REAL NOT NULL,
      interest_charged REAL NOT NULL,
      trade_time TEXT
    )`);
    const insert = db.prepare(
      `INSERT INTO trades
       (id, account_id, symbol, side, price, quantity, commission, taker_fee, interest_charged, trade_time)
       VALUES (?, 7, 'BTC', 'LONG', 100, 1, 0.25, 0.25, 0.5, '2026-08-10 12:00:00')`,
    );
    for (let id = 1; id <= 25; id += 1) insert.run(id);
    db.close();

    const trades = arena.readTradeHistory(7);
    assert.equal(trades.length, 25, "lifetime history inherited a card display limit");
    assert.equal(trades[0].id, 25, "history no longer arrives newest-first");
    assert.equal(trades[0].commission, 0.25, "commission and duplicate taker fee were added");
    assert.equal(trades[0].interestCharged, 0.5);
  } finally {
    if (previous === undefined) delete process.env.PAPER_TRADER_DATABASE_PATH;
    else process.env.PAPER_TRADER_DATABASE_PATH = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("snapshot accounting is lifetime and arena credentials never cross to the browser", async () => {
  const arena = await import("../src/lib/paper-trader/arena.ts");
  const account = {
    id: 4,
    name: "TradingAgents",
    accountType: "AI",
    initialCapital: 10_000,
    currentCash: 9_500,
    frozenCash: 0,
    model: "tradingagents",
    baseUrl: "http://127.0.0.1/private-callback",
    apiKey: "never-return-this-token",
  };
  assert.deepEqual(arena.publicArenaAccounts([account]), [
    { id: 4, name: "TradingAgents", initialCapital: 10_000, currentCash: 9_500 },
  ]);
  assert.doesNotMatch(JSON.stringify(arena.publicArenaAccounts([account])), /private-callback|never-return/);

  const snapshot = source("src/app/api/paper-trader/snapshot/route.ts");
  const decision = source("src/app/api/paper-trader/decide/chat/completions/route.ts");
  assert.match(snapshot, /readHistory\(readTradeHistory\(status\.accountId\)\)/);
  assert.match(snapshot, /accounts: publicArenaAccounts\(accounts\)/);
  assert.match(decision, /readHistory\(lifetimeTrades\)/);
});

test("the risk officer can only ever reduce what the committee asked for", async () => {
  const { assessRisk, constrain, readHistory } = await import("../src/lib/paper-trader/risk.ts");
  const buy = () =>
    decisions.decisionFor({
      verdict: "BUY",
      symbol: "BTC",
      reasoning: "",
      positions: [],
      settings: SETTINGS,
    });
  const empty = readHistory([]);

  const healthy = assessRisk({ equity: 10_000, capital: 10_000, positions: [], settings: SETTINGS });
  assert.equal(healthy.stance, "open");
  assert.equal(
    constrain({ decision: buy(), symbol: "BTC", assessment: healthy, history: empty, settings: SETTINGS })
      .decision.operation,
    "open",
  );

  // Past the drawdown limit: closing only.
  const drawn = assessRisk({ equity: 7_000, capital: 10_000, positions: [], settings: SETTINGS });
  assert.equal(drawn.stance, "flat");
  const refused = constrain({
    decision: buy(),
    symbol: "BTC",
    assessment: drawn,
    history: empty,
    settings: SETTINGS,
  });
  assert.equal(refused.decision.operation, "hold");
  assert.match(refused.decision.reason, /drawdown limit/);
  // A close is never blocked, whatever the stance.
  const close = decisions.decisionFor({
    verdict: "SELL",
    symbol: "BTC",
    reasoning: "",
    positions: [position("BTC", "LONG")],
    settings: SETTINGS,
  });
  assert.equal(
    constrain({ decision: close, symbol: "BTC", assessment: drawn, history: empty, settings: SETTINGS })
      .decision.operation,
    "close",
  );

  // At the position limit: nothing new.
  const full = assessRisk({
    equity: 10_000,
    capital: 10_000,
    positions: [position("BTC", "LONG"), position("ETH", "LONG"), position("SOL", "LONG")],
    settings: SETTINGS,
  });
  assert.equal(full.stance, "reduce-only");
  assert.equal(
    constrain({ decision: buy(), symbol: "DOGE", assessment: full, history: empty, settings: SETTINGS })
      .decision.operation,
    "hold",
  );

  // And a coin that keeps losing is left alone, while the others are not.
  const bruised = readHistory([
    trade(1, "BTC", "BUY", 100, 1),
    trade(2, "BTC", "SELL", 90, 1),
    trade(3, "BTC", "BUY", 100, 1),
    trade(4, "BTC", "SELL", 90, 1),
    trade(5, "BTC", "BUY", 100, 1),
    trade(6, "BTC", "SELL", 90, 1),
  ]);
  const cooled = constrain({
    decision: buy(),
    symbol: "BTC",
    assessment: healthy,
    history: bruised,
    settings: SETTINGS,
  });
  assert.equal(cooled.decision.operation, "hold");
  assert.match(cooled.decision.reason, /three times in a row|3 times in a row/);
  assert.equal(
    constrain({ decision: buy(), symbol: "ETH", assessment: healthy, history: bruised, settings: SETTINGS })
      .decision.operation,
    "open",
  );
});

test("a committee that cannot agree does not trade", () => {
  const route = source("src/app/api/paper-trader/decide/chat/completions/route.ts");
  // The confidence threshold has to be applied before the order is built, and
  // the risk officer has to see the order last.
  assert.match(route, /chair\.confidence >= settings\.minConfidence \? chair\.verdict : "HOLD"/);
  const constrainAt = route.indexOf("constrain({");
  const decisionAt = route.indexOf("decisionFor({");
  assert.ok(decisionAt > 0 && constrainAt > decisionAt, "the risk officer does not have the last word");
});

test("the desk's balance is equity, not the arena's notional total", () => {
  const snapshot = source("src/app/api/paper-trader/snapshot/route.ts");
  const card = source("src/app/components/hermes/inline-paper-trader-run.tsx");
  const overlay = source("src/lib/paper-trader/overlay.ts");
  // The clone's own overview counts a leveraged position at its notional value:
  // a live 2x position on a flat market reported total assets of $32,497 against
  // $25,000 of capital and nothing earned. The card must not show that number.
  assert.match(snapshot, /const equity = capital \+ history\.realised \+ unrealised;/);
  assert.match(card, /label: "Balance", value: money\(equity \?\? capital\)/);
  assert.ok(
    !/overview\?\.totalAssets/.test(card),
    "the card is reading the arena's notional total again",
  );
  assert.doesNotMatch(
    card,
    /<td className=\{cell\}>\{money\(decision\.totalBalance\)\}<\/td>/,
    "the decision table is still presenting legacy leveraged exposure as balance",
  );
  assert.match(card, /"Target %",\s*"Leverage",\s*"Executed"/);
  assert.match(overlay, /calcPositionsMarketValue/);
  assert.match(overlay, /using cost basis for position equity/);
});

test("the position count survives a failed live overview", () => {
  const card = source("src/app/components/hermes/inline-paper-trader-run.tsx");
  assert.match(card, /label: "Positions", value: String\(snapshot\?\.positions\.length \?\? 0\)/);
  assert.doesNotMatch(card, /label: "Positions", value: String\(overview\?\.positionsCount/);
});

// ---- the boundary the whole design rests on ---------------------------------

test("the decision endpoint answers the shape the arena's model call reads", () => {
  const route = source("src/app/api/paper-trader/decide/chat/completions/route.ts");
  const clone = source("../open-alpha-arena/backend/src/services/aiDecision.ts");
  // The clone reads choices[0].message.content and parses it as JSON.
  assert.match(clone, /result\.choices/);
  assert.match(clone, /choice\?\.message/);
  assert.match(route, /choices:\s*\[/);
  assert.match(route, /message:\s*\{ role: "assistant", content: JSON\.stringify\(decision\) \}/);
  // And it posts to `${base_url}/chat/completions` with a bearer token, which is
  // where this route has to live and what it has to check.
  assert.match(clone, /\$\{baseUrl\}\/chat\/completions/);
  assert.match(clone, /Bearer \$\{account\.apiKey\}/);
  assert.match(route, /tokenMatches\(bearerFrom\(request\)\)/);
});

test("the desk is never started by anything but a decision someone made", () => {
  const autostart = source("src/lib/paper-trader/autostart.ts");
  // The boot hook only ever honours the stored flag; it must not set it.
  assert.match(autostart, /if \(!state\.enabled\) return;/);
  assert.ok(!/markEnabled/.test(autostart), "the keepalive enables a desk on its own");
  const instrumentation = source("src/instrumentation-node.ts");
  assert.match(instrumentation, /autostartPaperTrader\(\)/);
});

test("an account write that times out is verified, not treated as a failure", async () => {
  const { isTimeout } = await import("../src/lib/paper-trader/arena.ts");
  const supervisor = source("src/lib/paper-trader/supervisor.ts");
  const arena = source("src/lib/paper-trader/arena.ts");

  // Creating or updating an account in this clone awaits a live price for every
  // registered symbol before it answers — a ccxt round trip each. A read-length
  // timeout on that aborts a request the arena then completes anyway, and the
  // desk ends up enabled with no account id, answering every decision request
  // with "the desk is not running" while it is.
  assert.match(arena, /const WRITE_TIMEOUT_MS = 180_000;/);
  for (const call of ["createAccount", "updateAccount", "deactivateAccount"]) {
    const body = arena.slice(arena.indexOf(`export async function ${call}`));
    assert.match(
      body.slice(0, 900),
      /WRITE_TIMEOUT_MS/,
      `${call} still writes on the read timeout`,
    );
  }

  assert.ok(isTimeout(Object.assign(new Error("x"), { name: "TimeoutError" })));
  assert.ok(isTimeout(new Error("The operation was aborted due to timeout")));
  assert.ok(!isTimeout(new Error("The trading desk refused /api/account (500).")));
  assert.ok(!isTimeout("not an error"));

  // And the account that gets recorded is the one the arena actually holds,
  // read back afterwards, never the one a response claimed.
  assert.match(supervisor, /if \(!isTimeout\(error\)\) throw error;/);
  assert.match(supervisor, /async function settle\(/);
  assert.match(supervisor, /const accounts = await listAccounts\(base\);/);
  const settleBody = supervisor.slice(supervisor.indexOf("async function settle("));
  assert.match(settleBody, /store\.recordAccount\(\{ accountId: settled\.id/);
});

test("an arena orphaned by a dead process is ended, not left trading", () => {
  const service = source("src/lib/paper-trader/service.ts");
  // The arena is a child process on a random port, and that port lives only in
  // the memory of whatever started it. When that dies without cleaning up — a
  // dev-server restart, a crashed worker — the next start cannot see the old
  // arena at all, and two arenas on one database is two schedulers trading the
  // same account against each other.
  assert.match(service, /function pidFile\(\)/);
  assert.match(service, /await reapOrphan\(\);/);
  // A recorded pid alone must never be enough to kill on: pids are recycled, and
  // killing a stranger is worse than leaving a stray backend running.
  const reap = service.slice(service.indexOf("async function reapOrphan"));
  assert.match(reap, /process\.kill\(pid, 0\)/, "liveness is not checked");
  assert.match(reap, /reachable\(`http:\/\/127\.0\.0\.1:\$\{port\}`\)/, "the port is not corroborated");
  assert.ok(
    reap.indexOf("reachable(") < reap.indexOf("process.kill(pid)"),
    "the kill happens before the port is corroborated",
  );
});

test("Stop cancels and waits for a child that is still starting", async () => {
  const previousHome = process.env.PAPER_TRADER_HOME;
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-paper-stop-race-"));
  process.env.PAPER_TRADER_HOME = isolatedHome;
  resetPaperLifecycleGlobals();

  try {
    const service = await import("../src/lib/paper-trader/service.ts");
    const child = new FakeArenaChild();
    const control = { child, cancelled: false };
    const promise = new Promise((_, reject) => {
      child.once("exit", () => reject(new Error("the fake start was terminated")));
    });
    globalThis.__breadboardPaperTraderStarting = {
      register: "BTC|CRYPTO|Bitcoin",
      cycleSeconds: 300,
      control,
      promise,
    };

    let stopped = false;
    const stopping = service.stopArena().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(control.cancelled, true, "Stop did not cancel the start attempt");
    assert.deepEqual(child.kills, ["SIGTERM"], "Stop did not terminate the starting child");
    assert.equal(stopped, false, "Stop returned before the starting child exited");

    child.finish();
    await stopping;
    assert.equal(stopped, true);
    assert.equal(service.arenaStarting(), false);
  } finally {
    resetPaperLifecycleGlobals();
    if (previousHome === undefined) delete process.env.PAPER_TRADER_HOME;
    else process.env.PAPER_TRADER_HOME = previousHome;
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  }
});

test("a settings restart waits for the previous arena to exit before starting another", async () => {
  const previousHome = process.env.PAPER_TRADER_HOME;
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-paper-restart-race-"));
  // An empty isolated home makes the replacement fail at the build check. That
  // keeps this lifecycle test hermetic: it can prove when start was attempted
  // without launching the real arena.
  process.env.PAPER_TRADER_HOME = isolatedHome;
  resetPaperLifecycleGlobals();

  try {
    const service = await import("../src/lib/paper-trader/service.ts");
    const child = new FakeArenaChild();
    globalThis.__breadboardPaperTraderArena = {
      child,
      url: "http://127.0.0.1:9",
      startedAt: Date.now(),
      register: "BTC|CRYPTO|Bitcoin",
      cycleSeconds: 300,
      log: "",
    };

    let settled = false;
    const restarting = service
      .ensureArena([{ symbol: "ETH", kind: "CRYPTO", name: "Ethereum" }], 10)
      .finally(() => {
        settled = true;
      });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(child.kills, ["SIGTERM"], "the old arena was not asked to stop");
    assert.equal(settled, false, "the replacement started before the old child exited");

    child.finish();
    await assert.rejects(restarting, /has not been built yet/i);
    assert.equal(settled, true);
  } finally {
    resetPaperLifecycleGlobals();
    if (previousHome === undefined) delete process.env.PAPER_TRADER_HOME;
    else process.env.PAPER_TRADER_HOME = previousHome;
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  }
});

test("a hung market-data call cannot end trading for good", () => {
  const equity = source("../scripts/paper-trader-overlay/equity.ts");
  const scheduler = source("../open-alpha-arena/backend/src/services/scheduler.ts");
  // The arena runs its trading job behind a max_instances flag it clears in a
  // `finally`, so the flag is released only when the job's promise settles. One
  // request that hangs — no error, no response — does not delay a cycle: it ends
  // trading altogether while the process stays up and healthy.
  assert.match(scheduler, /j\.inFlight = true/);
  assert.match(scheduler, /\.finally\(\(\) => \{\s*j\.inFlight = false/);
  // So every call out to the vendor is bounded.
  assert.match(equity, /const CALL_TIMEOUT_MS = /);
  assert.match(equity, /function withTimeout</);
  assert.match(equity, /return await withTimeout\(what, run\)/);
});

test("a desk that stops asking for decisions is noticed and restarted", async () => {
  const { cycleOverdue } = await import("../src/lib/paper-trader/supervisor.ts");
  const now = Date.parse("2026-08-10T20:00:00Z");
  const at = (iso) => ({ lastCycleAt: iso, startedAt: null });

  // Three cycles of silence, so one slow cycle is never mistaken for a dead one.
  assert.equal(cycleOverdue(at("2026-08-10 19:58:00"), 5, now), false);
  assert.equal(cycleOverdue(at("2026-08-10 19:46:00"), 5, now), false);
  assert.equal(cycleOverdue(at("2026-08-10 19:40:00"), 5, now), true);
  // The real case: quiet since 19:50 on a five-minute cycle, three hours later.
  assert.equal(
    cycleOverdue(at("2026-08-10 19:50:33"), 5, Date.parse("2026-08-10T23:00:00Z")),
    true,
  );
  // A desk that has never cycled falls back to when it started, and one with
  // neither is simply not judged.
  assert.equal(cycleOverdue({ lastCycleAt: null, startedAt: null }, 5, now), false);
  assert.equal(cycleOverdue(at("nonsense"), 5, now), false);

  // Restarting the arena does not rewrite the durable last-cycle pulse. The
  // live process start is therefore the grace clock: without it, an hours-old
  // pulse makes every one-minute watchdog tick kill the replacement before its
  // five-minute scheduler can fire.
  const justRestarted = Date.parse("2026-08-10T19:59:00Z");
  assert.equal(
    cycleOverdue(at("2026-08-10 17:00:00"), 5, now, justRestarted),
    false,
    "a replacement arena must receive a fresh post-restart grace window",
  );
  // The grace is bounded, not an exemption: if this same replacement also
  // misses three complete cycles, it is genuinely wedged and must be replaced.
  const restartedButWedged = Date.parse("2026-08-10T19:44:00Z");
  assert.equal(
    cycleOverdue(at("2026-08-10 17:00:00"), 5, now, restartedButWedged),
    true,
    "a running arena beyond the restart grace must still be diagnosed as wedged",
  );

  // Only the arena's own loop may set the pulse, or it stops being evidence.
  const decide = source("src/app/api/paper-trader/decide/chat/completions/route.ts");
  assert.match(decide, /store\.recordCycle\(\);/);
  const store = source("src/lib/paper-trader/store.ts");
  assert.equal(store.split("recordCycle(").length - 1, 1);

  // Only the background keepalive acts on it. A UI Refresh is a read and may
  // not restart the process or reconcile the account behind a harmless label.
  assert.match(
    source("src/lib/paper-trader/autostart.ts"),
    /cycleOverdue\(state, settings\.cycleMinutes, Date\.now\(\), running\.startedAt\)/,
    "the watchdog must judge the live arena's age, not only its stale durable pulse",
  );
});

test("the refresh button is a read-only UI refresh", () => {
  const route = source("src/app/api/paper-trader/control/route.ts");
  const card = source("src/app/components/hermes/inline-paper-trader-run.tsx");
  assert.match(route, /if \(action === "refresh"\)/);
  const refreshBranch = route.slice(
    route.indexOf('if (action === "refresh")'),
    route.indexOf('if (action !== "start")'),
  );
  assert.doesNotMatch(
    refreshBranch,
    /restartDesk|startDesk|stopDesk|failStale|releaseStale|markEnabled/,
  );
  assert.match(card, /const refreshView = async \(\) =>/);
  assert.match(card, /if \(!\(await load\(\)\)\)/);
  assert.match(card, /void refreshView\(\)/);
  assert.doesNotMatch(card, /control\("refresh"\)/);
  assert.match(card, /generation === loadGenerationRef\.current/);
  assert.match(card, /controlAction === "refresh" \? "Refreshing…" : "Refresh"/);
});

test("a failed analysis says why, rather than only that it failed", async () => {
  const { withDetail } = await import("../src/lib/paper-trader/decisions.ts");
  const traceback = [
    "Traceback (most recent call last):",
    '  File "C:/x/graph.py", line 12, in stream',
    "    raise RateLimitError(...)",
    "openai.RateLimitError: Error code: 429 - rate limit reached",
  ].join("\n");
  // The bridge's own sentence is for a person; the reason is in the traceback,
  // and its last line is the part that names a rate limit or a missing module.
  assert.equal(
    withDetail("The analysis stopped before it finished.", traceback),
    "The analysis stopped before it finished. openai.RateLimitError: Error code: 429 - rate limit reached",
  );
  assert.equal(withDetail("Failed.", ""), "Failed.");
  // Never doubled up when the message already carries it.
  assert.equal(withDetail("Failed. boom", "boom"), "Failed. boom");
  const decisions = source("src/lib/paper-trader/decisions.ts");
  assert.match(decisions, /withDetail\(message, typeof event\.detail === "string" \? event\.detail : ""\)/);
  // And the card shows it instead of hiding it in a tooltip on a tiny chip.
  assert.match(
    source("src/app/components/hermes/inline-paper-trader-run.tsx"),
    /could not be analysed: \{lastFailure\.error\}/,
  );
});

test("Vibe Trading asks ChatGPT first and Anthropic only when it is out", async () => {
  const { isUsageExhausted, pickAnthropicModel } = await import(
    "../src/lib/paper-trader/providers.ts"
  );

  // The distinction that decides whether a second attempt is sensible or merely
  // an expensive way to fail twice. This first string is the one the desk
  // actually recorded when it stopped trading.
  assert.ok(
    isUsageExhausted(
      "provider_stream_error provider=openai model=default: RateLimitError: Error code: 429 - {...}",
    ),
  );
  assert.ok(isUsageExhausted("You exceeded your current quota"));
  assert.ok(isUsageExhausted("usage limit reached for this account"));
  assert.ok(isUsageExhausted("Too Many Requests"));
  // A quant loop that fell over on a bad ticker fails the same way on any model.
  assert.ok(!isUsageExhausted("ValueError: unknown ticker ZZZZ"));
  assert.ok(!isUsageExhausted("The adviser did not answer in time."));
  // And a token count that merely contains the digits is not a rate limit.
  assert.ok(!isUsageExhausted("completion used 3429 tokens"));

  // The fallback id is asked of the relay, not guessed: the prefix depends on
  // how this machine reaches Anthropic.
  const catalogue = [
    "gpt-5.6-sol",
    "cliproxy/kimi-k2",
    "cliproxy/claude-haiku-4-5-20251001",
    "cliproxy/claude-opus-5",
    "cliproxy/claude-sonnet-5",
  ];
  assert.equal(pickAnthropicModel(catalogue), "cliproxy/claude-sonnet-5");
  assert.equal(
    pickAnthropicModel(["gpt-5.6-sol", "cliproxy/claude-haiku-4-5-20251001"]),
    "cliproxy/claude-haiku-4-5-20251001",
  );
  assert.equal(pickAnthropicModel(["gpt-5.6-sol", "cliproxy/kimi-k2"]), null);

  const committee = source("src/lib/paper-trader/committee.ts");
  // The first attempt respects a model pinned in Vibe Trading's own settings;
  // the fallback overrides it, because the pin is exactly what has run out.
  assert.match(committee, /settings: pin \? \{ \.\.\.settings, model \} : settings/);
  assert.match(committee, /if \(!isUsageExhausted\(reason\)\) throw error;/);
  // A note written by the fallback says so.
  assert.match(committee, /\[via \$\{usedModel\}\]/);
});

test("the desk hears all five ratings, not just the two extremes", () => {
  const { parseRating, ratingAction } = decisions;

  // The framework's own vocabulary — see signal_processing.py, which documents
  // process_signal as returning one of Buy / Overweight / Hold / Underweight /
  // Sell. Reading it as three points by looking for "buy" and "sell" silently
  // discards the two middle ratings, and those are the ones it actually uses:
  // three consecutive live analyses came back Underweight and every one was
  // recorded as HOLD, so the desk never traded at all.
  assert.equal(parseRating("Buy"), "BUY");
  assert.equal(parseRating("Overweight"), "OVERWEIGHT");
  assert.equal(parseRating("Hold"), "HOLD");
  assert.equal(parseRating("Underweight"), "UNDERWEIGHT");
  assert.equal(parseRating("Sell"), "SELL");
  // As it arrives in practice, with markdown around it.
  assert.equal(parseRating("**Rating**: Underweight"), "UNDERWEIGHT");
  assert.equal(parseRating(""), "HOLD");

  // Direction and strength. The asymmetry is the point: bullishness on something
  // you own none of is an instruction to own some, but "trim" on the same thing
  // is not an instruction to short it.
  assert.deepEqual(ratingAction("BUY"), { verdict: "BUY", conviction: "strong" });
  assert.deepEqual(ratingAction("OVERWEIGHT"), { verdict: "BUY", conviction: "mild" });
  assert.deepEqual(ratingAction("SELL"), { verdict: "SELL", conviction: "strong" });
  assert.deepEqual(ratingAction("UNDERWEIGHT"), { verdict: "SELL", conviction: "mild" });
  assert.deepEqual(ratingAction("HOLD"), { verdict: "HOLD", conviction: "strong" });
});

test("intermediate ratings use confidence-sized positions instead of leaving an empty desk idle", () => {
  const settings = settingsModule.paperTraderSettingsFrom({ symbols: ["btc"], allowShorts: true });
  const trim = (positions) =>
    decisions.decisionFor({
      verdict: "SELL",
      conviction: "mild",
      confidence: settings.minConfidence,
      symbol: "BTC",
      reasoning: "",
      positions,
      settings,
    });

  // Holding a long, "underweight" means reduce it — which the desk can do.
  const held = trim([position("BTC", "LONG")]);
  assert.equal(held.operation, "close");
  assert.equal(held.direction, "long");

  // This is an absolute-return desk. A bearish call on an empty portfolio opens
  // a smaller short when the user has enabled shorts, rather than holding forever.
  const flat = trim([]);
  assert.equal(flat.operation, "open");
  assert.equal(flat.direction, "short");
  assert.equal(
    flat.target_portion_of_balance,
    decisions.dynamicPositionSize({
      confidence: settings.minConfidence,
      minConfidence: settings.minConfidence,
      ceiling: settings.positionSize,
      conviction: "mild",
    }),
  );

  // An outright Sell still shorts, because that is a call the analysts made.
  const outright = decisions.decisionFor({
    verdict: "SELL",
    conviction: "strong",
    symbol: "BTC",
    reasoning: "",
    positions: [],
    settings,
  });
  assert.equal(outright.operation, "open");
  assert.equal(outright.direction, "short");

  // Bullishness is not treated the same way: "overweight" on nothing held buys.
  const mildBuy = decisions.decisionFor({
    verdict: "BUY",
    conviction: "mild",
    confidence: settings.minConfidence,
    symbol: "BTC",
    reasoning: "",
    positions: [],
    settings,
  });
  assert.equal(mildBuy.operation, "open");
  assert.equal(mildBuy.direction, "long");
  assert.equal(mildBuy.target_portion_of_balance, flat.target_portion_of_balance);

  const noShorting = decisions.decisionFor({
    verdict: "SELL",
    conviction: "mild",
    symbol: "BTC",
    reasoning: "",
    positions: [],
    settings: { ...settings, allowShorts: false },
  });
  assert.equal(noShorting.operation, "hold");
  assert.match(noShorting.reason, /shorting is turned off/i);
});

test("the analyses fall back too, because they are what gates trading", () => {
  const decisions = source("src/lib/paper-trader/decisions.ts");
  // The desk trades on these verdicts and nothing else. A usage limit killed
  // every run on its first model call, so no verdict was ever ready and the desk
  // held every cycle for hours while looking healthy.
  assert.match(decisions, /if \(!isUsageExhausted\(reason\)\) throw error;/);
  assert.match(decisions, /await anthropicFallbackModel\(\)/);
  assert.match(decisions, /runAnalysisOn\(symbol, settings, \{ \.\.\.context, model: fallback \}\)/);
  // The retry wraps the real runner rather than duplicating it.
  assert.match(decisions, /export async function runAnalysis\(/);
  assert.match(decisions, /^function runAnalysisOn\(/m);
});

test("the decision endpoint cannot answer with an error", () => {
  const route = source("src/app/api/paper-trader/decide/chat/completions/route.ts");
  // The arena reads a non-200 as "the model is broken" and trades nothing, so a
  // bug in here does not degrade the desk — it stops it, silently, until someone
  // reads a server log. A method added to a cached singleton did exactly that
  // for half a day.
  assert.match(route, /export async function POST\(request: Request\) \{\s*try \{\s*return await decide\(request\);/);
  assert.match(route, /return NextResponse\.json\(completion\(holding\(`The desk could not decide: \$\{reason\}`\)\)\);/);
  // And the diagnostics pulse is not allowed to be the thing that breaks it.
  const pulseAt = route.indexOf("store.recordCycle();");
  assert.ok(pulseAt > 0, "the cycle pulse is missing");
  assert.match(route.slice(pulseAt - 120, pulseAt), /try \{/);
});

test("a cached store never outlives the class or the schema that made it", () => {
  const instance = source("src/lib/paper-trader/instance.ts");
  // The singleton lives on globalThis, which survives a dev-server module
  // reload. A store built before a method existed keeps answering without it —
  // and the migration behind it never runs either, because the schema is applied
  // by a constructor that has already been and gone.
  assert.match(instance, /const moduleGeneration = Symbol\(/);
  assert.match(instance, /breadboardPaperTraderStoreGeneration !== moduleGeneration/);
  assert.match(instance, /globals\.breadboardPaperTraderStoreGeneration = moduleGeneration;/);
});

test("the composer refuses free typing while the desk is selected", () => {
  const composer = source("src/app/components/assistant-composer.tsx");
  // The desk takes no instructions — what it trades and how is settings, not a
  // sentence — so it joins the agents whose composer has no textarea at all. A
  // field that silently discarded what you typed would be worse than none.
  assert.match(
    composer,
    /const formAgent = tradingAgentsAgent \?\? shortsAgent \?\? formsmithAgent \?\? paperTraderSelection \?\? null;/,
  );
  assert.match(composer, /The trading desk takes no instructions/);
  // And unlike the other three there is nothing to fill in first, so send is
  // always ready.
  assert.match(composer, /paperTraderSelection\s*\?\s*true/);
});

test("typing the bare Paper Trader command locks the composer immediately", () => {
  const composer = source("src/app/components/assistant-composer.tsx");
  assert.match(
    composer,
    /const typedPaperTraderCommand =\s*!paperTraderAgent && value\.trim\(\)\.toLowerCase\(\) === PAPER_TRADER_COMMAND\.toLowerCase\(\);/,
  );
  assert.match(composer, /paperTraderAgent \?\?\s*\(typedPaperTraderCommand/);
  assert.match(composer, /else if \(paperTraderSelection\) onSubmit\(\);/);
  assert.match(composer, /if \(typedPaperTraderCommand\) onChange\(''\);/);
});

test("selecting the desk shows at once, and checks its health behind that", () => {
  const declarations = {
    "src/app/components/hermes/dashboard-agent-terminal.tsx":
      "const selectPaperTrader = useCallback(",
    "src/app/gardens/[clusterSlug]/workspace-client.tsx":
      "function selectPaperTrader(): ExternalAgentSelection {",
  };
  for (const [file, declaration] of Object.entries(declarations)) {
    const surface = source(file);
    const start = surface.indexOf(declaration);
    assert.ok(start > 0, `${file}: ${declaration} not found`);
    const body = surface.slice(start, start + 4_000);
    const selectedAt = body.indexOf("setPaperTraderAgent(selected)");
    const fetchedAt = body.indexOf('fetch("/api/paper-trader/health")');
    assert.ok(selectedAt > 0 && fetchedAt > 0, `${file}: selection or health check missing`);
    // The composer must not wait on a round trip to reflect a local choice. In
    // dev the first call to that route spends seconds being compiled, which read
    // as the app having hung.
    assert.ok(
      selectedAt < fetchedAt,
      `${file}: the composer waits for the health check before it changes`,
    );
  }
});

test("a bare command starts the desk on its first submission", () => {
  for (const file of [
    "src/app/components/hermes/dashboard-agent-terminal.tsx",
    "src/app/gardens/[clusterSlug]/workspace-client.tsx",
  ]) {
    const surface = source(file);
    assert.match(
      surface,
      /if \(selected\) await launchPaperTrader(?:Run)?\(paperTraderTask/,
      `${file} requires a second click after the bare command`,
    );
    assert.doesNotMatch(surface, /if \(selected && paperTraderTask\)/);
  }
});

test("Paper Trader stays out of agent pickers while its typed command remains available", () => {
  const composer = source("src/app/components/assistant-composer.tsx");
  const commandHub = source("src/app/components/hermes/command-hub.tsx");
  assert.doesNotMatch(composer, /onSelectPaperTrader=/);
  assert.doesNotMatch(composer, /onSelectPaperTrader \? 'paper-trader'/);
  assert.doesNotMatch(commandHub, /paper-trader-entry|showPaperTrader|onSelectPaperTrader/);
  assert.match(composer, /value\.trim\(\)\.toLowerCase\(\) === PAPER_TRADER_COMMAND\.toLowerCase\(\)/);
});

test("process exit fences a start and signals the arena immediately", async () => {
  resetPaperLifecycleGlobals();
  const service = await import("../src/lib/paper-trader/service.ts");
  const startingChild = new FakeArenaChild();
  const runningChild = new FakeArenaChild();
  const control = { child: startingChild, cancelled: false };
  globalThis.__breadboardPaperTraderStarting = {
    register: "BTC|CRYPTO|Bitcoin",
    cycleSeconds: 300,
    control,
    promise: Promise.resolve({}),
  };
  globalThis.__breadboardPaperTraderArena = {
    child: runningChild,
    url: "http://127.0.0.1:9",
    startedAt: Date.now(),
    register: "BTC|CRYPTO|Bitcoin",
    cycleSeconds: 300,
    log: "",
  };

  service.stopArenaForProcessExit();
  assert.equal(control.cancelled, true);
  assert.deepEqual(startingChild.kills, ["SIGTERM"]);
  assert.deepEqual(runningChild.kills, ["SIGTERM"]);
  assert.equal(globalThis.__breadboardPaperTraderArena, null);

  startingChild.finish();
  runningChild.finish();
  resetPaperLifecycleGlobals();
});

test("a card that nobody is looking at stops asking", () => {
  const card = source("src/app/components/hermes/inline-paper-trader-run.tsx");
  // A transcript scrolls back through months of these, and every one of them
  // polling forever would turn a chat nobody is reading into background load.
  assert.match(card, /if \(!onScreen \|\| !inForeground\) return;/);
  assert.match(card, /new IntersectionObserver/);
  assert.match(card, /visibilitychange/);
  // And a stopped desk has nothing moving to watch.
  assert.match(card, /snapshot\?\.desk\?\.running \? POLL_MS : IDLE_POLL_MS/);
});

test("the card shows a start request immediately and settles from the control response", () => {
  const card = source("src/app/components/hermes/inline-paper-trader-run.tsx");
  const controlAt = card.indexOf("const control = async (action:");
  assert.ok(controlAt > 0, "the card control handler is missing");
  const control = card.slice(controlAt, controlAt + 2_500);
  const pendingAt = control.indexOf("setControlAction(action)");
  const requestAt = control.indexOf('await fetch("/api/paper-trader/control"');
  assert.ok(
    pendingAt >= 0 && requestAt > pendingAt,
    "Start does not enter its pending UI before the request begins",
  );
  assert.match(control, /Starting the trading desk…/);
  assert.match(control, /if \(data\.desk\) setControlledDesk\(data\.desk\)/);
  assert.match(control, /if \(!response\.ok \|\| data\.ok !== true\)/);
  assert.match(control, /setFailure\(/);
  assert.match(card, /controlAction === "start"\s*\? "Starting…"/);
  assert.match(card, /disabled=\{controlAction !== null\}/);
});

test("the keepalive cannot take the app down with it", () => {
  const autostart = source("src/lib/paper-trader/autostart.ts");
  // It runs from a timer as `void revive()`, so anything escaping becomes an
  // unhandled rejection, and an unhandled rejection ends the dashboard process.
  const body = autostart.slice(autostart.indexOf("async function revive"));
  const tryAt = body.indexOf("try {");
  const storeAt = body.indexOf("getPaperTraderStore()");
  assert.ok(tryAt > 0 && storeAt > tryAt, "the database reads sit outside the try");
});

test("Stop wins over keepalive, and app shutdown closes only the process", () => {
  const autostart = source("src/lib/paper-trader/autostart.ts");
  const supervisor = source("src/lib/paper-trader/supervisor.ts");
  assert.match(autostart, /resumeOnly: true/);
  assert.match(supervisor, /options\.resumeOnly && !store\.state\(\)\.enabled/);
  assert.match(supervisor, /advanceIntentGeneration\(\);[\s\S]{0,180}store\.markDisabled\(\)/);
  assert.match(supervisor, /stopActivePaperTraderAnalyses\(\)/);
  assert.match(supervisor, /store\.failUnservedAnalyses\(/);

  assert.match(autostart, /process\.once\("exit", stopArenaForProcessExit\)/);
  assert.match(autostart, /\["SIGINT", "SIGTERM"\]/);
  const shutdown = autostart.slice(autostart.indexOf("export async function shutdownPaperTrader"));
  assert.match(shutdown, /await stopArena\(\)/);
  assert.doesNotMatch(shutdown, /markDisabled/);
});

test("a run may not install anything, and setup is the only place that can", () => {
  const runs = source("src/app/api/paper-trader/runs/route.ts");
  assert.ok(!/runSetupAction/.test(runs), "the run route can install");
  const setup = source("src/app/api/paper-trader/setup/route.ts");
  assert.match(setup, /requireUserId\(\)/);
  assert.match(setup, /runSetupAction/);
  for (const route of [
    "src/app/api/paper-trader/runs/route.ts",
    "src/app/api/paper-trader/health/route.ts",
    "src/app/api/paper-trader/snapshot/route.ts",
    "src/app/api/paper-trader/control/route.ts",
  ]) {
    assert.match(source(route), /requireUserId\(\)/, `${route} does not identify the user`);
  }
});
