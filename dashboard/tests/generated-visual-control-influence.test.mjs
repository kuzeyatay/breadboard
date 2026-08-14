import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  runGeneratedVisualDeterministicTests,
  validateGeneratedVisualizationDefinition,
} from "../src/lib/generated-visuals.ts";

const controls = [
  { id: "gain", label: "Gain", type: "slider", min: 0, max: 2, step: 0.1, defaultValue: 1 },
  { id: "sample_count", label: "Sample count", type: "number", min: 1, max: 10, step: 1, defaultValue: 4 },
  {
    id: "representation",
    label: "Representation",
    type: "select",
    options: ["time domain", "frequency domain"],
    defaultValue: "frequency domain",
  },
  { id: "show_phase", label: "Show phase", type: "toggle", defaultValue: false },
  { id: "advance", label: "Advance", type: "button", defaultValue: 0 },
];

const requiredInputs = controls.map((control) => ({
  id: control.id,
  label: control.label,
  type: control.type,
  defaultValue: control.defaultValue,
  ...(control.options ? { options: control.options } : {}),
}));

const opportunity = {
  requiredInputs,
  requiredOutputs: controls.map((control) => ({
    id: `output_${control.id}`,
    label: `${control.label} response`,
    representation: "value",
  })),
  sourceAnchorIds: [],
};

function inputExpression(id) {
  return { kind: "input", id };
}

function definitionWithExpressions(expressionFor = (control) => inputExpression(control.id)) {
  return {
    schemaVersion: 1,
    sdkVersion: "1.0.0",
    title: "Required control influence",
    description: "Each required learner control changes a numeric response.",
    accessibilityDescription: "Five labelled controls each update a numeric output, and Reset restores their documented defaults.",
    controls: structuredClone(controls),
    outputs: controls.map((control) => ({
      id: `output_${control.id}`,
      label: `${control.label} response`,
      representation: "value",
      expression: expressionFor(control),
    })),
    scenes: [{ kind: "value", outputId: "output_gain", emphasis: "strong" }],
  };
}

test("all required control types must influence a numeric output or scene expression", () => {
  const definition = definitionWithExpressions();
  const validation = validateGeneratedVisualizationDefinition(definition, opportunity);
  assert.equal(validation.errors.length, 0, validation.errors.join("; "));

  const result = runGeneratedVisualDeterministicTests({
    definition,
    opportunity,
    testCases: [],
  });

  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.semanticTests.length, controls.length);
  assert.ok(result.semanticTests.every((check) => check.passed), JSON.stringify(result.semanticTests));
  const selectCheck = result.semanticTests.find((check) => /Representation changes/.test(check.name));
  assert.ok(selectCheck);
  assert.equal(JSON.parse(selectCheck.detail).defaultState, 1, "the second select option is encoded as index 1");
  assert.equal(JSON.parse(selectCheck.detail).alternateState, 0);
});

test("select influence checks every non-default option index", () => {
  const selectOpportunity = structuredClone(opportunity);
  const requiredSelect = selectOpportunity.requiredInputs.find((input) => input.id === "representation");
  requiredSelect.options = ["time domain", "frequency domain", "phasor domain"];
  requiredSelect.defaultValue = "time domain";

  const definition = definitionWithExpressions();
  definition.controls = definition.controls.map((control) =>
    control.id === "representation"
      ? {
        ...control,
        options: ["time domain", "frequency domain", "phasor domain"],
        defaultValue: "time domain",
      }
      : control);
  definition.outputs = definition.outputs.map((output) =>
    output.id === "output_representation"
      ? {
        ...output,
        expression: {
          kind: "conditional",
          comparison: "eq",
          left: inputExpression("representation"),
          right: { kind: "constant", value: 2 },
          whenTrue: { kind: "constant", value: 1 },
          whenFalse: { kind: "constant", value: 0 },
        },
      }
      : output);

  const result = runGeneratedVisualDeterministicTests({
    definition,
    opportunity: selectOpportunity,
    testCases: [],
  });
  const selectCheck = result.semanticTests.find((check) => /Representation changes/.test(check.name));
  assert.ok(selectCheck);
  assert.equal(selectCheck.passed, true, JSON.stringify(selectCheck));
  assert.equal(JSON.parse(selectCheck.detail).alternateState, 2);
});

test("inert required controls fail even when their IDs and labels are present", () => {
  const definition = definitionWithExpressions(() => ({ kind: "constant", value: 1 }));
  const result = runGeneratedVisualDeterministicTests({
    definition,
    opportunity,
    testCases: [],
  });

  assert.equal(result.passed, false);
  assert.equal(result.semanticTests.length, controls.length);
  assert.ok(result.semanticTests.every((check) => check.passed === false), JSON.stringify(result.semanticTests));
});

test("definition validation requires every opportunity control ID and type", () => {
  const missing = definitionWithExpressions();
  missing.controls = missing.controls.filter((control) => control.id !== "representation");
  let validation = validateGeneratedVisualizationDefinition(missing, opportunity);
  assert.match(validation.errors.join("; "), /requires control representation/i);

  const wrongType = definitionWithExpressions();
  wrongType.controls = wrongType.controls.map((control) =>
    control.id === "representation"
      ? { ...control, type: "toggle", defaultValue: false }
      : control);
  validation = validateGeneratedVisualizationDefinition(wrongType, opportunity);
  assert.match(validation.errors.join("; "), /representation must use type select, not toggle/i);
});

test("definition validation preserves required select option indices and default", () => {
  const reordered = definitionWithExpressions();
  reordered.controls = reordered.controls.map((control) =>
    control.id === "representation"
      ? {
        ...control,
        options: ["frequency domain", "time domain"],
        defaultValue: "frequency domain",
      }
      : control);
  let validation = validateGeneratedVisualizationDefinition(reordered, opportunity);
  assert.match(validation.errors.join("; "), /representation must preserve its declared option order/i);

  const changedDefault = definitionWithExpressions();
  changedDefault.controls = changedDefault.controls.map((control) =>
    control.id === "representation"
      ? { ...control, defaultValue: "time domain" }
      : control);
  validation = validateGeneratedVisualizationDefinition(changedDefault, opportunity);
  assert.match(validation.errors.join("; "), /representation must use defaultValue "frequency domain"/i);
});

test("definition validation requires every opportunity output ID", () => {
  const renamed = definitionWithExpressions();
  renamed.outputs = renamed.outputs.map((output) =>
    output.id === "output_representation"
      ? { ...output, id: "renamed_representation" }
      : output);
  const validation = validateGeneratedVisualizationDefinition(renamed, opportunity);
  assert.match(validation.errors.join("; "), /requires output output_representation/i);
});

test("select contracts require unique options and a declared default", () => {
  const invalid = definitionWithExpressions();
  invalid.controls = invalid.controls.map((control) =>
    control.id === "representation"
      ? { ...control, options: ["time domain", "time domain"], defaultValue: "other" }
      : control);
  const validation = validateGeneratedVisualizationDefinition(invalid);
  assert.match(validation.errors.join("; "), /options must be unique/i);
  assert.match(validation.errors.join("; "), /defaultValue must match one declared option/i);
});

test("the sandbox keeps select labels in the UI but exposes option indices to expressions", () => {
  const runtime = fs.readFileSync(
    path.resolve("../quartz/quartz/components/scripts/generatedVisualSandbox.inline.js"),
    "utf8",
  );
  assert.match(runtime, /state\[control\.id\] = input\.selectedIndex/);
  assert.match(runtime, /readout\.textContent = input\.value/);
  assert.doesNotMatch(runtime, /state\[control\.id\] = input\.value/);
});
