import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const decisions = await import("../src/lib/paper-trader/decisions.ts");
const risk = await import("../src/lib/paper-trader/risk.ts");
const settingsModule = await import("../src/lib/paper-trader/settings.ts");

const source = (relativePath) =>
  fs.readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");

const SETTINGS = {
  ...settingsModule.DEFAULT_PAPER_TRADER_SETTINGS,
  positionSize: 0.4,
  minConfidence: 0.5,
  maxOpenPositions: 2,
};

const position = (symbol, side) => ({
  id: 1,
  symbol,
  name: symbol,
  quantity: 1,
  availableQuantity: 1,
  avgCost: 100,
  leverage: 2,
  side,
  lastPrice: 100,
  marketValue: 100,
  unrealisedPnl: 0,
});

const sizeAt = (confidence, conviction = "mild", overrides = {}) =>
  decisions.dynamicPositionSize({
    confidence,
    minConfidence: SETTINGS.minConfidence,
    ceiling: SETTINGS.positionSize,
    conviction,
    ...overrides,
  });

const assertClose = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `expected ${expected}, received ${actual}`);

test("position size varies continuously with the chair's confidence", () => {
  const confidences = [0.5, 0.6, 0.75, 0.9, 1];
  const sizes = confidences.map((confidence) => sizeAt(confidence));

  assertClose(sizes[0], SETTINGS.positionSize * 0.45);
  assert.equal(sizes.at(-1), SETTINGS.positionSize);
  assert.equal(new Set(sizes).size, sizes.length, "distinct confidences collapsed to one fixed size");
  for (let index = 1; index < sizes.length; index += 1) {
    assert.ok(sizes[index] > sizes[index - 1], "more confidence did not allocate more money");
  }
});

test("strong calls start larger than mild calls but both remain under the configured ceiling", () => {
  const mildAtThreshold = sizeAt(SETTINGS.minConfidence, "mild");
  const strongAtThreshold = sizeAt(SETTINGS.minConfidence, "strong");

  assertClose(mildAtThreshold, SETTINGS.positionSize * 0.45);
  assertClose(strongAtThreshold, SETTINGS.positionSize * 0.6);
  assert.ok(strongAtThreshold > mildAtThreshold);

  for (const conviction of ["mild", "strong"]) {
    for (const confidence of [0.5, 0.67, 0.82, 0.99, 1]) {
      const portion = sizeAt(confidence, conviction);
      assert.ok(portion > 0);
      assert.ok(portion <= SETTINGS.positionSize, `${conviction} ${confidence} exceeded the ceiling`);
    }
  }
});

test("confidence below the action threshold allocates nothing", () => {
  assert.equal(sizeAt(0), 0);
  assert.equal(sizeAt(0.49), 0);
  assert.equal(sizeAt(0.499_999), 0);
  assert.ok(sizeAt(0.5) > 0, "the inclusive action threshold was treated as below threshold");
});

test("dynamic sizing clamps hostile numeric inputs to an arena-safe portion", () => {
  assert.equal(sizeAt(Number.NaN), 0);
  assert.equal(sizeAt(Number.NEGATIVE_INFINITY), 0);
  assert.equal(sizeAt(-100), 0);
  assert.equal(sizeAt(100), SETTINGS.positionSize);
  assert.equal(sizeAt(1, "strong", { ceiling: -5 }), 0);

  const oversizedCeiling = sizeAt(1, "strong", { ceiling: 50 });
  assert.ok(Number.isFinite(oversizedCeiling));
  assert.equal(oversizedCeiling, 1, "the arena's absolute 100% wire ceiling was not enforced");
});

test("decisionFor uses numeric confidence rather than a fixed half-size intermediate trade", () => {
  const decide = (confidence) =>
    decisions.decisionFor({
      verdict: "BUY",
      conviction: "mild",
      confidence,
      symbol: "BTC",
      reasoning: "",
      positions: [],
      settings: SETTINGS,
    });

  const cautious = decide(0.55);
  const confident = decide(0.9);
  assert.equal(cautious.operation, "open");
  assert.equal(confident.operation, "open");
  assert.equal(cautious.target_portion_of_balance, sizeAt(0.55));
  assert.equal(confident.target_portion_of_balance, sizeAt(0.9));
  assert.ok(confident.target_portion_of_balance > cautious.target_portion_of_balance);
  assert.ok(confident.target_portion_of_balance <= SETTINGS.positionSize);

  const belowThreshold = decide(0.49);
  assert.equal(belowThreshold.operation, "hold");
  assert.equal(belowThreshold.target_portion_of_balance, 0);
});

test("dynamic sizing does not duplicate or accidentally trim existing positions", () => {
  const sameSide = decisions.decisionFor({
    verdict: "BUY",
    conviction: "strong",
    confidence: 1,
    symbol: "BTC",
    reasoning: "",
    positions: [position("BTC", "LONG")],
    settings: SETTINGS,
  });
  assert.equal(sameSide.operation, "hold", "the arena permits only one position per symbol");

  const reverse = decisions.decisionFor({
    verdict: "SELL",
    conviction: "mild",
    confidence: 0.55,
    symbol: "BTC",
    reasoning: "",
    positions: [position("BTC", "LONG")],
    settings: SETTINGS,
  });
  assert.equal(reverse.operation, "close");
  assert.equal(reverse.direction, "long");
  assert.equal(reverse.target_portion_of_balance, 1, "a direction change left a stale position open");
});

test("portfolio risk limits still have the last word over a dynamically sized order", () => {
  const proposed = decisions.decisionFor({
    verdict: "BUY",
    conviction: "strong",
    confidence: 0.9,
    symbol: "SOL",
    reasoning: "",
    positions: [],
    settings: SETTINGS,
  });
  const positions = [position("BTC", "LONG"), position("ETH", "SHORT")];
  const assessment = risk.assessRisk({
    equity: 10_000,
    capital: 10_000,
    positions,
    settings: SETTINGS,
  });
  const constrained = risk.constrain({
    decision: proposed,
    symbol: "SOL",
    assessment,
    history: risk.readHistory([]),
    settings: SETTINGS,
  });

  assert.equal(assessment.stance, "reduce-only");
  assert.equal(constrained.decision.operation, "hold");
  assert.equal(constrained.decision.target_portion_of_balance, 0);
  assert.match(constrained.intervention, /maximum number of positions/i);
});

test("the decision route passes the chair's numeric confidence into sizing before risk", () => {
  const route = source("src/app/api/paper-trader/decide/chat/completions/route.ts");
  const decisionAt = route.indexOf("decisionFor({");
  const riskAt = route.indexOf("constrain({", decisionAt);

  assert.ok(decisionAt >= 0 && riskAt > decisionAt, "risk no longer sees the sized order last");
  assert.match(route.slice(decisionAt, riskAt), /confidence:\s*chair\.confidence/);
});
