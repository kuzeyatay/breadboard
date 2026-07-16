import assert from "node:assert/strict";
import test from "node:test";

import { auditFormulaMetadata, formulaTextsStructurallyClose } from "../src/lib/garden-finalize.ts";

const BS = String.fromCharCode(92);

// ---------------------------------------------------------------------------
// formulaTextsStructurallyClose: same equation vs same-family-different-equation
// ---------------------------------------------------------------------------

test("structural closeness: identical / near-identical equations are close", () => {
  assert.equal(formulaTextsStructurallyClose("V_t = a + b", "V_t = a + b"), true);
  assert.equal(
    formulaTextsStructurallyClose(
      `${BS}dot{V}(t) = -${BS}lambda V(t) + Fc(t) + ${BS}Omega s(t)`,
      `${BS}dot{V}(t) = -${BS}lambda V(t) + Fc(t) + ${BS}Omega s(t) + I`,
    ),
    true,
  );
});

test("structural closeness: distinct equations of the same family are NOT close", () => {
  // A discrete LIF update vs the continuous membrane ODE — same membrane family,
  // different equations. This is the test2 false-positive case.
  const discrete = `V_t = ${BS}lambda V_{t-1} + WX_t - S_t V_{${BS}mathrm{th}}`;
  const continuous = `${BS}dot{V}(t) = -${BS}lambda V(t) + Fc(t) + ${BS}Omega s(t)`;
  assert.equal(formulaTextsStructurallyClose(discrete, continuous), false);
});

// ---------------------------------------------------------------------------
// auditFormulaMetadata: a worked example may apply an on-page conceptual-helper
// definition (shared LHS), not only a source_definition.
// ---------------------------------------------------------------------------

test("worked example applying an on-page conceptual-helper definition is not orphaned", () => {
  const entries = [
    { kind: "conceptual_helper", text: `A = ${BS}frac{100a}{BTN}`, groundingStatus: "conceptual-helper" },
    { kind: "worked_example", text: `A = ${BS}frac{100${BS}times5000}{100000} = 5${BS}%`, groundingStatus: "conceptual-helper", formulaFamily: "accuracy", exampleGroupId: "eg1" },
  ];
  const audit = auditFormulaMetadata(entries);
  assert.equal(
    audit.problems.some((p) => /no source definition on the page to apply/.test(p)),
    false,
    `worked example should be grounded to the on-page helper definition; got: ${JSON.stringify(audit.problems)}`,
  );
});

test("a genuinely orphan worked example (bare arithmetic, no metric, no lineage) is still flagged", () => {
  // Bare arithmetic with a mislabeled family and no on-page definition: its text
  // computes no recognizable metric (no %, ratio, or metric keyword), so it is
  // still noise.
  const entries = [
    { kind: "worked_example", text: "Z = 2 + 3 = 5", groundingStatus: "conceptual-helper", formulaFamily: "accuracy" },
  ];
  const audit = auditFormulaMetadata(entries);
  assert.equal(audit.problems.some((p) => /no source definition on the page to apply|no recognizable formula family or lineage/.test(p)), true);
});

test("a worked example computing a recognized metric is not orphaned even without an on-page definition", () => {
  // "A = 100×2400/(8×20×100) = 15%" computes the sparsity/activity metric on a
  // results page; its definition lives on an earlier page. The text itself is a
  // recognizable percentage metric, so it is a meaningful computation, not noise.
  const entries = [
    { kind: "conceptual_helper", text: `G(V) = ${BS}frac{1}{9}`, groundingStatus: "conceptual-helper" },
    { kind: "worked_example", text: `A = ${BS}frac{100${BS}times2400}{8${BS}times20${BS}times100} = 15${BS}%`, groundingStatus: "conceptual-helper", formulaFamily: "accuracy", exampleGroupId: "eg1" },
  ];
  const audit = auditFormulaMetadata(entries);
  assert.equal(
    audit.problems.some((p) => /no source definition on the page to apply/.test(p)),
    false,
    `metric worked example should not be flagged as orphan; got: ${JSON.stringify(audit.problems)}`,
  );
});
