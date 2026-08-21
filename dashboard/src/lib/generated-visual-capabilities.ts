import crypto from "node:crypto";

import { VISUAL_SDK_VERSION } from "./visual-sdk.ts";

/**
 * Shared factual capability contract for generated-visual validation,
 * generation, and pre-generation executability review. It contains no
 * subject-specific pedagogy and no renderer-selection policy.
 */
export const GENERATED_VISUAL_CAPABILITY_MANIFEST_VERSION = 3 as const;

/**
 * Controls are expression inputs, not artifact identifiers. Keep their compact
 * grammar distinct from the broader visual/scene/output identifier grammar and
 * reserve the two runtime expression variables before a model can project a
 * learner control onto either one.
 */
export const GENERATED_VISUAL_CONTROL_ID_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;
export const GENERATED_VISUAL_RESERVED_CONTROL_IDS = ["x", "t"] as const;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

export const GENERATED_VISUAL_CAPABILITY_MANIFEST = deepFreeze({
  manifestVersion: GENERATED_VISUAL_CAPABILITY_MANIFEST_VERSION,
  sdkVersion: VISUAL_SDK_VERSION,
  definitionSchemaVersion: 1,
  sourceForm: {
    importModule: "@breadboard/visual-sdk",
    declarativeObjectOnly: true,
    callbacks: false,
    arbitraryHtml: false,
    externalUrls: false,
    browserGlobals: false,
  },
  hardLimits: {
    sourceCharacters: 60_000,
    astNodes: 2_500,
    literalDepth: 24,
    expressionNodes: 300,
    controls: 12,
    outputs: 16,
    scenes: 24,
    selectOptions: 24,
    spatialGroups: 12,
    spatialPrimitivesPerGroup: 16,
    spatialPrimitives: 48,
    spatialPolygonPoints: 12,
    spatialMagnitude: 1_000_000,
  },
  requiredContractControls: {
    maximum: 3,
    types: ["slider", "number", "select", "toggle", "button"],
    kinds: ["variable", "select_case", "process_position", "protocol_action"],
    protocolRoles: [
      "prediction_input",
      "commit_prediction",
      "reveal_outcome",
      "evaluate_prediction",
      "reset",
    ],
    protocolRules: {
      sourceSemanticTypes: ["slider", "number", "select"],
      pureProtocolTypes: ["button", "toggle"],
      pureProtocolKind: "protocol_action",
      pureProtocolEvidence: "exactly_empty",
      buttonDefault: 0,
      toggleDefault: false,
      testPrediction:
        "an evidence-grounded slider/number/select marked prediction_input must precede a distinct protocol_action button/toggle marked commit_prediction, which must precede a distinct protocol_action button/toggle marked reveal_outcome or evaluate_prediction; the outcome expression or visibility must remain unchanged through prediction and commit-only states and change only after valid commit then reveal/evaluate",
    },
    exactProjectionRequired: true,
  },
  runtimeControls: {
    controlIds: {
      grammar: GENERATED_VISUAL_CONTROL_ID_PATTERN.source,
      reserved: GENERATED_VISUAL_RESERVED_CONTROL_IDS,
    },
    types: ["slider", "number", "select", "toggle", "button"],
    selectExpressionValue: "stable zero-based option index",
    toggleExpressionValue: "0 or 1",
    buttonExpressionValue: "monotonic click count reset to 0 by Reset",
    updates:
      "control changes synchronously reevaluate outputs, visibility, and scenes",
    protocolRoleSequencing:
      "the trusted runtime keeps prediction_input editable until commit_prediction, then locks prediction; reveal_outcome and evaluate_prediction are disabled and mutation-guarded until commit; Reset clears the protocol and unlocks prediction",
    retainedHistoryOrHiddenState: false,
  },
  outputs: {
    representations: [
      "value",
      "chart",
      "diagram",
      "animation",
      "timeline",
      "table",
      "annotation",
    ],
    numericExpressionOptionalFor: [
      "diagram",
      "animation",
      "timeline",
      "table",
      "annotation",
    ],
  },
  expressions: {
    kinds: ["constant", "input", "binary", "unary", "clamp", "conditional"],
    binaryOperators: [
      "add",
      "subtract",
      "multiply",
      "divide",
      "power",
      "min",
      "max",
    ],
    unaryOperators: [
      "negate",
      "abs",
      "sqrt",
      "sin",
      "cos",
      "tan",
      "exp",
      "log",
    ],
    comparisons: ["lt", "lte", "gt", "gte", "eq"],
    timeVariable: "t is available to dynamic expressions",
  },
  scenes: {
    kinds: [
      "plot",
      "diagram",
      "spatial",
      "timeline",
      "value",
      "table",
      "annotation",
      "formula",
      "animated_marker",
      "status",
    ],
    diagram: "bounded 2D node-link graphs",
    spatial: {
      projection:
        "a model-authored orthographic or perspective camera, with stable authored-world framing supplied by the runtime",
      projections: ["orthographic", "perspective"],
      interactions: ["fixed", "orbit"],
      defaults: {
        projection: "orthographic",
        interaction: "fixed",
      },
      cameraAuthorship:
        "projection and interaction are explicit presentation fields; the runtime never infers them from subject matter, geometry, controls, or output representation",
      orbitNavigation: [
        "pointer drag",
        "touch drag",
        "wheel zoom",
        "keyboard orbit and zoom",
        "Home or Reset",
      ],
      primitiveKinds: [
        "plane",
        "polygon",
        "sphere",
        "cylinder",
        "cone",
        "point",
        "vector",
      ],
      plane:
        "centered full rectangular patch extending to both sides of center",
      polygon:
        "bounded filled planar patch with 3-12 ordered, coplanar, non-collinear, non-self-intersecting vertices",
      conditionalVisibility:
        "groups and primitives accept expression-valued visibleWhen",
      palette: ["green", "blue", "amber", "violet", "red", "cyan", "gray"],
      patterns: ["solid", "striped", "dotted", "crosshatch"],
    },
    timeline: "ordered static steps controlled by one declared progress input",
    status: "three textual states selected by an expression and threshold",
  },
  interactionProtocol: {
    predictionCommitThenReveal:
      "realizable only with declared prediction_input, commit_prediction, and reveal_outcome/evaluate_prediction roles plus an outcome or visibility expression gated by both action states; the trusted runtime locks prediction at commit and rejects premature reveal/evaluate activation",
    automaticStateMachine:
      "enabled only for exact model-authored protocolRole values; it does not infer a protocol from labels, subject matter, geometry, or control order",
    networkOrServerRoundTripInsideArtifact: false,
  },
} as const);

export const GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH = crypto
  .createHash("sha256")
  .update(JSON.stringify(GENERATED_VISUAL_CAPABILITY_MANIFEST))
  .digest("hex");
