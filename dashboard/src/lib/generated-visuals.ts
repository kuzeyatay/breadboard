import crypto from "crypto";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { spawnSync } from "child_process";
import ts from "typescript";
import type OpenAI from "openai";
import { withCouncil } from "./council.ts";
import {
  VISUAL_SDK_VERSION,
  type GeneratedVisualizationDefinition,
  type GeneratedVisualControl,
  type GeneratedVisualOutput,
  type GeneratedVisualScene,
  type VisualExpression,
} from "./visual-sdk.ts";
import type {
  SourceVisualRelationship,
  VisualizationOpportunity,
} from "./visualization-opportunities.ts";

export const GENERATED_VISUAL_BLOCK_LANG = "breadboard-generated-visual";
export const GENERATED_VISUAL_SCHEMA_VERSION = 1;
export const GENERATED_VISUAL_MAX_SOURCE_CHARS = 60_000;

const SDK_IMPORT = "@breadboard/visual-sdk";
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
const MAX_AST_NODES = 2_500;
const MAX_LITERAL_DEPTH = 24;
const MAX_EXPRESSION_NODES = 300;
const MAX_SCENES = 24;
const MAX_CONTROLS = 12;
const MAX_OUTPUTS = 16;
const GENERATED_COMPILATION_CACHE = new Map<string, GeneratedVisualCompilation>();

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
  failureCategory?: "validation" | "compilation" | "runtime" | "critic" | "generation";
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
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function generatedVisualTokenUsage(value: unknown): GeneratedVisualTokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = asFiniteNumber(value.prompt_tokens ?? value.input_tokens) ?? 0;
  const outputTokens = asFiniteNumber(value.completion_tokens ?? value.output_tokens) ?? 0;
  const details = isRecord(value.completion_tokens_details) ? value.completion_tokens_details : {};
  const reasoningTokens = asFiniteNumber(details.reasoning_tokens) ?? 0;
  const totalTokens = asFiniteNumber(value.total_tokens) ?? inputTokens + outputTokens;
  if (inputTokens + outputTokens + totalTokens === 0) return undefined;
  return { inputTokens, outputTokens, reasoningTokens, totalTokens };
}

function boundedGeneratedVisualEvidence(value: unknown, maxChars: number): unknown {
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
  if (depth > MAX_LITERAL_DEPTH) throw new Error("module literal nesting is too deep");
  const node = unwrapExpression(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (
    ts.isPrefixUnaryExpression(node) &&
    (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(node.operand)
  ) {
    const value = Number(node.operand.text);
    return node.operator === ts.SyntaxKind.MinusToken ? -value : value;
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) => {
      if (ts.isSpreadElement(element)) throw new Error("spread elements are not allowed");
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
      const key = property.name &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name))
        ? property.name.text
        : "";
      if (!key || FORBIDDEN_PROPERTIES.has(key)) {
        throw new Error(`property ${key || "(unknown)"} is not allowed`);
      }
      result[key] = literalFromAst(property.initializer, depth + 1);
    }
    return result;
  }
  throw new Error(`executable syntax is not allowed (${ts.SyntaxKind[node.kind]})`);
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
      errors: [`source exceeds ${GENERATED_VISUAL_MAX_SOURCE_CHARS} characters`],
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
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }
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
    if (ts.isPropertyAccessExpression(node) && FORBIDDEN_PROPERTIES.has(node.name.text)) {
      errors.push(`forbidden property access: ${node.name.text}`);
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && EXTERNAL_URL_RE.test(node.text)) {
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
  if (astNodeCount > MAX_AST_NODES) errors.push(`AST exceeds ${MAX_AST_NODES} nodes`);

  let exportExpression: ts.Expression | null = null;
  let importCount = 0;
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      importCount += 1;
      const moduleName = ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : "";
      imports.push(moduleName);
      if (!IMPORT_ALLOWLIST.has(moduleName)) errors.push(`import ${moduleName || "(unknown)"} is not allowed`);
      if (moduleName === SDK_IMPORT) {
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) {
          errors.push("the SDK must use named imports");
        } else {
          for (const element of bindings.elements) {
            if (element.name.text !== "defineVisualization") {
              errors.push(`SDK import ${element.name.text} is not allowed in generated modules v1`);
            }
          }
        }
      } else if (moduleName === "react") {
        errors.push("React is allowlisted for future SDK versions but generated modules v1 must remain declarative");
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
    errors.push(`generated modules must import only defineVisualization from ${SDK_IMPORT}`);
  }
  if (!exportExpression) errors.push("a default defineVisualization export is required");

  let definition: unknown = null;
  if (exportExpression) {
    const expression = unwrapExpression(exportExpression);
    if (
      !ts.isCallExpression(expression) ||
      !ts.isIdentifier(expression.expression) ||
      expression.expression.text !== "defineVisualization" ||
      expression.arguments.length !== 1
    ) {
      errors.push("default export must be defineVisualization({ ...literal definition... })");
    } else {
      try {
        definition = literalFromAst(expression.arguments[0]);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "module literal could not be parsed");
      }
    }
  }
  return { definition, imports, errors: [...new Set(errors)], warnings, astNodeCount };
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
    errors.push(`${pathLabel}: expression exceeds ${MAX_EXPRESSION_NODES} nodes`);
    return false;
  }
  if (depth > 16 || !isRecord(expression)) {
    errors.push(`${pathLabel}: expression is invalid or too deeply nested`);
    return false;
  }
  const kind = expression.kind;
  if (kind === "constant") {
    if (asFiniteNumber(expression.value) === undefined) errors.push(`${pathLabel}: constant must be finite`);
    return asFiniteNumber(expression.value) !== undefined;
  }
  if (kind === "input") {
    const id = typeof expression.id === "string" ? expression.id : "";
    if (!knownInputs.has(id)) errors.push(`${pathLabel}: unknown input ${id || "(missing)"}`);
    return knownInputs.has(id);
  }
  if (kind === "binary") {
    if (!["add", "subtract", "multiply", "divide", "power", "min", "max"].includes(String(expression.op))) {
      errors.push(`${pathLabel}: unsupported binary operator`);
    }
    const left = validateExpression(expression.left, knownInputs, errors, `${pathLabel}.left`, depth + 1, counter);
    const right = validateExpression(expression.right, knownInputs, errors, `${pathLabel}.right`, depth + 1, counter);
    return left && right;
  }
  if (kind === "unary") {
    if (!["negate", "abs", "sqrt", "sin", "cos", "tan", "exp", "log"].includes(String(expression.op))) {
      errors.push(`${pathLabel}: unsupported unary operator`);
    }
    return validateExpression(expression.argument, knownInputs, errors, `${pathLabel}.argument`, depth + 1, counter);
  }
  if (kind === "clamp") {
    return ["value", "min", "max"].every((field) =>
      validateExpression(expression[field], knownInputs, errors, `${pathLabel}.${field}`, depth + 1, counter),
    );
  }
  if (kind === "conditional") {
    if (!["lt", "lte", "gt", "gte", "eq"].includes(String(expression.comparison))) {
      errors.push(`${pathLabel}: unsupported comparison`);
    }
    return ["left", "right", "whenTrue", "whenFalse"].every((field) =>
      validateExpression(expression[field], knownInputs, errors, `${pathLabel}.${field}`, depth + 1, counter),
    );
  }
  errors.push(`${pathLabel}: unsupported expression kind ${String(kind ?? "(missing)")}`);
  return false;
}

function validateControl(value: unknown, errors: string[], index: number): value is GeneratedVisualControl {
  if (!isRecord(value)) {
    errors.push(`controls[${index}] must be an object`);
    return false;
  }
  const id = typeof value.id === "string" ? value.id : "";
  const label = typeof value.label === "string" ? value.label.trim() : "";
  const type = typeof value.type === "string" ? value.type : "";
  if (!ID_PATTERN.test(id)) errors.push(`controls[${index}].id is invalid`);
  if (!label) errors.push(`controls[${index}] needs an accessible label`);
  if (!["slider", "number", "select", "toggle", "button"].includes(type)) {
    errors.push(`controls[${index}].type is invalid`);
  }
  if ((type === "slider" || type === "number") && asFiniteNumber(value.defaultValue) === undefined) {
    errors.push(`controls[${index}] needs a finite numeric default`);
  }
  if (type === "slider" || type === "number") {
    const min = asFiniteNumber(value.min);
    const max = asFiniteNumber(value.max);
    const step = asFiniteNumber(value.step);
    if (min === undefined || max === undefined || min >= max) errors.push(`controls[${index}] needs min < max`);
    if (step === undefined || step <= 0) errors.push(`controls[${index}] needs a positive step`);
  }
  if (type === "select") {
    const options = Array.isArray(value.options)
      ? value.options.filter((option): option is string => typeof option === "string" && option.trim().length > 0)
      : [];
    if (options.length < 2) errors.push(`controls[${index}] select needs at least two options`);
    if (new Set(options).size !== options.length) errors.push(`controls[${index}] select options must be unique`);
    if (typeof value.defaultValue !== "string" || !options.includes(value.defaultValue)) {
      errors.push(`controls[${index}] select defaultValue must match one declared option`);
    }
  }
  return true;
}

function expressionFieldsFromScene(scene: Record<string, unknown>): Array<[string, unknown]> {
  const fields: Array<[string, unknown]> = [];
  if (scene.kind === "plot" && Array.isArray(scene.series)) {
    scene.series.forEach((series, index) => {
      if (isRecord(series)) fields.push([`series[${index}].expression`, series.expression]);
    });
    if (Array.isArray(scene.markers)) {
      scene.markers.forEach((marker, index) => {
        if (isRecord(marker)) fields.push([`markers[${index}].x`, marker.x], [`markers[${index}].y`, marker.y]);
      });
    }
  }
  if (scene.kind === "diagram") {
    if (Array.isArray(scene.nodes)) {
      scene.nodes.forEach((node, index) => {
        if (isRecord(node) && node.value) fields.push([`nodes[${index}].value`, node.value]);
      });
    }
    if (Array.isArray(scene.edges)) {
      scene.edges.forEach((edge, index) => {
        if (isRecord(edge) && edge.strength) fields.push([`edges[${index}].strength`, edge.strength]);
      });
    }
  }
  if (scene.kind === "table" && Array.isArray(scene.rows)) {
    scene.rows.forEach((row, rowIndex) => {
      if (!isRecord(row) || !Array.isArray(row.values)) return;
      row.values.forEach((cell, cellIndex) => {
        if (isRecord(cell)) fields.push([`rows[${rowIndex}].values[${cellIndex}]`, cell]);
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
  return fields;
}

export function validateGeneratedVisualizationDefinition(
  value: unknown,
  opportunity?: VisualizationOpportunity,
): { definition: GeneratedVisualizationDefinition | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(value)) return { definition: null, errors: ["definition must be an object"], warnings };
  if (value.schemaVersion !== 1) errors.push("definition.schemaVersion must be 1");
  if (value.sdkVersion !== VISUAL_SDK_VERSION) {
    errors.push(`definition.sdkVersion must be ${VISUAL_SDK_VERSION}`);
  }
  for (const field of ["title", "description", "accessibilityDescription"] as const) {
    if (typeof value[field] !== "string" || !value[field].trim()) errors.push(`${field} is required`);
  }
  if (typeof value.accessibilityDescription === "string" && value.accessibilityDescription.length < 30) {
    errors.push("accessibilityDescription must explain the interaction and output");
  }
  if (EXTERNAL_URL_RE.test(JSON.stringify(value))) errors.push("definition contains an external URL");

  const controls = Array.isArray(value.controls) ? value.controls : [];
  if (controls.length > MAX_CONTROLS) errors.push(`definition has more than ${MAX_CONTROLS} controls`);
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
    if (!ID_PATTERN.test(id) || outputIds.has(id)) errors.push(`outputs[${index}].id is invalid or duplicate`);
    outputIds.add(id);
    if (typeof output.label !== "string" || !output.label.trim()) errors.push(`outputs[${index}] needs a label`);
    if (
      !["value", "chart", "diagram", "animation", "timeline", "table", "annotation"].includes(
        String(output.representation),
      )
    ) {
      errors.push(`outputs[${index}].representation is invalid`);
    }
    if (output.expression) {
      validateExpression(output.expression, controlIds, errors, `outputs[${index}].expression`);
    }
  });

  const scenes = Array.isArray(value.scenes) ? value.scenes : [];
  if (scenes.length === 0 || scenes.length > MAX_SCENES) {
    errors.push(`definition needs 1-${MAX_SCENES} scene nodes`);
  }
  const sceneKinds = new Set([
    "plot",
    "diagram",
    "timeline",
    "value",
    "table",
    "annotation",
    "formula",
    "animated_marker",
    "status",
  ]);
  scenes.forEach((scene, index) => {
    if (!isRecord(scene) || !sceneKinds.has(String(scene.kind))) {
      errors.push(`scenes[${index}] has an unsupported kind`);
      return;
    }
    if (scene.kind === "plot") {
      const min = asFiniteNumber(scene.xMin);
      const max = asFiniteNumber(scene.xMax);
      const samples = asFiniteNumber(scene.samples);
      if (min === undefined || max === undefined || min >= max) errors.push(`scenes[${index}] plot needs xMin < xMax`);
      if (samples === undefined || samples < 8 || samples > 240) errors.push(`scenes[${index}] plot samples must be 8-240`);
      if (!Array.isArray(scene.series) || scene.series.length === 0 || scene.series.length > 8) {
        errors.push(`scenes[${index}] plot needs 1-8 series`);
      }
      if (scene.markers !== undefined && (!Array.isArray(scene.markers) || scene.markers.length > 8)) {
        errors.push(`scenes[${index}] plot supports at most 8 markers`);
      }
    }
    if (scene.kind === "diagram") {
      if (!Array.isArray(scene.nodes) || scene.nodes.length === 0 || scene.nodes.length > 40) {
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
          if (x === undefined || x < 40 || x > 600 || y === undefined || y < 40 || y > 320) {
            errors.push(`scenes[${index}].nodes[${nodeIndex}] must stay inside x=40-600 and y=40-320`);
          }
          if (typeof node.label !== "string" || !node.label.trim() || node.label.length > 48) {
            errors.push(`scenes[${index}].nodes[${nodeIndex}] needs a concise label of at most 48 characters`);
          }
        });
      }
    }
    if (scene.kind === "timeline") {
      if (!Array.isArray(scene.steps) || scene.steps.length < 2 || scene.steps.length > 30) {
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
      if (asFiniteNumber(scene.threshold) === undefined) errors.push(`scenes[${index}] status needs a finite threshold`);
      for (const field of ["title", "belowLabel", "equalLabel", "aboveLabel"]) {
        if (typeof scene[field] !== "string" || !String(scene[field]).trim()) {
          errors.push(`scenes[${index}] status needs ${field}`);
        }
      }
    }
    for (const [field, expression] of expressionFieldsFromScene(scene)) {
      validateExpression(expression, controlIds, errors, `scenes[${index}].${field}`);
    }
  });

  if (isRecord(value.animation)) {
    const duration = asFiniteNumber(value.animation.durationMs);
    if (duration === undefined || duration < 250 || duration > 120_000) {
      errors.push("animation.durationMs must be 250-120000");
    }
  }

  if (opportunity) {
    for (const requiredOutput of opportunity.requiredOutputs) {
      if (!outputs.some((output) => isRecord(output) && output.id === requiredOutput.id)) {
        errors.push(`opportunity requires output ${requiredOutput.id}, but the module does not declare it`);
      }
    }
    const controlsById = new Map(
      controls
        .filter(isRecord)
        .map((control) => [String(control.id ?? ""), control]),
    );
    for (const requiredInput of opportunity.requiredInputs) {
      const control = controlsById.get(requiredInput.id);
      if (!control) {
        errors.push(`opportunity requires control ${requiredInput.id}, but the module does not declare it`);
        continue;
      }
      if (control.type !== requiredInput.type) {
        errors.push(
          `opportunity control ${requiredInput.id} must use type ${requiredInput.type}, not ${String(control.type ?? "(missing)")}`,
        );
      }
      if (requiredInput.type === "select" && control.type === "select") {
        if (Array.isArray(requiredInput.options)) {
          const actualOptions = Array.isArray(control.options)
            ? control.options.filter((option): option is string => typeof option === "string")
            : [];
          if (
            actualOptions.length !== requiredInput.options.length
            || actualOptions.some((option, index) => option !== requiredInput.options?.[index])
          ) {
            errors.push(
              `opportunity select control ${requiredInput.id} must preserve its declared option order`,
            );
          }
        }
        if (
          requiredInput.defaultValue !== undefined
          && control.defaultValue !== requiredInput.defaultValue
        ) {
          errors.push(
            `opportunity select control ${requiredInput.id} must use defaultValue ${JSON.stringify(requiredInput.defaultValue)}`,
          );
        }
      }
    }
  }
  return {
    definition: errors.length === 0 ? (value as unknown as GeneratedVisualizationDefinition) : null,
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
    ? sha256(JSON.stringify({
        requiredInputs: opportunity.requiredInputs,
        requiredOutputs: opportunity.requiredOutputs,
      }))
    : "unscoped";
  const cacheKey = [
    VISUAL_SDK_VERSION,
    sourceHash,
    opportunity?.similarityFingerprint ?? opportunity?.id ?? "unscoped",
    opportunityContractHash,
  ].join(":");
  const cached = GENERATED_COMPILATION_CACHE.get(cacheKey);
  if (cached) return { ...structuredClone(cached), cacheHit: true };
  const ast = staticAstValidation(sourceCode);
  const definitionValidation = validateGeneratedVisualizationDefinition(ast.definition, opportunity);
  const errors = [...ast.errors, ...definitionValidation.errors];
  const definition = errors.length === 0 ? definitionValidation.definition : null;
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
      if (expression.op === "divide") return right === 0 ? Number.NaN : left / right;
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
      return evaluateVisualExpression(matches ? expression.whenTrue : expression.whenFalse, state);
    }
  }
}

function selectOptionIndex(control: GeneratedVisualControl): number {
  if (control.type !== "select" || !Array.isArray(control.options)) return 0;
  const index = control.options.indexOf(String(control.defaultValue));
  return index >= 0 ? index : 0;
}

function numericDefaults(definition: GeneratedVisualizationDefinition): Record<string, number> {
  const state: Record<string, number> = {};
  for (const control of definition.controls) {
    if (typeof control.defaultValue === "number") state[control.id] = control.defaultValue;
    else if (typeof control.defaultValue === "boolean") state[control.id] = control.defaultValue ? 1 : 0;
    else if (control.type === "select") state[control.id] = selectOptionIndex(control);
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
    return Array.from({ length: optionCount }, (_, index) => index)
      .filter((index) => index !== current);
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
    return [...new Set(candidates.filter(
      (candidate): candidate is number =>
        typeof candidate === "number"
        && Number.isFinite(candidate)
        && Math.abs(candidate - current) > 1e-12
        && (control.min === undefined || candidate >= control.min)
        && (control.max === undefined || candidate <= control.max),
    ))];
  }
  return [];
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
    const sceneStates = scene.kind === "plot"
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
    if (output.expression) values[output.id] = evaluateVisualExpression(output.expression, state);
  }
  return values;
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
    passed: input.definition.controls.every((control) => control.label.trim().length > 0),
  });
  staticTests.push({
    name: "required source anchors exist",
    passed:
      !input.availableSourceAnchorIds ||
      input.opportunity.sourceAnchorIds.every((id) => input.availableSourceAnchorIds!.has(id)),
  });
  runtimeTests.push({
    name: "default outputs are finite",
    passed: Object.values(values).every(Number.isFinite),
    detail: JSON.stringify(values),
  });

  const controlsById = new Map(input.definition.controls.map((control) => [control.id, control]));
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
    const alternates = alternateControlStates(control, defaults[control.id] ?? 0);
    const baselineSamples = numericExpressionSamples(input.definition, defaults);
    const effectiveAlternate = alternates.find((alternate) => {
      const changedSamples = numericExpressionSamples(
        input.definition,
        { ...defaults, [control.id]: alternate },
      );
      return baselineSamples.some(
        (value, index) =>
          Number.isFinite(value)
          && Number.isFinite(changedSamples[index])
          && Math.abs(changedSamples[index] - value) > 1e-9,
      );
    });
    const differs = effectiveAlternate !== undefined;
    semanticTests.push({
      name: `${control.label} changes a numeric output or scene expression`,
      passed: differs,
      detail: JSON.stringify({
        defaultState: defaults[control.id],
        alternateState: effectiveAlternate ?? alternates[0],
        testedAlternateStates: alternates,
        numericExpressionCount: baselineSamples.length,
      }),
    });
  }

  for (const testCase of input.testCases.slice(0, 20)) {
    const state = { ...defaults };
    for (const [id, value] of Object.entries(testCase.inputs)) {
      if (typeof value === "number" && Number.isFinite(value)) state[id] = value;
      else if (typeof value === "boolean") state[id] = value ? 1 : 0;
    }
    const actual = outputValues(input.definition, state);
    const tolerance = Number.isFinite(testCase.tolerance) ? Math.max(0, testCase.tolerance!) : 1e-6;
    const mismatches: string[] = [];
    for (const [id, expected] of Object.entries(testCase.expected)) {
      if (typeof expected !== "number" || !Number.isFinite(expected)) continue;
      if (!Number.isFinite(actual[id]) || Math.abs(actual[id] - expected) > tolerance) {
        mismatches.push(`${id}: expected ${expected}, got ${String(actual[id])}`);
      }
    }
    semanticTests.push({
      name: `candidate test: ${testCase.name}`,
      passed: mismatches.length === 0,
      detail: mismatches.join("; ") || JSON.stringify(actual),
    });
  }

  for (const scene of input.definition.scenes) {
    if (scene.kind !== "plot") continue;
    let finite = true;
    for (let index = 0; index < scene.samples; index += 1) {
      const x = scene.xMin + ((scene.xMax - scene.xMin) * index) / Math.max(1, scene.samples - 1);
      for (const series of scene.series) {
        const value = evaluateVisualExpression(series.expression, { ...defaults, x });
        if (!Number.isFinite(value)) finite = false;
      }
    }
    runtimeTests.push({ name: `${scene.title} plot remains finite`, passed: finite });
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

function browserExecutable(env: NodeJS.ProcessEnv = process.env): string | null {
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
    path.resolve(cwd, "../quartz/quartz/components/scripts/generatedVisualSandbox.inline.js"),
    path.resolve(cwd, "quartz/quartz/components/scripts/generatedVisualSandbox.inline.js"),
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
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
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
}): { tests: GeneratedVisualTestsRecord["runtimeTests"]; browser?: GeneratedVisualTestsRecord["browser"] } {
  const executable = browserExecutable();
  if (!executable) {
    return {
      tests: [{ name: "browser mount", passed: false, detail: "No Chromium/Edge executable configured" }],
    };
  }
  let runtime = "";
  try {
    runtime = fs.readFileSync(sandboxRuntimePath(), "utf-8");
  } catch {
    return {
      tests: [{ name: "browser mount", passed: false, detail: "Generated visual sandbox runtime is missing" }],
      browser: { executable, viewports: [], screenshotCreated: false },
    };
  }
  fs.mkdirSync(input.outputDir, { recursive: true });
  const screenshotPath = path.join(input.outputDir, "preview.png");
  const timeout = input.timeoutMs ?? 20_000;
  const scenarios = [
    { name: "375x667 light", viewport: "375x667", theme: "light" as const, flags: [] },
    { name: "1280x800 dark", viewport: "1280x800", theme: "dark" as const, flags: [] },
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
  for (const scenario of scenarios) {
    const [width, height] = scenario.viewport.split("x");
    const scenarioSlug = scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const htmlPath = path.join(input.outputDir, `preview-${scenarioSlug}.html`);
    htmlPaths.push(htmlPath);
    fs.writeFileSync(htmlPath, previewHtml(input.definition, runtime, scenario.theme), "utf-8");
    const url = pathToFileURL(htmlPath).href;
    const result = spawnSync(
      executable,
      [
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
      ],
      { encoding: "utf-8", timeout, windowsHide: true },
    );
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
          : output.match(/<body[^>]*>/i)?.[0] ?? output.slice(-500)),
    });
  }
  const screenshotHtmlPath = path.join(input.outputDir, "preview-screenshot.html");
  htmlPaths.push(screenshotHtmlPath);
  fs.writeFileSync(screenshotHtmlPath, previewHtml(input.definition, runtime, "light"), "utf-8");
  const screenshotUrl = pathToFileURL(screenshotHtmlPath).href;
  const captureScreenshot = () =>
    spawnSync(
      executable,
      [
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
      ],
      { encoding: "utf-8", timeout, windowsHide: true },
    );
  let screenshot = captureScreenshot();
  let screenshotCreated = screenshot.status === 0 && fs.existsSync(screenshotPath);
  // Headless Edge can intermittently fail to create a screenshot while other
  // browser checks are finishing. Retry only the capture once; lesson/model
  // generation is not repeated for this disposable preview artifact.
  if (!screenshotCreated) {
    fs.rmSync(screenshotPath, { force: true });
    screenshot = captureScreenshot();
    screenshotCreated = screenshot.status === 0 && fs.existsSync(screenshotPath);
  }
  tests.push({
    name: "preview screenshot",
    passed: screenshotCreated,
    detail: screenshotCreated
      ? "created"
      : screenshot.error?.message || String(screenshot.stderr || "Screenshot was not created").slice(-500),
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

const GENERATED_BLOCK_RE = /```breadboard-generated-visual\r?\n([\s\S]*?)\r?\n```/g;

export function parseGeneratedVisualBlock(value: string): { id: string; version: number } | null {
  const id = value.match(/^id:\s*([A-Za-z][A-Za-z0-9_-]{1,79})\s*$/m)?.[1] ?? "";
  const version = Number(value.match(/^version:\s*(\d+)\s*$/m)?.[1] ?? 0);
  return ID_PATTERN.test(id) && Number.isInteger(version) && version > 0 ? { id, version } : null;
}

export function findGeneratedVisualBlockById(
  markdown: string,
  visualId: string,
): { fullMatch: string; value: string; index: number; version: number } | null {
  const pattern = new RegExp(GENERATED_BLOCK_RE.source, GENERATED_BLOCK_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    const parsed = parseGeneratedVisualBlock(match[1]);
    if (parsed?.id === visualId) {
      return { fullMatch: match[0], value: match[1], index: match.index, version: parsed.version };
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

export function generatedVisualArtifactDir(gardenDir: string, id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error("Invalid generated visualization ID");
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
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(targetDir, file));
  }
}

export function validateGeneratedVisualizationManifest(
  value: unknown,
  expectedId?: string,
): { manifest: GeneratedVisualizationManifest | null; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { manifest: null, errors: ["manifest must be an object"] };
  const id = typeof value.id === "string" ? value.id : "";
  if (!ID_PATTERN.test(id)) errors.push("manifest id is invalid");
  if (expectedId && id !== expectedId) errors.push(`manifest id ${id || "(missing)"} does not match ${expectedId}`);
  if (value.schemaVersion !== GENERATED_VISUAL_SCHEMA_VERSION) errors.push("unsupported manifest schemaVersion");
  if (value.sdkVersion !== VISUAL_SDK_VERSION) errors.push("unsupported manifest sdkVersion");
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
    if (typeof value[field] !== "string" || !String(value[field]).trim()) errors.push(`manifest ${field} is required`);
  }
  if (typeof value.targetPage === "string" && (!value.targetPage.startsWith("learning/") || !value.targetPage.endsWith(".md"))) {
    errors.push("manifest targetPage must be a learning Markdown page");
  }
  if (id && value.artifactPath !== artifactRelativePath(id)) errors.push("manifest artifactPath does not match id");
  for (const field of ["sourceAnchorIds", "sourceVisualIds", "conceptIds"]) {
    if (!Array.isArray(value[field]) || value[field].some((item) => typeof item !== "string")) {
      errors.push(`manifest ${field} must be a string array`);
    }
  }
  const relationships = value.sourceVisualRelationships ?? [];
  if (!Array.isArray(relationships) || relationships.some((relationship) => !isRecord(relationship))) {
    errors.push("manifest sourceVisualRelationships must be an array");
  }
  if (!/^[a-f0-9]{64}$/i.test(String(value.sourceHash ?? ""))) errors.push("manifest sourceHash is invalid");
  if (!/^[a-f0-9]{64}$/i.test(String(value.compiledHash ?? ""))) errors.push("manifest compiledHash is invalid");
  if (!Number.isInteger(value.version) || Number(value.version) < 1) errors.push("manifest version is invalid");
  if (!Number.isInteger(value.generationAttempt) || Number(value.generationAttempt) < 1) errors.push("manifest generationAttempt is invalid");
  if (value.previousVersion !== undefined && (!Number.isInteger(value.previousVersion) || Number(value.previousVersion) < 1)) {
    errors.push("manifest previousVersion is invalid");
  }
  if (!Number.isFinite(Date.parse(String(value.generatedAt ?? "")))) errors.push("manifest generatedAt is invalid");
  if (!["draft", "validated", "compiled", "tested", "critic_approved", "published", "rejected"].includes(String(value.status))) {
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
  const checkedManifest = validateGeneratedVisualizationManifest(input.manifest, input.manifest.id);
  if (!checkedManifest.manifest) {
    throw new Error(`Invalid generated visualization manifest: ${checkedManifest.errors.join("; ")}`);
  }
  const dir = generatedVisualArtifactDir(input.gardenDir, input.manifest.id);
  const versionDir = path.join(dir, "versions", String(input.manifest.version));
  fs.mkdirSync(versionDir, { recursive: true });
  writeJson(path.join(versionDir, "manifest.json"), input.manifest);
  fs.writeFileSync(path.join(versionDir, "source.tsx"), input.sourceCode, "utf-8");
  fs.writeFileSync(path.join(versionDir, "compiled.js"), input.compiledJavaScript, "utf-8");
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

function updateGeneratedVisualIndex(gardenDir: string, manifest: GeneratedVisualizationManifest): void {
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
    const prefix = "globalThis.__BREADBOARD_GENERATED_VISUAL__ = Object.freeze(";
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
        pedagogicalClaims: { type: "array", items: { type: "string" }, maxItems: 20 },
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
                    value: { anyOf: [{ type: "number" }, { type: "string" }, { type: "boolean" }] },
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
                    value: { anyOf: [{ type: "number" }, { type: "string" }, { type: "boolean" }] },
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
  signal?: AbortSignal;
}): Promise<GeneratedVisualizationCandidate> {
  const validModuleTemplate = `import { defineVisualization } from "@breadboard/visual-sdk";
export default defineVisualization({
  schemaVersion: 1,
  sdkVersion: "1.0.0",
  title: "Parameter relationship",
  description: "Move the parameter to inspect the source-backed relationship.",
  accessibilityDescription: "A labelled slider changes a finite value and a plotted curve. Reset restores the documented default.",
  controls: [{ id: "gain", label: "Gain", type: "slider", min: 0, max: 2, step: 0.1, defaultValue: 1 }],
  outputs: [{ id: "result", label: "Result", representation: "value", expression: { kind: "binary", op: "multiply", left: { kind: "input", id: "gain" }, right: { kind: "constant", value: 2 } } }],
  scenes: [
    { kind: "value", outputId: "result", emphasis: "strong" },
    { kind: "plot", title: "Response", xLabel: "Input", yLabel: "Output", xMin: 0, xMax: 10, samples: 80, series: [{ id: "response", label: "Response", expression: { kind: "binary", op: "multiply", left: { kind: "input", id: "gain" }, right: { kind: "input", id: "x" } } }] },
    { kind: "diagram", title: "Causal path", nodes: [{ id: "input", label: "Input", x: 100, y: 90 }, { id: "output", label: "Output", x: 500, y: 90, value: { kind: "input", id: "gain" } }], edges: [{ from: "input", to: "output", label: "changes", directed: true }] },
    { kind: "formula", title: "Relationship", text: "result = 2 × gain" }
  ]
});`;
  const system =
    `Create one declarative Breadboard generated visualization using SDK ${VISUAL_SDK_VERSION}. ` +
    `Return the strict structured object requested by the response schema. sourceCode must contain exactly ` +
    `import { defineVisualization } from "${SDK_IMPORT}"; followed by export default defineVisualization({...}). ` +
    "The argument must be one JSON-compatible object literal: no functions, variables, JSX, spreads, computed properties, callbacks, loops, classes, timers, browser globals, HTML, URLs, or package imports. " +
    "Use schemaVersion 1 and sdkVersion 1.0.0. The definition needs title, description, accessibilityDescription, controls, outputs, and scenes. " +
    "Every expression uses the field kind (never type); binary and unary expressions use op (never operator), and a unary expression stores its child in argument (never value). " +
    "Every output uses representation (never type or value). Its optional expression is the derived value. " +
    "A plot uses xMin, xMax, samples, xLabel, yLabel and series[].expression; it never uses axes or explicit point arrays. " +
    "A diagram node requires id, label, x, and y; node.value is either omitted or a valid expression. " +
    "A value scene contains kind and outputId. A formula/annotation scene contains kind, title, and text. " +
    "Expression kinds are constant, input, binary(add/subtract/multiply/divide/power/min/max), unary(negate/abs/sqrt/sin/cos/tan/exp/log), clamp, or conditional. A conditional is exactly {kind, comparison, left, right, whenTrue, whenFalse}; comparison is one of lt/lte/gt/gte/eq. Never use condition/then/else. " +
    "Scene kinds are plot, diagram, timeline, value, table, annotation, formula, animated_marker, and status. Use only these exact field names. " +
    "A status scene is exactly {kind:\"status\",title,value,threshold,belowLabel,equalLabel,aboveLabel,description?}; use it for a current textual state instead of numeric status codes. " +
    "A plot may include markers:[{id,label,x,y,color?}] with expression-valued x/y; use a marker for the selected point and never fake a point as a sparse line series. " +
    "Diagram node coordinates must remain within x=40-600 and y=40-320 and labels must be concise. " +
    "Each testCases item represents inputs and expected as arrays of {id,value} pairs and includes tolerance (number or null). " +
    "Use the exact required input IDs, input types, and output IDs from the opportunity. Use only source-backed relationships. Label illustrative or normalized values clearly. Every required control must materially change a numeric output or scene expression. " +
    "A select control is exposed to expressions as the stable zero-based index of its option in the declared options array (0 for the first option, 1 for the second, and so on), while the interface displays the option label; use conditional expressions against those numeric indices. " +
    "Keep sourceCode below 8,000 bytes and use at most five scenes; prefer the smallest expression tree that teaches the objective. testCases should cover only simple derived outputs with numeric expectations you can compute exactly (an empty testCases array is allowed because Breadboard adds deterministic tests). " +
    "sourceCode must end immediately after the final ASCII semicolon; do not append Markdown fences, commentary, or non-ASCII punctuation. " +
    `This is a complete syntactically valid module template; follow its schema exactly:\n${validModuleTemplate}`;
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
               sourceContext: boundedGeneratedVisualEvidence(input.sourceContext, 10_000),
               sourceFigureSummaries: boundedGeneratedVisualEvidence(input.sourceFigureSummaries?.slice(0, 10), 8_000),
               formulaDefinitions: boundedGeneratedVisualEvidence(input.formulaDefinitions?.slice(0, 12), 6_000),
              sdkDocumentation: {
                version: VISUAL_SDK_VERSION,
                controlTypes: ["slider", "number", "select", "toggle", "button"],
                outputTypes: ["value", "chart", "diagram", "animation", "timeline", "table", "annotation"],
                maxControls: MAX_CONTROLS,
                maxScenes: MAX_SCENES,
              },
              repairContext: input.errors?.length
                 ? {
                     previousSourceCode: input.previousSourceCode?.slice(0, 10_000),
                     exactErrors: input.errors.slice(0, 20).map((error) => error.slice(0, 1_000)),
                   }
                : undefined,
            }),
          },
        ],
        max_completion_tokens: Math.max(
          1_000,
          Math.min(12_000, Number(process.env.LEARN_GENERATED_VISUAL_MAX_OUTPUT_TOKENS ?? 6_000) || 6_000),
        ),
        response_format: { type: "json_schema", json_schema: generatedCandidateSchema() },
      },
      {
        taskType: "visualization_generation",
        gardenId: input.opportunity.gardenId,
        pageId: input.opportunity.targetPage,
        sourceContext: input.sourceContext,
        councilModeOverride: "direct_council",
      },
    ),
    { signal: input.signal },
  );
  const content = response.choices[0]?.message?.content ?? "";
  const tokenUsage = generatedVisualTokenUsage(response.usage);
  const parsed = JSON.parse(content);
  if (!isRecord(parsed) || typeof parsed.sourceCode !== "string") {
    throw new Error("ChatMock did not return a structured generated visualization candidate");
  }
  const testCases = Array.isArray(parsed.testCases)
    ? parsed.testCases.flatMap((item) => {
        if (!isRecord(item) || !Array.isArray(item.inputs) || !Array.isArray(item.expected)) return [];
        const record = (entries: unknown[]) => Object.fromEntries(
          entries.flatMap((entry) =>
            isRecord(entry) && typeof entry.id === "string" ? [[entry.id, entry.value]] : []),
        );
        return [{
          name: typeof item.name === "string" ? item.name : "generated test",
          inputs: record(item.inputs),
          expected: record(item.expected),
          ...(typeof item.tolerance === "number" ? { tolerance: item.tolerance } : {}),
        }];
      })
    : [];
  return {
    ...(parsed as unknown as GeneratedVisualizationCandidate),
    testCases,
    ...(tokenUsage ? { tokenUsage } : {}),
  };
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
  ["avoidsDuplication"],
  ["complexityDiscipline", "avoidsUnnecessaryComplexity", "complexityRestraint"],
  ["accessibility"],
];

/** The spelling of each dimension the critic is asked for, so the prompt, the
 * response schema, and the normalizer cannot drift apart. */
const CRITIC_RUBRIC_KEYS: readonly string[] = DETAILED_CRITIC_SCORE_GROUPS.map((keys) => keys[0]);

/** Names every rubric dimension the critic left unscored. */
function unscoredDetailedCriticDimensions(scores: Record<string, unknown>): string[] {
  return DETAILED_CRITIC_SCORE_GROUPS
    .filter((keys) => !keys.some((key) => asFiniteNumber(scores[key]) !== undefined))
    .map((keys) => keys[0]);
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
  if (!isRecord(parsed) || !isRecord(parsed.scores)) return reject("the reply carries no scores object");

  const visualScores = parsed.scores;
  // `accessibility` is scored by the legacy rubric too, so it cannot identify the shape.
  const detailedScoreKeys = DETAILED_CRITIC_SCORE_GROUPS.flat().filter((key) => key !== "accessibility");
  if (!detailedScoreKeys.some((key) => asFiniteNumber(visualScores[key]) !== undefined)) {
    return reject("the reply carries no recognized rubric scores");
  }
  if (diagnostics) diagnostics.detailed = true;
  if (
    expectedOpportunityId &&
    typeof parsed.opportunityId === "string" &&
    parsed.opportunityId !== expectedOpportunityId
  ) {
    return reject(`the reply scored a different opportunity (${parsed.opportunityId})`);
  }

  const normalizedDecision = typeof parsed.decision === "string"
    ? parsed.decision.trim().toLowerCase().replace(/[\s_-]+/g, "")
    : "";
  const decisionApproved = ["approve", "approved", "accept", "accepted", "pass", "passed"].includes(normalizedDecision)
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
    return reject(`"approved" (${parsed.approved}) contradicts "decision" (${parsed.decision})`);
  }
  const providerApproved = typeof parsed.approved === "boolean" ? parsed.approved : decisionApproved;
  if (providerApproved === undefined) {
    return reject('the reply carries no boolean "approved" and no recognized "decision"');
  }

  const optionalScore = (key: string): number | undefined => {
    const value = asFiniteNumber(visualScores[key]);
    return value === undefined ? undefined : Math.max(0, Math.min(1, value));
  };
  const topLevelOverall = asFiniteNumber(parsed.overallScore ?? parsed.overall);
  const overall = optionalScore("overall")
    ?? (topLevelOverall === undefined ? 0 : Math.max(0, Math.min(1, topLevelOverall)));
  const firstReported = (keys: string[], fallback = overall) => {
    for (const key of keys) {
      const value = optionalScore(key);
      if (value !== undefined) return value;
    }
    return fallback;
  };
  const minimumReported = (keys: string[], fallback = overall) => {
    const values = keys.map(optionalScore).filter((value): value is number => value !== undefined);
    return values.length ? Math.min(...values) : fallback;
  };
  const controlMeaningfulness = firstReported(["controlMeaningfulness", "meaningfulControls"]);
  const defaultStateUsefulness = firstReported(["defaultStateUsefulness", "usefulDefaultState"]);
  const variableIntroduction = optionalScore("variableIntroduction");
  const sourceFidelity = firstReported([
    "sourceClaimsAndUnits",
    "sourceClaimsAndUnitsPreserved",
    "sourceClaimAndUnitPreservation",
    "sourceClaimPreservation",
  ]);
  if (providerApproved) {
    // An approval is only trustworthy when every dimension was actually scored.
    const unscored = unscoredDetailedCriticDimensions(visualScores);
    if (unscored.length) {
      return reject(`the reply approved the visual without scoring ${unscored.join(", ")}`);
    }
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
    if (normalized && !requestedChanges.includes(normalized) && requestedChanges.length < 12) {
      requestedChanges.push(normalized);
    }
  };
  for (const key of ["requestedChanges", "requiredChanges", "recommendations", "issues"] as const) {
    if (Array.isArray(parsed[key])) parsed[key].forEach(addChange);
  }
  if ((optionalScore("interactionImprovesUnderstanding") ?? overall) < 0.75) {
    addChange("Make the interaction teach the stated learning objective more directly.");
  }
  if ((optionalScore("subsectionFit") ?? overall) < 0.75) {
    addChange("Align the visual and its controls with this subsection instead of adjacent material.");
  }
  if (controlMeaningfulness < 0.65) {
    addChange("Replace generic controls with variables that directly change the taught relationship, and explain each control's effect.");
  }
  if (defaultStateUsefulness < 0.65) {
    addChange("Choose a default state that immediately demonstrates the intended relationship.");
  }
  if (variableIntroduction !== undefined && variableIntroduction < 0.65) {
    addChange("Introduce and label every variable and unit before the learner manipulates it.");
  }
  if (sourceFidelity < 0.75) {
    addChange("Ground every relationship, claim, and unit in the supplied source evidence.");
  }
  if ((optionalScore("avoidsDuplication") ?? 1) < 0.75) {
    addChange("Remove duplicated explanation or interaction and keep only the distinct learning contribution.");
  }
  if (firstReported(["complexityDiscipline", "avoidsUnnecessaryComplexity", "complexityRestraint"], 1) < 0.65) {
    addChange("Reduce unnecessary complexity while preserving the interaction required by the learning objective.");
  }
  if (scores.accessibility < 0.65) {
    addChange("Add a complete non-visual explanation and ensure every control, output, diagram, and state is keyboard-readable and explicitly labelled.");
  }

  const reason = [parsed.reason, parsed.rationale, parsed.summary]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?.trim()
    ?? `Visualization critic overall score ${overall.toFixed(2)}.`;
  if (!providerApproved && requestedChanges.length === 0) {
    addChange("Revise the visual to address the critic's rationale before requesting another review.");
  }
  const providerScores = Object.fromEntries([
    ...Object.entries(visualScores),
    ["overallScore", parsed.overallScore],
  ].flatMap(([key, value]) => {
    const numeric = asFiniteNumber(value);
    return numeric === undefined ? [] : [[key, Math.max(0, Math.min(1, numeric))]];
  }));
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
  signal?: AbortSignal;
}): Promise<GeneratedVisualCriticRecord> {
  const evidence = {
    opportunity: input.opportunity,
    explanation: input.candidate.explanation,
    pedagogicalClaims: input.candidate.pedagogicalClaims,
    accessibilityDescription: input.candidate.accessibilityDescription,
    definition: input.definition,
    sourceContext: JSON.stringify(input.sourceContext ?? {}).slice(0, 8_000),
    sourceFigureSummaries: boundedGeneratedVisualEvidence(input.sourceFigureSummaries?.slice(0, 6), 6_000),
    formulaDefinitions: boundedGeneratedVisualEvidence(input.formulaDefinitions?.slice(0, 8), 5_000),
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
            "derived values and textual status use aria-live",
            "light/dark and reduced-motion CSS",
            "mobile and desktop overflow checks",
          ],
        }
      : undefined,
  };
  const previewData = input.previewPath && fs.existsSync(input.previewPath)
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
              "Approve only if interaction improves understanding, belongs in this subsection, uses meaningful controls, has a useful default state, introduces every variable, preserves source claims and units, avoids duplication and unnecessary complexity, and is accessible.",
          },
          {
            role: "user",
            content: previewData
              ? [
                  { type: "text", text: JSON.stringify(evidence) },
                  { type: "image_url", image_url: { url: previewData, detail: "low" } },
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
                requestedChanges: { type: "array", items: { type: "string" }, maxItems: 12 },
                scores: {
                  type: "object",
                  additionalProperties: false,
                  required: [...CRITIC_RUBRIC_KEYS],
                  properties: Object.fromEntries(
                    CRITIC_RUBRIC_KEYS.map((key) => [key, { type: "number" }]),
                  ),
                },
              },
            },
          },
        },
        max_completion_tokens: Math.max(
          500,
          Math.min(4_000, Number(process.env.LEARN_GENERATED_VISUAL_CRITIC_MAX_OUTPUT_TOKENS ?? 1_500) || 1_500),
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
    { signal: input.signal },
  );
  const content = response.choices[0]?.message?.content ?? "";
  const tokenUsage = generatedVisualTokenUsage(response.usage);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`critic returned invalid JSON: ${content.slice(0, 500) || "(empty response)"}`);
  }
  const criticDiagnostics: DetailedGeneratedVisualCriticDiagnostics = {};
  const detailedCritic = normalizeDetailedGeneratedVisualCriticRecord(
    parsed,
    tokenUsage,
    input.opportunity.id,
    criticDiagnostics,
  );
  if (detailedCritic) return detailedCritic;
  // A rubric-shaped reply that will not normalize is the detailed path's failure
  // to explain — say what is wrong so the retry can ask the critic to fix it.
  if (criticDiagnostics.detailed && criticDiagnostics.reason) {
    throw new Error(`critic returned an unusable rubric verdict: ${criticDiagnostics.reason}`);
  }
  if (isRecord(parsed) && isRecord(parsed.scores) && typeof parsed.scores.pedagogy === "number") {
    const legacy = parsed.scores;
    const score = (key: string, fallback = 0) => Math.max(0, Math.min(1, Number(legacy[key]) || fallback));
    const sourceCoverage = score("source_coverage");
    const correctness = score("correctness");
    const hallucinationRisk = score("hallucination_risk", 1);
    const scores = {
      pedagogicalValue: score("pedagogy"),
      sourceFidelity: Math.min(sourceCoverage, correctness, 1 - hallucinationRisk),
      usability: score("interaction_quality"),
      accessibility: score("accessibility"),
    };
    const requestedChanges: string[] = [];
    if (sourceCoverage < 0.75) requestedChanges.push("Tie every pedagogical claim explicitly to the supplied source evidence.");
    if (correctness < 0.75) requestedChanges.push("Correct the relationship, units, defaults, or boundary behavior.");
    if (hallucinationRisk > 0.25) requestedChanges.push("Remove or clearly label any derived or illustrative claim not stated by the source.");
    if (scores.pedagogicalValue < 0.75) requestedChanges.push("Make the interaction teach the stated learning objective more directly.");
    if (scores.usability < 0.65) requestedChanges.push("Simplify the controls and make their effect on the output clearer.");
    if (scores.accessibility < 0.65) requestedChanges.push("Improve labels, descriptions, keyboard use, or non-visual explanation.");
    return {
      approved:
        scores.pedagogicalValue >= 0.75 &&
        scores.sourceFidelity >= 0.75 &&
        scores.usability >= 0.65 &&
        scores.accessibility >= 0.65,
      checkedAt: nowIso(),
      reason: `ChatMock critic scores: pedagogy ${scores.pedagogicalValue.toFixed(2)}, source fidelity ${scores.sourceFidelity.toFixed(2)}, usability ${scores.usability.toFixed(2)}, accessibility ${scores.accessibility.toFixed(2)}.`,
      requestedChanges,
      scores,
      ...(tokenUsage ? { tokenUsage } : {}),
    };
  }
  // `reason` and `requestedChanges` are both defaulted below, so a verdict that
  // carries a decision and at least one recognized score is usable without them.
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.scores) ||
    typeof parsed.approved !== "boolean" ||
    !["pedagogicalValue", "sourceFidelity", "usability", "accessibility"].some(
      (key) => asFiniteNumber((parsed.scores as Record<string, unknown>)[key]) !== undefined,
    )
  ) {
    throw new Error(`critic returned an invalid record: ${content.slice(0, 500) || "(empty response)"}`);
  }
  const parsedScores = parsed.scores;
  const score = (key: string) => Math.max(0, Math.min(1, Number(parsedScores[key]) || 0));
  const scores = {
    pedagogicalValue: score("pedagogicalValue"),
    sourceFidelity: score("sourceFidelity"),
    usability: score("usability"),
    accessibility: score("accessibility"),
  };
  return {
    approved:
      parsed.approved === true &&
      scores.pedagogicalValue >= 0.75 &&
      scores.sourceFidelity >= 0.75 &&
      scores.usability >= 0.65 &&
      scores.accessibility >= 0.65,
    checkedAt: nowIso(),
    reason: typeof parsed.reason === "string" ? parsed.reason : "Critic supplied no reason",
    requestedChanges: Array.isArray(parsed.requestedChanges)
      ? parsed.requestedChanges.filter((item): item is string => typeof item === "string").slice(0, 12)
      : [],
    scores,
    ...(tokenUsage ? { tokenUsage } : {}),
  };
}

function nextGeneratedVisualVersion(gardenDir: string, id: string): number {
  return (loadGeneratedVisualManifest(gardenDir, id)?.version ?? 0) + 1;
}

function emit(sink: EventSink | undefined, type: string, data: Record<string, unknown>): void {
  sink?.({ type, data });
}

async function withGeneratedVisualTimeout<T>(input: {
  timeoutMs: number;
  externalSignal?: AbortSignal;
  work: (signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  if (input.externalSignal?.aborted) throw new Error("generated visualization was cancelled");
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort(input.externalSignal?.reason);
  input.externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(`generated visualization request timed out after ${input.timeoutMs}ms`)), input.timeoutMs);
  try {
    return await input.work(controller.signal);
  } finally {
    clearTimeout(timer);
    input.externalSignal?.removeEventListener("abort", abortFromExternal);
  }
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
  const dir = path.join(generatedVisualArtifactDir(gardenDir, id), "attempts", runId, `attempt-${attempt}`);
  fs.mkdirSync(dir, { recursive: true });
  if (candidate) {
    fs.writeFileSync(path.join(dir, "source.tsx"), candidate.sourceCode, "utf-8");
    writeJson(path.join(dir, "candidate.json"), candidate);
  }
  if (evidence?.validation) writeJson(path.join(dir, "validation.json"), evidence.validation);
  if (evidence?.tests) writeJson(path.join(dir, "tests.json"), evidence.tests);
  if (evidence?.critic) writeJson(path.join(dir, "critic.json"), evidence.critic);
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
    Math.min(8, Number(process.env.LEARN_GENERATED_VISUAL_CONCURRENCY ?? 2) || 2),
  );
}

async function acquireGeneratedVisualSlot(signal?: AbortSignal): Promise<() => void> {
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
    activeGeneratedVisualizations = Math.max(0, activeGeneratedVisualizations - 1);
  };
}

async function createGeneratedVisualizationWithSlot(input: CreateGeneratedVisualizationInput): Promise<GeneratedVisualResult> {
  const enabled = String(process.env.LEARN_GENERATED_VISUALS_ENABLED ?? "true").trim() !== "false";
  if (!enabled) return { manifest: null, definition: null, errors: ["generated visuals are disabled"] };
  const id = input.opportunity.id;
  const version = nextGeneratedVisualVersion(input.gardenDir, id);
  const runId = `${nowIso().replace(/[^0-9]/g, "").slice(0, 17)}-${process.pid}`;
  const maxAttempts = Math.max(
    1,
    Math.min(
      5,
      input.maxAttempts ?? (Number(process.env.LEARN_GENERATED_VISUAL_MAX_ATTEMPTS ?? 3) || 3),
    ),
  );
  const candidateProvider = input.candidateProvider ?? generateVisualizationCandidate;
  const criticProvider = input.criticProvider ?? reviewGeneratedVisualization;
  let previousSourceCode = "";
  let repairErrors: string[] = [];
  let lastFailure: GeneratedVisualResult["failureCategory"] = "generation";
  const requestTimeoutMs = Math.max(
    5_000,
    Math.min(300_000, input.timeoutMs ?? (Number(process.env.LEARN_GENERATED_VISUAL_TIMEOUT_MS ?? 90_000) || 90_000)),
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    input.checkCancelled?.();
    if (input.abortSignal?.aborted) throw new Error("generated visualization was cancelled");
    const startedAt = Date.now();
    const lifecycle: GeneratedVisualLifecycleRecord[] = [
      { status: "draft", at: nowIso(), attempt },
    ];
    emit(input.onEvent, attempt === 1 ? "visual_generation_started" : "visual_repair_started", {
      gardenId: input.opportunity.gardenId,
      learningUnitId: input.opportunity.learningUnitId,
      visualizationId: id,
      attempt,
      route: "generated_module",
      sourceAnchors: input.opportunity.sourceAnchorIds,
    });
    let candidate: GeneratedVisualizationCandidate;
    const generationStartedAt = Date.now();
    try {
      candidate = await withGeneratedVisualTimeout({
        timeoutMs: requestTimeoutMs,
        externalSignal: input.abortSignal,
        work: (signal) => candidateProvider({
          client: input.client,
          model: input.model,
          opportunity: input.opportunity,
          pageMarkdown: input.pageMarkdown,
          sourceContext: input.sourceContext,
          sourceFigureSummaries: input.sourceFigureSummaries,
          formulaDefinitions: input.formulaDefinitions,
          previousSourceCode: previousSourceCode || undefined,
          errors: repairErrors.length ? repairErrors : undefined,
          signal,
        }),
      });
    } catch (error) {
      lastFailure = "generation";
      repairErrors = [error instanceof Error ? error.message : "candidate generation failed"];
      writeRejectedAttempt(input.gardenDir, id, runId, attempt, null, "generation", repairErrors, lifecycle);
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
    const compilation = compileGeneratedVisualization(candidate.sourceCode, input.opportunity);
    if (!compilation.definition) {
      lastFailure = "validation";
      repairErrors = compilation.validation.errors;
      writeRejectedAttempt(input.gardenDir, id, runId, attempt, candidate, "validation", repairErrors, lifecycle, {
        validation: compilation.validation,
      });
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
      input.runBrowserTests ?? String(process.env.LEARN_GENERATED_VISUAL_BROWSER_TESTS ?? "true") !== "false";
    const browserStartedAt = Date.now();
    const browser = shouldRunBrowser
      ? runGeneratedVisualBrowserTests({ definition, outputDir: stagingDir })
      : {
          tests: [{ name: "browser tests explicitly disabled", passed: true, detail: "development override" }],
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
    if (input.abortSignal?.aborted) throw new Error("generated visualization was cancelled");
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
      writeRejectedAttempt(input.gardenDir, id, runId, attempt, candidate, "runtime", repairErrors, lifecycle, {
        validation: compilation.validation,
        tests: deterministicTests,
      });
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
        input.criticMaxAttempts
          ?? (Number(process.env.LEARN_GENERATED_VISUAL_CRITIC_ATTEMPTS ?? 2) || 2),
      ),
    );
    const criticStartedAt = Date.now();
    let priorCriticFailure: string | undefined;
    for (let criticAttempt = 1; criticAttempt <= criticAttempts; criticAttempt += 1) {
      try {
        critic = await withGeneratedVisualTimeout({
          timeoutMs: requestTimeoutMs,
          externalSignal: input.abortSignal,
          work: (signal) => criticProvider({
            client: input.client,
            model: String(process.env.LEARN_GENERATED_VISUAL_CRITIC_MODEL ?? input.model),
            opportunity: input.opportunity,
            candidate,
            definition,
            sourceContext: input.sourceContext,
            sourceFigureSummaries: input.sourceFigureSummaries,
            formulaDefinitions: input.formulaDefinitions,
            previewPath: browser.browser?.screenshotCreated ? path.join(stagingDir, "preview.png") : undefined,
            tests: deterministicTests,
            priorCriticFailure,
            signal,
          }),
        });
        break;
      } catch (error) {
        if (input.abortSignal?.aborted) throw error;
        input.checkCancelled?.();
        criticFailure = error instanceof Error ? error.message : "critic failed";
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
      repairErrors = [
        `Critic review could not complete after ${criticAttempts} attempt${criticAttempts === 1 ? "" : "s"}: ${criticFailure}`,
      ];
      writeRejectedAttempt(input.gardenDir, id, runId, attempt, candidate, "critic", repairErrors, lifecycle, {
        validation: compilation.validation,
        tests: deterministicTests,
      });
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
      repairErrors = [critic.reason, ...critic.requestedChanges].filter(Boolean);
      writeRejectedAttempt(input.gardenDir, id, runId, attempt, candidate, "critic", repairErrors, lifecycle, {
        validation: compilation.validation,
        tests: deterministicTests,
        critic,
      });
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
      fs.rmSync(path.join(generatedVisualArtifactDir(input.gardenDir, id), ".staging"), {
        recursive: true,
        force: true,
      });
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

  emit(input.onEvent, "visual_fallback_used", {
    gardenId: input.opportunity.gardenId,
    learningUnitId: input.opportunity.learningUnitId,
    visualizationId: id,
    failureCategory: lastFailure,
    reason: repairErrors.join("; ") || "generated visualization attempts exhausted",
    resultingStatus: "rejected",
  });
  return {
    manifest: null,
    definition: null,
    errors: repairErrors.length ? repairErrors : ["generated visualization attempts exhausted"],
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
  if (!fs.existsSync(manifestPath)) throw new Error(`Version ${input.version} does not exist`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as GeneratedVisualizationManifest;
  if (manifest.id !== input.id || manifest.version !== input.version) {
    throw new Error("Generated visualization version manifest is inconsistent");
  }
  const validation = JSON.parse(fs.readFileSync(path.join(targetDir, "validation.json"), "utf-8")) as GeneratedVisualValidationRecord;
  const tests = JSON.parse(fs.readFileSync(path.join(targetDir, "tests.json"), "utf-8")) as GeneratedVisualTestsRecord;
  const critic = JSON.parse(fs.readFileSync(path.join(targetDir, "critic.json"), "utf-8")) as GeneratedVisualCriticRecord;
  const source = fs.readFileSync(path.join(targetDir, "source.tsx"), "utf-8");
  if (
    manifest.status !== "published" ||
    sha256(source) !== manifest.sourceHash ||
    validation.valid !== true ||
    tests.passed !== true ||
    critic.approved !== true ||
    !loadGeneratedVisualDefinition(input.gardenDir, input.id, input.version)
  ) {
    throw new Error(`Version ${input.version} no longer passes generated visualization publication gates`);
  }
  copyArtifactFiles(targetDir, generatedVisualArtifactDir(input.gardenDir, input.id));
  writeJson(path.join(generatedVisualArtifactDir(input.gardenDir, input.id), "current.json"), {
    id: input.id,
    version: input.version,
    manifest: `versions/${input.version}/manifest.json`,
  });
  updateGeneratedVisualIndex(input.gardenDir, manifest);
  return manifest;
}
