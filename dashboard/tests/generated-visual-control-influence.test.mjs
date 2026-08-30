import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  runGeneratedVisualDeterministicTests,
  validateGeneratedVisualizationDefinition,
} from "../src/lib/generated-visuals.ts";
import { compileGeneratedVisualization } from "../src/lib/generated-visual-compiler.ts";

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

function resetProtocolFixture({ referenceReset = false, resetOnly = false } = {}) {
  const gain = {
    id: "gain",
    kind: "variable",
    label: "Gain",
    type: "slider",
    min: 0,
    max: 2,
    step: 0.1,
    defaultValue: 1,
  };
  const reset = {
    id: "reset_action",
    kind: "protocol_action",
    label: "Reset",
    type: "button",
    protocolRole: "reset",
    defaultValue: 0,
  };
  const fixtureControls = resetOnly ? [reset] : [gain, reset];
  const expression = resetOnly
    ? { kind: "constant", value: 1 }
    : referenceReset
      ? {
          kind: "binary",
          op: "add",
          left: inputExpression("gain"),
          right: inputExpression("reset_action"),
        }
      : inputExpression("gain");
  return {
    opportunity: {
      requiredInputs: structuredClone(fixtureControls),
      requiredOutputs: [{
        id: "visible_state",
        label: "Visible state",
        representation: "value",
      }],
      sourceAnchorIds: [],
    },
    definition: {
      schemaVersion: 1,
      sdkVersion: "1.0.0",
      title: "Runtime-owned Reset",
      description: "A control changes the visual and Reset restores defaults.",
      accessibilityDescription:
        "Change Gain, inspect Visible state, then use Reset to restore Gain to its default.",
      controls: structuredClone(fixtureControls),
      outputs: [{
        id: "visible_state",
        label: "Visible state",
        representation: "value",
        expression,
      }],
      scenes: [{ kind: "value", outputId: "visible_state", emphasis: "strong" }],
    },
  };
}

test("runtime-owned Reset restores another required control without expression dependence", () => {
  const fixture = resetProtocolFixture();
  const result = runGeneratedVisualDeterministicTests({
    ...fixture,
    testCases: [],
  });

  assert.equal(result.passed, true, JSON.stringify(result));
  const resetCheck = result.semanticTests.find((check) =>
    /Reset restores a changed visual/.test(check.name),
  );
  assert.ok(resetCheck);
  assert.equal(resetCheck.passed, true, JSON.stringify(resetCheck));
  assert.deepEqual(JSON.parse(resetCheck.detail), {
    runtimeOwned: true,
    authoredResetReference: false,
    changedControlId: "gain",
    alternateState: 0,
    changedExpressionCount: 3,
  });
});

test("runtime-owned Reset fails when there is no changed visual state to restore", () => {
  const fixture = resetProtocolFixture({ resetOnly: true });
  const result = runGeneratedVisualDeterministicTests({
    ...fixture,
    testCases: [],
  });

  assert.equal(result.passed, false);
  const resetCheck = result.semanticTests.find((check) =>
    /Reset restores a changed visual/.test(check.name),
  );
  assert.ok(resetCheck);
  assert.equal(resetCheck.passed, false);
  assert.match(JSON.parse(resetCheck.detail).reason, /no non-reset required control/i);
});

test("runtime-owned Reset rejects authored expression references to its control id", () => {
  const fixture = resetProtocolFixture({ referenceReset: true });
  const result = runGeneratedVisualDeterministicTests({
    ...fixture,
    testCases: [],
  });

  assert.equal(result.passed, false);
  const resetCheck = result.semanticTests.find((check) =>
    /Reset restores a changed visual/.test(check.name),
  );
  assert.ok(resetCheck);
  assert.equal(resetCheck.passed, false);
  assert.equal(JSON.parse(resetCheck.detail).authoredResetReference, true);
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

const branchOpportunity = {
  interactionGoal: "explore_structure",
  learnerAction:
    "Select the first, second, or combined case and inspect the highlighted branch of a persistent dependency diagram.",
  requiredInputs: [{
    id: "branch_case",
    kind: "select_case",
    label: "Branch case",
    type: "select",
    options: ["First", "Second", "First + Second"],
    defaultValue: "First + Second",
  }],
  requiredOutputs: [{
    id: "branch_view",
    label: "Selected dependency branch",
    representation: "diagram",
  }],
  sourceAnchorIds: [],
};

test("physical path selection does not trigger node-link branch requirements", () => {
  const physicalOpportunity = {
    interactionGoal: "explore_structure",
    learnerAction:
      "Select path a, b, or c and inspect the highlighted loop and enclosed current in the shared coaxial-conductor diagram.",
    requiredInputs: [{
      id: "amperian_path",
      kind: "select_case",
      label: "Closed physical path",
      type: "select",
      options: ["a", "b", "c"],
      defaultValue: "a",
    }],
    requiredOutputs: [{
      id: "enclosed_state",
      label: "Enclosed state",
      representation: "diagram",
    }],
    sourceAnchorIds: [],
  };
  const definition = {
    schemaVersion: 1,
    sdkVersion: "1.0.0",
    title: "Physical path selection",
    description: "The selected closed physical path changes the enclosed state.",
    accessibilityDescription:
      "Choose a closed path and inspect the corresponding enclosed state.",
    controls: structuredClone(physicalOpportunity.requiredInputs),
    outputs: [{
      ...physicalOpportunity.requiredOutputs[0],
      expression: inputExpression("amperian_path"),
    }],
    scenes: [{ kind: "value", outputId: "enclosed_state", emphasis: "strong" }],
  };
  const result = runGeneratedVisualDeterministicTests({
    definition,
    opportunity: physicalOpportunity,
    testCases: [],
  });

  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(
    result.semanticTests.some((check) =>
      /selected diagram branch/.test(check.name),
    ),
    false,
  );
});

function strengthWhen(optionIndex, whenTrue = 5, whenFalse = 1) {
  return {
    kind: "conditional",
    comparison: "eq",
    left: inputExpression("branch_case"),
    right: { kind: "constant", value: optionIndex },
    whenTrue: { kind: "constant", value: whenTrue },
    whenFalse: { kind: "constant", value: whenFalse },
  };
}

function selectedOrCombinedStrength(selectedIndex, high = 5, low = 1) {
  return {
    kind: "conditional",
    comparison: "eq",
    left: inputExpression("branch_case"),
    right: { kind: "constant", value: selectedIndex },
    whenTrue: { kind: "constant", value: high },
    whenFalse: strengthWhen(2, high, low),
  };
}

function branchDefinition(edgeStrengths) {
  return {
    schemaVersion: 1,
    sdkVersion: "1.0.0",
    title: "Persistent selected branches",
    description:
      "Choose one dependency case while the full node-link topology remains visible.",
    accessibilityDescription:
      "A labelled branch selector changes the emphasized dependency edges; Reset restores the combined case.",
    controls: structuredClone(branchOpportunity.requiredInputs),
    outputs: structuredClone(branchOpportunity.requiredOutputs),
    scenes: [{
      kind: "diagram",
      title: "Dependency branches",
      nodes: [
        { id: "first", label: "A", x: 140, y: 110 },
        { id: "second", label: "B", x: 140, y: 250 },
        { id: "result", label: "R", x: 500, y: 180 },
      ],
      edges: [
        { from: "first", to: "result", directed: true, strength: edgeStrengths[0] },
        { from: "second", to: "result", directed: true, strength: edgeStrengths[1] },
      ],
    }],
  };
}

test("selected-branch diagram validation requires exclusive single branches and a combined union", () => {
  const unrelatedUniformChange = branchDefinition([
    inputExpression("branch_case"),
    inputExpression("branch_case"),
  ]);
  let result = runGeneratedVisualDeterministicTests({
    definition: unrelatedUniformChange,
    opportunity: branchOpportunity,
    testCases: [],
  });
  assert.equal(
    result.semanticTests.find((check) => /changes a numeric/.test(check.name))?.passed,
    true,
    "a uniform width change demonstrates why generic influence alone is insufficient",
  );
  let branchCheck = result.semanticTests.find((check) =>
    /branch_case gives every selected diagram branch/.test(check.name),
  );
  assert.ok(branchCheck);
  assert.equal(branchCheck.passed, false, JSON.stringify(branchCheck));
  assert.match(branchCheck.detail, /exact control branch_case/);
  assert.match(branchCheck.detail, /diagram edge\.strength/);
  assert.match(
    branchCheck.detail,
    /combined\/both\/all\/sum\/total\/and\/&\/\+/,
  );

  const combinedDoesNotShowUnion = branchDefinition([
    strengthWhen(0),
    strengthWhen(1),
  ]);
  result = runGeneratedVisualDeterministicTests({
    definition: combinedDoesNotShowUnion,
    opportunity: branchOpportunity,
    testCases: [],
  });
  branchCheck = result.semanticTests.find((check) =>
    /branch_case gives every selected diagram branch/.test(check.name),
  );
  assert.equal(branchCheck?.passed, false, JSON.stringify(branchCheck));

  const faithfulBranches = branchDefinition([
    selectedOrCombinedStrength(0),
    selectedOrCombinedStrength(1),
  ]);
  result = runGeneratedVisualDeterministicTests({
    definition: faithfulBranches,
    opportunity: branchOpportunity,
    testCases: [],
  });
  branchCheck = result.semanticTests.find((check) =>
    /branch_case gives every selected diagram branch/.test(check.name),
  );
  assert.equal(branchCheck?.passed, true, JSON.stringify(branchCheck));
  assert.equal(result.passed, true, JSON.stringify(result));
});

function selectedBranchCheck(definition, branchContract = branchOpportunity) {
  const result = runGeneratedVisualDeterministicTests({
    definition,
    opportunity: branchContract,
    testCases: [],
  });
  const branchCheck = result.semanticTests.find((check) =>
    /branch_case gives every selected diagram branch/.test(check.name),
  );
  assert.ok(branchCheck, JSON.stringify(result.semanticTests));
  return branchCheck;
}

test("selected-branch highlighting must be perceptible and persist across runtime contexts", () => {
  const imperceptible = branchDefinition([
    selectedOrCombinedStrength(0, 1.00000002, 1),
    selectedOrCombinedStrength(1, 1.00000002, 1),
  ]);
  assert.equal(
    selectedBranchCheck(imperceptible).passed,
    false,
    "sub-pixel numerical differences are not visible highlighting",
  );

  const addClock = (expression) => ({
    kind: "binary",
    op: "add",
    left: expression,
    right: {
      kind: "binary",
      op: "multiply",
      left: { kind: "constant", value: 10 },
      right: inputExpression("t"),
    },
  });
  const clockSaturatesEveryBranch = branchDefinition([
    addClock(selectedOrCombinedStrength(0)),
    addClock(selectedOrCombinedStrength(1)),
  ]);
  clockSaturatesEveryBranch.animation = {
    durationMs: 1_000,
    loop: true,
    autoplay: true,
  };
  assert.equal(
    selectedBranchCheck(clockSaturatesEveryBranch).passed,
    false,
    "highlighting that disappears when the runtime clock advances must fail",
  );

  const otherControlSaturatesEveryBranch = branchDefinition([
    {
      kind: "binary",
      op: "add",
      left: selectedOrCombinedStrength(0),
      right: {
        kind: "binary",
        op: "multiply",
        left: { kind: "constant", value: 10 },
        right: inputExpression("wash_out"),
      },
    },
    {
      kind: "binary",
      op: "add",
      left: selectedOrCombinedStrength(1),
      right: {
        kind: "binary",
        op: "multiply",
        left: { kind: "constant", value: 10 },
        right: inputExpression("wash_out"),
      },
    },
  ]);
  otherControlSaturatesEveryBranch.controls.push({
    id: "wash_out",
    kind: "variable",
    label: "Wash out",
    type: "toggle",
    defaultValue: false,
  });
  assert.equal(
    selectedBranchCheck(otherControlSaturatesEveryBranch).passed,
    false,
    "highlighting that disappears in another authored control state must fail",
  );

  const bothToggleWashout = {
    kind: "conditional",
    comparison: "gt",
    left: inputExpression("mask_a"),
    right: { kind: "constant", value: 0 },
    whenTrue: {
      kind: "conditional",
      comparison: "gt",
      left: inputExpression("mask_b"),
      right: { kind: "constant", value: 0 },
      whenTrue: { kind: "constant", value: 10 },
      whenFalse: { kind: "constant", value: 0 },
    },
    whenFalse: { kind: "constant", value: 0 },
  };
  const twoControlsTogetherSaturateEveryBranch = branchDefinition([
    {
      kind: "binary",
      op: "add",
      left: selectedOrCombinedStrength(0),
      right: bothToggleWashout,
    },
    {
      kind: "binary",
      op: "add",
      left: selectedOrCombinedStrength(1),
      right: bothToggleWashout,
    },
  ]);
  for (const controlId of ["mask_a", "mask_b"]) {
    twoControlsTogetherSaturateEveryBranch.controls.push({
      id: controlId,
      kind: "variable",
      label: controlId,
      type: "toggle",
      defaultValue: false,
    });
  }
  assert.equal(
    selectedBranchCheck(twoControlsTogetherSaturateEveryBranch).passed,
    false,
    "the bounded cross-product must catch highlighting that vanishes only when two controls are active together",
  );

  assert.equal(
    selectedBranchCheck(
      branchDefinition([
        selectedOrCombinedStrength(0),
        selectedOrCombinedStrength(1),
      ]),
    ).passed,
    true,
  );
});

test("selected-branch topology rejects decoys, duplicate paths, and combined extras", () => {
  const faithful = branchDefinition([
    selectedOrCombinedStrength(0),
    selectedOrCombinedStrength(1),
  ]);

  const decoy = structuredClone(faithful);
  const staticPromisedDiagram = structuredClone(decoy.scenes[0]);
  staticPromisedDiagram.edges.forEach((edge) => {
    edge.strength = { kind: "constant", value: 1 };
  });
  decoy.scenes = [staticPromisedDiagram, decoy.scenes[0]];
  assert.equal(
    selectedBranchCheck(decoy).passed,
    false,
    "an unrelated responsive diagram cannot excuse the promised static diagram",
  );

  for (const reversed of [false, true]) {
    const duplicatePath = structuredClone(faithful);
    duplicatePath.scenes[0].edges[1] = {
      ...duplicatePath.scenes[0].edges[1],
      from: reversed ? "result" : "first",
      to: reversed ? "first" : "result",
    };
    assert.equal(
      selectedBranchCheck(duplicatePath).passed,
      false,
      reversed
        ? "a reverse overlay is not a second visible branch"
        : "a duplicate endpoint pair is not a second visible branch",
    );
  }

  const combinedExtra = structuredClone(faithful);
  combinedExtra.scenes[0].nodes.push({
    id: "unrelated",
    label: "U",
    x: 320,
    y: 280,
  });
  combinedExtra.scenes[0].edges.push({
    from: "unrelated",
    to: "result",
    directed: true,
    strength: strengthWhen(2),
  });
  assert.equal(
    selectedBranchCheck(combinedExtra).passed,
    false,
    "combined highlighting must equal the union, not add an unrelated branch",
  );

  const disconnected = branchDefinition([
    selectedOrCombinedStrength(0),
    selectedOrCombinedStrength(1),
  ]);
  disconnected.scenes[0].nodes = [
    { id: "first", label: "A", x: 120, y: 100 },
    { id: "first_result", label: "A result", x: 280, y: 100 },
    { id: "second", label: "B", x: 360, y: 260 },
    { id: "second_result", label: "B result", x: 520, y: 260 },
  ];
  disconnected.scenes[0].edges[0].to = "first_result";
  disconnected.scenes[0].edges[1].to = "second_result";
  const disconnectedCheck = selectedBranchCheck(disconnected);
  assert.equal(
    disconnectedCheck.passed,
    false,
    "two disconnected selectable edges are not one dependency graph",
  );
  assert.match(disconnectedCheck.detail, /connected dependency graph/);

  const connectedByPersistentDependency = structuredClone(disconnected);
  connectedByPersistentDependency.scenes[0].edges.push({
    from: "first_result",
    to: "second",
    directed: true,
    strength: { kind: "constant", value: 1 },
  });
  assert.equal(
    selectedBranchCheck(connectedByPersistentDependency).passed,
    true,
    "a persistent static dependency edge may connect the two selectable branches",
  );
});

test("conjoined option labels identify a combined branch only when they cover peer options", () => {
  for (const options of [
    ["First", "Second", "First and Second"],
    ["Electric", "Magnetic", "Electric & Magnetic"],
  ]) {
    const conjoinedOpportunity = structuredClone(branchOpportunity);
    conjoinedOpportunity.requiredInputs[0].options = options;
    conjoinedOpportunity.requiredInputs[0].defaultValue = options[2];
    const definition = branchDefinition([
      selectedOrCombinedStrength(0),
      selectedOrCombinedStrength(1),
    ]);
    definition.controls[0].options = options;
    definition.controls[0].defaultValue = options[2];
    assert.equal(
      selectedBranchCheck(definition, conjoinedOpportunity).passed,
      true,
      options.join(" / "),
    );
  }

  const descriptiveOpportunity = structuredClone(branchOpportunity);
  descriptiveOpportunity.requiredInputs[0].options = [
    "Cause and effect",
    "Second",
    "Third",
  ];
  descriptiveOpportunity.requiredInputs[0].defaultValue = "Third";
  const descriptiveDefinition = branchDefinition([
    selectedOrCombinedStrength(0),
    selectedOrCombinedStrength(1),
  ]);
  descriptiveDefinition.controls[0].options =
    descriptiveOpportunity.requiredInputs[0].options;
  descriptiveDefinition.controls[0].defaultValue = "Third";
  assert.equal(
    selectedBranchCheck(descriptiveDefinition, descriptiveOpportunity).passed,
    false,
    "a descriptive `and` without peer-option coverage is not an aggregate role",
  );
});

test("malformed diagram edges fail validation and deterministic branch diagnostics fail closed", () => {
  const malformed = branchDefinition([
    selectedOrCombinedStrength(0),
    selectedOrCombinedStrength(1),
  ]);
  malformed.scenes[0].edges = [null, null];
  const validation = validateGeneratedVisualizationDefinition(malformed);
  assert.match(
    validation.errors.join("; "),
    /scenes\[0\]\.edges\[0\] must be an object/,
  );
  assert.doesNotThrow(() => selectedBranchCheck(malformed));
  assert.equal(selectedBranchCheck(malformed).passed, false);

  const unknownEndpoint = branchDefinition([
    selectedOrCombinedStrength(0),
    selectedOrCombinedStrength(1),
  ]);
  unknownEndpoint.scenes[0].edges[0].from = "missing";
  assert.match(
    validateGeneratedVisualizationDefinition(unknownEndpoint).errors.join("; "),
    /edges\[0\]\.from must name a diagram node/,
  );
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
