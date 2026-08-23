import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  compileGeneratedVisualization,
  runGeneratedVisualDeterministicTests,
  validateGeneratedVisualizationDefinition,
} from "../src/lib/generated-visuals.ts";

const controls = [
  {
    id: "gain",
    label: "Gain",
    type: "slider",
    min: 0,
    max: 2,
    step: 0.1,
    defaultValue: 1,
  },
  {
    id: "sample_count",
    label: "Sample count",
    type: "number",
    min: 1,
    max: 10,
    step: 1,
    defaultValue: 4,
  },
  {
    id: "representation",
    label: "Representation",
    type: "select",
    options: ["time domain", "frequency domain"],
    defaultValue: "frequency domain",
  },
  {
    id: "show_phase",
    label: "Show phase",
    type: "toggle",
    defaultValue: false,
  },
  { id: "advance", label: "Advance", type: "button", defaultValue: 0 },
];

const requiredInputs = controls.map((control) => ({
  id: control.id,
  label: control.label,
  type: control.type,
  defaultValue: control.defaultValue,
  ...(control.options ? { options: control.options } : {}),
  ...(control.min !== undefined ? { min: control.min } : {}),
  ...(control.max !== undefined ? { max: control.max } : {}),
  ...(control.step !== undefined ? { step: control.step } : {}),
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

function definitionWithExpressions(
  expressionFor = (control) => inputExpression(control.id),
) {
  return {
    schemaVersion: 1,
    sdkVersion: "1.0.0",
    title: "Required control influence",
    description: "Each required learner control changes a numeric response.",
    accessibilityDescription:
      "Five labelled controls each update a numeric output, and Reset restores their documented defaults.",
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
  const validation = validateGeneratedVisualizationDefinition(
    definition,
    opportunity,
  );
  assert.equal(validation.errors.length, 0, validation.errors.join("; "));

  const result = runGeneratedVisualDeterministicTests({
    definition,
    opportunity,
    testCases: [],
  });

  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.semanticTests.length, controls.length);
  assert.ok(
    result.semanticTests.every((check) => check.passed),
    JSON.stringify(result.semanticTests),
  );
  const selectCheck = result.semanticTests.find((check) =>
    /Representation changes/.test(check.name),
  );
  assert.ok(selectCheck);
  assert.equal(
    JSON.parse(selectCheck.detail).defaultState,
    1,
    "the second select option is encoded as index 1",
  );
  assert.equal(JSON.parse(selectCheck.detail).alternateState, 0);
});

test("timeline progress must use a declared control rather than an invented runtime input", () => {
  const definition = definitionWithExpressions();
  definition.scenes = [{
    kind: "timeline",
    title: "Reviewed progression",
    progressInput: "progress",
    steps: [
      { id: "start", label: "Start", description: "Initial state.", at: 0 },
      { id: "finish", label: "Finish", description: "Final state.", at: 1 },
    ],
  }];
  for (const progressInput of ["progress", "t", "x"]) {
    definition.scenes[0].progressInput = progressInput;
    const invalid = validateGeneratedVisualizationDefinition(definition, opportunity);
    assert.match(
      invalid.errors.join("; "),
      new RegExp(
        `timeline progressInput "${progressInput}" must name one declared control id \\(gain, sample_count, representation, show_phase, advance\\)`,
        "i",
      ),
    );
  }

  definition.scenes[0].progressInput = "advance";
  const valid = validateGeneratedVisualizationDefinition(definition, opportunity);
  assert.equal(valid.errors.length, 0, valid.errors.join("; "));
});

test("select influence checks every non-default option index", () => {
  const selectOpportunity = structuredClone(opportunity);
  const requiredSelect = selectOpportunity.requiredInputs.find(
    (input) => input.id === "representation",
  );
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
      : control,
  );
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
      : output,
  );

  const result = runGeneratedVisualDeterministicTests({
    definition,
    opportunity: selectOpportunity,
    testCases: [],
  });
  const selectCheck = result.semanticTests.find((check) =>
    /Representation changes/.test(check.name),
  );
  assert.ok(selectCheck);
  assert.equal(selectCheck.passed, true, JSON.stringify(selectCheck));
  assert.equal(JSON.parse(selectCheck.detail).alternateState, 2);
});

test("candidate tests translate select option labels into their expression indices", () => {
  const definition = definitionWithExpressions();
  const result = runGeneratedVisualDeterministicTests({
    definition,
    opportunity,
    testCases: [
      {
        name: "time-domain option",
        inputs: { representation: "time domain" },
        expected: { output_representation: 0 },
      },
      {
        name: "frequency-domain option",
        inputs: { representation: "frequency domain" },
        expected: { output_representation: 1 },
      },
    ],
  });

  const candidateTests = result.semanticTests.filter((check) =>
    check.name.startsWith("candidate test:"),
  );
  assert.equal(candidateTests.length, 2);
  assert.ok(candidateTests.every((check) => check.passed), JSON.stringify(candidateTests));
});

test("inert required controls fail even when their IDs and labels are present", () => {
  const definition = definitionWithExpressions(() => ({
    kind: "constant",
    value: 1,
  }));
  const result = runGeneratedVisualDeterministicTests({
    definition,
    opportunity,
    testCases: [],
  });

  assert.equal(result.passed, false);
  assert.equal(result.semanticTests.length, controls.length);
  assert.ok(
    result.semanticTests.every((check) => check.passed === false),
    JSON.stringify(result.semanticTests),
  );
});

test("definition validation requires every opportunity control ID and type", () => {
  const missing = definitionWithExpressions();
  missing.controls = missing.controls.filter(
    (control) => control.id !== "representation",
  );
  let validation = validateGeneratedVisualizationDefinition(
    missing,
    opportunity,
  );
  assert.match(
    validation.errors.join("; "),
    /requires control representation/i,
  );

  const wrongType = definitionWithExpressions();
  wrongType.controls = wrongType.controls.map((control) =>
    control.id === "representation"
      ? { ...control, type: "toggle", defaultValue: false }
      : control,
  );
  validation = validateGeneratedVisualizationDefinition(wrongType, opportunity);
  assert.match(
    validation.errors.join("; "),
    /representation must use type select, not toggle/i,
  );
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
      : control,
  );
  let validation = validateGeneratedVisualizationDefinition(
    reordered,
    opportunity,
  );
  assert.match(
    validation.errors.join("; "),
    /representation must preserve options \["time domain","frequency domain"\], not \["frequency domain","time domain"\]/i,
  );

  const changedDefault = definitionWithExpressions();
  changedDefault.controls = changedDefault.controls.map((control) =>
    control.id === "representation"
      ? { ...control, defaultValue: "time domain" }
      : control,
  );
  validation = validateGeneratedVisualizationDefinition(
    changedDefault,
    opportunity,
  );
  assert.match(
    validation.errors.join("; "),
    /representation must preserve defaultValue "frequency domain", not "time domain"/i,
  );
});

test("test_prediction preserves the reviewed input -> commit -> reveal controls and exercises each protocol stage", () => {
  const predictionControls = [
    {
      id: "predicted_value",
      kind: "variable",
      label: "Predicted value",
      type: "slider",
      protocolRole: "prediction_input",
      unit: "V",
      min: 0,
      max: 2,
      step: 0.5,
      defaultValue: 1,
    },
    {
      id: "commit_prediction",
      kind: "protocol_action",
      label: "Commit prediction",
      type: "button",
      protocolRole: "commit_prediction",
      defaultValue: 0,
    },
    {
      id: "reveal_outcome",
      kind: "protocol_action",
      label: "Reveal outcome",
      type: "button",
      protocolRole: "reveal_outcome",
      defaultValue: 0,
    },
  ];
  const predictionOpportunity = {
    interactionGoal: "test_prediction",
    requiredInputs: structuredClone(predictionControls),
    requiredOutputs: [
      {
        id: "prediction_result",
        label: "Prediction result",
        representation: "value",
      },
    ],
    sourceAnchorIds: [],
  };
  const predictionDefinition = {
    schemaVersion: 1,
    sdkVersion: "1.0.0",
    title: "Prediction protocol",
    description: "Choose a prediction, commit it, and then reveal the result.",
    accessibilityDescription:
      "A prediction slider is followed by separate commit and reveal buttons before the finite result appears.",
    controls: structuredClone(predictionControls),
    outputs: [
      {
        id: "prediction_result",
        label: "Prediction result",
        representation: "value",
        expression: {
          kind: "conditional",
          comparison: "gt",
          left: inputExpression("reveal_outcome"),
          right: { kind: "constant", value: 0 },
          whenTrue: {
            kind: "conditional",
            comparison: "gt",
            left: inputExpression("commit_prediction"),
            right: { kind: "constant", value: 0 },
            whenTrue: inputExpression("predicted_value"),
            whenFalse: { kind: "constant", value: 0 },
          },
          whenFalse: { kind: "constant", value: 0 },
        },
      },
    ],
    scenes: [
      { kind: "value", outputId: "prediction_result", emphasis: "strong" },
    ],
  };

  const validation = validateGeneratedVisualizationDefinition(
    predictionDefinition,
    predictionOpportunity,
  );
  assert.equal(validation.errors.length, 0, validation.errors.join("; "));
  assert.deepEqual(
    validation.definition.controls.map(({ id, kind, type, protocolRole }) => ({
      id,
      kind,
      type,
      protocolRole,
    })),
    [
      {
        id: "predicted_value",
        kind: "variable",
        type: "slider",
        protocolRole: "prediction_input",
      },
      {
        id: "commit_prediction",
        kind: "protocol_action",
        type: "button",
        protocolRole: "commit_prediction",
      },
      {
        id: "reveal_outcome",
        kind: "protocol_action",
        type: "button",
        protocolRole: "reveal_outcome",
      },
    ],
  );
  const compiled = compileGeneratedVisualization(
    `import { defineVisualization } from "@breadboard/visual-sdk";\nexport default defineVisualization(${JSON.stringify(predictionDefinition)});`,
    predictionOpportunity,
  );
  assert.equal(
    compiled.validation.valid,
    true,
    compiled.validation.errors.join("; "),
  );
  assert.deepEqual(
    compiled.definition.controls.map(({ kind, protocolRole }) => ({
      kind,
      protocolRole,
    })),
    predictionControls.map(({ kind, protocolRole }) => ({
      kind,
      protocolRole,
    })),
  );
  assert.match(compiled.compiledJavaScript, /"kind":"protocol_action"/);
  assert.match(
    compiled.compiledJavaScript,
    /"protocolRole":"commit_prediction"/,
  );

  const result = runGeneratedVisualDeterministicTests({
    definition: compiled.definition,
    opportunity: predictionOpportunity,
    testCases: [],
  });
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.ok(
    result.semanticTests.every((check) => check.passed),
    JSON.stringify(result.semanticTests),
  );

  const revealBeforeCommit = structuredClone(predictionDefinition);
  revealBeforeCommit.outputs[0].expression = {
    kind: "conditional",
    comparison: "gt",
    left: inputExpression("reveal_outcome"),
    right: { kind: "constant", value: 0 },
    whenTrue: inputExpression("predicted_value"),
    whenFalse: { kind: "constant", value: 0 },
  };
  const unsafeResult = runGeneratedVisualDeterministicTests({
    definition: revealBeforeCommit,
    opportunity: predictionOpportunity,
    testCases: [],
  });
  const gateCheck = unsafeResult.semanticTests.find((check) =>
    /gated until valid commit then reveal\/evaluate/i.test(check.name),
  );
  assert.ok(gateCheck);
  assert.equal(gateCheck.passed, false, JSON.stringify(gateCheck));
  assert.equal(JSON.parse(gateCheck.detail).revealedBeforeCommit, true);
  const unsafeValidation = validateGeneratedVisualizationDefinition(
    revealBeforeCommit,
    predictionOpportunity,
  );
  assert.match(
    unsafeValidation.errors.join("; "),
    /test_prediction protocol is not executable:.*"revealedBeforeCommit":true/i,
  );

  const commitOnly = structuredClone(predictionDefinition);
  commitOnly.outputs[0].expression = {
    kind: "conditional",
    comparison: "gt",
    left: inputExpression("commit_prediction"),
    right: { kind: "constant", value: 0 },
    whenTrue: inputExpression("predicted_value"),
    whenFalse: { kind: "constant", value: 0 },
  };
  const commitOnlyValidation = validateGeneratedVisualizationDefinition(
    commitOnly,
    predictionOpportunity,
  );
  assert.match(
    commitOnlyValidation.errors.join("; "),
    /test_prediction protocol is not executable:.*"changedAtCommitOnly":true/i,
  );

  const nonnumericDefinition = structuredClone(predictionDefinition);
  const gatedVisibility = structuredClone(
    nonnumericDefinition.outputs[0].expression,
  );
  nonnumericDefinition.outputs[0].representation = "diagram";
  delete nonnumericDefinition.outputs[0].expression;
  nonnumericDefinition.scenes = [
    {
      kind: "annotation",
      title: "Prediction evaluation",
      text: "The model critic reviews this nonnumeric revealed outcome.",
      visibleWhen: gatedVisibility,
    },
  ];
  const nonnumericOpportunity = structuredClone(predictionOpportunity);
  nonnumericOpportunity.requiredOutputs[0].representation = "diagram";
  const nonnumericValidation = validateGeneratedVisualizationDefinition(
    nonnumericDefinition,
    nonnumericOpportunity,
  );
  assert.equal(
    nonnumericValidation.errors.length,
    0,
    nonnumericValidation.errors.join("; "),
  );
  const nonnumericResult = runGeneratedVisualDeterministicTests({
    definition: nonnumericValidation.definition,
    opportunity: nonnumericOpportunity,
    testCases: [],
  });
  assert.equal(nonnumericResult.passed, true, JSON.stringify(nonnumericResult));
  const visibilityGateCheck = nonnumericResult.semanticTests.find((check) =>
    /gated until valid commit then reveal\/evaluate/i.test(check.name),
  );
  assert.ok(
    visibilityGateCheck,
    JSON.stringify(nonnumericResult.semanticTests),
  );
  assert.equal(
    visibilityGateCheck.passed,
    true,
    JSON.stringify(visibilityGateCheck),
  );
  assert.deepEqual(JSON.parse(visibilityGateCheck.detail), {
    outcomeExpressionPaths: ["scenes[0].visibleWhen"],
    changedDuringPrediction: false,
    revealedBeforeCommit: false,
    changedAtCommitOnly: false,
    outcomeChangedAfterValidReveal: true,
    nonFiniteState: false,
  });
});

test("generated controls are an exact indexed projection with no unreviewed controls", () => {
  const exactControls = [
    {
      id: "predicted_case",
      kind: "select_case",
      label: "Predicted case",
      type: "select",
      protocolRole: "prediction_input",
      options: ["Case A", "Case B"],
      defaultValue: "Case A",
    },
    {
      id: "commit_prediction",
      kind: "protocol_action",
      label: "Commit prediction",
      type: "toggle",
      protocolRole: "commit_prediction",
      defaultValue: false,
    },
  ];
  const exactOpportunity = {
    requiredInputs: structuredClone(exactControls),
    requiredOutputs: [
      { id: "result", label: "Result", representation: "value" },
    ],
  };
  const exactDefinition = {
    schemaVersion: 1,
    sdkVersion: "1.0.0",
    title: "Exact controls",
    description: "Exercise exact projection of reviewed controls.",
    accessibilityDescription:
      "A case selector and commit toggle update one finite result in their reviewed order.",
    controls: structuredClone(exactControls),
    outputs: [
      {
        id: "result",
        label: "Result",
        representation: "value",
        expression: inputExpression("commit_prediction"),
      },
    ],
    scenes: [{ kind: "value", outputId: "result" }],
  };
  assert.equal(
    validateGeneratedVisualizationDefinition(exactDefinition, exactOpportunity)
      .errors.length,
    0,
  );

  const cases = [
    [
      "count",
      (definition) =>
        definition.controls.push({
          id: "extra_control",
          label: "Extra control",
          type: "button",
          defaultValue: 0,
        }),
    ],
    ["order", (definition) => definition.controls.reverse()],
    [
      "id",
      (definition) => {
        definition.controls[0].id = "different_case";
      },
    ],
    [
      "kind",
      (definition) => {
        definition.controls[0].kind = "variable";
      },
    ],
    [
      "label",
      (definition) => {
        definition.controls[0].label = "Different case";
      },
    ],
    [
      "type",
      (definition) => {
        definition.controls[1].type = "button";
        definition.controls[1].defaultValue = 0;
      },
    ],
    [
      "protocolRole",
      (definition) => {
        delete definition.controls[0].protocolRole;
      },
    ],
    ["options", (definition) => definition.controls[0].options.reverse()],
    [
      "defaultValue",
      (definition) => {
        definition.controls[0].defaultValue = "Case B";
      },
    ],
    [
      "unreviewed field",
      (definition) => {
        definition.controls[0].description = "Model-added prose";
      },
    ],
  ];
  for (const [name, mutate] of cases) {
    const drifted = structuredClone(exactDefinition);
    mutate(drifted);
    const errors = validateGeneratedVisualizationDefinition(
      drifted,
      exactOpportunity,
    ).errors;
    assert.ok(errors.length > 0, `${name} drift was accepted`);
    assert.match(
      errors.join("; "),
      name === "order"
        ? /reviewed order/i
        : name === "count"
          ? /requires exactly/i
          : new RegExp(name, "i"),
    );
  }
});

test("protocol roles reject incompatible runtime control types and defaults", () => {
  const definition = definitionWithExpressions();
  definition.controls[0] = {
    id: "gain",
    kind: "protocol_action",
    label: "Gain",
    type: "button",
    protocolRole: "prediction_input",
    defaultValue: 1,
  };
  definition.controls[1] = {
    id: "sample_count",
    kind: "variable",
    label: "Sample count",
    type: "slider",
    protocolRole: "commit_prediction",
    min: 0,
    max: 1,
    step: 1,
    defaultValue: 0,
  };
  const errors =
    validateGeneratedVisualizationDefinition(definition).errors.join("; ");
  assert.match(errors, /button defaultValue must be 0/i);
  assert.match(errors, /prediction_input must use slider, number, or select/i);
  assert.match(errors, /commit_prediction must use button or toggle/i);
});

test("definition validation requires every opportunity output ID", () => {
  const renamed = definitionWithExpressions();
  renamed.outputs = renamed.outputs.map((output) =>
    output.id === "output_representation"
      ? { ...output, id: "renamed_representation" }
      : output,
  );
  const validation = validateGeneratedVisualizationDefinition(
    renamed,
    opportunity,
  );
  assert.match(
    validation.errors.join("; "),
    /requires output output_representation/i,
  );
});

test("generated outputs preserve exact reviewed count and order with no learner-visible extras", () => {
  const definition = definitionWithExpressions();
  assert.equal(
    validateGeneratedVisualizationDefinition(definition, opportunity).errors
      .length,
    0,
  );

  const extra = definitionWithExpressions();
  extra.outputs.push({
    id: "unreviewed_output",
    label: "Unreviewed output",
    representation: "value",
    expression: { kind: "constant", value: 1 },
  });
  assert.match(
    validateGeneratedVisualizationDefinition(extra, opportunity).errors.join(
      "; ",
    ),
    /requires exactly 5 output\(s\).*declares 6/i,
  );

  const reordered = definitionWithExpressions();
  [reordered.outputs[0], reordered.outputs[1]] = [
    reordered.outputs[1],
    reordered.outputs[0],
  ];
  const reorderedErrors = validateGeneratedVisualizationDefinition(
    reordered,
    opportunity,
  ).errors.join("; ");
  assert.match(reorderedErrors, /requires output .* reviewed order/i);
  assert.match(reorderedErrors, /output_gain/i);
});

test("select contracts require unique options and a declared default", () => {
  const invalid = definitionWithExpressions();
  invalid.controls = invalid.controls.map((control) =>
    control.id === "representation"
      ? {
          ...control,
          options: ["time domain", "time domain"],
          defaultValue: "other",
        }
      : control,
  );
  const validation = validateGeneratedVisualizationDefinition(invalid);
  assert.match(validation.errors.join("; "), /options must be unique/i);
  assert.match(
    validation.errors.join("; "),
    /defaultValue must match one declared option/i,
  );
});

test("the sandbox keeps select labels in the UI but exposes option indices to expressions", () => {
  const runtime = fs.readFileSync(
    path.resolve(
      "../quartz/quartz/components/scripts/generatedVisualSandbox.inline.js",
    ),
    "utf8",
  );
  assert.match(runtime, /state\[control\.id\] = input\.selectedIndex/);
  assert.match(runtime, /readout\.textContent = input\.value/);
  assert.doesNotMatch(runtime, /state\[control\.id\] = input\.value/);
});
