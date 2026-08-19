import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  classifyEvidenceTurn,
  describeBound,
  evidenceCalibrationDiagnostics,
  evidenceCalibrationSection,
  extractSuppliedMeasurements,
  parseNumber,
  suppliedEvidenceText,
  verdictFor,
} from "../src/lib/hermes/evidence-calibration.ts";
import { composeHermesSystemPrompt } from "../src/lib/hermes/system-prompts.ts";

// Bread could read a report correctly and still write a conclusion two steps
// stronger than the report carried: a value sitting inside the range printed
// beside it was called raised because a quantity derived from it was out of
// range, "compatible with" became "you have", and a reassuring finding became
// "harmless". These tests hold the two halves of the fix — the durable
// contract and the per-turn check — to the behaviour rather than the wording.
//
// The scenario set is deliberately spread across medicine, finance, technical
// diagnosis, law and engineering, because a fix that only works on the shape
// of the report that provoked it is not a fix.

delete process.env.ENABLE_EVIDENCE_CALIBRATION;

const source = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const scenarioSet = JSON.parse(
  fs.readFileSync(
    new URL("../../qa/evidence-calibration/scenarios.json", import.meta.url),
    "utf8",
  ),
);
const scenarios = scenarioSet.scenarios;

const evidenceOf = (scenario) =>
  `${scenario.attachmentName}\n${scenario.evidence}`;

const decision = (overrides = {}) => ({
  mode: "knowledge",
  requestedOutcome: "answer the question",
  implementationRequired: false,
  decisionReason: "test",
  decisionSource: "breadboard_server_policy_v1",
  authorizedRoots: [],
  authorizedPathPatterns: [],
  allowedTools: ["websearch"],
  allowedOperations: ["knowledge_work"],
  allowedCommandPatterns: [],
  selectedConditionalSkills: [],
  selectedConnections: [],
  createdAt: "2026-08-19T00:00:00.000Z",
  expiresAt: null,
  revokedAt: null,
  ...overrides,
});

const withEnv = (values, run) => {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

// --- the durable contract ---------------------------------------------------

test("the contract ships and is reachable from the repository", () => {
  const diagnostics = evidenceCalibrationDiagnostics();
  assert.equal(diagnostics.live, true);
  assert.equal(diagnostics.enabled, true);
});

test("the contract separates observation, inference and possibility", () => {
  const contract = source("../hermes-config/system/evidence-calibration.md");
  // The five classes have to be distinguishable to a reader who has never seen
  // this file, so each is checked by its idea rather than by a slogan.
  assert.match(contract, /direct observation/i);
  assert.match(contract, /derived/i);
  assert.match(contract, /interpretation/i);
  assert.match(contract, /hypothesis|explanations the same evidence/i);
  assert.match(contract, /stronger than the evidence/i);
  // And the classes must stay internal rather than becoming labels in answers.
  assert.match(contract, /never labels you print|not.{0,20}print/i);
});

test("the contract names the promotions that inflate a claim", () => {
  const contract = source("../hermes-config/system/evidence-calibration.md");
  assert.match(contract, /compatible with is not/i);
  assert.match(contract, /associated with is not/i);
  assert.match(contract, /suggests is not/i);
  assert.match(contract, /absence of|absent/i);
  assert.match(contract, /harmless/i);
});

test("the contract makes the supplied bound govern the description of a value", () => {
  const contract = source("../hermes-config/system/evidence-calibration.md");
  assert.match(contract, /range, threshold, target, tolerance, or specification/i);
  assert.match(
    contract,
    /bound written in the source governs|source's own bound|bound the source/i,
  );
  // The derived-quantity rule is the specific failure this exists to stop.
  assert.match(
    contract,
    /derived quantity being out of range is a statement about that derived quantity, not about each input/i,
  );
});

test("the contract forbids hedging as loudly as it forbids overclaiming", () => {
  const contract = source("../hermes-config/system/evidence-calibration.md");
  assert.match(contract, /licence to hedge/i);
  assert.match(contract, /plain, direct statement with no qualifier/i);
  assert.match(contract, /padded with disclaimers/i);
  assert.match(contract, /response_style/);
});

test("the always-on core lives in the assistant prompt, not only in the gated section", () => {
  const assistant = source("../hermes-config/system/assistant.md");
  assert.match(
    assistant,
    /strength of a claim tracks the strength of the evidence/i,
  );
  assert.match(assistant, /on every turn and not only the high-stakes ones/i);
  assert.match(assistant, /calibration rather than hedging/i);
});

// --- reading a bound out of supplied material -------------------------------

test("a value is compared with the bound its own source printed", () => {
  const { measurements } = extractSuppliedMeasurements(
    "Fasting glucose      92 mg/dL      (reference 70 - 99)",
  );
  assert.equal(measurements.length, 1);
  assert.equal(measurements[0].label, "Fasting glucose");
  assert.equal(measurements[0].value, 92);
  assert.equal(measurements[0].unit, "mg/dL");
  assert.equal(measurements[0].verdict, "within");
});

test("both kinds of table are read, because reports are printed both ways", () => {
  const fixedWidth = extractSuppliedMeasurements(
    "Throughput          1,240      req/s      >= 1500",
  ).measurements;
  assert.equal(fixedWidth.length, 1);
  assert.equal(fixedWidth[0].value, 1240);
  assert.equal(fixedWidth[0].verdict, "below");

  const piped = extractSuppliedMeasurements(
    "| Contract value | 84000 | EUR | 0 - 100000 |",
  ).measurements;
  assert.equal(piped.length, 1);
  assert.equal(piped[0].label, "Contract value");
  assert.equal(piped[0].verdict, "within");
});

test("numbers a source did not offer as measurements are left alone", () => {
  for (const line of [
    "Chapter 3 covers pages 40 - 88 of the book",
    "The team grew from 10 to 20 people between 2019 - 2024",
    "I paid 1,200.50 EUR last month for the licence",
    "Call me on 555 - 0134 tomorrow",
  ]) {
    assert.deepEqual(
      extractSuppliedMeasurements(line).measurements,
      [],
      line,
    );
  }
});

test("thousands separators and decimal commas are told apart", () => {
  assert.equal(parseNumber("1,240"), 1240);
  assert.equal(parseNumber("1,240.5"), 1240.5);
  assert.equal(parseNumber("3,5"), 3.5);
  assert.equal(parseNumber("not a number"), null);
});

test("the comparison is arithmetic, including at the edges", () => {
  assert.equal(verdictFor(5, { kind: "interval", low: 1, high: 10 }), "within");
  assert.equal(verdictFor(10, { kind: "interval", low: 1, high: 10 }), "at_bound");
  assert.equal(verdictFor(11, { kind: "interval", low: 1, high: 10 }), "above");
  assert.equal(verdictFor(0, { kind: "interval", low: 1, high: 10 }), "below");
  assert.equal(
    verdictFor(300, { kind: "comparator", operator: "<=", limit: 300 }),
    "within",
  );
  assert.equal(
    verdictFor(300, { kind: "comparator", operator: "<", limit: 300 }),
    "at_bound",
  );
  assert.equal(
    verdictFor(89, { kind: "comparator", operator: ">=", limit: 90 }),
    "below",
  );
  assert.equal(describeBound({ kind: "interval", low: 1, high: 2 }), "1 to 2");
});

// --- the scenario set -------------------------------------------------------

test("the evaluation set spans the domains it claims to", () => {
  const domains = new Set(scenarios.map((scenario) => scenario.domain));
  assert.ok(scenarios.length >= 7, "the set must not silently shrink");
  for (const domain of ["medical", "financial", "technical", "legal", "engineering"]) {
    assert.ok(domains.has(domain), `missing domain: ${domain}`);
  }
  for (const scenario of scenarios) {
    assert.ok(scenario.rubric.must.length >= 3, scenario.id);
    assert.ok(scenario.rubric.mustNot.length >= 2, scenario.id);
  }
});

for (const scenario of scenarios) {
  test(`${scenario.id}: the turn is classified as the evidence work it is`, () => {
    const classification = classifyEvidenceTurn({
      userText: scenario.question,
      suppliedEvidence: evidenceOf(scenario),
    });
    assert.equal(classification.register, scenario.expect.register);
    assert.equal(classification.highStakes, scenario.expect.highStakes);
    assert.equal(classification.suppliedEvidence, true);
  });

  test(`${scenario.id}: every bounded value is placed on the right side of its own bound`, () => {
    const { measurements } = extractSuppliedMeasurements(evidenceOf(scenario));
    const find = (label) => {
      const match = measurements.find((entry) => entry.label === label);
      assert.ok(match, `${label} was not read out of ${scenario.id}`);
      return match;
    };
    for (const expected of scenario.expect.within) {
      const measurement = find(expected.label);
      assert.equal(measurement.value, expected.value);
      assert.equal(
        measurement.verdict,
        "within",
        `${expected.label} sits inside its stated bound and must not be reported otherwise`,
      );
    }
    for (const expected of scenario.expect.outside) {
      const measurement = find(expected.label);
      assert.equal(measurement.value, expected.value);
      assert.ok(
        measurement.verdict === "above" || measurement.verdict === "below",
        `${expected.label} falls outside its stated bound`,
      );
    }
    // Nothing may be read out of the material that the scenario did not
    // account for: a stray reading is a wrong verdict waiting to be quoted.
    const accounted = new Set(
      [...scenario.expect.within, ...scenario.expect.outside].map(
        (entry) => entry.label,
      ),
    );
    for (const measurement of measurements) {
      assert.ok(
        accounted.has(measurement.label),
        `unaccounted reading in ${scenario.id}: ${measurement.label}`,
      );
    }
  });

  test(`${scenario.id}: the rendered section states each verdict rather than an impression`, () => {
    const section = evidenceCalibrationSection({
      userText: scenario.question,
      suppliedEvidence: evidenceOf(scenario),
      decision: decision(),
    });
    assert.ok(section, `${scenario.id} produced no section`);
    for (const expected of scenario.expect.within) {
      const line = section
        .split("\n")
        .find((entry) => entry.startsWith(`- ${expected.label}:`));
      assert.ok(line, `${expected.label} missing from the rendered check`);
      assert.match(line, /is inside the (range|bound)/);
    }
    for (const expected of scenario.expect.outside) {
      const line = section
        .split("\n")
        .find((entry) => entry.startsWith(`- ${expected.label}:`));
      assert.ok(line, `${expected.label} missing from the rendered check`);
      assert.match(line, /is (above|below) the (range|bound)/);
    }
  });
}

// --- the failure this exists to stop ---------------------------------------

test("a derived quantity out of range does not drag its in-range inputs with it", () => {
  const scenario = scenarios.find(
    (entry) => entry.id === "derived-metric-vs-in-range-component",
  );
  const section = evidenceCalibrationSection({
    userText: scenario.question,
    suppliedEvidence: evidenceOf(scenario),
    decision: decision(),
  });
  // The component is stated as in range and the derived quantity as out of it,
  // in the same block, so the model cannot infer one status from the other.
  assert.match(section, /Serum creatinine: 1\.02 mg\/dL is inside/);
  assert.match(section, /Estimated GFR \(calculated\): 58 mL\/min is below/);
  assert.match(
    section,
    /whatever quantity was derived from it/,
    "the block must say outright that a derived quantity does not reclassify its inputs",
  );
});

test("a set with nothing out of range still gets its bounds stated", () => {
  const scenario = scenarios.find(
    (entry) => entry.id === "benign-finding-in-context",
  );
  const section = evidenceCalibrationSection({
    userText: scenario.question,
    suppliedEvidence: evidenceOf(scenario),
    decision: decision(),
  });
  assert.match(section, /Indication length: 1\.8 mm is inside/);
  // With nothing outside, the mixed-picture sentence would be a lie.
  assert.doesNotMatch(section, /falls outside the bound stated for it/);
});

test("supplied material with no bounds still engages when the question is interpretive", () => {
  const scenario = scenarios.find(
    (entry) => entry.id === "control-evidence-supports-a-definite-answer",
  );
  const section = evidenceCalibrationSection({
    userText: scenario.question,
    suppliedEvidence: evidenceOf(scenario),
    decision: decision(),
  });
  assert.ok(section);
  // Nothing numeric to check, so no measurement block is invented for it.
  assert.doesNotMatch(section, /compared with that bound arithmetically/);
  // And the control case must not be pushed toward hedging.
  assert.match(section, /not.{0,40}turn a well evidenced answer into a hedged one/i);
});

// --- what the section says about itself ------------------------------------

test("the section stays invisible and refuses to reshape the answer", () => {
  const scenario = scenarios[0];
  const section = evidenceCalibrationSection({
    userText: scenario.question,
    suppliedEvidence: evidenceOf(scenario),
    decision: decision(),
  });
  assert.match(section, /None of this is visible to the user/);
  assert.match(section, /Do not name the register/);
  assert.match(section, /Answer the actual question first/);
});

test("external verification is asked for only where the turn can actually do it", () => {
  const scenario = scenarios.find((entry) => entry.expect.highStakes);
  // Only the per-turn half is read here: the durable contract talks about
  // external sources unconditionally, and it is the turn that has to know
  // whether this one can reach any.
  const turnHalf = (allowedTools) =>
    evidenceCalibrationSection({
      userText: scenario.question,
      suppliedEvidence: evidenceOf(scenario),
      decision: decision({ allowedTools }),
    }).split("# evidence_turn")[1];

  const withWeb = turnHalf(["websearch"]);
  assert.match(withWeb, /primary or official source/);
  // Browsing to decorate a settled answer is the failure in the other
  // direction, and the same sentence has to rule it out.
  assert.match(withWeb, /Do not search to decorate/);

  const withoutWeb = turnHalf([]);
  assert.doesNotMatch(withoutWeb, /primary or official source/);
  assert.match(withoutWeb, /could not be verified/);
});

// --- turns that must pay nothing for any of this ---------------------------

test("ordinary conversation gets no section at all", () => {
  for (const text of [
    "hi",
    "thanks!",
    "What time is the standup?",
    "Write me a haiku about rain.",
    "Explain how a hash map works.",
    "Rename this branch to feature/checkout-retry please.",
    "Summarise the last three messages for me.",
  ]) {
    assert.equal(
      evidenceCalibrationSection({ userText: text, decision: decision() }),
      null,
      text,
    );
  }
});

test("numbers alone are not evidence to calibrate", () => {
  // A pasted list with no bounds and no interpretive question is arithmetic,
  // not interpretation, and must not drag the contract onto the turn.
  const section = evidenceCalibrationSection({
    userText: "Add these up for me: 12, 48, 7, 91, 33, 5, 60, 14",
    decision: decision(),
  });
  assert.equal(section, null);
});

test("the switch turns the whole mechanism off", () => {
  withEnv({ ENABLE_EVIDENCE_CALIBRATION: "0" }, () => {
    assert.equal(
      evidenceCalibrationSection({
        userText: scenarios[0].question,
        suppliedEvidence: evidenceOf(scenarios[0]),
        decision: decision(),
      }),
      null,
    );
  });
});

// --- composition ------------------------------------------------------------

test("the composed prompt carries the contract on an evidence turn", () => {
  const scenario = scenarios[0];
  const prompt = composeHermesSystemPrompt({
    surface: "dashboard_terminal",
    decision: decision(),
    userText: scenario.question,
    suppliedEvidence: evidenceOf(scenario),
  });
  assert.match(prompt, /# evidence_calibration/);
  assert.match(prompt, /# evidence_turn/);
  assert.match(prompt, /Serum creatinine: 1\.02 mg\/dL is inside/);
  // Style still governs the answer, so it must be read before the contract
  // that defers to it.
  assert.ok(prompt.indexOf("# response_style") < prompt.indexOf("# evidence_calibration"));
});

test("the composed prompt is unchanged for a turn with nothing to calibrate", () => {
  const prompt = composeHermesSystemPrompt({
    surface: "dashboard_terminal",
    decision: decision(),
    userText: "What time is the standup?",
  });
  assert.doesNotMatch(prompt, /# evidence_calibration/);
  assert.doesNotMatch(prompt, /# evidence_turn/);
});

test("attachment text is what the check reads, and only the verbatim kinds", () => {
  const text = suppliedEvidenceText([
    {
      type: "text",
      name: "panel.txt",
      text: "Creatinine        1.02 mg/dL        0.70 - 1.30",
    },
    { type: "image", name: "photo.png", dataUrl: "data:image/png;base64,AA" },
    {
      type: "document",
      name: "report.docx",
      blobId: "abc",
      format: "docx",
      text: "| Debt to equity | 2.4 | ratio | 0.5 - 2.0 |",
    },
    { type: "video", name: "clip.mp4", blobId: "def", format: "mp4" },
  ]);
  assert.match(text, /panel\.txt/);
  assert.match(text, /report\.docx/);
  assert.doesNotMatch(text, /photo\.png/);
  assert.doesNotMatch(text, /clip\.mp4/);
  assert.equal(suppliedEvidenceText(undefined), "");
  assert.equal(extractSuppliedMeasurements(text).measurements.length, 2);
});

// --- wiring -----------------------------------------------------------------

test("every surface that composes a prompt hands it the material it received", () => {
  const turn = source("src/lib/conversations/turn-service.ts");
  assert.match(
    turn,
    /composeHermesSystemPrompt\(\{[\s\S]{0,400}?suppliedEvidence: suppliedEvidenceText\(documents\.inlineAttachments\)/,
  );
  const garden = source("src/lib/hermes/garden-chat-adapter.ts");
  assert.match(
    garden,
    /composeHermesSystemPrompt\(\{[\s\S]{0,400}?suppliedEvidence: suppliedEvidenceText\(documents\.inlineAttachments\)/,
  );
  // Agent mode off has its own pipeline and the same obligation.
  const direct = source("src/lib/conversations/direct-turn-service.ts");
  assert.match(direct, /evidenceCalibrationSection\(\{ userText, suppliedEvidence \}\)/);
  assert.match(direct, /suppliedEvidenceText\(attachments\)/);
});
