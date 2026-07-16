import assert from "node:assert/strict";
import test from "node:test";

import { formulaMetricFamily, isWorkedExampleFormula } from "../src/lib/learn-utils.ts";

const BS = String.fromCharCode(92); // a literal backslash, unmangled by tooling

// Numeric worked examples (concrete substitution / arithmetic → a result).
test("numeric arithmetic and chained substitutions are worked examples", () => {
  assert.equal(isWorkedExampleFormula(`N_{${BS}text{spikes}} = 2+1+2=5`), true);
  assert.equal(isWorkedExampleFormula("L_decision = 35 - 20 = 15"), true);
  assert.equal(isWorkedExampleFormula("y = f(3) = 9"), true);
  assert.equal(isWorkedExampleFormula(`E = 3${BS}times4 = 12`), true);
});

// Summation/product/integral DEFINITIONS are never worked-example arithmetic,
// even when OCR flattens \sum_{t=1}^{T}\sum_{i=1}^{N} into "sum sum ... t=1 i=1"
// (the inline index bounds add extra "=" signs and digits). This is the exact
// test-2 finalize failure: formulas[0] "T N Total Spikes = sum sum si(t) (3)
// t=1 i=1" was wrongly flagged as worked-example arithmetic marked
// source_definition.
test("OCR-flattened summation definition is NOT a worked example", () => {
  assert.equal(isWorkedExampleFormula("T N Total Spikes = sum sum si(t) (3) t=1 i=1"), false);
});

test("LaTeX summation / product definitions are NOT worked examples", () => {
  assert.equal(isWorkedExampleFormula(`N_{${BS}text{spikes}}=${BS}sum_{t=1}^{T}${BS}sum_{i=1}^{N}S_i[t]`), false);
  assert.equal(isWorkedExampleFormula(`${BS}prod_{i=1}^{3} x_i`), false);
});

// Symbolic metric definitions remain non-worked-example.
test("symbolic metric definitions are NOT worked examples", () => {
  assert.equal(isWorkedExampleFormula(`${BS}text{Accuracy} = N_{correct}/N_{total}`), false);
  assert.equal(isWorkedExampleFormula("T = t_{decision} - t_{onset}"), false);
});

// A benefit-per-energy ratio is EFFICIENCY, not energy — even though it mentions
// joules. This is the exact test-2 failure: an efficiency worked example
// ("900 correct classifications / 20 J = 45 correct classifications per joule")
// classified as energy and got anchored to the energy formula S1.P6.E3 on an
// efficiency page, which the page-level family audit then rejected.
test("benefit-per-energy ratios classify as efficiency, not energy", () => {
  assert.equal(formulaMetricFamily("45 correct classifications per joule"), "efficiency");
  assert.equal(formulaMetricFamily("4500 percentage points per joule"), "efficiency");
  assert.equal(formulaMetricFamily(`${BS}frac{900 correct classifications}{20 J} = 45 correct classifications per joule`), "efficiency");
  assert.equal(formulaMetricFamily(`${BS}eta_{NEE}=${BS}frac{A}{E_{inf}}`), "efficiency");
});

test("genuine energy formulas still classify as energy", () => {
  assert.equal(formulaMetricFamily("E = N_s E_{spike} + N_c E_{syn}"), "energy");
  assert.equal(formulaMetricFamily("energy per inference"), "energy");
  assert.equal(formulaMetricFamily("Total energy consumption in joules"), "energy");
});
