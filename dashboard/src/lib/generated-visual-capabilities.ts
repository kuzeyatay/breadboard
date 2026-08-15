import crypto from "node:crypto";

import { VISUAL_SDK_VERSION } from "./visual-sdk.ts";

/**
 * Shared factual capability contract for generated-visual validation,
 * generation, and pre-generation executability review. It contains no
 * subject-specific pedagogy and no renderer-selection policy.
 */
export const GENERATED_VISUAL_CAPABILITY_MANIFEST_VERSION = 1 as const;

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
    types: ["slider", "number", "select"],
    kinds: ["variable", "select_case", "process_position"],
    exactProjectionRequired: true,
  },
  runtimeControls: {
    types: ["slider", "number", "select", "toggle", "button"],
    selectExpressionValue: "stable zero-based option index",
    toggleExpressionValue: "0 or 1",
    buttonExpressionValue: "monotonic click count reset to 0 by Reset",
    updates: "control changes synchronously reevaluate outputs, visibility, and scenes",
    retainedHistoryOrHiddenState: false,
  },
  outputs: {
    representations: ["value", "chart", "diagram", "animation", "timeline", "table", "annotation"],
    numericExpressionOptionalFor: ["diagram", "animation", "timeline", "table", "annotation"],
  },
  expressions: {
    kinds: ["constant", "input", "binary", "unary", "clamp", "conditional"],
    binaryOperators: ["add", "subtract", "multiply", "divide", "power", "min", "max"],
    unaryOperators: ["negate", "abs", "sqrt", "sin", "cos", "tan", "exp", "log"],
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
      projection: "stable orthographic projection supplied by the runtime",
      primitiveKinds: ["plane", "polygon", "sphere", "cylinder", "cone", "point", "vector"],
      plane: "centered full rectangular patch extending to both sides of center",
      polygon: "bounded filled planar patch with 3-12 ordered, coplanar, non-collinear, non-self-intersecting vertices",
      conditionalVisibility: "groups and primitives accept expression-valued visibleWhen",
      palette: ["green", "blue", "amber", "violet", "red", "cyan", "gray"],
      patterns: ["solid", "striped", "dotted", "crosshatch"],
    },
    timeline: "ordered static steps controlled by one declared progress input",
    status: "three textual states selected by an expression and threshold",
  },
  interactionProtocol: {
    predictionCommitThenReveal:
      "realizable with a declared prediction input and expression-gated result, using a button click count or another explicit authored control state to keep the result hidden until commitment",
    automaticStateMachine: false,
    networkOrServerRoundTripInsideArtifact: false,
  },
} as const);

export const GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH = crypto
  .createHash("sha256")
  .update(JSON.stringify(GENERATED_VISUAL_CAPABILITY_MANIFEST))
  .digest("hex");
