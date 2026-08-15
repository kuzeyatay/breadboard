import crypto from "crypto";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { spawnSync } from "child_process";
import ts from "typescript";
import type OpenAI from "openai";
import { withCouncil } from "./council.ts";
import {
  GENERATED_VISUAL_CAPABILITY_MANIFEST,
  GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH,
} from "./generated-visual-capabilities.ts";
import {
  VISUAL_SDK_VERSION,
  type GeneratedVisualizationDefinition,
  type GeneratedVisualControl,
  type SpatialPrimitive,
  type SpatialScalar,
  type SpatialScene,
  type SpatialVector3,
  type VisualExpression,
} from "./visual-sdk.ts";
import type {
  SourceVisualRelationship,
  VisualizationOpportunity,
} from "./visualization-opportunities.ts";
import { isRetryableModelTransportError } from "./http-502-retry.ts";

export const GENERATED_VISUAL_BLOCK_LANG = "breadboard-generated-visual";
export const GENERATED_VISUAL_SCHEMA_VERSION =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.definitionSchemaVersion;
export const GENERATED_VISUAL_MAX_SOURCE_CHARS =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.sourceCharacters;
export const GENERATED_VISUAL_PROVIDER_TRANSPORT_MAX_ATTEMPTS = 3;
/** Spatial visuals can require several critic-guided, model-authored revisions
 * across independent geometry, runtime, and accessibility gates. Keep that
 * semantic loop finite and distinct from identical-request transport replay. */
export const GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS = 8;
/** Complex declarative visual generation can legitimately take longer than a
 * general chat request. Keep one explicit, bounded per-request deadline while
 * preserving the separate three-replay transport ladder. */
export const GENERATED_VISUAL_PROVIDER_REQUEST_TIMEOUT_MS = 180_000;

const SDK_IMPORT = GENERATED_VISUAL_CAPABILITY_MANIFEST.sourceForm.importModule;
const IMPORT_ALLOWLIST = new Set([SDK_IMPORT, "react"]);
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,79}$/;
const FORBIDDEN_IDENTIFIERS = new Set([
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "eval",
  "Function",
  "document",
  "window",
  "localStorage",
  "sessionStorage",
  "navigator",
  "process",
  "require",
  "global",
  "globalThis",
  "setTimeout",
  "setInterval",
  "Worker",
  "SharedWorker",
  "EventSource",
]);
const FORBIDDEN_PROPERTIES = new Set([
  "cookie",
  "serviceWorker",
  "prototype",
  "__proto__",
  "constructor",
  "dangerouslySetInnerHTML",
  "innerHTML",
  "outerHTML",
  "location",
  "open",
  "sendBeacon",
]);
const EXTERNAL_URL_RE = /(?:https?:|wss?:|file:|javascript:|data:text\/html)/i;
const MAX_AST_NODES = GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.astNodes;
const MAX_LITERAL_DEPTH =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.literalDepth;
const MAX_EXPRESSION_NODES =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.expressionNodes;
const MAX_SCENES = GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.scenes;
const MAX_CONTROLS = GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.controls;
const MAX_OUTPUTS = GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.outputs;
const MAX_SELECT_OPTIONS =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.selectOptions;
const MAX_SPATIAL_GROUPS =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.spatialGroups;
const MAX_SPATIAL_PRIMITIVES_PER_GROUP =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.spatialPrimitivesPerGroup;
const MAX_SPATIAL_PRIMITIVES =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.spatialPrimitives;
const MAX_SPATIAL_POLYGON_POINTS =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.spatialPolygonPoints;
const MAX_SPATIAL_MAGNITUDE =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.spatialMagnitude;
const SPATIAL_PRIMITIVE_KINDS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.primitiveKinds,
);
const SPATIAL_PALETTE = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.palette,
);
const SPATIAL_PATTERNS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.patterns,
);
const SPATIAL_PROJECTIONS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.projections,
);
const SPATIAL_INTERACTIONS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.interactions,
);
const GENERATED_CONTROL_TYPES = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.runtimeControls.types,
);
const GENERATED_CONTROL_KINDS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.requiredContractControls.kinds,
);
const GENERATED_CONTROL_PROTOCOL_ROLES = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.requiredContractControls.protocolRoles,
);
const GENERATED_OUTPUT_REPRESENTATIONS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.outputs.representations,
);
const GENERATED_EXPRESSION_KINDS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.kinds,
);
const GENERATED_BINARY_OPERATORS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.binaryOperators,
);
const GENERATED_UNARY_OPERATORS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.unaryOperators,
);
const GENERATED_COMPARISONS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.comparisons,
);
const GENERATED_SCENE_KINDS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.kinds,
);
const GENERATED_COMPILATION_CACHE = new Map<
  string,
  GeneratedVisualCompilation
>();

export interface GeneratedVisualizationTestCase {
  name: string;
  inputs: Record<string, unknown>;
  expected: Record<string, unknown>;
  tolerance?: number;
}

export interface GeneratedVisualTokenUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface GeneratedVisualizationCandidate {
  title: string;
  explanation: string;
  sourceCode: string;
  testCases: GeneratedVisualizationTestCase[];
  accessibilityDescription: string;
  pedagogicalClaims: string[];
  tokenUsage?: GeneratedVisualTokenUsage;
}

export type GeneratedVisualizationStatus =
  | "draft"
  | "validated"
  | "compiled"
  | "tested"
  | "critic_approved"
  | "published"
  | "rejected";

export interface GeneratedVisualizationManifest {
  schemaVersion: number;
  sdkVersion: string;
  id: string;
  gardenId: string;
  learningUnitId: string;
  title: string;
  description: string;
  learningObjective: string;
  sourceAnchorIds: string[];
  sourceVisualIds: string[];
  sourceVisualRelationships: SourceVisualRelationship[];
  conceptIds: string[];
  insertionAnchor: string;
  targetPage: string;
  targetHeading: string;
  sourceHash: string;
  compiledHash: string;
  status: GeneratedVisualizationStatus;
  generatedAt: string;
  generatorModel: string;
  generationAttempt: number;
  version: number;
  previousVersion?: number;
  artifactPath: string;
  similarityFingerprint: string;
}

export interface GeneratedVisualValidationRecord {
  valid: boolean;
  checkedAt: string;
  astNodeCount: number;
  sourceBytes: number;
  imports: string[];
  errors: string[];
  warnings: string[];
}

export interface GeneratedVisualTestsRecord {
  passed: boolean;
  checkedAt: string;
  staticTests: Array<{ name: string; passed: boolean; detail?: string }>;
  semanticTests: Array<{ name: string; passed: boolean; detail?: string }>;
  runtimeTests: Array<{ name: string; passed: boolean; detail?: string }>;
  browser?: {
    executable?: string;
    viewports: string[];
    screenshotCreated: boolean;
  };
}

export interface GeneratedVisualCriticRecord {
  approved: boolean;
  checkedAt: string;
  reason: string;
  requestedChanges: string[];
  scores: {
    pedagogicalValue: number;
    sourceFidelity: number;
    usability: number;
    accessibility: number;
  };
  providerApproved?: boolean;
  providerScores?: Record<string, number>;
  tokenUsage?: GeneratedVisualTokenUsage;
}

export interface GeneratedVisualLifecycleRecord {
  status: GeneratedVisualizationStatus;
  at: string;
  attempt: number;
  detail?: string;
}

export interface GeneratedVisualCompilation {
  definition: GeneratedVisualizationDefinition | null;
  validation: GeneratedVisualValidationRecord;
  sourceHash: string;
  compiledHash: string;
  compiledJavaScript: string;
  cacheHit: boolean;
}

export interface GeneratedVisualResult {
  manifest: GeneratedVisualizationManifest | null;
  definition: GeneratedVisualizationDefinition | null;
  errors: string[];
  failureCategory?:
    | "validation"
    | "compilation"
    | "runtime"
    | "critic"
    | "generation";
}

export interface GeneratedVisualEvent {
  type: string;
  data: Record<string, unknown>;
}

type EventSink = (event: GeneratedVisualEvent) => void;

function nowIso(): string {
  return new Date().toISOString();
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function generatedVisualTokenUsage(
  value: unknown,
): GeneratedVisualTokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens =
    asFiniteNumber(value.prompt_tokens ?? value.input_tokens) ?? 0;
  const outputTokens =
    asFiniteNumber(value.completion_tokens ?? value.output_tokens) ?? 0;
  const details = isRecord(value.completion_tokens_details)
    ? value.completion_tokens_details
    : {};
  const reasoningTokens = asFiniteNumber(details.reasoning_tokens) ?? 0;
  const totalTokens =
    asFiniteNumber(value.total_tokens) ?? inputTokens + outputTokens;
  if (inputTokens + outputTokens + totalTokens === 0) return undefined;
  return { inputTokens, outputTokens, reasoningTokens, totalTokens };
}

function boundedGeneratedVisualEvidence(
  value: unknown,
  maxChars: number,
): unknown {
  if (value === undefined) return undefined;
  let serialized = "";
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { truncated: true, text: String(value).slice(0, maxChars) };
  }
  if (serialized.length <= maxChars) return value;
  return { truncated: true, jsonExcerpt: serialized.slice(0, maxChars) };
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function literalFromAst(expression: ts.Expression, depth = 0): unknown {
  if (depth > MAX_LITERAL_DEPTH)
    throw new Error("module literal nesting is too deep");
  const node = unwrapExpression(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (
    ts.isPrefixUnaryExpression(node) &&
    (node.operator === ts.SyntaxKind.MinusToken ||
      node.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(node.operand)
  ) {
    const value = Number(node.operand.text);
    return node.operator === ts.SyntaxKind.MinusToken ? -value : value;
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) => {
      if (ts.isSpreadElement(element))
        throw new Error("spread elements are not allowed");
      return literalFromAst(element, depth + 1);
    });
  }
  if (ts.isObjectLiteralExpression(node)) {
    const result: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) {
        throw new Error("only plain object property assignments are allowed");
      }
      if (property.name && ts.isComputedPropertyName(property.name)) {
        throw new Error("computed property names are not allowed");
      }
      const key =
        property.name &&
        (ts.isIdentifier(property.name) ||
          ts.isStringLiteral(property.name) ||
          ts.isNumericLiteral(property.name))
          ? property.name.text
          : "";
      if (!key || FORBIDDEN_PROPERTIES.has(key)) {
        throw new Error(`property ${key || "(unknown)"} is not allowed`);
      }
      result[key] = literalFromAst(property.initializer, depth + 1);
    }
    return result;
  }
  throw new Error(
    `executable syntax is not allowed (${ts.SyntaxKind[node.kind]})`,
  );
}

function staticAstValidation(sourceCode: string): {
  definition: unknown;
  imports: string[];
  errors: string[];
  warnings: string[];
  astNodeCount: number;
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const imports: string[] = [];
  if (sourceCode.length > GENERATED_VISUAL_MAX_SOURCE_CHARS) {
    return {
      definition: null,
      imports,
      errors: [
        `source exceeds ${GENERATED_VISUAL_MAX_SOURCE_CHARS} characters`,
      ],
      warnings,
      astNodeCount: 0,
    };
  }
  const sourceFile = ts.createSourceFile(
    "generated-visual.tsx",
    sourceCode,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX,
  );
  const parseDiagnostics =
    (
      sourceFile as ts.SourceFile & {
        parseDiagnostics?: readonly ts.Diagnostic[];
      }
    ).parseDiagnostics ?? [];
  for (const diagnostic of parseDiagnostics) {
    errors.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
  }

  let astNodeCount = 0;
  const visit = (node: ts.Node) => {
    astNodeCount += 1;
    if (astNodeCount > MAX_AST_NODES) return;
    if (ts.isIdentifier(node) && FORBIDDEN_IDENTIFIERS.has(node.text)) {
      errors.push(`forbidden global or capability: ${node.text}`);
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      FORBIDDEN_PROPERTIES.has(node.name.text)
    ) {
      errors.push(`forbidden property access: ${node.name.text}`);
    }
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      EXTERNAL_URL_RE.test(node.text)
    ) {
      errors.push("external URLs and executable URL schemes are not allowed");
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      errors.push("dynamic import() is not allowed");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (astNodeCount > MAX_AST_NODES)
    errors.push(`AST exceeds ${MAX_AST_NODES} nodes`);

  let exportExpression: ts.Expression | null = null;
  let importCount = 0;
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      importCount += 1;
      const moduleName = ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : "";
      imports.push(moduleName);
      if (!IMPORT_ALLOWLIST.has(moduleName))
        errors.push(`import ${moduleName || "(unknown)"} is not allowed`);
      if (moduleName === SDK_IMPORT) {
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) {
          errors.push("the SDK must use named imports");
        } else {
          for (const element of bindings.elements) {
            if (element.name.text !== "defineVisualization") {
              errors.push(
                `SDK import ${element.name.text} is not allowed in generated modules v1`,
              );
            }
          }
        }
      } else if (moduleName === "react") {
        errors.push(
          "React is allowlisted for future SDK versions but generated modules v1 must remain declarative",
        );
      }
      continue;
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      if (exportExpression) errors.push("only one default export is allowed");
      exportExpression = statement.expression;
      continue;
    }
    if (statement.kind !== ts.SyntaxKind.EmptyStatement) {
      errors.push(`top-level ${ts.SyntaxKind[statement.kind]} is not allowed`);
    }
  }
  if (importCount !== 1 || imports[0] !== SDK_IMPORT) {
    errors.push(
      `generated modules must import only defineVisualization from ${SDK_IMPORT}`,
    );
  }
  if (!exportExpression)
    errors.push("a default defineVisualization export is required");

  let definition: unknown = null;
  if (exportExpression) {
    const expression = unwrapExpression(exportExpression);
    if (
      !ts.isCallExpression(expression) ||
      !ts.isIdentifier(expression.expression) ||
      expression.expression.text !== "defineVisualization" ||
      expression.arguments.length !== 1
    ) {
      errors.push(
        "default export must be defineVisualization({ ...literal definition... })",
      );
    } else {
      try {
        definition = literalFromAst(expression.arguments[0]);
      } catch (error) {
        errors.push(
          error instanceof Error
            ? error.message
            : "module literal could not be parsed",
        );
      }
    }
  }
  return {
    definition,
    imports,
    errors: [...new Set(errors)],
    warnings,
    astNodeCount,
  };
}

function validateExpression(
  expression: unknown,
  knownInputs: Set<string>,
  errors: string[],
  pathLabel: string,
  depth = 0,
  counter = { value: 0 },
): expression is VisualExpression {
  counter.value += 1;
  if (counter.value > MAX_EXPRESSION_NODES) {
    errors.push(
      `${pathLabel}: expression exceeds ${MAX_EXPRESSION_NODES} nodes`,
    );
    return false;
  }
  if (depth > 16 || !isRecord(expression)) {
    errors.push(`${pathLabel}: expression is invalid or too deeply nested`);
    return false;
  }
  const kind = expression.kind;
  if (!GENERATED_EXPRESSION_KINDS.has(String(kind))) {
    errors.push(
      `${pathLabel}: unsupported expression kind ${String(kind ?? "(missing)")}`,
    );
    return false;
  }
  if (kind === "constant") {
    if (asFiniteNumber(expression.value) === undefined)
      errors.push(`${pathLabel}: constant must be finite`);
    return asFiniteNumber(expression.value) !== undefined;
  }
  if (kind === "input") {
    const id = typeof expression.id === "string" ? expression.id : "";
    if (!knownInputs.has(id))
      errors.push(`${pathLabel}: unknown input ${id || "(missing)"}`);
    return knownInputs.has(id);
  }
  if (kind === "binary") {
    if (!GENERATED_BINARY_OPERATORS.has(String(expression.op))) {
      errors.push(`${pathLabel}: unsupported binary operator`);
    }
    const left = validateExpression(
      expression.left,
      knownInputs,
      errors,
      `${pathLabel}.left`,
      depth + 1,
      counter,
    );
    const right = validateExpression(
      expression.right,
      knownInputs,
      errors,
      `${pathLabel}.right`,
      depth + 1,
      counter,
    );
    return left && right;
  }
  if (kind === "unary") {
    if (!GENERATED_UNARY_OPERATORS.has(String(expression.op))) {
      errors.push(`${pathLabel}: unsupported unary operator`);
    }
    return validateExpression(
      expression.argument,
      knownInputs,
      errors,
      `${pathLabel}.argument`,
      depth + 1,
      counter,
    );
  }
  if (kind === "clamp") {
    return ["value", "min", "max"].every((field) =>
      validateExpression(
        expression[field],
        knownInputs,
        errors,
        `${pathLabel}.${field}`,
        depth + 1,
        counter,
      ),
    );
  }
  if (kind === "conditional") {
    if (!GENERATED_COMPARISONS.has(String(expression.comparison))) {
      errors.push(`${pathLabel}: unsupported comparison`);
    }
    return ["left", "right", "whenTrue", "whenFalse"].every((field) =>
      validateExpression(
        expression[field],
        knownInputs,
        errors,
        `${pathLabel}.${field}`,
        depth + 1,
        counter,
      ),
    );
  }
  errors.push(
    `${pathLabel}: unsupported expression kind ${String(kind ?? "(missing)")}`,
  );
  return false;
}

function validateControl(
  value: unknown,
  errors: string[],
  index: number,
): value is GeneratedVisualControl {
  if (!isRecord(value)) {
    errors.push(`controls[${index}] must be an object`);
    return false;
  }
  const id = typeof value.id === "string" ? value.id : "";
  const label = typeof value.label === "string" ? value.label.trim() : "";
  const type = typeof value.type === "string" ? value.type : "";
  if (!ID_PATTERN.test(id)) errors.push(`controls[${index}].id is invalid`);
  if (!label) errors.push(`controls[${index}] needs an accessible label`);
  if (!GENERATED_CONTROL_TYPES.has(type)) {
    errors.push(`controls[${index}].type is invalid`);
  }
  if (
    value.kind !== undefined &&
    (typeof value.kind !== "string" || !GENERATED_CONTROL_KINDS.has(value.kind))
  ) {
    errors.push(`controls[${index}].kind is invalid`);
  }
  if (
    value.protocolRole !== undefined &&
    (typeof value.protocolRole !== "string" ||
      !GENERATED_CONTROL_PROTOCOL_ROLES.has(value.protocolRole))
  ) {
    errors.push(`controls[${index}].protocolRole is invalid`);
  }
  if (
    (type === "slider" || type === "number") &&
    asFiniteNumber(value.defaultValue) === undefined
  ) {
    errors.push(`controls[${index}] needs a finite numeric default`);
  }
  if (type === "slider" || type === "number") {
    const min = asFiniteNumber(value.min);
    const max = asFiniteNumber(value.max);
    const step = asFiniteNumber(value.step);
    if (min === undefined || max === undefined || min >= max)
      errors.push(`controls[${index}] needs min < max`);
    if (step === undefined || step <= 0)
      errors.push(`controls[${index}] needs a positive step`);
  }
  if (type === "select") {
    const options = Array.isArray(value.options)
      ? value.options.filter(
          (option): option is string =>
            typeof option === "string" && option.trim().length > 0,
        )
      : [];
    if (options.length < 2 || options.length > MAX_SELECT_OPTIONS) {
      errors.push(
        `controls[${index}] select needs 2-${MAX_SELECT_OPTIONS} options`,
      );
    }
    if (new Set(options).size !== options.length)
      errors.push(`controls[${index}] select options must be unique`);
    if (
      typeof value.defaultValue !== "string" ||
      !options.includes(value.defaultValue)
    ) {
      errors.push(
        `controls[${index}] select defaultValue must match one declared option`,
      );
    }
  }
  if (type === "toggle" && typeof value.defaultValue !== "boolean") {
    errors.push(`controls[${index}] toggle defaultValue must be boolean`);
  }
  if (type === "button" && value.defaultValue !== 0) {
    errors.push(`controls[${index}] button defaultValue must be 0`);
  }
  if (
    value.protocolRole === "prediction_input" &&
    type !== "slider" &&
    type !== "number" &&
    type !== "select"
  ) {
    errors.push(
      `controls[${index}] prediction_input must use slider, number, or select`,
    );
  }
  if (
    typeof value.protocolRole === "string" &&
    value.protocolRole !== "prediction_input" &&
    type !== "button" &&
    type !== "toggle"
  ) {
    errors.push(
      `controls[${index}] ${value.protocolRole} must use button or toggle`,
    );
  }
  if (
    value.kind === "protocol_action" &&
    type !== "button" &&
    type !== "toggle"
  ) {
    errors.push(`controls[${index}] protocol_action must use button or toggle`);
  }
  if (
    typeof value.kind === "string" &&
    value.kind !== "protocol_action" &&
    (type === "button" || type === "toggle")
  ) {
    errors.push(`controls[${index}] ${type} must use kind protocol_action`);
  }
  if (
    value.protocolRole === "prediction_input" &&
    value.kind === "protocol_action"
  ) {
    errors.push(
      `controls[${index}] prediction_input must not use kind protocol_action`,
    );
  }
  if (
    typeof value.protocolRole === "string" &&
    value.protocolRole !== "prediction_input" &&
    value.kind !== undefined &&
    value.kind !== "protocol_action"
  ) {
    errors.push(
      `controls[${index}] ${value.protocolRole} must use kind protocol_action`,
    );
  }
  return true;
}

function validateSpatialScalar(
  value: unknown,
  knownInputs: Set<string>,
  errors: string[],
  pathLabel: string,
  options: { positive?: boolean; max?: number } = {},
): boolean {
  const numeric = asFiniteNumber(value);
  if (numeric !== undefined) {
    const max = options.max ?? MAX_SPATIAL_MAGNITUDE;
    let valid = true;
    if (Math.abs(numeric) > max) {
      errors.push(`${pathLabel} must stay within +/-${max}`);
      valid = false;
    }
    if (options.positive && numeric <= 0) {
      errors.push(`${pathLabel} must be positive`);
      valid = false;
    }
    return valid;
  }
  if (!isRecord(value)) {
    errors.push(`${pathLabel} must be a finite number or expression`);
    return false;
  }
  return validateExpression(value, knownInputs, errors, pathLabel);
}

function validateSpatialVector3(
  value: unknown,
  knownInputs: Set<string>,
  errors: string[],
  pathLabel: string,
): boolean {
  if (!Array.isArray(value) || value.length !== 3) {
    errors.push(`${pathLabel} must contain exactly three spatial scalars`);
    return false;
  }
  return value.every((component, index) =>
    validateSpatialScalar(
      component,
      knownInputs,
      errors,
      `${pathLabel}[${index}]`,
    ),
  );
}

function literalSpatialVectorLength(value: unknown): number | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const components = value.map(asFiniteNumber);
  if (components.some((component) => component === undefined)) return undefined;
  return Math.hypot(...(components as number[]));
}

function spatialPolygonShapeDiagnostics(
  points: Array<[number, number, number]>,
  pathLabel: string,
): string[] {
  if (points.length < 3)
    return [`${pathLabel}.points needs at least three points`];
  const scale = Math.max(1, ...points.flatMap((point) => point.map(Math.abs)));
  const tolerance = Math.max(1e-7, scale * 1e-9);
  const subtract = (
    left: [number, number, number],
    right: [number, number, number],
  ): [number, number, number] =>
    left.map((value, index) => value - right[index]) as [
      number,
      number,
      number,
    ];
  const cross = (
    left: [number, number, number],
    right: [number, number, number],
  ): [number, number, number] => [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
  const errors: string[] = [];
  for (let leftIndex = 0; leftIndex < points.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < points.length;
      rightIndex += 1
    ) {
      if (
        Math.hypot(...subtract(points[leftIndex], points[rightIndex])) <=
        tolerance
      ) {
        errors.push(`${pathLabel}.points must be distinct`);
        leftIndex = points.length;
        break;
      }
    }
  }
  const origin = points[0];
  const firstEdge = points
    .slice(1)
    .map((point) => subtract(point, origin))
    .find((edge) => Math.hypot(...edge) > tolerance);
  if (!firstEdge)
    return [
      ...errors,
      `${pathLabel}.points must contain at least three non-collinear points`,
    ];
  const firstLength = Math.hypot(...firstEdge);
  const normal = points
    .slice(1)
    .map((point) => cross(firstEdge, subtract(point, origin)))
    .find((candidate) => Math.hypot(...candidate) / firstLength > tolerance);
  if (!normal)
    return [
      ...errors,
      `${pathLabel}.points must contain at least three non-collinear points`,
    ];
  const normalLength = Math.hypot(...normal);
  const unitNormal = normal.map((component) => component / normalLength);
  const nonCoplanar = points.some((point) => {
    const delta = subtract(point, origin);
    return (
      Math.abs(
        delta.reduce(
          (sum, component, index) => sum + component * unitNormal[index],
          0,
        ),
      ) > tolerance
    );
  });
  if (nonCoplanar) return [...errors, `${pathLabel}.points must be coplanar`];

  const dominantAxis = unitNormal
    .map((component, index) => ({ index, magnitude: Math.abs(component) }))
    .sort((left, right) => right.magnitude - left.magnitude)[0].index;
  const projected = points.map(
    (point) =>
      point.filter((_, index) => index !== dominantAxis) as [number, number],
  );
  const projectedScale = Math.max(
    1,
    ...projected.flatMap((point) => point.map(Math.abs)),
  );
  const areaTolerance = tolerance * projectedScale;
  const orientation = (
    first: [number, number],
    second: [number, number],
    third: [number, number],
  ) =>
    (second[0] - first[0]) * (third[1] - first[1]) -
    (second[1] - first[1]) * (third[0] - first[0]);
  const onSegment = (
    first: [number, number],
    second: [number, number],
    point: [number, number],
  ) =>
    point[0] >= Math.min(first[0], second[0]) - tolerance &&
    point[0] <= Math.max(first[0], second[0]) + tolerance &&
    point[1] >= Math.min(first[1], second[1]) - tolerance &&
    point[1] <= Math.max(first[1], second[1]) + tolerance;
  const segmentsIntersect = (
    firstStart: [number, number],
    firstEnd: [number, number],
    secondStart: [number, number],
    secondEnd: [number, number],
  ) => {
    const firstSideStart = orientation(firstStart, firstEnd, secondStart);
    const firstSideEnd = orientation(firstStart, firstEnd, secondEnd);
    const secondSideStart = orientation(secondStart, secondEnd, firstStart);
    const secondSideEnd = orientation(secondStart, secondEnd, firstEnd);
    if (
      (Math.abs(firstSideStart) <= areaTolerance &&
        onSegment(firstStart, firstEnd, secondStart)) ||
      (Math.abs(firstSideEnd) <= areaTolerance &&
        onSegment(firstStart, firstEnd, secondEnd)) ||
      (Math.abs(secondSideStart) <= areaTolerance &&
        onSegment(secondStart, secondEnd, firstStart)) ||
      (Math.abs(secondSideEnd) <= areaTolerance &&
        onSegment(secondStart, secondEnd, firstEnd))
    )
      return true;
    return (
      firstSideStart > areaTolerance !== firstSideEnd > areaTolerance &&
      secondSideStart > areaTolerance !== secondSideEnd > areaTolerance
    );
  };
  const edgeCount = projected.length;
  for (let firstIndex = 0; firstIndex < edgeCount; firstIndex += 1) {
    const firstNext = (firstIndex + 1) % edgeCount;
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < edgeCount;
      secondIndex += 1
    ) {
      const secondNext = (secondIndex + 1) % edgeCount;
      if (
        firstIndex === secondIndex ||
        firstIndex === secondNext ||
        firstNext === secondIndex ||
        firstNext === secondNext
      )
        continue;
      if (
        segmentsIntersect(
          projected[firstIndex],
          projected[firstNext],
          projected[secondIndex],
          projected[secondNext],
        )
      ) {
        errors.push(
          `${pathLabel}.points must form a non-self-intersecting boundary`,
        );
        return errors;
      }
    }
  }
  return errors;
}

function validateSpatialPrimitive(
  value: unknown,
  knownInputs: Set<string>,
  errors: string[],
  pathLabel: string,
  primitiveIds: Set<string>,
): value is SpatialPrimitive {
  if (!isRecord(value)) {
    errors.push(`${pathLabel} must be an object`);
    return false;
  }
  const kind = typeof value.kind === "string" ? value.kind : "";
  if (!SPATIAL_PRIMITIVE_KINDS.has(kind)) {
    errors.push(
      `${pathLabel}.kind must be plane, polygon, sphere, cylinder, cone, point, or vector`,
    );
    return false;
  }
  const id = typeof value.id === "string" ? value.id : "";
  if (!ID_PATTERN.test(id) || primitiveIds.has(id)) {
    errors.push(
      `${pathLabel}.id is invalid or duplicate within the spatial scene`,
    );
  } else {
    primitiveIds.add(id);
  }
  const label = typeof value.label === "string" ? value.label.trim() : "";
  if (!label || label.length > 72)
    errors.push(`${pathLabel}.label must contain 1-72 characters`);
  if (value.color !== undefined && !SPATIAL_PALETTE.has(String(value.color))) {
    errors.push(`${pathLabel}.color must use a safe spatial palette token`);
  }
  if (
    value.pattern !== undefined &&
    !SPATIAL_PATTERNS.has(String(value.pattern))
  ) {
    errors.push(
      `${pathLabel}.pattern must be solid, striped, dotted, or crosshatch`,
    );
  }
  if (value.opacity !== undefined) {
    const opacity = asFiniteNumber(value.opacity);
    if (opacity === undefined || opacity < 0.1 || opacity > 1) {
      errors.push(`${pathLabel}.opacity must be between 0.1 and 1`);
    }
  }
  if (value.visibleWhen !== undefined) {
    validateExpression(
      value.visibleWhen,
      knownInputs,
      errors,
      `${pathLabel}.visibleWhen`,
    );
  }

  const commonFields = [
    "kind",
    "id",
    "label",
    "color",
    "pattern",
    "opacity",
    "visibleWhen",
  ];
  const fieldsByKind: Record<string, string[]> = {
    plane: ["center", "normal", "size"],
    polygon: ["points"],
    sphere: ["center", "radius"],
    cylinder: ["center", "axis", "radius", "height"],
    cone: ["apex", "axis", "radius", "height"],
    point: ["position", "size"],
    vector: ["from", "to", "headSize"],
  };
  const allowedFields = new Set([...commonFields, ...fieldsByKind[kind]]);
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field))
      errors.push(`${pathLabel}.${field} is not supported for a ${kind}`);
  }

  if (kind === "plane") {
    validateSpatialVector3(
      value.center,
      knownInputs,
      errors,
      `${pathLabel}.center`,
    );
    validateSpatialVector3(
      value.normal,
      knownInputs,
      errors,
      `${pathLabel}.normal`,
    );
    validateSpatialScalar(
      value.size,
      knownInputs,
      errors,
      `${pathLabel}.size`,
      { positive: true },
    );
    if (literalSpatialVectorLength(value.normal) === 0)
      errors.push(`${pathLabel}.normal must be non-zero`);
  } else if (kind === "polygon") {
    if (
      !Array.isArray(value.points) ||
      value.points.length < 3 ||
      value.points.length > MAX_SPATIAL_POLYGON_POINTS
    ) {
      errors.push(
        `${pathLabel}.points must contain 3-${MAX_SPATIAL_POLYGON_POINTS} spatial vectors`,
      );
    } else {
      value.points.forEach((point, pointIndex) => {
        validateSpatialVector3(
          point,
          knownInputs,
          errors,
          `${pathLabel}.points[${pointIndex}]`,
        );
      });
      const literalPoints = value.points.map((point) =>
        Array.isArray(point) ? point.map(asFiniteNumber) : [],
      );
      if (
        literalPoints.every(
          (point) =>
            point.length === 3 &&
            point.every((component) => component !== undefined),
        )
      ) {
        errors.push(
          ...spatialPolygonShapeDiagnostics(
            literalPoints.map(
              (point) => point.map(Number) as [number, number, number],
            ),
            pathLabel,
          ),
        );
      }
    }
  } else if (kind === "sphere") {
    validateSpatialVector3(
      value.center,
      knownInputs,
      errors,
      `${pathLabel}.center`,
    );
    validateSpatialScalar(
      value.radius,
      knownInputs,
      errors,
      `${pathLabel}.radius`,
      { positive: true },
    );
  } else if (kind === "cylinder") {
    validateSpatialVector3(
      value.center,
      knownInputs,
      errors,
      `${pathLabel}.center`,
    );
    validateSpatialVector3(
      value.axis,
      knownInputs,
      errors,
      `${pathLabel}.axis`,
    );
    validateSpatialScalar(
      value.radius,
      knownInputs,
      errors,
      `${pathLabel}.radius`,
      { positive: true },
    );
    validateSpatialScalar(
      value.height,
      knownInputs,
      errors,
      `${pathLabel}.height`,
      { positive: true },
    );
    if (literalSpatialVectorLength(value.axis) === 0)
      errors.push(`${pathLabel}.axis must be non-zero`);
  } else if (kind === "cone") {
    validateSpatialVector3(
      value.apex,
      knownInputs,
      errors,
      `${pathLabel}.apex`,
    );
    validateSpatialVector3(
      value.axis,
      knownInputs,
      errors,
      `${pathLabel}.axis`,
    );
    validateSpatialScalar(
      value.radius,
      knownInputs,
      errors,
      `${pathLabel}.radius`,
      { positive: true },
    );
    validateSpatialScalar(
      value.height,
      knownInputs,
      errors,
      `${pathLabel}.height`,
      { positive: true },
    );
    if (literalSpatialVectorLength(value.axis) === 0)
      errors.push(`${pathLabel}.axis must be non-zero`);
  } else if (kind === "point") {
    validateSpatialVector3(
      value.position,
      knownInputs,
      errors,
      `${pathLabel}.position`,
    );
    if (value.size !== undefined) {
      validateSpatialScalar(
        value.size,
        knownInputs,
        errors,
        `${pathLabel}.size`,
        { positive: true, max: 40 },
      );
    }
  } else if (kind === "vector") {
    validateSpatialVector3(
      value.from,
      knownInputs,
      errors,
      `${pathLabel}.from`,
    );
    validateSpatialVector3(value.to, knownInputs, errors, `${pathLabel}.to`);
    if (value.headSize !== undefined) {
      validateSpatialScalar(
        value.headSize,
        knownInputs,
        errors,
        `${pathLabel}.headSize`,
        { positive: true, max: 40 },
      );
    }
    const from = Array.isArray(value.from)
      ? value.from.map(asFiniteNumber)
      : [];
    const to = Array.isArray(value.to) ? value.to.map(asFiniteNumber) : [];
    if (
      from.length === 3 &&
      to.length === 3 &&
      [...from, ...to].every((component) => component !== undefined)
    ) {
      const distance = Math.hypot(
        ...from.map(
          (component, index) => Number(to[index]) - Number(component),
        ),
      );
      if (distance === 0)
        errors.push(`${pathLabel} must have distinct from and to points`);
    }
  }
  return true;
}

function validateSpatialScene(
  scene: Record<string, unknown>,
  knownInputs: Set<string>,
  errors: string[],
  sceneIndex: number,
): void {
  const pathLabel = `scenes[${sceneIndex}]`;
  if (typeof scene.title !== "string" || !scene.title.trim())
    errors.push(`${pathLabel} spatial scene needs a title`);
  if (scene.view !== undefined) {
    if (!isRecord(scene.view)) {
      errors.push(`${pathLabel}.view must be an object`);
    } else {
      for (const field of Object.keys(scene.view)) {
        if (
          !new Set([
            "azimuthDegrees",
            "elevationDegrees",
            "scale",
            "projection",
            "interaction",
          ]).has(field)
        ) {
          errors.push(`${pathLabel}.view.${field} is not supported`);
        }
      }
      if (scene.view.azimuthDegrees !== undefined) {
        const value = asFiniteNumber(scene.view.azimuthDegrees);
        if (value === undefined || value < -180 || value > 180) {
          errors.push(
            `${pathLabel}.view.azimuthDegrees must be between -180 and 180`,
          );
        }
      }
      if (scene.view.elevationDegrees !== undefined) {
        const value = asFiniteNumber(scene.view.elevationDegrees);
        if (value === undefined || value < -85 || value > 85) {
          errors.push(
            `${pathLabel}.view.elevationDegrees must be between -85 and 85`,
          );
        }
      }
      if (scene.view.scale !== undefined) {
        const value = asFiniteNumber(scene.view.scale);
        if (value === undefined || value < 0.25 || value > 2) {
          errors.push(`${pathLabel}.view.scale must be between 0.25 and 2`);
        }
      }
      if (
        scene.view.projection !== undefined &&
        !SPATIAL_PROJECTIONS.has(String(scene.view.projection))
      ) {
        errors.push(
          `${pathLabel}.view.projection must be ${GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.projections.join(" or ")}`,
        );
      }
      if (
        scene.view.interaction !== undefined &&
        !SPATIAL_INTERACTIONS.has(String(scene.view.interaction))
      ) {
        errors.push(
          `${pathLabel}.view.interaction must be ${GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.interactions.join(" or ")}`,
        );
      }
    }
  }
  if (
    !Array.isArray(scene.groups) ||
    scene.groups.length === 0 ||
    scene.groups.length > MAX_SPATIAL_GROUPS
  ) {
    errors.push(
      `${pathLabel} spatial scene needs 1-${MAX_SPATIAL_GROUPS} groups`,
    );
    return;
  }
  const groupIds = new Set<string>();
  const primitiveIds = new Set<string>();
  let primitiveCount = 0;
  scene.groups.forEach((group, groupIndex) => {
    const groupPath = `${pathLabel}.groups[${groupIndex}]`;
    if (!isRecord(group)) {
      errors.push(`${groupPath} must be an object`);
      return;
    }
    for (const field of Object.keys(group)) {
      if (!new Set(["id", "label", "visibleWhen", "primitives"]).has(field)) {
        errors.push(`${groupPath}.${field} is not supported`);
      }
    }
    const id = typeof group.id === "string" ? group.id : "";
    if (!ID_PATTERN.test(id) || groupIds.has(id))
      errors.push(`${groupPath}.id is invalid or duplicate`);
    else groupIds.add(id);
    const label = typeof group.label === "string" ? group.label.trim() : "";
    if (!label || label.length > 72)
      errors.push(`${groupPath}.label must contain 1-72 characters`);
    if (group.visibleWhen !== undefined) {
      validateExpression(
        group.visibleWhen,
        knownInputs,
        errors,
        `${groupPath}.visibleWhen`,
      );
    }
    if (
      !Array.isArray(group.primitives) ||
      group.primitives.length === 0 ||
      group.primitives.length > MAX_SPATIAL_PRIMITIVES_PER_GROUP
    ) {
      errors.push(
        `${groupPath} needs 1-${MAX_SPATIAL_PRIMITIVES_PER_GROUP} primitives`,
      );
      return;
    }
    primitiveCount += group.primitives.length;
    group.primitives.forEach((primitive, primitiveIndex) => {
      validateSpatialPrimitive(
        primitive,
        knownInputs,
        errors,
        `${groupPath}.primitives[${primitiveIndex}]`,
        primitiveIds,
      );
    });
  });
  if (primitiveCount > MAX_SPATIAL_PRIMITIVES) {
    errors.push(
      `${pathLabel} spatial scene has more than ${MAX_SPATIAL_PRIMITIVES} primitives`,
    );
  }
}

function expressionFieldsFromScene(
  scene: Record<string, unknown>,
): Array<[string, unknown]> {
  const fields: Array<[string, unknown]> = [];
  const addSpatialScalar = (pathLabel: string, value: unknown) => {
    if (isRecord(value)) fields.push([pathLabel, value]);
  };
  const addSpatialVector = (pathLabel: string, value: unknown) => {
    if (!Array.isArray(value)) return;
    value.forEach((component, index) =>
      addSpatialScalar(`${pathLabel}[${index}]`, component),
    );
  };
  if (scene.kind === "plot" && Array.isArray(scene.series)) {
    scene.series.forEach((series, index) => {
      if (isRecord(series))
        fields.push([`series[${index}].expression`, series.expression]);
    });
    if (Array.isArray(scene.markers)) {
      scene.markers.forEach((marker, index) => {
        if (isRecord(marker))
          fields.push(
            [`markers[${index}].x`, marker.x],
            [`markers[${index}].y`, marker.y],
          );
      });
    }
  }
  if (scene.kind === "diagram") {
    if (Array.isArray(scene.nodes)) {
      scene.nodes.forEach((node, index) => {
        if (isRecord(node) && node.value)
          fields.push([`nodes[${index}].value`, node.value]);
      });
    }
    if (Array.isArray(scene.edges)) {
      scene.edges.forEach((edge, index) => {
        if (isRecord(edge) && edge.strength)
          fields.push([`edges[${index}].strength`, edge.strength]);
      });
    }
  }
  if (scene.kind === "table" && Array.isArray(scene.rows)) {
    scene.rows.forEach((row, rowIndex) => {
      if (!isRecord(row) || !Array.isArray(row.values)) return;
      row.values.forEach((cell, cellIndex) => {
        if (isRecord(cell))
          fields.push([`rows[${rowIndex}].values[${cellIndex}]`, cell]);
      });
    });
  }
  if (scene.kind === "annotation" || scene.kind === "formula") {
    if (scene.visibleWhen) fields.push(["visibleWhen", scene.visibleWhen]);
  }
  if (scene.kind === "animated_marker") {
    fields.push(["x", scene.x], ["y", scene.y]);
  }
  if (scene.kind === "status") fields.push(["value", scene.value]);
  if (scene.kind === "spatial" && Array.isArray(scene.groups)) {
    scene.groups.forEach((group, groupIndex) => {
      if (!isRecord(group)) return;
      if (group.visibleWhen !== undefined) {
        addSpatialScalar(
          `groups[${groupIndex}].visibleWhen`,
          group.visibleWhen,
        );
      }
      if (!Array.isArray(group.primitives)) return;
      group.primitives.forEach((primitive, primitiveIndex) => {
        if (!isRecord(primitive)) return;
        const base = `groups[${groupIndex}].primitives[${primitiveIndex}]`;
        if (primitive.visibleWhen !== undefined)
          addSpatialScalar(`${base}.visibleWhen`, primitive.visibleWhen);
        if (primitive.kind === "plane") {
          addSpatialVector(`${base}.center`, primitive.center);
          addSpatialVector(`${base}.normal`, primitive.normal);
          addSpatialScalar(`${base}.size`, primitive.size);
        } else if (
          primitive.kind === "polygon" &&
          Array.isArray(primitive.points)
        ) {
          primitive.points.forEach((point, pointIndex) => {
            addSpatialVector(`${base}.points[${pointIndex}]`, point);
          });
        } else if (primitive.kind === "sphere") {
          addSpatialVector(`${base}.center`, primitive.center);
          addSpatialScalar(`${base}.radius`, primitive.radius);
        } else if (primitive.kind === "cylinder") {
          addSpatialVector(`${base}.center`, primitive.center);
          addSpatialVector(`${base}.axis`, primitive.axis);
          addSpatialScalar(`${base}.radius`, primitive.radius);
          addSpatialScalar(`${base}.height`, primitive.height);
        } else if (primitive.kind === "cone") {
          addSpatialVector(`${base}.apex`, primitive.apex);
          addSpatialVector(`${base}.axis`, primitive.axis);
          addSpatialScalar(`${base}.radius`, primitive.radius);
          addSpatialScalar(`${base}.height`, primitive.height);
        } else if (primitive.kind === "point") {
          addSpatialVector(`${base}.position`, primitive.position);
          if (primitive.size !== undefined)
            addSpatialScalar(`${base}.size`, primitive.size);
        } else if (primitive.kind === "vector") {
          addSpatialVector(`${base}.from`, primitive.from);
          addSpatialVector(`${base}.to`, primitive.to);
          if (primitive.headSize !== undefined)
            addSpatialScalar(`${base}.headSize`, primitive.headSize);
        }
      });
    });
  }
  return fields;
}

export function validateGeneratedVisualizationDefinition(
  value: unknown,
  opportunity?: VisualizationOpportunity,
): {
  definition: GeneratedVisualizationDefinition | null;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(value))
    return {
      definition: null,
      errors: ["definition must be an object"],
      warnings,
    };
  if (value.schemaVersion !== 1)
    errors.push("definition.schemaVersion must be 1");
  if (value.sdkVersion !== VISUAL_SDK_VERSION) {
    errors.push(`definition.sdkVersion must be ${VISUAL_SDK_VERSION}`);
  }
  for (const field of [
    "title",
    "description",
    "accessibilityDescription",
  ] as const) {
    if (typeof value[field] !== "string" || !value[field].trim())
      errors.push(`${field} is required`);
  }
  if (
    typeof value.accessibilityDescription === "string" &&
    value.accessibilityDescription.length < 30
  ) {
    errors.push(
      "accessibilityDescription must explain the interaction and output",
    );
  }
  if (EXTERNAL_URL_RE.test(JSON.stringify(value)))
    errors.push("definition contains an external URL");

  const controls = Array.isArray(value.controls) ? value.controls : [];
  if (controls.length > MAX_CONTROLS)
    errors.push(`definition has more than ${MAX_CONTROLS} controls`);
  const controlIds = new Set<string>();
  controls.forEach((control, index) => {
    if (validateControl(control, errors, index) && isRecord(control)) {
      const id = String(control.id);
      if (controlIds.has(id)) errors.push(`duplicate control id ${id}`);
      controlIds.add(id);
    }
  });
  controlIds.add("x");
  controlIds.add("t");

  const outputs = Array.isArray(value.outputs) ? value.outputs : [];
  if (outputs.length === 0 || outputs.length > MAX_OUTPUTS) {
    errors.push(`definition needs 1-${MAX_OUTPUTS} outputs`);
  }
  const outputIds = new Set<string>();
  outputs.forEach((output, index) => {
    if (!isRecord(output)) {
      errors.push(`outputs[${index}] must be an object`);
      return;
    }
    const id = typeof output.id === "string" ? output.id : "";
    if (!ID_PATTERN.test(id) || outputIds.has(id))
      errors.push(`outputs[${index}].id is invalid or duplicate`);
    outputIds.add(id);
    if (typeof output.label !== "string" || !output.label.trim())
      errors.push(`outputs[${index}] needs a label`);
    if (!GENERATED_OUTPUT_REPRESENTATIONS.has(String(output.representation))) {
      errors.push(`outputs[${index}].representation is invalid`);
    }
    if (output.expression) {
      validateExpression(
        output.expression,
        controlIds,
        errors,
        `outputs[${index}].expression`,
      );
    }
  });

  const scenes = Array.isArray(value.scenes) ? value.scenes : [];
  if (scenes.length === 0 || scenes.length > MAX_SCENES) {
    errors.push(`definition needs 1-${MAX_SCENES} scene nodes`);
  }
  scenes.forEach((scene, index) => {
    if (!isRecord(scene) || !GENERATED_SCENE_KINDS.has(String(scene.kind))) {
      errors.push(`scenes[${index}] has an unsupported kind`);
      return;
    }
    if (scene.kind === "plot") {
      const min = asFiniteNumber(scene.xMin);
      const max = asFiniteNumber(scene.xMax);
      const samples = asFiniteNumber(scene.samples);
      if (min === undefined || max === undefined || min >= max)
        errors.push(`scenes[${index}] plot needs xMin < xMax`);
      if (samples === undefined || samples < 8 || samples > 240)
        errors.push(`scenes[${index}] plot samples must be 8-240`);
      if (
        !Array.isArray(scene.series) ||
        scene.series.length === 0 ||
        scene.series.length > 8
      ) {
        errors.push(`scenes[${index}] plot needs 1-8 series`);
      }
      if (
        scene.markers !== undefined &&
        (!Array.isArray(scene.markers) || scene.markers.length > 8)
      ) {
        errors.push(`scenes[${index}] plot supports at most 8 markers`);
      }
    }
    if (scene.kind === "diagram") {
      if (
        !Array.isArray(scene.nodes) ||
        scene.nodes.length === 0 ||
        scene.nodes.length > 40
      ) {
        errors.push(`scenes[${index}] diagram needs 1-40 nodes`);
      }
      if (!Array.isArray(scene.edges) || scene.edges.length > 80) {
        errors.push(`scenes[${index}] diagram has too many edges`);
      }
      if (Array.isArray(scene.nodes)) {
        scene.nodes.forEach((node, nodeIndex) => {
          if (!isRecord(node)) return;
          const x = asFiniteNumber(node.x);
          const y = asFiniteNumber(node.y);
          if (
            x === undefined ||
            x < 40 ||
            x > 600 ||
            y === undefined ||
            y < 40 ||
            y > 320
          ) {
            errors.push(
              `scenes[${index}].nodes[${nodeIndex}] must stay inside x=40-600 and y=40-320`,
            );
          }
          if (
            typeof node.label !== "string" ||
            !node.label.trim() ||
            node.label.length > 48
          ) {
            errors.push(
              `scenes[${index}].nodes[${nodeIndex}] needs a concise label of at most 48 characters`,
            );
          }
        });
      }
    }
    if (scene.kind === "timeline") {
      if (
        !Array.isArray(scene.steps) ||
        scene.steps.length < 2 ||
        scene.steps.length > 30
      ) {
        errors.push(`scenes[${index}] timeline needs 2-30 steps`);
      }
      if (!controlIds.has(String(scene.progressInput))) {
        errors.push(`scenes[${index}] timeline progressInput is unknown`);
      }
    }
    if (scene.kind === "value" && !outputIds.has(String(scene.outputId))) {
      errors.push(`scenes[${index}] references an unknown output`);
    }
    if (scene.kind === "status") {
      if (asFiniteNumber(scene.threshold) === undefined)
        errors.push(`scenes[${index}] status needs a finite threshold`);
      for (const field of ["title", "belowLabel", "equalLabel", "aboveLabel"]) {
        if (typeof scene[field] !== "string" || !String(scene[field]).trim()) {
          errors.push(`scenes[${index}] status needs ${field}`);
        }
      }
    }
    if (scene.kind === "spatial")
      validateSpatialScene(scene, controlIds, errors, index);
    for (const [field, expression] of expressionFieldsFromScene(scene)) {
      validateExpression(
        expression,
        controlIds,
        errors,
        `scenes[${index}].${field}`,
      );
    }
  });

  if (isRecord(value.animation)) {
    const duration = asFiniteNumber(value.animation.durationMs);
    if (duration === undefined || duration < 250 || duration > 120_000) {
      errors.push("animation.durationMs must be 250-120000");
    }
  }

  if (opportunity) {
    if (outputs.length !== opportunity.requiredOutputs.length) {
      errors.push(
        `opportunity requires exactly ${opportunity.requiredOutputs.length} output(s) in reviewed order, but the module declares ${outputs.length}`,
      );
    }
    opportunity.requiredOutputs.forEach((requiredOutput, index) => {
      const output = outputs[index];
      if (!isRecord(output)) {
        errors.push(
          `opportunity requires output ${requiredOutput.id} at outputs[${index}], but the module does not declare it there`,
        );
        return;
      }
      for (const field of ["id", "label", "representation"] as const) {
        if (output[field] !== requiredOutput[field]) {
          errors.push(
            field === "id"
              ? `opportunity requires output ${requiredOutput.id} at outputs[${index}] in reviewed order, but the module declares id ${JSON.stringify(output.id)}`
              : `opportunity output ${requiredOutput.id} must preserve ${field} ${JSON.stringify(requiredOutput[field])}, not ${JSON.stringify(output[field])}`,
          );
        }
      }
    });
    if (controls.length !== opportunity.requiredInputs.length) {
      errors.push(
        `opportunity requires exactly ${opportunity.requiredInputs.length} control(s) in reviewed order, but the module declares ${controls.length}`,
      );
    }
    opportunity.requiredInputs.forEach((requiredInput, index) => {
      const control = controls[index];
      if (!isRecord(control)) {
        errors.push(
          `opportunity requires control ${requiredInput.id} at controls[${index}], but the module does not declare it there`,
        );
        return;
      }
      if (control.id !== requiredInput.id) {
        errors.push(
          `opportunity requires control ${requiredInput.id} (id) at controls[${index}] in reviewed order, but the module declares id ${JSON.stringify(control.id)}`,
        );
      }
      if (control.type !== requiredInput.type) {
        errors.push(
          `opportunity control ${requiredInput.id} must use type ${requiredInput.type}, not ${String(control.type ?? "(missing)")}`,
        );
      }
      const requiredInputRecord = requiredInput as unknown as Record<
        string,
        unknown
      >;
      for (const field of [
        "kind",
        "label",
        "protocolRole",
        "unit",
        "min",
        "max",
        "step",
        "defaultValue",
      ] as const) {
        if (control[field] !== requiredInputRecord[field]) {
          errors.push(
            `opportunity control ${requiredInput.id} must preserve ${field} ${JSON.stringify(requiredInputRecord[field])}, not ${JSON.stringify(control[field])}`,
          );
        }
      }
      const requiredOptions = requiredInput.options;
      const actualOptions = control.options;
      const optionsMatch =
        (requiredOptions === undefined && actualOptions === undefined) ||
        (Array.isArray(requiredOptions) &&
          Array.isArray(actualOptions) &&
          actualOptions.length === requiredOptions.length &&
          actualOptions.every(
            (option, optionIndex) => option === requiredOptions[optionIndex],
          ));
      if (!optionsMatch) {
        errors.push(
          `opportunity control ${requiredInput.id} must preserve options ${JSON.stringify(requiredOptions)}, not ${JSON.stringify(actualOptions)}`,
        );
      }
      const expectedFields = new Set(
        [
          "id",
          "kind",
          "label",
          "type",
          "protocolRole",
          "unit",
          "min",
          "max",
          "step",
          "options",
          "defaultValue",
        ].filter((field) => requiredInputRecord[field] !== undefined),
      );
      const extraFields = Object.keys(control).filter(
        (field) => !expectedFields.has(field),
      );
      if (extraFields.length > 0) {
        errors.push(
          `opportunity control ${requiredInput.id} declares unreviewed field(s): ${extraFields.join(", ")}`,
        );
      }
    });
  }
  if (
    opportunity?.interactionGoal === "test_prediction" &&
    errors.length === 0
  ) {
    const candidate = value as unknown as GeneratedVisualizationDefinition;
    const protocol = predictionProtocolDiagnostics(
      candidate,
      opportunity,
      numericDefaults(candidate),
    );
    if (protocol && !protocol.passed) {
      errors.push(
        `test_prediction protocol is not executable: ${protocol.detail}`,
      );
    }
  }
  return {
    definition:
      errors.length === 0
        ? (value as unknown as GeneratedVisualizationDefinition)
        : null,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  };
}

export function compileGeneratedVisualization(
  sourceCode: string,
  opportunity?: VisualizationOpportunity,
): GeneratedVisualCompilation {
  const sourceHash = sha256(sourceCode);
  const opportunityContractHash = opportunity
    ? sha256(
        JSON.stringify({
          requiredInputs: opportunity.requiredInputs,
          requiredOutputs: opportunity.requiredOutputs,
        }),
      )
    : "unscoped";
  const cacheKey = [
    GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH,
    VISUAL_SDK_VERSION,
    sourceHash,
    opportunity?.similarityFingerprint ?? opportunity?.id ?? "unscoped",
    opportunityContractHash,
  ].join(":");
  const cached = GENERATED_COMPILATION_CACHE.get(cacheKey);
  if (cached) return { ...structuredClone(cached), cacheHit: true };
  const ast = staticAstValidation(sourceCode);
  const definitionValidation = validateGeneratedVisualizationDefinition(
    ast.definition,
    opportunity,
  );
  const errors = [...ast.errors, ...definitionValidation.errors];
  const definition =
    errors.length === 0 ? definitionValidation.definition : null;
  const compiledJavaScript = definition
    ? `globalThis.__BREADBOARD_GENERATED_VISUAL__ = Object.freeze(${JSON.stringify(definition)});\n`
    : "";
  const result: GeneratedVisualCompilation = {
    definition,
    validation: {
      valid: Boolean(definition),
      checkedAt: nowIso(),
      astNodeCount: ast.astNodeCount,
      sourceBytes: Buffer.byteLength(sourceCode),
      imports: ast.imports,
      errors: [...new Set(errors)],
      warnings: [...ast.warnings, ...definitionValidation.warnings],
    },
    sourceHash,
    compiledHash: compiledJavaScript ? sha256(compiledJavaScript) : "",
    compiledJavaScript,
    cacheHit: false,
  };
  if (result.definition) {
    GENERATED_COMPILATION_CACHE.set(cacheKey, structuredClone(result));
    if (GENERATED_COMPILATION_CACHE.size > 128) {
      const oldest = GENERATED_COMPILATION_CACHE.keys().next().value;
      if (oldest) GENERATED_COMPILATION_CACHE.delete(oldest);
    }
  }
  return result;
}

export function evaluateVisualExpression(
  expression: VisualExpression,
  state: Record<string, number>,
): number {
  switch (expression.kind) {
    case "constant":
      return expression.value;
    case "input":
      return Number(state[expression.id] ?? 0);
    case "binary": {
      const left = evaluateVisualExpression(expression.left, state);
      const right = evaluateVisualExpression(expression.right, state);
      if (expression.op === "add") return left + right;
      if (expression.op === "subtract") return left - right;
      if (expression.op === "multiply") return left * right;
      if (expression.op === "divide")
        return right === 0 ? Number.NaN : left / right;
      if (expression.op === "power") return Math.pow(left, right);
      if (expression.op === "min") return Math.min(left, right);
      return Math.max(left, right);
    }
    case "unary": {
      const value = evaluateVisualExpression(expression.argument, state);
      if (expression.op === "negate") return -value;
      if (expression.op === "abs") return Math.abs(value);
      if (expression.op === "sqrt") return Math.sqrt(value);
      if (expression.op === "sin") return Math.sin(value);
      if (expression.op === "cos") return Math.cos(value);
      if (expression.op === "tan") return Math.tan(value);
      if (expression.op === "exp") return Math.exp(value);
      return Math.log(value);
    }
    case "clamp":
      return Math.max(
        evaluateVisualExpression(expression.min, state),
        Math.min(
          evaluateVisualExpression(expression.max, state),
          evaluateVisualExpression(expression.value, state),
        ),
      );
    case "conditional": {
      const left = evaluateVisualExpression(expression.left, state);
      const right = evaluateVisualExpression(expression.right, state);
      const matches =
        expression.comparison === "lt"
          ? left < right
          : expression.comparison === "lte"
            ? left <= right
            : expression.comparison === "gt"
              ? left > right
              : expression.comparison === "gte"
                ? left >= right
                : left === right;
      return evaluateVisualExpression(
        matches ? expression.whenTrue : expression.whenFalse,
        state,
      );
    }
  }
}

function selectOptionIndex(control: GeneratedVisualControl): number {
  if (control.type !== "select" || !Array.isArray(control.options)) return 0;
  const index = control.options.indexOf(String(control.defaultValue));
  return index >= 0 ? index : 0;
}

function numericDefaults(
  definition: GeneratedVisualizationDefinition,
): Record<string, number> {
  const state: Record<string, number> = {};
  for (const control of definition.controls) {
    if (typeof control.defaultValue === "number")
      state[control.id] = control.defaultValue;
    else if (typeof control.defaultValue === "boolean")
      state[control.id] = control.defaultValue ? 1 : 0;
    else if (control.type === "select")
      state[control.id] = selectOptionIndex(control);
    else if (control.type === "button") state[control.id] = 0;
  }
  state.x = 0;
  state.t = 0;
  return state;
}

function alternateControlStates(
  control: GeneratedVisualControl,
  current: number,
): number[] {
  if (control.type === "select") {
    const optionCount = control.options?.length ?? 0;
    return Array.from({ length: optionCount }, (_, index) => index).filter(
      (index) => index !== current,
    );
  }
  if (control.type === "toggle") return [current === 0 ? 1 : 0];
  if (control.type === "button") return [current + 1];
  if (control.type === "slider" || control.type === "number") {
    const candidates = [
      control.min,
      control.max,
      current - (control.step ?? 1),
      current + (control.step ?? 1),
    ];
    return [
      ...new Set(
        candidates.filter(
          (candidate): candidate is number =>
            typeof candidate === "number" &&
            Number.isFinite(candidate) &&
            Math.abs(candidate - current) > 1e-12 &&
            (control.min === undefined || candidate >= control.min) &&
            (control.max === undefined || candidate <= control.max),
        ),
      ),
    ];
  }
  return [];
}

function evaluateSpatialScalar(
  value: SpatialScalar | undefined,
  state: Record<string, number>,
): number {
  if (typeof value === "number") return value;
  return value ? evaluateVisualExpression(value, state) : Number.NaN;
}

function evaluateSpatialVector(
  value: SpatialVector3,
  state: Record<string, number>,
): [number, number, number] {
  return value.map((component) => evaluateSpatialScalar(component, state)) as [
    number,
    number,
    number,
  ];
}

function spatialVectorDiagnostics(
  value: SpatialVector3,
  state: Record<string, number>,
  pathLabel: string,
): { value: [number, number, number]; errors: string[] } {
  const evaluated = evaluateSpatialVector(value, state);
  const errors = evaluated.every(
    (component) =>
      Number.isFinite(component) &&
      Math.abs(component) <= MAX_SPATIAL_MAGNITUDE,
  )
    ? []
    : [`${pathLabel} is non-finite or outside +/-${MAX_SPATIAL_MAGNITUDE}`];
  return { value: evaluated, errors };
}

function spatialPositiveScalarDiagnostics(
  value: SpatialScalar | undefined,
  state: Record<string, number>,
  pathLabel: string,
  max: number = MAX_SPATIAL_MAGNITUDE,
): { value: number; errors: string[] } {
  const evaluated = evaluateSpatialScalar(value, state);
  return {
    value: evaluated,
    errors:
      Number.isFinite(evaluated) && evaluated > 0 && evaluated <= max
        ? []
        : [
            `${pathLabel} must evaluate to a finite positive value no greater than ${max}`,
          ],
  };
}

function spatialPrimitiveGeometryDiagnostics(
  primitive: SpatialPrimitive,
  state: Record<string, number>,
  pathLabel: string,
): string[] {
  const errors: string[] = [];
  if (primitive.kind === "plane") {
    const center = spatialVectorDiagnostics(
      primitive.center,
      state,
      `${pathLabel}.center`,
    );
    const normal = spatialVectorDiagnostics(
      primitive.normal,
      state,
      `${pathLabel}.normal`,
    );
    const size = spatialPositiveScalarDiagnostics(
      primitive.size,
      state,
      `${pathLabel}.size`,
    );
    errors.push(...center.errors, ...normal.errors, ...size.errors);
    if (normal.errors.length === 0 && Math.hypot(...normal.value) <= 1e-9) {
      errors.push(`${pathLabel}.normal evaluates to a zero-length vector`);
    }
  } else if (primitive.kind === "polygon") {
    const points = primitive.points.map((point, pointIndex) =>
      spatialVectorDiagnostics(
        point,
        state,
        `${pathLabel}.points[${pointIndex}]`,
      ),
    );
    errors.push(...points.flatMap((point) => point.errors));
    if (points.every((point) => point.errors.length === 0)) {
      errors.push(
        ...spatialPolygonShapeDiagnostics(
          points.map((point) => point.value),
          pathLabel,
        ),
      );
    }
  } else if (primitive.kind === "sphere") {
    const center = spatialVectorDiagnostics(
      primitive.center,
      state,
      `${pathLabel}.center`,
    );
    const radius = spatialPositiveScalarDiagnostics(
      primitive.radius,
      state,
      `${pathLabel}.radius`,
    );
    errors.push(...center.errors, ...radius.errors);
  } else if (primitive.kind === "cylinder") {
    const center = spatialVectorDiagnostics(
      primitive.center,
      state,
      `${pathLabel}.center`,
    );
    const axis = spatialVectorDiagnostics(
      primitive.axis,
      state,
      `${pathLabel}.axis`,
    );
    const radius = spatialPositiveScalarDiagnostics(
      primitive.radius,
      state,
      `${pathLabel}.radius`,
    );
    const height = spatialPositiveScalarDiagnostics(
      primitive.height,
      state,
      `${pathLabel}.height`,
    );
    errors.push(
      ...center.errors,
      ...axis.errors,
      ...radius.errors,
      ...height.errors,
    );
    if (axis.errors.length === 0 && Math.hypot(...axis.value) <= 1e-9) {
      errors.push(`${pathLabel}.axis evaluates to a zero-length vector`);
    }
  } else if (primitive.kind === "cone") {
    const apex = spatialVectorDiagnostics(
      primitive.apex,
      state,
      `${pathLabel}.apex`,
    );
    const axis = spatialVectorDiagnostics(
      primitive.axis,
      state,
      `${pathLabel}.axis`,
    );
    const radius = spatialPositiveScalarDiagnostics(
      primitive.radius,
      state,
      `${pathLabel}.radius`,
    );
    const height = spatialPositiveScalarDiagnostics(
      primitive.height,
      state,
      `${pathLabel}.height`,
    );
    errors.push(
      ...apex.errors,
      ...axis.errors,
      ...radius.errors,
      ...height.errors,
    );
    if (axis.errors.length === 0 && Math.hypot(...axis.value) <= 1e-9) {
      errors.push(`${pathLabel}.axis evaluates to a zero-length vector`);
    }
  } else if (primitive.kind === "point") {
    const position = spatialVectorDiagnostics(
      primitive.position,
      state,
      `${pathLabel}.position`,
    );
    errors.push(...position.errors);
    if (primitive.size !== undefined) {
      errors.push(
        ...spatialPositiveScalarDiagnostics(
          primitive.size,
          state,
          `${pathLabel}.size`,
          40,
        ).errors,
      );
    }
  } else {
    const from = spatialVectorDiagnostics(
      primitive.from,
      state,
      `${pathLabel}.from`,
    );
    const to = spatialVectorDiagnostics(primitive.to, state, `${pathLabel}.to`);
    errors.push(...from.errors, ...to.errors);
    if (primitive.headSize !== undefined) {
      errors.push(
        ...spatialPositiveScalarDiagnostics(
          primitive.headSize,
          state,
          `${pathLabel}.headSize`,
          40,
        ).errors,
      );
    }
    if (
      from.errors.length === 0 &&
      to.errors.length === 0 &&
      Math.hypot(
        ...from.value.map((component, index) => to.value[index] - component),
      ) <= 1e-9
    ) {
      errors.push(`${pathLabel} evaluates to a zero-length vector`);
    }
  }
  return errors;
}

function spatialSceneGeometryDiagnostics(
  scene: SpatialScene,
  definition: GeneratedVisualizationDefinition,
  defaults: Record<string, number>,
): string[] {
  const states: Array<Record<string, number>> = [
    { ...defaults, t: 0 },
    { ...defaults, t: 0.371 },
    { ...defaults, t: 1 },
  ];
  for (const control of definition.controls) {
    for (const alternate of alternateControlStates(
      control,
      defaults[control.id] ?? 0,
    )) {
      states.push({ ...defaults, [control.id]: alternate });
      if (states.length >= 48) break;
    }
    if (states.length >= 48) break;
  }
  const errors: string[] = [];
  states.forEach((state, stateIndex) => {
    let visiblePrimitiveCount = 0;
    scene.groups.forEach((group, groupIndex) => {
      const groupVisibility =
        group.visibleWhen === undefined
          ? 1
          : evaluateVisualExpression(group.visibleWhen, state);
      if (!Number.isFinite(groupVisibility)) {
        errors.push(
          `state ${stateIndex} groups[${groupIndex}].visibleWhen is non-finite`,
        );
        return;
      }
      if (groupVisibility <= 0) return;
      group.primitives.forEach((primitive, primitiveIndex) => {
        const primitiveVisibility =
          primitive.visibleWhen === undefined
            ? 1
            : evaluateVisualExpression(primitive.visibleWhen, state);
        if (!Number.isFinite(primitiveVisibility)) {
          errors.push(
            `state ${stateIndex} groups[${groupIndex}].primitives[${primitiveIndex}].visibleWhen is non-finite`,
          );
          return;
        }
        if (primitiveVisibility <= 0) return;
        visiblePrimitiveCount += 1;
        errors.push(
          ...spatialPrimitiveGeometryDiagnostics(
            primitive,
            state,
            `state ${stateIndex} groups[${groupIndex}].primitives[${primitiveIndex}]`,
          ),
        );
      });
    });
    if (visiblePrimitiveCount === 0)
      errors.push(`state ${stateIndex} has no visible spatial primitives`);
  });
  return [...new Set(errors)];
}

function numericExpressionSamples(
  definition: GeneratedVisualizationDefinition,
  state: Record<string, number>,
): number[] {
  const values: number[] = [];
  const commonStates = [
    { ...state, x: 0, t: 0 },
    { ...state, x: 0.371, t: 0.371 },
    { ...state, x: 1, t: 1 },
  ];
  for (const output of definition.outputs) {
    if (!output.expression) continue;
    for (const sampleState of commonStates) {
      values.push(evaluateVisualExpression(output.expression, sampleState));
    }
  }
  for (const scene of definition.scenes) {
    const record = scene as unknown as Record<string, unknown>;
    const expressions = expressionFieldsFromScene(record).map(
      ([, expression]) => expression as VisualExpression,
    );
    if (scene.kind === "timeline") {
      expressions.push({ kind: "input", id: scene.progressInput });
    }
    const sceneStates =
      scene.kind === "plot"
        ? [
            { ...state, x: scene.xMin, t: 0 },
            { ...state, x: (scene.xMin + scene.xMax) / 2, t: 0.5 },
            { ...state, x: scene.xMax, t: 1 },
          ]
        : commonStates;
    for (const expression of expressions) {
      for (const sampleState of sceneStates) {
        values.push(evaluateVisualExpression(expression, sampleState));
      }
    }
  }
  return values;
}

function outputValues(
  definition: GeneratedVisualizationDefinition,
  state: Record<string, number>,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const output of definition.outputs) {
    if (output.expression)
      values[output.id] = evaluateVisualExpression(output.expression, state);
  }
  return values;
}

type ProtocolOutcomeExpression = {
  path: string;
  expression: VisualExpression;
};

function visualExpressionReferencesInput(
  expression: VisualExpression,
  inputId: string,
): boolean {
  if (expression.kind === "input") return expression.id === inputId;
  if (expression.kind === "constant") return false;
  if (expression.kind === "binary") {
    return (
      visualExpressionReferencesInput(expression.left, inputId) ||
      visualExpressionReferencesInput(expression.right, inputId)
    );
  }
  if (expression.kind === "unary") {
    return visualExpressionReferencesInput(expression.argument, inputId);
  }
  if (expression.kind === "clamp") {
    return (
      visualExpressionReferencesInput(expression.value, inputId) ||
      visualExpressionReferencesInput(expression.min, inputId) ||
      visualExpressionReferencesInput(expression.max, inputId)
    );
  }
  return (
    visualExpressionReferencesInput(expression.left, inputId) ||
    visualExpressionReferencesInput(expression.right, inputId) ||
    visualExpressionReferencesInput(expression.whenTrue, inputId) ||
    visualExpressionReferencesInput(expression.whenFalse, inputId)
  );
}

function protocolOutcomeExpressions(
  definition: GeneratedVisualizationDefinition,
  opportunity: VisualizationOpportunity,
  commitId: string,
  revealId: string,
): ProtocolOutcomeExpression[] {
  const requiredOutputIds = new Set(
    opportunity.requiredOutputs.map((output) => output.id),
  );
  const requiredOutputs = definition.outputs.flatMap((output, outputIndex) =>
    requiredOutputIds.has(output.id) && output.expression
      ? [
          {
            path: `outputs[${outputIndex}].expression`,
            expression: output.expression,
          },
        ]
      : [],
  );
  if (requiredOutputs.length > 0) return requiredOutputs;

  const sceneExpressions = definition.scenes.flatMap((scene, sceneIndex) => {
    const expressions = expressionFieldsFromScene(
      scene as unknown as Record<string, unknown>,
    ).map(([path, expression]) => ({
      path: `scenes[${sceneIndex}].${path}`,
      expression: expression as VisualExpression,
    }));
    if (scene.kind === "timeline") {
      expressions.push({
        path: `scenes[${sceneIndex}].progressInput`,
        expression: { kind: "input", id: scene.progressInput },
      });
    }
    return expressions;
  });
  const referencesProtocol = ({ expression }: ProtocolOutcomeExpression) =>
    visualExpressionReferencesInput(expression, commitId) ||
    visualExpressionReferencesInput(expression, revealId);
  const visibilityExpressions = sceneExpressions.filter(
    (candidate) =>
      candidate.path.endsWith("visibleWhen") && referencesProtocol(candidate),
  );
  return visibilityExpressions.length > 0
    ? visibilityExpressions
    : sceneExpressions.filter(referencesProtocol);
}

function protocolExpressionValues(
  expressions: ProtocolOutcomeExpression[],
  state: Record<string, number>,
): number[] {
  return expressions.map(({ expression }) =>
    evaluateVisualExpression(expression, state),
  );
}

function protocolValuesDiffer(left: number[], right: number[]): boolean {
  return left.some(
    (value, index) =>
      Number.isFinite(value) &&
      Number.isFinite(right[index]) &&
      Math.abs(value - right[index]) > 1e-9,
  );
}

function predictionProtocolDiagnostics(
  definition: GeneratedVisualizationDefinition,
  opportunity: VisualizationOpportunity,
  defaults: Record<string, number>,
): { passed: boolean; detail: string } | undefined {
  if (opportunity.interactionGoal !== "test_prediction") return undefined;
  const prediction = definition.controls.find(
    (control) => control.protocolRole === "prediction_input",
  );
  const commit = definition.controls.find(
    (control) => control.protocolRole === "commit_prediction",
  );
  const reveal = definition.controls.find(
    (control) =>
      control.protocolRole === "reveal_outcome" ||
      control.protocolRole === "evaluate_prediction",
  );
  if (!prediction || !commit || !reveal) {
    return {
      passed: false,
      detail:
        "the exact generated definition is missing prediction_input, commit_prediction, or reveal/evaluate protocol roles",
    };
  }
  const outcomeExpressions = protocolOutcomeExpressions(
    definition,
    opportunity,
    commit.id,
    reveal.id,
  );
  if (outcomeExpressions.length === 0) {
    return {
      passed: false,
      detail:
        "no required outcome expression or observable scene/visibility expression depends on the authored commit and reveal/evaluate controls",
    };
  }
  const predictionValues = [
    ...alternateControlStates(prediction, defaults[prediction.id] ?? 0),
  ];
  let outcomeChangedAfterValidReveal = false;
  let changedDuringPrediction = false;
  let changedAtCommitOnly = false;
  let revealedBeforeCommit = false;
  let nonFiniteState = false;
  for (const predictionValue of predictionValues) {
    const baselineState = {
      ...defaults,
      [commit.id]: 0,
      [reveal.id]: 0,
    };
    const predictionState = {
      ...baselineState,
      [prediction.id]: predictionValue,
    };
    const unauthorizedRevealState = { ...predictionState, [reveal.id]: 1 };
    const commitOnlyState = { ...predictionState, [commit.id]: 1 };
    const validRevealState = { ...commitOnlyState, [reveal.id]: 1 };
    const baselineValues = protocolExpressionValues(
      outcomeExpressions,
      baselineState,
    );
    const predictionOnlyValues = protocolExpressionValues(
      outcomeExpressions,
      predictionState,
    );
    const unauthorizedValues = protocolExpressionValues(
      outcomeExpressions,
      unauthorizedRevealState,
    );
    const commitOnlyValues = protocolExpressionValues(
      outcomeExpressions,
      commitOnlyState,
    );
    const validRevealValues = protocolExpressionValues(
      outcomeExpressions,
      validRevealState,
    );
    nonFiniteState ||= [
      ...baselineValues,
      ...predictionOnlyValues,
      ...unauthorizedValues,
      ...commitOnlyValues,
      ...validRevealValues,
    ].some((value) => !Number.isFinite(value));
    changedDuringPrediction ||= protocolValuesDiffer(
      baselineValues,
      predictionOnlyValues,
    );
    revealedBeforeCommit ||= protocolValuesDiffer(
      predictionOnlyValues,
      unauthorizedValues,
    );
    changedAtCommitOnly ||= protocolValuesDiffer(
      predictionOnlyValues,
      commitOnlyValues,
    );
    outcomeChangedAfterValidReveal ||= protocolValuesDiffer(
      commitOnlyValues,
      validRevealValues,
    );
  }
  return {
    passed:
      !nonFiniteState &&
      !changedDuringPrediction &&
      !revealedBeforeCommit &&
      !changedAtCommitOnly &&
      outcomeChangedAfterValidReveal,
    detail: JSON.stringify({
      outcomeExpressionPaths: outcomeExpressions.map(({ path }) => path),
      changedDuringPrediction,
      revealedBeforeCommit,
      changedAtCommitOnly,
      outcomeChangedAfterValidReveal,
      nonFiniteState,
    }),
  };
}

function protocolAwareInfluenceState(
  definition: GeneratedVisualizationDefinition,
  control: GeneratedVisualControl,
  defaults: Record<string, number>,
): Record<string, number> {
  const state = { ...defaults };
  const activate = (role: GeneratedVisualControl["protocolRole"]) => {
    for (const candidate of definition.controls) {
      if (candidate.protocolRole === role) state[candidate.id] = 1;
    }
  };
  if (control.protocolRole === "prediction_input") {
    activate("commit_prediction");
    activate("reveal_outcome");
    activate("evaluate_prediction");
  } else if (control.protocolRole === "commit_prediction") {
    activate("reveal_outcome");
    activate("evaluate_prediction");
  } else if (
    control.protocolRole === "reveal_outcome" ||
    control.protocolRole === "evaluate_prediction"
  ) {
    activate("commit_prediction");
  }
  return state;
}

export function runGeneratedVisualDeterministicTests(input: {
  definition: GeneratedVisualizationDefinition;
  testCases: GeneratedVisualizationTestCase[];
  opportunity: VisualizationOpportunity;
  availableSourceAnchorIds?: Set<string>;
}): GeneratedVisualTestsRecord {
  const staticTests: GeneratedVisualTestsRecord["staticTests"] = [];
  const semanticTests: GeneratedVisualTestsRecord["semanticTests"] = [];
  const runtimeTests: GeneratedVisualTestsRecord["runtimeTests"] = [];
  const defaults = numericDefaults(input.definition);
  const values = outputValues(input.definition, defaults);
  staticTests.push({
    name: "all controls have accessible labels",
    passed: input.definition.controls.every(
      (control) => control.label.trim().length > 0,
    ),
  });
  staticTests.push({
    name: "required source anchors exist",
    passed:
      !input.availableSourceAnchorIds ||
      input.opportunity.sourceAnchorIds.every((id) =>
        input.availableSourceAnchorIds!.has(id),
      ),
  });
  runtimeTests.push({
    name: "default outputs are finite",
    passed: Object.values(values).every(Number.isFinite),
    detail: JSON.stringify(values),
  });

  const controlsById = new Map(
    input.definition.controls.map((control) => [control.id, control]),
  );
  for (const requiredInput of input.opportunity.requiredInputs) {
    const control = controlsById.get(requiredInput.id);
    if (!control) {
      semanticTests.push({
        name: `${requiredInput.label} is implemented by the generated module`,
        passed: false,
        detail: `missing required control ${requiredInput.id}`,
      });
      continue;
    }
    const influenceState = protocolAwareInfluenceState(
      input.definition,
      control,
      defaults,
    );
    const alternates = alternateControlStates(
      control,
      influenceState[control.id] ?? 0,
    );
    const baselineSamples = numericExpressionSamples(
      input.definition,
      influenceState,
    );
    const effectiveAlternate = alternates.find((alternate) => {
      const changedSamples = numericExpressionSamples(input.definition, {
        ...influenceState,
        [control.id]: alternate,
      });
      return baselineSamples.some(
        (value, index) =>
          Number.isFinite(value) &&
          Number.isFinite(changedSamples[index]) &&
          Math.abs(changedSamples[index] - value) > 1e-9,
      );
    });
    const differs = effectiveAlternate !== undefined;
    semanticTests.push({
      name: `${control.label} changes a numeric output or scene expression`,
      passed: differs,
      detail: JSON.stringify({
        defaultState: influenceState[control.id],
        alternateState: effectiveAlternate ?? alternates[0],
        testedAlternateStates: alternates,
        numericExpressionCount: baselineSamples.length,
      }),
    });
  }

  const predictionProtocol = predictionProtocolDiagnostics(
    input.definition,
    input.opportunity,
    defaults,
  );
  if (predictionProtocol) {
    semanticTests.push({
      name: "test_prediction keeps the reviewed outcome gated until valid commit then reveal/evaluate",
      ...predictionProtocol,
    });
  }

  for (const testCase of input.testCases.slice(0, 20)) {
    const state = { ...defaults };
    for (const [id, value] of Object.entries(testCase.inputs)) {
      if (typeof value === "number" && Number.isFinite(value))
        state[id] = value;
      else if (typeof value === "boolean") state[id] = value ? 1 : 0;
    }
    const actual = outputValues(input.definition, state);
    const tolerance = Number.isFinite(testCase.tolerance)
      ? Math.max(0, testCase.tolerance!)
      : 1e-6;
    const mismatches: string[] = [];
    for (const [id, expected] of Object.entries(testCase.expected)) {
      if (typeof expected !== "number" || !Number.isFinite(expected)) continue;
      if (
        !Number.isFinite(actual[id]) ||
        Math.abs(actual[id] - expected) > tolerance
      ) {
        mismatches.push(
          `${id}: expected ${expected}, got ${String(actual[id])}`,
        );
      }
    }
    semanticTests.push({
      name: `candidate test: ${testCase.name}`,
      passed: mismatches.length === 0,
      detail: mismatches.join("; ") || JSON.stringify(actual),
    });
  }

  for (const scene of input.definition.scenes) {
    if (scene.kind === "plot") {
      let finite = true;
      for (let index = 0; index < scene.samples; index += 1) {
        const x =
          scene.xMin +
          ((scene.xMax - scene.xMin) * index) / Math.max(1, scene.samples - 1);
        for (const series of scene.series) {
          const value = evaluateVisualExpression(series.expression, {
            ...defaults,
            x,
          });
          if (!Number.isFinite(value)) finite = false;
        }
      }
      runtimeTests.push({
        name: `${scene.title} plot remains finite`,
        passed: finite,
      });
    } else if (scene.kind === "spatial") {
      const diagnostics = spatialSceneGeometryDiagnostics(
        scene,
        input.definition,
        defaults,
      );
      runtimeTests.push({
        name: `${scene.title} spatial geometry remains finite, visible, and non-degenerate`,
        passed: diagnostics.length === 0,
        detail: diagnostics.slice(0, 20).join("; "),
      });
    }
  }
  if (input.definition.animation) {
    runtimeTests.push({
      name: "animation clock is bounded",
      passed:
        input.definition.animation.durationMs >= 250 &&
        input.definition.animation.durationMs <= 120_000,
    });
  }
  const all = [...staticTests, ...semanticTests, ...runtimeTests];
  return {
    passed: all.every((test) => test.passed),
    checkedAt: nowIso(),
    staticTests,
    semanticTests,
    runtimeTests,
  };
}

function browserExecutable(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const configured = String(env.BREADBOARD_VISUAL_BROWSER_PATH ?? "").trim();
  const candidates = [
    configured,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function sandboxRuntimePath(): string {
  const cwd = process.cwd();
  const candidates = [
    path.resolve(
      cwd,
      "../quartz/quartz/components/scripts/generatedVisualSandbox.inline.js",
    ),
    path.resolve(
      cwd,
      "quartz/quartz/components/scripts/generatedVisualSandbox.inline.js",
    ),
  ];
  // Desktop/packaged installs: the Quartz workspace is wherever
  // QUARTZ_CONTENT_PATH points (content lives inside the workspace).
  const contentPath = process.env.QUARTZ_CONTENT_PATH?.trim();
  if (contentPath) {
    candidates.unshift(
      path.resolve(
        path.dirname(path.resolve(contentPath)),
        "quartz/components/scripts/generatedVisualSandbox.inline.js",
      ),
    );
  }
  return (
    candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
  );
}

function previewHtml(
  definition: GeneratedVisualizationDefinition,
  runtime: string,
  theme: "light" | "dark" = "light",
): string {
  const serialized = JSON.stringify(definition).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>html,body{margin:0;padding:0;background:#f8f6ef;color:#10251c;font-family:system-ui,sans-serif}</style></head><body><div id="breadboard-generated-visual-root"></div><script>window.__BREADBOARD_VISUAL_TEST_MODE__=true;</script><script>${runtime.replace(/<\/script/gi, "<\\/script")}</script><script>window.postMessage({type:"breadboard-generated-visual:init",definition:${serialized},theme:${JSON.stringify(theme)}},"*");</script></body></html>`;
}

export function runGeneratedVisualBrowserTests(input: {
  definition: GeneratedVisualizationDefinition;
  outputDir: string;
  timeoutMs?: number;
}): {
  tests: GeneratedVisualTestsRecord["runtimeTests"];
  browser?: GeneratedVisualTestsRecord["browser"];
} {
  const executable = browserExecutable();
  if (!executable) {
    return {
      tests: [
        {
          name: "browser mount",
          passed: false,
          detail: "No Chromium/Edge executable configured",
        },
      ],
    };
  }
  let runtime = "";
  try {
    runtime = fs.readFileSync(sandboxRuntimePath(), "utf-8");
  } catch {
    return {
      tests: [
        {
          name: "browser mount",
          passed: false,
          detail: "Generated visual sandbox runtime is missing",
        },
      ],
      browser: { executable, viewports: [], screenshotCreated: false },
    };
  }
  fs.mkdirSync(input.outputDir, { recursive: true });
  const screenshotPath = path.join(input.outputDir, "preview.png");
  const timeout = input.timeoutMs ?? 20_000;
  const scenarios = [
    {
      name: "375x667 light",
      viewport: "375x667",
      theme: "light" as const,
      flags: [],
    },
    {
      name: "1280x800 dark",
      viewport: "1280x800",
      theme: "dark" as const,
      flags: [],
    },
    {
      name: "1280x800 reduced-motion",
      viewport: "1280x800",
      theme: "light" as const,
      flags: ["--force-prefers-reduced-motion"],
    },
  ];
  const viewports = scenarios.map((scenario) => scenario.name);
  const tests: GeneratedVisualTestsRecord["runtimeTests"] = [];
  const htmlPaths: string[] = [];
  const browserProfileRoot = path.resolve(input.outputDir);
  let browserProfileCounter = 0;
  const spawnIsolatedBrowser = (slug: string, args: string[]) => {
    browserProfileCounter += 1;
    const profilePath = path.resolve(
      browserProfileRoot,
      `.browser-profile-${slug}-${process.pid}-${browserProfileCounter}`,
    );
    if (!profilePath.startsWith(`${browserProfileRoot}${path.sep}`)) {
      throw new Error(
        "Generated visual browser profile escaped its disposable output directory",
      );
    }
    fs.mkdirSync(profilePath, { recursive: true });
    try {
      return spawnSync(
        executable,
        [`--user-data-dir=${profilePath}`, ...args],
        { encoding: "utf-8", timeout, windowsHide: true },
      );
    } finally {
      try {
        fs.rmSync(profilePath, { recursive: true, force: true });
      } catch {
        // A timed-out browser may still hold its disposable profile briefly.
      }
    }
  };
  for (const scenario of scenarios) {
    const [width, height] = scenario.viewport.split("x");
    const scenarioSlug = scenario.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    const htmlPath = path.join(input.outputDir, `preview-${scenarioSlug}.html`);
    htmlPaths.push(htmlPath);
    fs.writeFileSync(
      htmlPath,
      previewHtml(input.definition, runtime, scenario.theme),
      "utf-8",
    );
    const url = pathToFileURL(htmlPath).href;
    const result = spawnIsolatedBrowser(scenarioSlug, [
      "--headless=new",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--no-first-run",
      ...scenario.flags,
      `--window-size=${width},${height}`,
      "--virtual-time-budget=2500",
      "--dump-dom",
      url,
    ]);
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const browserPassed =
      result.status === 0 &&
      output.includes('data-breadboard-runtime-tests="passed"') &&
      !output.includes('data-breadboard-overflow="true"');
    tests.push({
      name: `browser mount ${scenario.name}`,
      passed: browserPassed,
      detail:
        result.error?.message ||
        (browserPassed
          ? "mounted and self-tested"
          : (output.match(/<body[^>]*>/i)?.[0] ?? output.slice(-500))),
    });
  }
  const screenshotHtmlPath = path.join(
    input.outputDir,
    "preview-screenshot.html",
  );
  htmlPaths.push(screenshotHtmlPath);
  fs.writeFileSync(
    screenshotHtmlPath,
    previewHtml(input.definition, runtime, "light"),
    "utf-8",
  );
  const screenshotUrl = pathToFileURL(screenshotHtmlPath).href;
  const captureScreenshot = () =>
    spawnIsolatedBrowser("screenshot", [
      "--headless=new",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--window-size=1000,720",
      "--virtual-time-budget=2500",
      `--screenshot=${screenshotPath}`,
      screenshotUrl,
    ]);
  let screenshot = captureScreenshot();
  let screenshotCreated =
    screenshot.status === 0 && fs.existsSync(screenshotPath);
  // Headless Edge can intermittently fail to create a screenshot while other
  // browser checks are finishing. Retry only the capture once; lesson/model
  // generation is not repeated for this disposable preview artifact.
  if (!screenshotCreated) {
    fs.rmSync(screenshotPath, { force: true });
    screenshot = captureScreenshot();
    screenshotCreated =
      screenshot.status === 0 && fs.existsSync(screenshotPath);
  }
  tests.push({
    name: "preview screenshot",
    passed: screenshotCreated,
    detail: screenshotCreated
      ? "created"
      : screenshot.error?.message ||
        String(screenshot.stderr || "Screenshot was not created").slice(-500),
  });
  try {
    for (const htmlPath of htmlPaths) fs.rmSync(htmlPath, { force: true });
  } catch {
    // A debug preview HTML is harmless if the browser still has the file open.
  }
  return { tests, browser: { executable, viewports, screenshotCreated } };
}

export function buildGeneratedVisualBlock(id: string, version: number): string {
  if (!ID_PATTERN.test(id) || !Number.isInteger(version) || version < 1) {
    throw new Error("Invalid generated visualization block identity");
  }
  return `\`\`\`${GENERATED_VISUAL_BLOCK_LANG}\nid: ${id}\nversion: ${version}\n\`\`\``;
}

const GENERATED_BLOCK_RE =
  /```breadboard-generated-visual\r?\n([\s\S]*?)\r?\n```/g;

export function parseGeneratedVisualBlock(
  value: string,
): { id: string; version: number } | null {
  const id =
    value.match(/^id:\s*([A-Za-z][A-Za-z0-9_-]{1,79})\s*$/m)?.[1] ?? "";
  const version = Number(value.match(/^version:\s*(\d+)\s*$/m)?.[1] ?? 0);
  return ID_PATTERN.test(id) && Number.isInteger(version) && version > 0
    ? { id, version }
    : null;
}

export function findGeneratedVisualBlockById(
  markdown: string,
  visualId: string,
): { fullMatch: string; value: string; index: number; version: number } | null {
  const pattern = new RegExp(
    GENERATED_BLOCK_RE.source,
    GENERATED_BLOCK_RE.flags,
  );
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    const parsed = parseGeneratedVisualBlock(match[1]);
    if (parsed?.id === visualId) {
      return {
        fullMatch: match[0],
        value: match[1],
        index: match.index,
        version: parsed.version,
      };
    }
  }
  return null;
}

export function replaceGeneratedVisualBlock(
  markdown: string,
  block: { fullMatch: string; index: number },
  id: string,
  version: number,
): string {
  return `${markdown.slice(0, block.index)}${buildGeneratedVisualBlock(id, version)}${markdown.slice(
    block.index + block.fullMatch.length,
  )}`;
}

function artifactRelativePath(id: string): string {
  return `.breadboard/visuals/${id}`;
}

export function generatedVisualArtifactDir(
  gardenDir: string,
  id: string,
): string {
  if (!ID_PATTERN.test(id))
    throw new Error("Invalid generated visualization ID");
  return path.join(gardenDir, ".breadboard", "visuals", id);
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function copyArtifactFiles(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of [
    "manifest.json",
    "source.tsx",
    "compiled.js",
    "validation.json",
    "critic.json",
    "preview.png",
    "tests.json",
    "lifecycle.json",
  ]) {
    const source = path.join(sourceDir, file);
    if (fs.existsSync(source))
      fs.copyFileSync(source, path.join(targetDir, file));
  }
}

export function validateGeneratedVisualizationManifest(
  value: unknown,
  expectedId?: string,
): { manifest: GeneratedVisualizationManifest | null; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value))
    return { manifest: null, errors: ["manifest must be an object"] };
  const id = typeof value.id === "string" ? value.id : "";
  if (!ID_PATTERN.test(id)) errors.push("manifest id is invalid");
  if (expectedId && id !== expectedId)
    errors.push(
      `manifest id ${id || "(missing)"} does not match ${expectedId}`,
    );
  if (value.schemaVersion !== GENERATED_VISUAL_SCHEMA_VERSION)
    errors.push("unsupported manifest schemaVersion");
  if (value.sdkVersion !== VISUAL_SDK_VERSION)
    errors.push("unsupported manifest sdkVersion");
  for (const field of [
    "gardenId",
    "learningUnitId",
    "title",
    "description",
    "learningObjective",
    "insertionAnchor",
    "targetPage",
    "targetHeading",
    "generatorModel",
    "artifactPath",
    "similarityFingerprint",
  ]) {
    if (typeof value[field] !== "string" || !String(value[field]).trim())
      errors.push(`manifest ${field} is required`);
  }
  if (
    typeof value.targetPage === "string" &&
    (!value.targetPage.startsWith("learning/") ||
      !value.targetPage.endsWith(".md"))
  ) {
    errors.push("manifest targetPage must be a learning Markdown page");
  }
  if (id && value.artifactPath !== artifactRelativePath(id))
    errors.push("manifest artifactPath does not match id");
  for (const field of ["sourceAnchorIds", "sourceVisualIds", "conceptIds"]) {
    if (
      !Array.isArray(value[field]) ||
      value[field].some((item) => typeof item !== "string")
    ) {
      errors.push(`manifest ${field} must be a string array`);
    }
  }
  const relationships = value.sourceVisualRelationships ?? [];
  if (
    !Array.isArray(relationships) ||
    relationships.some((relationship) => !isRecord(relationship))
  ) {
    errors.push("manifest sourceVisualRelationships must be an array");
  }
  if (!/^[a-f0-9]{64}$/i.test(String(value.sourceHash ?? "")))
    errors.push("manifest sourceHash is invalid");
  if (!/^[a-f0-9]{64}$/i.test(String(value.compiledHash ?? "")))
    errors.push("manifest compiledHash is invalid");
  if (!Number.isInteger(value.version) || Number(value.version) < 1)
    errors.push("manifest version is invalid");
  if (
    !Number.isInteger(value.generationAttempt) ||
    Number(value.generationAttempt) < 1
  )
    errors.push("manifest generationAttempt is invalid");
  if (
    value.previousVersion !== undefined &&
    (!Number.isInteger(value.previousVersion) ||
      Number(value.previousVersion) < 1)
  ) {
    errors.push("manifest previousVersion is invalid");
  }
  if (!Number.isFinite(Date.parse(String(value.generatedAt ?? ""))))
    errors.push("manifest generatedAt is invalid");
  if (
    ![
      "draft",
      "validated",
      "compiled",
      "tested",
      "critic_approved",
      "published",
      "rejected",
    ].includes(String(value.status))
  ) {
    errors.push("manifest status is invalid");
  }
  if (errors.length > 0) return { manifest: null, errors };
  return {
    manifest: {
      ...(value as unknown as GeneratedVisualizationManifest),
      sourceVisualRelationships: relationships as SourceVisualRelationship[],
    },
    errors: [],
  };
}

export function saveGeneratedVisualArtifact(input: {
  gardenDir: string;
  manifest: GeneratedVisualizationManifest;
  sourceCode: string;
  compiledJavaScript: string;
  validation: GeneratedVisualValidationRecord;
  critic: GeneratedVisualCriticRecord;
  tests: GeneratedVisualTestsRecord;
  lifecycle: GeneratedVisualLifecycleRecord[];
  previewPath?: string;
}): void {
  const checkedManifest = validateGeneratedVisualizationManifest(
    input.manifest,
    input.manifest.id,
  );
  if (!checkedManifest.manifest) {
    throw new Error(
      `Invalid generated visualization manifest: ${checkedManifest.errors.join("; ")}`,
    );
  }
  const dir = generatedVisualArtifactDir(input.gardenDir, input.manifest.id);
  const versionDir = path.join(dir, "versions", String(input.manifest.version));
  fs.mkdirSync(versionDir, { recursive: true });
  writeJson(path.join(versionDir, "manifest.json"), input.manifest);
  fs.writeFileSync(
    path.join(versionDir, "source.tsx"),
    input.sourceCode,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(versionDir, "compiled.js"),
    input.compiledJavaScript,
    "utf-8",
  );
  writeJson(path.join(versionDir, "validation.json"), input.validation);
  writeJson(path.join(versionDir, "critic.json"), input.critic);
  writeJson(path.join(versionDir, "tests.json"), input.tests);
  writeJson(path.join(versionDir, "lifecycle.json"), input.lifecycle);
  if (input.previewPath && fs.existsSync(input.previewPath)) {
    fs.copyFileSync(input.previewPath, path.join(versionDir, "preview.png"));
  }
  copyArtifactFiles(versionDir, dir);
  writeJson(path.join(dir, "current.json"), {
    id: input.manifest.id,
    version: input.manifest.version,
    manifest: `versions/${input.manifest.version}/manifest.json`,
  });
  updateGeneratedVisualIndex(input.gardenDir, input.manifest);
}

function updateGeneratedVisualIndex(
  gardenDir: string,
  manifest: GeneratedVisualizationManifest,
): void {
  const indexPath = path.join(gardenDir, ".breadboard", "visual-index.json");
  let index: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    if (isRecord(parsed)) index = parsed;
  } catch {
    index = {};
  }
  index[manifest.id] = {
    id: manifest.id,
    kind: "generated_module",
    pageSlug: manifest.targetPage.replace(/\.md$/i, ""),
    type: "generated_module",
    title: manifest.title,
    version: manifest.version,
    updatedAt: manifest.generatedAt,
    artifactPath: manifest.artifactPath,
    sourceHash: manifest.sourceHash,
    compiledHash: manifest.compiledHash,
    learningUnitId: manifest.learningUnitId,
    opportunityId: manifest.id,
  };
  writeJson(indexPath, index);
}

export function loadGeneratedVisualManifest(
  gardenDir: string,
  id: string,
  version?: number,
): GeneratedVisualizationManifest | null {
  try {
    const dir = generatedVisualArtifactDir(gardenDir, id);
    const filePath = version
      ? path.join(dir, "versions", String(version), "manifest.json")
      : path.join(dir, "manifest.json");
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return validateGeneratedVisualizationManifest(parsed, id).manifest;
  } catch {
    return null;
  }
}

export function loadGeneratedVisualDefinition(
  gardenDir: string,
  id: string,
  version?: number,
): GeneratedVisualizationDefinition | null {
  try {
    const dir = generatedVisualArtifactDir(gardenDir, id);
    const compiledPath = version
      ? path.join(dir, "versions", String(version), "compiled.js")
      : path.join(dir, "compiled.js");
    const sourcePath = version
      ? path.join(dir, "versions", String(version), "source.tsx")
      : path.join(dir, "source.tsx");
    const manifest = loadGeneratedVisualManifest(gardenDir, id, version);
    if (!manifest) return null;
    const source = fs.readFileSync(sourcePath, "utf-8");
    if (sha256(source) !== manifest.sourceHash) return null;
    const compiled = fs.readFileSync(compiledPath, "utf-8");
    if (sha256(compiled) !== manifest.compiledHash) return null;
    const prefix =
      "globalThis.__BREADBOARD_GENERATED_VISUAL__ = Object.freeze(";
    const suffix = ");\n";
    if (!compiled.startsWith(prefix) || !compiled.endsWith(suffix)) return null;
    const parsed = JSON.parse(compiled.slice(prefix.length, -suffix.length));
    return validateGeneratedVisualizationDefinition(parsed).definition;
  } catch {
    return null;
  }
}

function generatedCandidateSchema() {
  return {
    name: "breadboard_generated_visual_candidate",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "title",
        "explanation",
        "sourceCode",
        "testCases",
        "accessibilityDescription",
        "pedagogicalClaims",
      ],
      properties: {
        title: { type: "string" },
        explanation: { type: "string" },
        sourceCode: { type: "string" },
        accessibilityDescription: { type: "string" },
        pedagogicalClaims: {
          type: "array",
          items: { type: "string" },
          maxItems: 20,
        },
        testCases: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "inputs", "expected", "tolerance"],
            properties: {
              name: { type: "string" },
              inputs: {
                type: "array",
                maxItems: 20,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "value"],
                  properties: {
                    id: { type: "string" },
                    value: {
                      anyOf: [
                        { type: "number" },
                        { type: "string" },
                        { type: "boolean" },
                      ],
                    },
                  },
                },
              },
              expected: {
                type: "array",
                maxItems: 20,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "value"],
                  properties: {
                    id: { type: "string" },
                    value: {
                      anyOf: [
                        { type: "number" },
                        { type: "string" },
                        { type: "boolean" },
                      ],
                    },
                  },
                },
              },
              tolerance: { type: ["number", "null"] },
            },
          },
        },
      },
    },
  };
}

export function validateGeneratedVisualizationCandidateEnvelope(
  value: unknown,
  tokenUsage?: GeneratedVisualTokenUsage,
): { candidate: GeneratedVisualizationCandidate | null; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value))
    return { candidate: null, errors: ["candidate must be one JSON object"] };
  const requiredFields = [
    "title",
    "explanation",
    "sourceCode",
    "testCases",
    "accessibilityDescription",
    "pedagogicalClaims",
  ];
  for (const field of Object.keys(value)) {
    if (!requiredFields.includes(field))
      errors.push(`candidate.${field} is not supported`);
  }
  for (const field of [
    "title",
    "explanation",
    "sourceCode",
    "accessibilityDescription",
  ] as const) {
    if (typeof value[field] !== "string" || !value[field].trim())
      errors.push(`candidate.${field} is required`);
  }
  const pedagogicalClaims = Array.isArray(value.pedagogicalClaims)
    ? value.pedagogicalClaims
    : [];
  if (!Array.isArray(value.pedagogicalClaims))
    errors.push("candidate.pedagogicalClaims must be an array");
  else {
    if (pedagogicalClaims.length > 20)
      errors.push("candidate.pedagogicalClaims supports at most 20 items");
    pedagogicalClaims.forEach((claim, index) => {
      if (typeof claim !== "string" || !claim.trim()) {
        errors.push(
          `candidate.pedagogicalClaims[${index}] must be a non-empty string`,
        );
      }
    });
  }

  const rawTestCases = Array.isArray(value.testCases) ? value.testCases : [];
  if (!Array.isArray(value.testCases))
    errors.push("candidate.testCases must be an array");
  else if (rawTestCases.length > 20)
    errors.push("candidate.testCases supports at most 20 items");
  const testCases: GeneratedVisualizationTestCase[] = [];
  rawTestCases.slice(0, 20).forEach((item, testIndex) => {
    const pathLabel = `candidate.testCases[${testIndex}]`;
    if (!isRecord(item)) {
      errors.push(`${pathLabel} must be an object`);
      return;
    }
    for (const field of Object.keys(item)) {
      if (!["name", "inputs", "expected", "tolerance"].includes(field)) {
        errors.push(`${pathLabel}.${field} is not supported`);
      }
    }
    if (typeof item.name !== "string" || !item.name.trim())
      errors.push(`${pathLabel}.name is required`);
    if (
      !(item.tolerance === null || asFiniteNumber(item.tolerance) !== undefined)
    ) {
      errors.push(`${pathLabel}.tolerance must be a finite number or null`);
    }
    const parseEntries = (
      field: "inputs" | "expected",
    ): Record<string, unknown> => {
      const entries = item[field];
      if (!Array.isArray(entries)) {
        errors.push(`${pathLabel}.${field} must be an array`);
        return {};
      }
      if (entries.length > 20)
        errors.push(`${pathLabel}.${field} supports at most 20 items`);
      const ids = new Set<string>();
      const pairs: Array<[string, unknown]> = [];
      entries.slice(0, 20).forEach((entry, entryIndex) => {
        const entryPath = `${pathLabel}.${field}[${entryIndex}]`;
        if (!isRecord(entry)) {
          errors.push(`${entryPath} must be an object`);
          return;
        }
        for (const key of Object.keys(entry)) {
          if (!["id", "value"].includes(key))
            errors.push(`${entryPath}.${key} is not supported`);
        }
        const id = typeof entry.id === "string" ? entry.id.trim() : "";
        if (!id || ids.has(id))
          errors.push(`${entryPath}.id is missing or duplicate`);
        else ids.add(id);
        if (
          typeof entry.value !== "number" &&
          typeof entry.value !== "string" &&
          typeof entry.value !== "boolean"
        ) {
          errors.push(
            `${entryPath}.value must be a number, string, or boolean`,
          );
        } else if (
          typeof entry.value === "number" &&
          !Number.isFinite(entry.value)
        ) {
          errors.push(`${entryPath}.value must be finite`);
        }
        if (id) pairs.push([id, entry.value]);
      });
      return Object.fromEntries(pairs);
    };
    const inputs = parseEntries("inputs");
    const expected = parseEntries("expected");
    testCases.push({
      name: typeof item.name === "string" ? item.name : "",
      inputs,
      expected,
      ...(typeof item.tolerance === "number"
        ? { tolerance: item.tolerance }
        : {}),
    });
  });
  if (errors.length > 0)
    return { candidate: null, errors: [...new Set(errors)] };
  return {
    candidate: {
      title: String(value.title),
      explanation: String(value.explanation),
      sourceCode: String(value.sourceCode),
      testCases,
      accessibilityDescription: String(value.accessibilityDescription),
      pedagogicalClaims: pedagogicalClaims as string[],
      ...(tokenUsage ? { tokenUsage } : {}),
    },
    errors: [],
  };
}

export async function generateVisualizationCandidate(input: {
  client: OpenAI;
  model: string;
  opportunity: VisualizationOpportunity;
  pageMarkdown: string;
  sourceContext?: unknown;
  sourceFigureSummaries?: unknown[];
  formulaDefinitions?: unknown[];
  previousSourceCode?: string;
  errors?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<GeneratedVisualizationCandidate> {
  const validModuleTemplate = `import { defineVisualization } from "@breadboard/visual-sdk";
export default defineVisualization({
  schemaVersion: ${GENERATED_VISUAL_CAPABILITY_MANIFEST.definitionSchemaVersion},
  sdkVersion: "${GENERATED_VISUAL_CAPABILITY_MANIFEST.sdkVersion}",
  title: "Parameter relationship",
  description: "Move the parameter to inspect the source-backed relationship.",
  accessibilityDescription: "A labelled slider changes a finite value and a plotted curve. Reset restores the documented default.",
  controls: [{ id: "gain", kind: "variable", label: "Gain", type: "slider", min: 0, max: 2, step: 0.1, defaultValue: 1 }],
  outputs: [{ id: "result", label: "Result", representation: "value", expression: { kind: "binary", op: "multiply", left: { kind: "input", id: "gain" }, right: { kind: "constant", value: 2 } } }],
  scenes: [
    { kind: "value", outputId: "result", emphasis: "strong" },
    { kind: "plot", title: "Response", xLabel: "Input", yLabel: "Output", xMin: 0, xMax: 10, samples: 80, series: [{ id: "response", label: "Response", expression: { kind: "binary", op: "multiply", left: { kind: "input", id: "gain" }, right: { kind: "input", id: "x" } } }] },
    { kind: "diagram", title: "Causal path", nodes: [{ id: "input", label: "Input", x: 100, y: 90 }, { id: "output", label: "Output", x: 500, y: 90, value: { kind: "input", id: "gain" } }], edges: [{ from: "input", to: "output", label: "changes", directed: true }] },
    { kind: "formula", title: "Relationship", text: "result = 2 × gain" }
  ]
});`;
  const spatialModuleTemplate = `import { defineVisualization } from "@breadboard/visual-sdk";
export default defineVisualization({
  schemaVersion: ${GENERATED_VISUAL_CAPABILITY_MANIFEST.definitionSchemaVersion},
  sdkVersion: "${GENERATED_VISUAL_CAPABILITY_MANIFEST.sdkVersion}",
  title: "Spatial case comparison",
  description: "Choose a case to inspect model-authored geometry in one stable spatial frame.",
  accessibilityDescription: "A labelled selector changes which spatial construction is visible. Drag or use the arrow keys to orbit the perspective view, use wheel or plus and minus to zoom, and use Home or Reset to restore it. Every object also appears in a text legend with its geometric type and pattern.",
  controls: [{ id: "case_mode", kind: "select_case", label: "Case", type: "select", options: ["Case A", "Case B"], defaultValue: "Case A" }],
  outputs: [{ id: "case_view", label: "Selected construction", representation: "diagram" }],
  scenes: [{
    kind: "spatial",
    title: "Construction",
    view: { azimuthDegrees: 35, elevationDegrees: 24, scale: 1, projection: "perspective", interaction: "orbit" },
    groups: [
      { id: "fixed-items", label: "Common", primitives: [
        { kind: "point", id: "fixed-point", label: "Fixed point", position: [1, 1, 1], color: "red" },
        { kind: "vector", id: "direction-vector", label: "Direction", from: [0, 0, 0], to: [1, 1, 1], color: "gray" }
      ] },
      { id: "case-a", label: "Case A", visibleWhen: { kind: "conditional", comparison: "eq", left: { kind: "input", id: "case_mode" }, right: { kind: "constant", value: 0 }, whenTrue: { kind: "constant", value: 1 }, whenFalse: { kind: "constant", value: 0 } }, primitives: [
        { kind: "plane", id: "sample-plane", label: "Plane", center: [0, 0, 0], normal: [0, 0, 1], size: 4, color: "blue", pattern: "striped" },
        { kind: "polygon", id: "sample-patch", label: "Clipped surface patch", points: [[0, 0, -1], [3, 0, -1], [3, 0, 1], [0, 0, 1]], color: "cyan", pattern: "dotted" }
      ] },
      { id: "case-b", label: "Case B", visibleWhen: { kind: "conditional", comparison: "eq", left: { kind: "input", id: "case_mode" }, right: { kind: "constant", value: 1 }, whenTrue: { kind: "constant", value: 1 }, whenFalse: { kind: "constant", value: 0 } }, primitives: [
        { kind: "sphere", id: "sample-sphere", label: "Sphere", center: [0, 0, 0], radius: 2, color: "green", pattern: "dotted" },
        { kind: "cylinder", id: "sample-cylinder", label: "Cylinder", center: [0, 0, 0], axis: [0, 0, 1], radius: 1, height: 4, color: "amber", pattern: "crosshatch" },
        { kind: "cone", id: "sample-cone", label: "Cone", apex: [0, 0, -2], axis: [0, 0, 1], radius: 1.5, height: 4, color: "violet", pattern: "solid" }
      ] }
    ]
  }]
});`;
  const system =
    `Create one declarative Breadboard generated visualization using SDK ${VISUAL_SDK_VERSION}. ` +
    "Reply with one JSON object and nothing else. It must have exactly these six fields: " +
    '{"title":<non-empty string>,"explanation":<non-empty string>,"sourceCode":<complete module string>,"testCases":[{"name":<non-empty string>,"inputs":[{"id":<string>,"value":<number|string|boolean>}],"expected":[{"id":<string>,"value":<number|string|boolean>}],"tolerance":<finite number|null>}],"accessibilityDescription":<non-empty string>,"pedagogicalClaims":[<non-empty string>,...]}. ' +
    "Do not omit title, explanation, accessibilityDescription, or pedagogicalClaims even when a Council wrapper does not enforce response_format. " +
    `sourceCode must contain exactly ` +
    `import { defineVisualization } from "${SDK_IMPORT}"; followed by export default defineVisualization({...}). ` +
    "The argument must be one JSON-compatible object literal: no functions, variables, JSX, spreads, computed properties, callbacks, loops, classes, timers, browser globals, HTML, URLs, or package imports. " +
    `Use schemaVersion ${GENERATED_VISUAL_CAPABILITY_MANIFEST.definitionSchemaVersion} and sdkVersion ${GENERATED_VISUAL_CAPABILITY_MANIFEST.sdkVersion}. The definition needs title, description, accessibilityDescription, controls, outputs, and scenes. ` +
    "Every expression uses the field kind (never type); binary and unary expressions use op (never operator), and a unary expression stores its child in argument (never value). " +
    `Every output uses representation (never type or value). Its optional expression is the derived value. output.representation is metadata and does not force scene.kind: a spatial scene may satisfy a diagram or animation output. ${GENERATED_VISUAL_CAPABILITY_MANIFEST.outputs.numericExpressionOptionalFor.join(", ")} outputs may omit output.expression when their observable is nonnumeric; never expose a select option index as an output merely to satisfy influence. ` +
    "A plot uses xMin, xMax, samples, xLabel, yLabel and series[].expression; it never uses axes or explicit point arrays. " +
    "A diagram is only a 2D node-link graph. A diagram node requires id, label, x, and y; node.value is omitted unless it represents a genuinely meaningful numeric quantity. Never use node.value for selection styling or visibility, and never use diagram nodes as substitutes for physical surfaces or solids. " +
    "A value scene contains kind and outputId. A formula/annotation scene contains kind, title, and text. " +
    `Expression kinds are ${GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.kinds.join(", ")}. Binary operators are ${GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.binaryOperators.join("/")}; unary operators are ${GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.unaryOperators.join("/")}. A conditional is exactly {kind, comparison, left, right, whenTrue, whenFalse}; comparison is one of ${GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.comparisons.join("/")}. Never use condition/then/else. ` +
    `Scene kinds are ${GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.kinds.join(", ")}. Use only these exact field names. ` +
    `Use spatial for physical geometry. A spatial scene is exactly {kind:"spatial",title,view?:{azimuthDegrees?,elevationDegrees?,scale?,projection?:"orthographic"|"perspective",interaction?:"fixed"|"orbit"},groups:[{id,label,visibleWhen?,primitives:[...]}]}; it supports 1-${MAX_SPATIAL_GROUPS} groups, 1-${MAX_SPATIAL_PRIMITIVES_PER_GROUP} primitives per group, and ${MAX_SPATIAL_PRIMITIVES} total. ` +
    `A spatial primitive has kind,id,label,color?,pattern?,opacity?,visibleWhen? plus kind fields: plane(center,normal,size), polygon(points with 3-${MAX_SPATIAL_POLYGON_POINTS} coplanar non-collinear SpatialVectors in boundary order), sphere(center,radius), cylinder(center,axis,radius,height), cone(apex,axis,radius,height), point(position,size?), or vector(from,to,headSize?). ` +
    "A plane is a centered full rectangular patch extending to both sides of its center. A polygon is a bounded filled surface patch whose points trace one non-self-intersecting boundary. Use ordered polygon vertices, not plane, whenever the visible surface must be clipped, sector-shaped, one-sided, triangular, or a half-plane patch; never describe a plane primitive as a half-plane or clipped patch. " +
    "Every spatial vector is exactly three SpatialScalars. A SpatialScalar is a finite number or any valid expression, including input or t for dynamic geometry. visibleWhen is an expression; the group or primitive is visible only when it evaluates above zero. Normals, axes, and vectors must be non-zero; sizes, radii, heights, point sizes, and head sizes must stay positive. " +
    `Spatial colors are only ${GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.palette.join(", ")}. Patterns are only ${GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.patterns.join(", ")}. projection and interaction are model-authored presentation fields, never inferred semantics or additional learner controls. If either is omitted, the legacy default is projection:"${GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.defaults.projection}" and interaction:"${GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.defaults.interaction}". Author perspective when depth foreshortening materially clarifies the source-grounded geometry; author orbit only when changing viewpoint improves the stated learning action, and describe its drag, wheel, keyboard, Home, and Reset operation in accessibilityDescription. The runtime supplies stable full-domain world framing, deterministic depth ordering, safe patterns, object labels, and an accessible text legend; author the actual geometry, camera mode, and relationships in the module. Use group visibleWhen for selector cases so all cases share one stable authored-world frame. ` +
    'A status scene is exactly {kind:"status",title,value,threshold,belowLabel,equalLabel,aboveLabel,description?}; use it for a current textual state instead of numeric status codes. ' +
    "A plot may include markers:[{id,label,x,y,color?}] with expression-valued x/y; use a marker for the selected point and never fake a point as a sparse line series. " +
    "Diagram node coordinates must remain within x=40-600 and y=40-320 and labels must be concise. " +
    "Each testCases item represents inputs and expected as arrays of {id,value} pairs and includes tolerance (number or null). " +
    "Implement opportunity.interactionGoal and opportunity.learnerAction as the artifact's actual interaction sequence, not merely as labels or explanatory prose. For test_prediction, require the learner to commit a prediction before the artifact reveals or evaluates the outcome; use the exact protocolRole fields from the reviewed controls and author the required outcome expression or scene visibleWhen so it is unchanged initially, after prediction input, after unauthorized reveal/evaluate without commitment, and after commit alone; it must change only after valid commit_prediction then reveal_outcome/evaluate_prediction. Gate that observable with both authored action controls, not commit alone or reveal alone. The trusted runtime derives sequencing only from protocolRole: prediction_input stays editable until commit, commitment locks it, reveal/evaluate stays disabled and mutation-guarded until commit, and Reset clears and unlocks the sequence. Every decisive condition named by the reviewed interaction contract must be directly manipulable or evaluated by the artifact. " +
    "Copy the opportunity.requiredInputs array exactly and in order: same control count, id, kind, label, type, protocolRole, unit, min, max, step, options, and defaultValue. Do not add a control or a field the reviewed contract omits. Copy opportunity.requiredOutputs exactly and in order: same output count, id, label, and representation; never add or reorder learner-visible outputs. Keep any runtime-internal derived values inside scene or output expressions rather than declaring extra outputs. Use only source-backed relationships. Label illustrative or normalized values clearly. Every required control must materially change a numeric output or scene expression. " +
    "Before returning, perform a complete model-authored consistency check against the supplied evidence and the literal definition. Independently recompute every evaluable numeric or geometric relationship you authored: scalar values, signed directions, units and conversions, vector endpoint deltas and magnitudes, component-wise sums, resultants, and other aggregates. Make every coordinate, label, annotation, explanation, and accessibility statement agree at the authored precision. If a total is claimed to be the sum of displayed contributions, its components must equal that displayed sum; do not hide a discrepancy behind rounding or prose. If displayed elements are representative samples of a larger or continuous domain, do not construct or imply the whole-domain aggregate as their exact finite subtotal unless the supplied evidence explicitly establishes that equality; distinguish the sample contribution and whole-domain result in the geometry as well as the labels and non-visual explanation. When the evidence does not supply enough information to evaluate a sign, magnitude, scale, or aggregate, use explicitly qualitative or normalized encoding and do not invent or claim an evaluated value. The compiler and renderer will not infer or repair any of these relationships for you. " +
    "A select control is exposed to expressions as the stable zero-based index of its option in the declared options array (0 for the first option, 1 for the second, and so on), while the interface displays the option label; use conditional expressions against those numeric indices. Group or primitive visibleWhen counts as scene influence, so do not add a meaningless numeric output for the select. " +
    "Keep sourceCode below 16,000 bytes and use at most five scenes; prefer the smallest expression tree that teaches the objective. testCases should cover only simple derived outputs with numeric expectations you can compute exactly (an empty testCases array is allowed because Breadboard adds deterministic tests). " +
    "sourceCode must end immediately after the final ASCII semicolon; do not append Markdown fences, commentary, or non-ASCII punctuation. " +
    `This is a complete syntactically valid scalar/plot module template; follow its schema exactly:\n${validModuleTemplate}\n` +
    `This is a complete syntactically valid spatial module template; replace its generic labels and geometry with source-grounded content:\n${spatialModuleTemplate}`;
  const response = await input.client.chat.completions.create(
    withCouncil(
      {
        model: input.model,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: JSON.stringify({
              opportunity: input.opportunity,
              localTeachingText: input.pageMarkdown.slice(0, 14_000),
              sourceContext: boundedGeneratedVisualEvidence(
                input.sourceContext,
                10_000,
              ),
              sourceFigureSummaries: boundedGeneratedVisualEvidence(
                input.sourceFigureSummaries?.slice(0, 10),
                8_000,
              ),
              formulaDefinitions: boundedGeneratedVisualEvidence(
                input.formulaDefinitions?.slice(0, 12),
                6_000,
              ),
              sdkDocumentation: {
                version: GENERATED_VISUAL_CAPABILITY_MANIFEST.sdkVersion,
                controlTypes: [
                  ...GENERATED_VISUAL_CAPABILITY_MANIFEST.runtimeControls.types,
                ],
                controlKinds: [
                  ...GENERATED_VISUAL_CAPABILITY_MANIFEST
                    .requiredContractControls.kinds,
                ],
                controlProtocolRoles: [
                  ...GENERATED_VISUAL_CAPABILITY_MANIFEST
                    .requiredContractControls.protocolRoles,
                ],
                outputTypes: [
                  ...GENERATED_VISUAL_CAPABILITY_MANIFEST.outputs
                    .representations,
                ],
                sceneTypes: [
                  ...GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.kinds,
                ],
                spatialPrimitiveTypes: [
                  ...GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial
                    .primitiveKinds,
                ],
                spatialProjectionTypes: [
                  ...GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial
                    .projections,
                ],
                spatialInteractionTypes: [
                  ...GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial
                    .interactions,
                ],
                spatialViewDefaults:
                  GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.defaults,
                maxControls: MAX_CONTROLS,
                maxSelectOptions: MAX_SELECT_OPTIONS,
                maxScenes: MAX_SCENES,
                maxSpatialGroups: MAX_SPATIAL_GROUPS,
                maxSpatialPrimitives: MAX_SPATIAL_PRIMITIVES,
                maxSpatialPolygonPoints: MAX_SPATIAL_POLYGON_POINTS,
              },
              repairContext: input.errors?.length
                ? {
                    // A repair is another model-authored revision. Preserve the
                    // exact prior artifact and every gate/critic message so code
                    // never silently edits or summarizes its semantic context.
                    previousSourceCode: input.previousSourceCode,
                    exactErrors: input.errors,
                  }
                : undefined,
            }),
          },
        ],
        max_completion_tokens: Math.max(
          1_000,
          Math.min(
            12_000,
            Number(
              process.env.LEARN_GENERATED_VISUAL_MAX_OUTPUT_TOKENS ?? 6_000,
            ) || 6_000,
          ),
        ),
        response_format: {
          type: "json_schema",
          json_schema: generatedCandidateSchema(),
        },
      },
      {
        taskType: "visualization_generation",
        gardenId: input.opportunity.gardenId,
        pageId: input.opportunity.targetPage,
        sourceContext: input.sourceContext,
        councilModeOverride: "direct_council",
      },
    ),
    {
      signal: input.signal,
      ...(input.timeoutMs ? { timeout: input.timeoutMs } : {}),
      maxRetries: 0,
    },
  );
  const content = response.choices[0]?.message?.content ?? "";
  const tokenUsage = generatedVisualTokenUsage(response.usage);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `generated visualization candidate is not valid JSON: ${error instanceof Error ? error.message : "parse failed"}`,
    );
  }
  const envelope = validateGeneratedVisualizationCandidateEnvelope(
    parsed,
    tokenUsage,
  );
  if (!envelope.candidate) {
    throw new Error(
      `generated visualization candidate envelope is invalid: ${envelope.errors.join("; ")}`,
    );
  }
  return envelope.candidate;
}

/** Score groups a rubric-shaped approval must fill in. Each group is one
 * dimension, listed with every spelling the critic is known to use. */
const DETAILED_CRITIC_SCORE_GROUPS: readonly (readonly string[])[] = [
  ["interactionImprovesUnderstanding"],
  ["subsectionFit"],
  ["controlMeaningfulness", "meaningfulControls"],
  ["defaultStateUsefulness", "usefulDefaultState"],
  ["variableIntroduction"],
  [
    "sourceClaimsAndUnits",
    "sourceClaimsAndUnitsPreserved",
    "sourceClaimAndUnitPreservation",
    "sourceClaimPreservation",
  ],
  ["primitiveTopologyAndDomain"],
  ["avoidsDuplication"],
  [
    "complexityDiscipline",
    "avoidsUnnecessaryComplexity",
    "complexityRestraint",
  ],
  ["accessibility"],
];

/** The spelling of each dimension the critic is asked for, so the prompt, the
 * response schema, and the normalizer cannot drift apart. */
const CRITIC_RUBRIC_KEYS: readonly string[] = DETAILED_CRITIC_SCORE_GROUPS.map(
  (keys) => keys[0],
);

/** Names every rubric dimension the critic left unscored. */
function unscoredDetailedCriticDimensions(
  scores: Record<string, unknown>,
): string[] {
  return DETAILED_CRITIC_SCORE_GROUPS.filter(
    (keys) => !keys.some((key) => asFiniteNumber(scores[key]) !== undefined),
  ).map((keys) => keys[0]);
}

/** Why a rubric-shaped critic reply could not be normalized, so the caller can
 * tell the critic what to fix instead of retrying the identical prompt. */
export interface DetailedGeneratedVisualCriticDiagnostics {
  /** The reply carries rubric scores, so the detailed path owns the failure. */
  detailed?: boolean;
  reason?: string;
}

export function normalizeDetailedGeneratedVisualCriticRecord(
  parsed: unknown,
  tokenUsage?: GeneratedVisualTokenUsage,
  expectedOpportunityId?: string,
  diagnostics?: DetailedGeneratedVisualCriticDiagnostics,
): GeneratedVisualCriticRecord | null {
  const reject = (reason: string): null => {
    if (diagnostics) diagnostics.reason = reason;
    return null;
  };
  if (!isRecord(parsed) || !isRecord(parsed.scores))
    return reject("the reply carries no scores object");

  const visualScores = parsed.scores;
  // `accessibility` is scored by the legacy rubric too, so it cannot identify the shape.
  const detailedScoreKeys = DETAILED_CRITIC_SCORE_GROUPS.flat().filter(
    (key) => key !== "accessibility",
  );
  if (
    !detailedScoreKeys.some(
      (key) => asFiniteNumber(visualScores[key]) !== undefined,
    )
  ) {
    return reject("the reply carries no recognized rubric scores");
  }
  if (diagnostics) diagnostics.detailed = true;
  if (
    expectedOpportunityId &&
    typeof parsed.opportunityId === "string" &&
    parsed.opportunityId !== expectedOpportunityId
  ) {
    return reject(
      `the reply scored a different opportunity (${parsed.opportunityId})`,
    );
  }

  const normalizedDecision =
    typeof parsed.decision === "string"
      ? parsed.decision
          .trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, "")
      : "";
  const decisionApproved = [
    "approve",
    "approved",
    "accept",
    "accepted",
    "pass",
    "passed",
  ].includes(normalizedDecision)
    ? true
    : [
          "reject",
          "rejected",
          "revise",
          "revision",
          "needsrevision",
          "needschanges",
          "changesrequested",
          "fail",
          "failed",
        ].includes(normalizedDecision)
      ? false
      : undefined;
  if (
    typeof parsed.approved === "boolean" &&
    decisionApproved !== undefined &&
    parsed.approved !== decisionApproved
  ) {
    return reject(
      `"approved" (${parsed.approved}) contradicts "decision" (${parsed.decision})`,
    );
  }
  const providerApproved =
    typeof parsed.approved === "boolean" ? parsed.approved : decisionApproved;
  if (providerApproved === undefined) {
    return reject(
      'the reply carries no boolean "approved" and no recognized "decision"',
    );
  }

  for (const key of [
    ...new Set(DETAILED_CRITIC_SCORE_GROUPS.flat()),
    "overall",
  ] as const) {
    const value = asFiniteNumber(visualScores[key]);
    if (value !== undefined && (value < 0 || value > 1)) {
      return reject(`score "${key}" must be between 0 and 1`);
    }
  }
  for (const key of ["overallScore", "overall"] as const) {
    const value = asFiniteNumber(parsed[key]);
    if (value !== undefined && (value < 0 || value > 1)) {
      return reject(`score "${key}" must be between 0 and 1`);
    }
  }

  const optionalScore = (key: string): number | undefined =>
    asFiniteNumber(visualScores[key]);
  const topLevelOverall = asFiniteNumber(parsed.overallScore ?? parsed.overall);
  const overall = optionalScore("overall") ?? topLevelOverall ?? 0;
  const firstReported = (keys: string[], fallback = overall) => {
    for (const key of keys) {
      const value = optionalScore(key);
      if (value !== undefined) return value;
    }
    return fallback;
  };
  const minimumReported = (keys: string[], fallback = overall) => {
    const values = keys
      .map(optionalScore)
      .filter((value): value is number => value !== undefined);
    return values.length ? Math.min(...values) : fallback;
  };
  const controlMeaningfulness = firstReported([
    "controlMeaningfulness",
    "meaningfulControls",
  ]);
  const defaultStateUsefulness = firstReported([
    "defaultStateUsefulness",
    "usefulDefaultState",
  ]);
  const variableIntroduction = optionalScore("variableIntroduction");
  const sourceClaimsAndUnits = firstReported([
    "sourceClaimsAndUnits",
    "sourceClaimsAndUnitsPreserved",
    "sourceClaimAndUnitPreservation",
    "sourceClaimPreservation",
  ]);
  const primitiveTopologyAndDomain =
    optionalScore("primitiveTopologyAndDomain") ?? overall;
  const sourceFidelity = Math.min(
    sourceClaimsAndUnits,
    primitiveTopologyAndDomain,
  );
  // Every verdict must use the same complete protocol. Otherwise an old score
  // shape could bypass a required publication dimension simply by approving.
  const unscored = unscoredDetailedCriticDimensions(visualScores);
  if (unscored.length) {
    return reject(
      `the reply gave a verdict without scoring ${unscored.join(", ")}`,
    );
  }
  const scores = {
    pedagogicalValue: minimumReported([
      "interactionImprovesUnderstanding",
      "subsectionFit",
      "controlMeaningfulness",
      "meaningfulControls",
      "defaultStateUsefulness",
      "usefulDefaultState",
    ]),
    sourceFidelity,
    usability: minimumReported([
      "controlMeaningfulness",
      "meaningfulControls",
      "defaultStateUsefulness",
      "usefulDefaultState",
      "variableIntroduction",
      "complexityDiscipline",
      "avoidsUnnecessaryComplexity",
      "complexityRestraint",
      "avoidsDuplication",
    ]),
    accessibility: optionalScore("accessibility") ?? overall,
  };

  const requestedChanges: string[] = [];
  const addChange = (value: unknown) => {
    if (typeof value !== "string") return;
    const normalized = value.trim();
    if (
      normalized &&
      !requestedChanges.includes(normalized) &&
      requestedChanges.length < 12
    ) {
      requestedChanges.push(normalized);
    }
  };
  for (const key of [
    "requestedChanges",
    "requiredChanges",
    "recommendations",
    "issues",
  ] as const) {
    if (Array.isArray(parsed[key])) parsed[key].forEach(addChange);
  }
  if (providerApproved && requestedChanges.length > 0) {
    return reject("the reply approved the visual while requesting changes");
  }
  if ((optionalScore("interactionImprovesUnderstanding") ?? overall) < 0.75) {
    addChange(
      "Make the interaction teach the stated learning objective more directly.",
    );
  }
  if ((optionalScore("subsectionFit") ?? overall) < 0.75) {
    addChange(
      "Align the visual and its controls with this subsection instead of adjacent material.",
    );
  }
  if (controlMeaningfulness < 0.65) {
    addChange(
      "Replace generic controls with variables that directly change the taught relationship, and explain each control's effect.",
    );
  }
  if (defaultStateUsefulness < 0.65) {
    addChange(
      "Choose a default state that immediately demonstrates the intended relationship.",
    );
  }
  if (variableIntroduction !== undefined && variableIntroduction < 0.65) {
    addChange(
      "Introduce and label every variable and unit before the learner manipulates it.",
    );
  }
  if (sourceClaimsAndUnits < 0.75) {
    addChange(
      "Ground every relationship, claim, and unit in the supplied source evidence, and recompute every authored numeric, signed, directional, unit, and aggregate relationship for internal consistency.",
    );
  }
  if (primitiveTopologyAndDomain < 0.75) {
    addChange(
      "Make each rendered primitive's actual topology and domain match its labels, explanation, interaction contract, and source evidence; relabeling a mismatched shape is not a correction.",
    );
  }
  if ((optionalScore("avoidsDuplication") ?? 1) < 0.75) {
    addChange(
      "Remove duplicated explanation or interaction and keep only the distinct learning contribution.",
    );
  }
  if (
    firstReported(
      [
        "complexityDiscipline",
        "avoidsUnnecessaryComplexity",
        "complexityRestraint",
      ],
      1,
    ) < 0.65
  ) {
    addChange(
      "Reduce unnecessary complexity while preserving the interaction required by the learning objective.",
    );
  }
  if (scores.accessibility < 0.65) {
    addChange(
      "Add a complete non-visual explanation and ensure every control, output, diagram, and state is keyboard-readable and explicitly labelled.",
    );
  }

  const reason =
    [parsed.reason, parsed.rationale, parsed.summary]
      .find(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      )
      ?.trim() ?? `Visualization critic overall score ${overall.toFixed(2)}.`;
  if (!providerApproved && requestedChanges.length === 0) {
    addChange(
      "Revise the visual to address the critic's rationale before requesting another review.",
    );
  }
  const providerScores = Object.fromEntries(
    [
      ...Object.entries(visualScores),
      ["overallScore", parsed.overallScore],
    ].flatMap(([key, value]) => {
      const numeric = asFiniteNumber(value);
      return numeric === undefined ? [] : [[key, numeric]];
    }),
  );
  return {
    approved:
      providerApproved &&
      scores.pedagogicalValue >= 0.75 &&
      scores.sourceFidelity >= 0.75 &&
      scores.usability >= 0.65 &&
      scores.accessibility >= 0.65,
    checkedAt: nowIso(),
    reason,
    requestedChanges,
    scores,
    providerApproved,
    providerScores,
    ...(tokenUsage ? { tokenUsage } : {}),
  };
}

async function reviewGeneratedVisualization(input: {
  client: OpenAI;
  model: string;
  opportunity: VisualizationOpportunity;
  candidate: GeneratedVisualizationCandidate;
  definition: GeneratedVisualizationDefinition;
  sourceContext?: unknown;
  sourceFigureSummaries?: unknown[];
  formulaDefinitions?: unknown[];
  previewPath?: string;
  tests?: GeneratedVisualTestsRecord;
  /** Why the previous critic reply was unusable, quoted back so a retry
   * corrects the shape instead of repeating the identical prompt. */
  priorCriticFailure?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<GeneratedVisualCriticRecord> {
  const evidence = {
    opportunity: input.opportunity,
    explanation: input.candidate.explanation,
    pedagogicalClaims: input.candidate.pedagogicalClaims,
    accessibilityDescription: input.candidate.accessibilityDescription,
    definition: input.definition,
    sourceContext: JSON.stringify(input.sourceContext ?? {}).slice(0, 8_000),
    sourceFigureSummaries: boundedGeneratedVisualEvidence(
      input.sourceFigureSummaries?.slice(0, 6),
      6_000,
    ),
    formulaDefinitions: boundedGeneratedVisualEvidence(
      input.formulaDefinitions?.slice(0, 8),
      5_000,
    ),
    previewGenerated: Boolean(input.previewPath),
    runtimeEvidence: input.tests
      ? {
          passed: input.tests.passed,
          staticTests: input.tests.staticTests,
          semanticTests: input.tests.semanticTests,
          runtimeTests: input.tests.runtimeTests,
          browser: input.tests.browser,
          sandboxCapabilities: [
            "native labelled controls with keyboard focus",
            "reset synchronizes state, controls, and readouts",
            "exact protocolRole values enforce prediction then commit then reveal/evaluate, lock committed prediction inputs, guard premature activation, and Reset the sequence",
            "derived values and textual status use aria-live",
            "light/dark and reduced-motion CSS",
            "mobile and desktop overflow checks",
            "spatial projection and navigation occur only when explicitly authored as orthographic/perspective and fixed/orbit",
            "orbit views support pointer, touch, wheel, keyboard, Home, and global Reset over stable authored-world bounds",
          ],
        }
      : undefined,
  };
  const previewData =
    input.previewPath && fs.existsSync(input.previewPath)
      ? `data:image/png;base64,${fs.readFileSync(input.previewPath).toString("base64")}`
      : "";
  const response = await input.client.chat.completions.create(
    withCouncil(
      {
        model: input.model,
        messages: [
          {
            role: "system",
            // Council-routed requests drop `response_format`, so the required
            // shape is spelled out here as well as in the schema below.
            content:
              "Review one already validated Breadboard interactive visualization. Do not mutate the artifact.\n" +
              "Reply with one JSON object and nothing else:\n" +
              `{"approved": <boolean>, "reason": <string>, "requestedChanges": [<string>, ...], "scores": {${CRITIC_RUBRIC_KEYS.map((key) => `"${key}": <0-1 number>`).join(", ")}}}\n` +
              "Score every one of those dimensions as a number from 0 to 1 — an approval that leaves any dimension unscored is discarded. " +
              "Leave requestedChanges empty when you approve; otherwise list the specific revisions. " +
              "Compare every rendered primitive's actual topology and domain against its labels, explanation, interaction contract, and source evidence. Explicitly distinguish centered/full from bounded/clipped/one-sided/sector geometry and open from closed geometry. Reject any mismatch even when a label or prose renames the rendered shape; relabeling does not change topology or domain. " +
              "Independently recompute every evaluable relationship from the literal definition rather than trusting its labels, explanation, pedagogical claims, or screenshot. Check scalar values, signs, directions, units and conversions, every vector's endpoint delta and magnitude, component-wise sums, resultants, rounding, and other aggregates. A claimed sum must equal the displayed contributions at the authored precision. If displayed elements are representative samples of a larger or continuous domain, reject a whole-domain aggregate that is constructed or implied as their exact finite subtotal unless the source evidence explicitly establishes that equality; require the distinction in geometry, labels, and the non-visual explanation. If source evidence does not establish a sign, magnitude, scale, or aggregate, require explicitly qualitative or normalized encoding and reject unsupported evaluated claims. Treat every such check as part of both sourceClaimsAndUnits and primitiveTopologyAndDomain, and score either below its publication threshold when any check fails. " +
              "For a spatial scene, verify that its explicitly authored orthographic/perspective and fixed/orbit view is pedagogically useful rather than decorative, preserves legibility and truthful geometry, and is explained accessibly when orbit navigation is enabled. Omitted camera fields are the fixed orthographic legacy default; never infer a different mode from the screenshot or subject matter. " +
              "For test_prediction, verify the actual control and output behavior follows the reviewed input, then commit, then reveal/evaluate order; reject an artifact that reveals or evaluates the outcome before commitment, whose outcome changes initially, during prediction, or at commit alone, ignores any protocol stage, or merely describes the sequence in prose. The trusted runtime uses exact protocolRole values (never labels or subject inference) to keep prediction inputs editable until commit, lock them after commit, mutation-guard reveal/evaluate until commitment, and clear/unlock on Reset. There is no retained hidden-state snapshot; the mechanism is a UI/state lock and guard, not a semantic prediction snapshot invented by the runtime. Require the authored outcome expression or visibility to be gated by both commit and reveal/evaluate. " +
              "Approve only if interaction improves understanding, belongs in this subsection, uses meaningful controls, has a useful default state, introduces every variable, preserves source claims and units, matches primitive topology and domain, avoids duplication and unnecessary complexity, and is accessible.",
          },
          {
            role: "user",
            content: previewData
              ? [
                  { type: "text", text: JSON.stringify(evidence) },
                  {
                    type: "image_url",
                    image_url: { url: previewData, detail: "low" },
                  },
                ]
              : JSON.stringify(evidence),
          },
          ...(input.priorCriticFailure
            ? [
                {
                  role: "user" as const,
                  content:
                    `Your previous review was discarded because ${input.priorCriticFailure}. ` +
                    "Review the same artifact again and reply with the exact JSON object described above, " +
                    `including a 0-1 number for every one of: ${CRITIC_RUBRIC_KEYS.join(", ")}.`,
                },
              ]
            : []),
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "breadboard_generated_visual_critic",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["approved", "reason", "requestedChanges", "scores"],
              properties: {
                approved: { type: "boolean" },
                reason: { type: "string" },
                requestedChanges: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 12,
                },
                scores: {
                  type: "object",
                  additionalProperties: false,
                  required: [...CRITIC_RUBRIC_KEYS],
                  properties: Object.fromEntries(
                    CRITIC_RUBRIC_KEYS.map((key) => [
                      key,
                      {
                        type: "number",
                        minimum: 0,
                        maximum: 1,
                      },
                    ]),
                  ),
                },
              },
            },
          },
        },
        max_completion_tokens: Math.max(
          500,
          Math.min(
            4_000,
            Number(
              process.env.LEARN_GENERATED_VISUAL_CRITIC_MAX_OUTPUT_TOKENS ??
                1_500,
            ) || 1_500,
          ),
        ),
      },
      {
        taskType: "critique",
        gardenId: input.opportunity.gardenId,
        pageId: input.opportunity.targetPage,
        sourceContext: input.opportunity,
        councilModeOverride: "direct_council",
      },
    ),
    {
      signal: input.signal,
      ...(input.timeoutMs ? { timeout: input.timeoutMs } : {}),
      maxRetries: 0,
    },
  );
  const content = response.choices[0]?.message?.content ?? "";
  const tokenUsage = generatedVisualTokenUsage(response.usage);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(
      `critic returned invalid JSON: ${content.slice(0, 500) || "(empty response)"}`,
    );
  }
  const criticDiagnostics: DetailedGeneratedVisualCriticDiagnostics = {};
  const detailedCritic = normalizeDetailedGeneratedVisualCriticRecord(
    parsed,
    tokenUsage,
    input.opportunity.id,
    criticDiagnostics,
  );
  if (detailedCritic) return detailedCritic;
  // Active publication has one critic protocol. Legacy/compact score records
  // cannot approve by bypassing a required topology/domain comparison.
  throw new Error(
    `critic returned an unusable rubric verdict: ${criticDiagnostics.reason ?? "the reply did not score every required critic dimension, including primitiveTopologyAndDomain"}`,
  );
}

function nextGeneratedVisualVersion(gardenDir: string, id: string): number {
  return (loadGeneratedVisualManifest(gardenDir, id)?.version ?? 0) + 1;
}

function emit(
  sink: EventSink | undefined,
  type: string,
  data: Record<string, unknown>,
): void {
  sink?.({ type, data });
}

const GENERATED_VISUAL_REQUEST_TIMEOUT_CODE =
  "BREADBOARD_GENERATED_VISUAL_REQUEST_TIMEOUT";

class GeneratedVisualRequestTimeoutError extends Error {
  readonly code = GENERATED_VISUAL_REQUEST_TIMEOUT_CODE;
  readonly timeoutMs: number;

  constructor(timeoutMs: number, cause?: unknown) {
    super(
      `generated visualization provider request timed out after ${timeoutMs}ms`,
    );
    this.name = "GeneratedVisualRequestTimeoutError";
    this.timeoutMs = timeoutMs;
    if (cause !== undefined)
      (this as Error & { cause?: unknown }).cause = cause;
  }
}

class GeneratedVisualProviderTransportExhaustedError extends Error {
  readonly transportAttempts: number;
  readonly lastError: unknown;
  readonly retryOwner: "generated_visual_timeout" | "upstream_client";

  constructor(
    transportAttempts: number,
    lastError: unknown,
    retryOwner: "generated_visual_timeout" | "upstream_client",
  ) {
    const detail =
      lastError instanceof Error && lastError.message.trim()
        ? lastError.message.trim()
        : String(lastError || "provider transport failed");
    super(
      retryOwner === "generated_visual_timeout"
        ? `generated visualization provider transport exhausted ${transportAttempts} identical-request attempts: ${detail}`
        : `generated visualization upstream provider transport retries were exhausted before a model response: ${detail}`,
    );
    this.name = "GeneratedVisualProviderTransportExhaustedError";
    this.transportAttempts = transportAttempts;
    this.lastError = lastError;
    this.retryOwner = retryOwner;
    (this as Error & { cause?: unknown }).cause = lastError;
  }
}

interface GeneratedVisualProviderErrorDetail {
  code: string;
  name: string;
  message: string;
  status?: number;
}

function generatedVisualProviderErrorDetails(
  error: unknown,
): GeneratedVisualProviderErrorDetail[] {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  const details: GeneratedVisualProviderErrorDetail[] = [];
  while (pending.length > 0 && details.length < 24) {
    const current = pending.shift();
    if (typeof current === "string") {
      details.push({ code: "", name: "", message: current });
      continue;
    }
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const record = current as {
      cause?: unknown;
      code?: unknown;
      errors?: unknown;
      message?: unknown;
      name?: unknown;
      response?: unknown;
      status?: unknown;
    };
    const responseStatus = isRecord(record.response)
      ? asFiniteNumber(record.response.status)
      : undefined;
    details.push({
      code: typeof record.code === "string" ? record.code : "",
      name: typeof record.name === "string" ? record.name : "",
      message: typeof record.message === "string" ? record.message : "",
      status: asFiniteNumber(record.status) ?? responseStatus,
    });
    if (record.cause !== undefined) pending.push(record.cause);
    if (Array.isArray(record.errors)) pending.push(...record.errors);
  }
  return details;
}

function isGeneratedVisualProviderCancellation(error: unknown): boolean {
  return generatedVisualProviderErrorDetails(error).some(
    ({ code, name, message }) => {
      const normalizedCode = code.toUpperCase();
      const normalizedName = name.toLowerCase();
      return (
        normalizedCode === "ABORT_ERR" ||
        normalizedCode === "ERR_CANCELED" ||
        normalizedCode === "ERR_CANCELLED" ||
        normalizedName.includes("abort") ||
        normalizedName.includes("cancel") ||
        /\b(?:request|operation|job|generated visualization) (?:was )?(?:cancelled|canceled|aborted)\b/i.test(
          message,
        )
      );
    },
  );
}

/** Generated-visual requests own only their deadline. Learn's tracked client
 * separately owns 502/restart/connection retries, preventing multiplicative
 * retry schedules while caller-owned aborts remain terminal. */
export function isGeneratedVisualProviderTransportError(
  error: unknown,
): boolean {
  if (error instanceof GeneratedVisualRequestTimeoutError) return true;
  const details = generatedVisualProviderErrorDetails(error);
  if (details.length === 0) return false;
  // Do not reinterpret an ordinary HTTP/model response as a transport timeout.
  if (details.some(({ status }) => status !== undefined)) return false;
  const isExplicitTimeout = ({
    code,
    name,
    message,
  }: GeneratedVisualProviderErrorDetail) => {
    const normalizedCode = code.toUpperCase();
    return (
      [
        "ETIMEDOUT",
        "UND_ERR_CONNECT_TIMEOUT",
        "UND_ERR_HEADERS_TIMEOUT",
        "UND_ERR_BODY_TIMEOUT",
      ].includes(normalizedCode) ||
      /(?:api|connection|request|provider).*timeout/i.test(name) ||
      /\b(?:request|connection|response|provider) (?:timed out|timeout)\b/i.test(
        message,
      )
    );
  };
  // Provider timeout wrappers sometimes retain a nested AbortError produced by
  // their own deadline. The outer timeout identity wins; a naked/root abort is
  // still caller cancellation, and call sites check externalSignal first.
  if (isExplicitTimeout(details[0])) return true;
  if (isGeneratedVisualProviderCancellation(error)) return false;
  return details.some(isExplicitTimeout);
}

function generatedVisualAbortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ?? new DOMException("The operation was aborted", "AbortError")
  );
}

async function withGeneratedVisualTimeout<T>(input: {
  timeoutMs: number;
  externalSignal?: AbortSignal;
  work: (signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  if (input.externalSignal?.aborted)
    throw generatedVisualAbortReason(input.externalSignal);
  const controller = new AbortController();
  let timeoutFailure: GeneratedVisualRequestTimeoutError | undefined;
  let externalFailure: unknown;
  let rejectBoundary: (reason?: unknown) => void = () => undefined;
  const boundary = new Promise<never>((_resolve, reject) => {
    rejectBoundary = reject;
  });
  const abortFromExternal = () => {
    externalFailure = generatedVisualAbortReason(input.externalSignal!);
    controller.abort(externalFailure);
    rejectBoundary(externalFailure);
  };
  input.externalSignal?.addEventListener("abort", abortFromExternal, {
    once: true,
  });
  const timer = setTimeout(() => {
    timeoutFailure = new GeneratedVisualRequestTimeoutError(input.timeoutMs);
    controller.abort(timeoutFailure);
    rejectBoundary(timeoutFailure);
  }, input.timeoutMs);
  try {
    return await Promise.race([
      Promise.resolve().then(() => input.work(controller.signal)),
      boundary,
    ]);
  } catch (error) {
    if (externalFailure !== undefined) throw externalFailure;
    if (timeoutFailure) {
      if (error !== timeoutFailure) {
        (timeoutFailure as Error & { cause?: unknown }).cause = error;
      }
      throw timeoutFailure;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    input.externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

export async function retryGeneratedVisualProviderRequest<T>(input: {
  timeoutMs: number;
  /** The built-in OpenAI provider applies `timeoutMs` to each raw SDK call so
   * an upstream connection-retry delay is never aborted by this boundary. */
  timeoutOwner?: "boundary" | "provider";
  externalSignal?: AbortSignal;
  checkCancelled?: () => void;
  maxTransportAttempts?: number;
  work: (signal: AbortSignal, transportAttempt: number) => Promise<T>;
  onRetry?: (event: {
    error: unknown;
    transportAttempt: number;
    transportMaxAttempts: number;
  }) => void;
}): Promise<T> {
  const maxTransportAttempts = Math.max(
    1,
    Math.min(
      GENERATED_VISUAL_PROVIDER_TRANSPORT_MAX_ATTEMPTS,
      input.maxTransportAttempts ??
        GENERATED_VISUAL_PROVIDER_TRANSPORT_MAX_ATTEMPTS,
    ),
  );
  for (
    let transportAttempt = 1;
    transportAttempt <= maxTransportAttempts;
    transportAttempt += 1
  ) {
    input.checkCancelled?.();
    if (input.externalSignal?.aborted)
      throw generatedVisualAbortReason(input.externalSignal);
    try {
      if (input.timeoutOwner === "provider") {
        const requestSignal =
          input.externalSignal ?? new AbortController().signal;
        return await input.work(requestSignal, transportAttempt);
      }
      return await withGeneratedVisualTimeout({
        timeoutMs: input.timeoutMs,
        externalSignal: input.externalSignal,
        work: (signal) => input.work(signal, transportAttempt),
      });
    } catch (error) {
      if (input.externalSignal?.aborted)
        throw generatedVisualAbortReason(input.externalSignal);
      input.checkCancelled?.();
      if (error instanceof GeneratedVisualProviderTransportExhaustedError)
        throw error;
      if (isGeneratedVisualProviderTransportError(error)) {
        if (transportAttempt === maxTransportAttempts) {
          throw new GeneratedVisualProviderTransportExhaustedError(
            transportAttempt,
            error,
            "generated_visual_timeout",
          );
        }
        input.onRetry?.({
          error,
          transportAttempt,
          transportMaxAttempts: maxTransportAttempts,
        });
        continue;
      }
      // `attachLearnTokenUsageTracking` already gave these narrow failures its
      // six-attempt schedule. Treat final exhaustion as infrastructure-terminal
      // for this logical request; never multiply it or spend a semantic attempt.
      if (isRetryableModelTransportError(error)) {
        throw new GeneratedVisualProviderTransportExhaustedError(
          transportAttempt,
          error,
          "upstream_client",
        );
      }
      throw error;
    }
  }
  throw new Error(
    "generated visualization provider transport retry schedule did not run",
  );
}

function writeRejectedAttempt(
  gardenDir: string,
  id: string,
  runId: string,
  attempt: number,
  candidate: GeneratedVisualizationCandidate | null,
  category: string,
  errors: string[],
  lifecycle: GeneratedVisualLifecycleRecord[] = [],
  evidence?: {
    validation?: GeneratedVisualValidationRecord;
    tests?: GeneratedVisualTestsRecord;
    critic?: GeneratedVisualCriticRecord;
  },
): void {
  const dir = path.join(
    generatedVisualArtifactDir(gardenDir, id),
    "attempts",
    runId,
    `attempt-${attempt}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  if (candidate) {
    fs.writeFileSync(
      path.join(dir, "source.tsx"),
      candidate.sourceCode,
      "utf-8",
    );
    writeJson(path.join(dir, "candidate.json"), candidate);
  }
  if (evidence?.validation)
    writeJson(path.join(dir, "validation.json"), evidence.validation);
  if (evidence?.tests) writeJson(path.join(dir, "tests.json"), evidence.tests);
  if (evidence?.critic)
    writeJson(path.join(dir, "critic.json"), evidence.critic);
  writeJson(path.join(dir, "rejection.json"), {
    status: "rejected",
    category,
    errors,
    at: nowIso(),
  });
  writeJson(path.join(dir, "lifecycle.json"), [
    ...lifecycle,
    { status: "rejected", at: nowIso(), attempt, detail: errors.join("; ") },
  ]);
}

export type CreateGeneratedVisualizationInput = {
  client: OpenAI;
  model: string;
  gardenDir: string;
  opportunity: VisualizationOpportunity;
  pageMarkdown: string;
  sourceContext?: unknown;
  sourceFigureSummaries?: unknown[];
  formulaDefinitions?: unknown[];
  availableSourceAnchorIds?: Set<string>;
  onEvent?: EventSink;
  candidateProvider?: typeof generateVisualizationCandidate;
  criticProvider?: typeof reviewGeneratedVisualization;
  maxAttempts?: number;
  criticMaxAttempts?: number;
  runBrowserTests?: boolean;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  checkCancelled?: () => void;
};

let activeGeneratedVisualizations = 0;
const generatedVisualWaiters: Array<{
  grant: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
}> = [];

function generatedVisualConcurrencyLimit(): number {
  return Math.max(
    1,
    Math.min(
      8,
      Number(process.env.LEARN_GENERATED_VISUAL_CONCURRENCY ?? 2) || 2,
    ),
  );
}

async function acquireGeneratedVisualSlot(
  signal?: AbortSignal,
): Promise<() => void> {
  if (signal?.aborted) throw new Error("generated visualization was cancelled");
  if (activeGeneratedVisualizations < generatedVisualConcurrencyLimit()) {
    activeGeneratedVisualizations += 1;
  } else {
    await new Promise<void>((resolve, reject) => {
      const waiter: (typeof generatedVisualWaiters)[number] = {
        grant: resolve,
        reject,
        signal,
      };
      waiter.abort = () => {
        const index = generatedVisualWaiters.indexOf(waiter);
        if (index >= 0) generatedVisualWaiters.splice(index, 1);
        reject(new Error("generated visualization was cancelled"));
      };
      signal?.addEventListener("abort", waiter.abort, { once: true });
      generatedVisualWaiters.push(waiter);
    });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    while (generatedVisualWaiters.length > 0) {
      const waiter = generatedVisualWaiters.shift();
      if (!waiter) break;
      waiter.signal?.removeEventListener("abort", waiter.abort!);
      if (waiter.signal?.aborted) {
        waiter.reject(new Error("generated visualization was cancelled"));
        continue;
      }
      waiter.grant();
      return;
    }
    activeGeneratedVisualizations = Math.max(
      0,
      activeGeneratedVisualizations - 1,
    );
  };
}

async function createGeneratedVisualizationWithSlot(
  input: CreateGeneratedVisualizationInput,
): Promise<GeneratedVisualResult> {
  const enabled =
    String(process.env.LEARN_GENERATED_VISUALS_ENABLED ?? "true").trim() !==
    "false";
  if (!enabled)
    return {
      manifest: null,
      definition: null,
      errors: ["generated visuals are disabled"],
    };
  const id = input.opportunity.id;
  const version = nextGeneratedVisualVersion(input.gardenDir, id);
  const runId = `${nowIso()
    .replace(/[^0-9]/g, "")
    .slice(0, 17)}-${process.pid}`;
  const maxAttempts = Math.max(
    1,
    Math.min(
      GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS,
      input.maxAttempts ??
        (Number(process.env.LEARN_GENERATED_VISUAL_MAX_ATTEMPTS ?? 3) || 3),
    ),
  );
  const candidateProvider =
    input.candidateProvider ?? generateVisualizationCandidate;
  const criticProvider = input.criticProvider ?? reviewGeneratedVisualization;
  let previousSourceCode = "";
  let repairErrors: string[] = [];
  let lastFailure: GeneratedVisualResult["failureCategory"] = "generation";
  let transportExhaustedWithoutFallback = false;
  const requestTimeoutMs = Math.max(
    5_000,
    Math.min(
      300_000,
      input.timeoutMs ??
        (Number(
          process.env.LEARN_GENERATED_VISUAL_TIMEOUT_MS ??
            GENERATED_VISUAL_PROVIDER_REQUEST_TIMEOUT_MS,
        ) || GENERATED_VISUAL_PROVIDER_REQUEST_TIMEOUT_MS),
    ),
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    input.checkCancelled?.();
    if (input.abortSignal?.aborted)
      throw new Error("generated visualization was cancelled");
    const startedAt = Date.now();
    const lifecycle: GeneratedVisualLifecycleRecord[] = [
      { status: "draft", at: nowIso(), attempt },
    ];
    emit(
      input.onEvent,
      attempt === 1 ? "visual_generation_started" : "visual_repair_started",
      {
        gardenId: input.opportunity.gardenId,
        learningUnitId: input.opportunity.learningUnitId,
        visualizationId: id,
        attempt,
        route: "generated_module",
        sourceAnchors: input.opportunity.sourceAnchorIds,
      },
    );
    let candidate: GeneratedVisualizationCandidate;
    const generationStartedAt = Date.now();
    const candidateRequest = {
      client: input.client,
      model: input.model,
      opportunity: input.opportunity,
      pageMarkdown: input.pageMarkdown,
      sourceContext: input.sourceContext,
      sourceFigureSummaries: input.sourceFigureSummaries,
      formulaDefinitions: input.formulaDefinitions,
      previousSourceCode: previousSourceCode || undefined,
      errors: repairErrors.length ? repairErrors : undefined,
      timeoutMs: requestTimeoutMs,
    };
    try {
      candidate = await retryGeneratedVisualProviderRequest({
        timeoutMs: requestTimeoutMs,
        timeoutOwner:
          candidateProvider === generateVisualizationCandidate
            ? "provider"
            : "boundary",
        externalSignal: input.abortSignal,
        checkCancelled: input.checkCancelled,
        work: (signal) => candidateProvider({ ...candidateRequest, signal }),
        onRetry: ({ error, transportAttempt, transportMaxAttempts }) => {
          emit(input.onEvent, "visual_generation_transport_retry", {
            visualizationId: id,
            attempt,
            transportAttempt,
            transportMaxAttempts,
            reason:
              error instanceof Error
                ? error.message
                : "provider transport failed",
          });
        },
      });
    } catch (error) {
      if (input.abortSignal?.aborted)
        throw generatedVisualAbortReason(input.abortSignal);
      input.checkCancelled?.();
      lastFailure = "generation";
      repairErrors = [
        error instanceof Error ? error.message : "candidate generation failed",
      ];
      if (error instanceof GeneratedVisualProviderTransportExhaustedError) {
        transportExhaustedWithoutFallback = true;
        writeRejectedAttempt(
          input.gardenDir,
          id,
          runId,
          attempt,
          null,
          "generation_transport",
          repairErrors,
          lifecycle,
        );
        emit(input.onEvent, "visual_generation_transport_exhausted", {
          visualizationId: id,
          attempt,
          transportAttempts: error.transportAttempts,
          transportRetryOwner: error.retryOwner,
          failureCategory: "generation",
          reason: repairErrors.join("; "),
          durationMs: Date.now() - startedAt,
        });
        break;
      }
      if (isGeneratedVisualProviderCancellation(error)) throw error;
      writeRejectedAttempt(
        input.gardenDir,
        id,
        runId,
        attempt,
        null,
        "generation",
        repairErrors,
        lifecycle,
      );
      emit(input.onEvent, "visual_generation_failed", {
        visualizationId: id,
        attempt,
        failureCategory: "generation",
        reason: repairErrors.join("; "),
        durationMs: Date.now() - startedAt,
      });
      continue;
    }
    previousSourceCode = candidate.sourceCode;
    emit(input.onEvent, "visual_model_generation_completed", {
      visualizationId: id,
      attempt,
      durationMs: Date.now() - generationStartedAt,
      ...(candidate.tokenUsage ? { tokenUsage: candidate.tokenUsage } : {}),
    });
    const compilationStartedAt = Date.now();
    const compilation = compileGeneratedVisualization(
      candidate.sourceCode,
      input.opportunity,
    );
    if (!compilation.definition) {
      lastFailure = "validation";
      repairErrors = compilation.validation.errors;
      writeRejectedAttempt(
        input.gardenDir,
        id,
        runId,
        attempt,
        candidate,
        "validation",
        repairErrors,
        lifecycle,
        {
          validation: compilation.validation,
        },
      );
      emit(input.onEvent, "visual_static_validation_failed", {
        visualizationId: id,
        attempt,
        failureCategory: "validation",
        reason: repairErrors.join("; "),
        durationMs: Date.now() - startedAt,
      });
      continue;
    }
    emit(input.onEvent, "visual_compilation_completed", {
      visualizationId: id,
      attempt,
      sourceHash: compilation.sourceHash,
      cacheHit: compilation.cacheHit,
      durationMs: Date.now() - compilationStartedAt,
    });
    const definition = compilation.definition;
    lifecycle.push(
      { status: "validated", at: nowIso(), attempt },
      { status: "compiled", at: nowIso(), attempt },
    );
    emit(input.onEvent, "visual_generation_completed", {
      visualizationId: id,
      attempt,
      sourceHash: compilation.sourceHash,
      durationMs: Date.now() - startedAt,
    });

    const deterministicStartedAt = Date.now();
    const deterministicTests = runGeneratedVisualDeterministicTests({
      definition,
      testCases: candidate.testCases,
      opportunity: input.opportunity,
      availableSourceAnchorIds: input.availableSourceAnchorIds,
    });
    emit(input.onEvent, "visual_semantic_tests_completed", {
      visualizationId: id,
      attempt,
      passed: deterministicTests.passed,
      durationMs: Date.now() - deterministicStartedAt,
    });
    const stagingDir = path.join(
      generatedVisualArtifactDir(input.gardenDir, id),
      ".staging",
      `${version}-${attempt}`,
    );
    const shouldRunBrowser =
      input.runBrowserTests ??
      String(process.env.LEARN_GENERATED_VISUAL_BROWSER_TESTS ?? "true") !==
        "false";
    const browserStartedAt = Date.now();
    const browser = shouldRunBrowser
      ? runGeneratedVisualBrowserTests({ definition, outputDir: stagingDir })
      : {
          tests: [
            {
              name: "browser tests explicitly disabled",
              passed: true,
              detail: "development override",
            },
          ],
          browser: undefined,
        };
    emit(input.onEvent, "visual_browser_tests_completed", {
      visualizationId: id,
      attempt,
      enabled: shouldRunBrowser,
      passed: browser.tests.every((test) => test.passed),
      durationMs: Date.now() - browserStartedAt,
    });
    input.checkCancelled?.();
    if (input.abortSignal?.aborted)
      throw new Error("generated visualization was cancelled");
    deterministicTests.runtimeTests.push(...browser.tests);
    deterministicTests.browser = browser.browser;
    deterministicTests.passed = [
      ...deterministicTests.staticTests,
      ...deterministicTests.semanticTests,
      ...deterministicTests.runtimeTests,
    ].every((test) => test.passed);
    if (!deterministicTests.passed) {
      lastFailure = "runtime";
      repairErrors = [
        ...deterministicTests.staticTests,
        ...deterministicTests.semanticTests,
        ...deterministicTests.runtimeTests,
      ]
        .filter((test) => !test.passed)
        .map((test) => `${test.name}: ${test.detail ?? "failed"}`);
      writeRejectedAttempt(
        input.gardenDir,
        id,
        runId,
        attempt,
        candidate,
        "runtime",
        repairErrors,
        lifecycle,
        {
          validation: compilation.validation,
          tests: deterministicTests,
        },
      );
      emit(input.onEvent, "visual_runtime_test_failed", {
        visualizationId: id,
        attempt,
        failureCategory: "runtime",
        reason: repairErrors.join("; "),
        durationMs: Date.now() - startedAt,
      });
      continue;
    }
    lifecycle.push({ status: "tested", at: nowIso(), attempt });

    let critic: GeneratedVisualCriticRecord | null = null;
    let criticFailure = "critic failed";
    const criticAttempts = Math.max(
      1,
      Math.min(
        3,
        input.criticMaxAttempts ??
          (Number(process.env.LEARN_GENERATED_VISUAL_CRITIC_ATTEMPTS ?? 2) ||
            2),
      ),
    );
    const criticStartedAt = Date.now();
    let priorCriticFailure: string | undefined;
    let criticTransportExhausted:
      | GeneratedVisualProviderTransportExhaustedError
      | undefined;
    for (
      let criticAttempt = 1;
      criticAttempt <= criticAttempts;
      criticAttempt += 1
    ) {
      const criticRequest = {
        client: input.client,
        model: String(
          process.env.LEARN_GENERATED_VISUAL_CRITIC_MODEL ?? input.model,
        ),
        opportunity: input.opportunity,
        candidate,
        definition,
        sourceContext: input.sourceContext,
        sourceFigureSummaries: input.sourceFigureSummaries,
        formulaDefinitions: input.formulaDefinitions,
        previewPath: browser.browser?.screenshotCreated
          ? path.join(stagingDir, "preview.png")
          : undefined,
        tests: deterministicTests,
        priorCriticFailure,
        timeoutMs: requestTimeoutMs,
      };
      try {
        critic = await retryGeneratedVisualProviderRequest({
          timeoutMs: requestTimeoutMs,
          timeoutOwner:
            criticProvider === reviewGeneratedVisualization
              ? "provider"
              : "boundary",
          externalSignal: input.abortSignal,
          checkCancelled: input.checkCancelled,
          work: (signal) => criticProvider({ ...criticRequest, signal }),
          onRetry: ({ error, transportAttempt, transportMaxAttempts }) => {
            emit(input.onEvent, "visual_critic_transport_retry", {
              visualizationId: id,
              attempt,
              criticAttempt,
              transportAttempt,
              transportMaxAttempts,
              reason:
                error instanceof Error
                  ? error.message
                  : "provider transport failed",
            });
          },
        });
        break;
      } catch (error) {
        if (input.abortSignal?.aborted)
          throw generatedVisualAbortReason(input.abortSignal);
        input.checkCancelled?.();
        if (error instanceof GeneratedVisualProviderTransportExhaustedError) {
          criticTransportExhausted = error;
          criticFailure = error.message;
          emit(input.onEvent, "visual_critic_transport_exhausted", {
            visualizationId: id,
            attempt,
            criticAttempt,
            transportAttempts: error.transportAttempts,
            transportRetryOwner: error.retryOwner,
            failureCategory: "critic",
            reason: error.message,
            durationMs: Date.now() - criticStartedAt,
          });
          break;
        }
        if (isGeneratedVisualProviderCancellation(error)) throw error;
        criticFailure =
          error instanceof Error ? error.message : "critic failed";
        priorCriticFailure = criticFailure;
        if (criticAttempt < criticAttempts) {
          emit(input.onEvent, "visual_critic_retry", {
            visualizationId: id,
            attempt,
            criticAttempt,
            reason: criticFailure,
          });
        }
      }
    }
    if (!critic) {
      lastFailure = "critic";
      if (criticTransportExhausted) {
        transportExhaustedWithoutFallback = true;
        repairErrors = [criticTransportExhausted.message];
        writeRejectedAttempt(
          input.gardenDir,
          id,
          runId,
          attempt,
          candidate,
          "critic_transport",
          repairErrors,
          lifecycle,
          {
            validation: compilation.validation,
            tests: deterministicTests,
          },
        );
        break;
      }
      repairErrors = [
        `Critic review could not complete after ${criticAttempts} attempt${criticAttempts === 1 ? "" : "s"}: ${criticFailure}`,
      ];
      writeRejectedAttempt(
        input.gardenDir,
        id,
        runId,
        attempt,
        candidate,
        "critic",
        repairErrors,
        lifecycle,
        {
          validation: compilation.validation,
          tests: deterministicTests,
        },
      );
      emit(input.onEvent, "visual_critic_failed", {
        visualizationId: id,
        attempt,
        criticAttempts,
        failureCategory: "critic",
        reason: criticFailure,
        durationMs: Date.now() - criticStartedAt,
      });
      break;
    }
    emit(input.onEvent, "visual_critic_completed", {
      visualizationId: id,
      attempt,
      approved: critic.approved,
      durationMs: Date.now() - criticStartedAt,
      ...(critic.tokenUsage ? { tokenUsage: critic.tokenUsage } : {}),
    });
    if (!critic.approved) {
      lastFailure = "critic";
      repairErrors = [critic.reason, ...critic.requestedChanges].filter(
        Boolean,
      );
      writeRejectedAttempt(
        input.gardenDir,
        id,
        runId,
        attempt,
        candidate,
        "critic",
        repairErrors,
        lifecycle,
        {
          validation: compilation.validation,
          tests: deterministicTests,
          critic,
        },
      );
      emit(input.onEvent, "visual_critic_rejected", {
        visualizationId: id,
        attempt,
        failureCategory: "critic",
        reason: critic.reason,
        durationMs: Date.now() - startedAt,
      });
      continue;
    }
    lifecycle.push({ status: "critic_approved", at: nowIso(), attempt });

    const previous = loadGeneratedVisualManifest(input.gardenDir, id);
    const manifest: GeneratedVisualizationManifest = {
      schemaVersion: GENERATED_VISUAL_SCHEMA_VERSION,
      sdkVersion: VISUAL_SDK_VERSION,
      id,
      gardenId: input.opportunity.gardenId,
      learningUnitId: input.opportunity.learningUnitId,
      title: candidate.title || definition.title,
      description: candidate.explanation || definition.description,
      learningObjective: input.opportunity.learningObjective,
      sourceAnchorIds: input.opportunity.sourceAnchorIds,
      sourceVisualIds: input.opportunity.sourceVisualIds,
      sourceVisualRelationships: input.opportunity.sourceVisualRelationships,
      conceptIds: input.opportunity.conceptIds,
      insertionAnchor: input.opportunity.insertionAnchor,
      targetPage: input.opportunity.targetPage,
      targetHeading: input.opportunity.targetHeading,
      sourceHash: compilation.sourceHash,
      compiledHash: compilation.compiledHash,
      status: "published",
      generatedAt: nowIso(),
      generatorModel: input.model,
      generationAttempt: attempt,
      version,
      ...(previous ? { previousVersion: previous.version } : {}),
      artifactPath: artifactRelativePath(id),
      similarityFingerprint: input.opportunity.similarityFingerprint,
    };
    saveGeneratedVisualArtifact({
      gardenDir: input.gardenDir,
      manifest,
      sourceCode: candidate.sourceCode,
      compiledJavaScript: compilation.compiledJavaScript,
      validation: compilation.validation,
      critic,
      tests: deterministicTests,
      lifecycle: [...lifecycle, { status: "published", at: nowIso(), attempt }],
      previewPath: path.join(stagingDir, "preview.png"),
    });
    try {
      fs.rmSync(
        path.join(generatedVisualArtifactDir(input.gardenDir, id), ".staging"),
        {
          recursive: true,
          force: true,
        },
      );
    } catch {
      // Staging cleanup is best-effort; it is never indexed or published.
    }
    emit(input.onEvent, "visual_published", {
      gardenId: manifest.gardenId,
      learningUnitId: manifest.learningUnitId,
      visualizationId: id,
      attempt,
      version,
      route: "generated_module",
      sourceAnchors: manifest.sourceAnchorIds,
      artifactPaths: [manifest.artifactPath],
      previousStatus: previous?.status ?? "none",
      resultingStatus: manifest.status,
      durationMs: Date.now() - startedAt,
    });
    return { manifest, definition, errors: [] };
  }

  if (!transportExhaustedWithoutFallback) {
    emit(input.onEvent, "visual_fallback_used", {
      gardenId: input.opportunity.gardenId,
      learningUnitId: input.opportunity.learningUnitId,
      visualizationId: id,
      failureCategory: lastFailure,
      reason:
        repairErrors.join("; ") || "generated visualization attempts exhausted",
      resultingStatus: "rejected",
    });
  }
  return {
    manifest: null,
    definition: null,
    errors: repairErrors.length
      ? repairErrors
      : ["generated visualization attempts exhausted"],
    failureCategory: lastFailure,
  };
}

export async function createGeneratedVisualization(
  input: CreateGeneratedVisualizationInput,
): Promise<GeneratedVisualResult> {
  const release = await acquireGeneratedVisualSlot(input.abortSignal);
  try {
    return await createGeneratedVisualizationWithSlot(input);
  } finally {
    release();
  }
}

export function rollbackGeneratedVisualization(input: {
  gardenDir: string;
  id: string;
  version: number;
}): GeneratedVisualizationManifest {
  const targetDir = path.join(
    generatedVisualArtifactDir(input.gardenDir, input.id),
    "versions",
    String(input.version),
  );
  const manifestPath = path.join(targetDir, "manifest.json");
  if (!fs.existsSync(manifestPath))
    throw new Error(`Version ${input.version} does not exist`);
  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf-8"),
  ) as GeneratedVisualizationManifest;
  if (manifest.id !== input.id || manifest.version !== input.version) {
    throw new Error("Generated visualization version manifest is inconsistent");
  }
  const validation = JSON.parse(
    fs.readFileSync(path.join(targetDir, "validation.json"), "utf-8"),
  ) as GeneratedVisualValidationRecord;
  const tests = JSON.parse(
    fs.readFileSync(path.join(targetDir, "tests.json"), "utf-8"),
  ) as GeneratedVisualTestsRecord;
  const critic = JSON.parse(
    fs.readFileSync(path.join(targetDir, "critic.json"), "utf-8"),
  ) as GeneratedVisualCriticRecord;
  const source = fs.readFileSync(path.join(targetDir, "source.tsx"), "utf-8");
  if (
    manifest.status !== "published" ||
    sha256(source) !== manifest.sourceHash ||
    validation.valid !== true ||
    tests.passed !== true ||
    critic.approved !== true ||
    !loadGeneratedVisualDefinition(input.gardenDir, input.id, input.version)
  ) {
    throw new Error(
      `Version ${input.version} no longer passes generated visualization publication gates`,
    );
  }
  copyArtifactFiles(
    targetDir,
    generatedVisualArtifactDir(input.gardenDir, input.id),
  );
  writeJson(
    path.join(
      generatedVisualArtifactDir(input.gardenDir, input.id),
      "current.json",
    ),
    {
      id: input.id,
      version: input.version,
      manifest: `versions/${input.version}/manifest.json`,
    },
  );
  updateGeneratedVisualIndex(input.gardenDir, manifest);
  return manifest;
}
