import crypto from "node:crypto";
import ts from "typescript";
import type { VisualExpression } from "../visual-sdk.ts";
import { interactiveVisualizerConfig } from "./interactive-visualizer-config.ts";
import {
  INTERACTIVE_VISUALIZER_RUNTIME_VERSION,
  INTERACTIVE_VISUALIZER_SCHEMA_VERSION,
  INTERACTIVE_VISUALIZER_THREE_VERSION,
  type InteractiveVisualizerControl,
  type InteractiveVisualizerDefinition,
  type InteractiveVisualizerManifest,
  type InteractiveVisualizerPackage,
  type InteractiveVisualizerPlan,
  type InteractiveVisualizerScene,
  type InteractiveVisualizerValidation,
} from "./interactive-visualizer-types.ts";

const SDK_IMPORT = "@breadboard/interactive-visualizer-sdk";
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,79}$/;
const MAX_HTML_BYTES = 24_000;
const MAX_CSS_BYTES = 48_000;
const MAX_AST_NODES = 4_000;
const MAX_LITERAL_DEPTH = 28;
const MAX_EXPRESSION_NODES = 500;
const MAX_CONTROLS = 16;
const MAX_OUTPUTS = 20;
const MAX_SCENES = 8;
const EXTERNAL_URL_RE = /(?:https?:|wss?:|file:|ftp:|javascript:|data:text\/html)/i;
const FORBIDDEN_IDENTIFIERS = new Set([
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "eval", "Function",
  "document", "window", "navigator", "location", "localStorage", "sessionStorage",
  "indexedDB", "caches", "cookieStore", "process", "require", "global", "globalThis",
  "setTimeout", "setInterval", "requestAnimationFrame", "Worker", "SharedWorker",
  "BroadcastChannel", "MessageChannel", "WebAssembly", "Deno", "Bun",
]);
const FORBIDDEN_PROPERTIES = new Set([
  "cookie", "serviceWorker", "prototype", "__proto__", "constructor",
  "dangerouslySetInnerHTML", "innerHTML", "outerHTML", "srcdoc", "location",
  "open", "sendBeacon", "postMessage",
]);
const ALLOWED_HTML_TAGS = new Set([
  "html", "head", "body", "main", "div", "section", "header", "footer",
  "article", "h1", "h2", "h3", "p", "span", "strong", "em", "small",
]);
const VOID_HTML_TAGS = new Set(["meta"]);

export interface CompiledInteractiveVisualizerPackage {
  definition: InteractiveVisualizerDefinition | null;
  manifest: InteractiveVisualizerManifest | null;
  plan: InteractiveVisualizerPlan | null;
  html: string;
  css: string;
  validation: InteractiveVisualizerValidation;
  sourceHash: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stringArray(value: unknown, max = 24): value is string[] {
  return Array.isArray(value) &&
    value.length <= max &&
    value.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 500);
}

export function validateInteractiveVisualizerPlan(
  value: unknown,
): { plan: InteractiveVisualizerPlan | null; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { plan: null, errors: ["plan must be an object"] };
  if (value.schemaVersion !== INTERACTIVE_VISUALIZER_SCHEMA_VERSION) {
    errors.push("plan.schemaVersion must be 1");
  }
  if (!["2d", "3d", "hybrid"].includes(String(value.mode))) {
    errors.push("plan.mode must be 2d, 3d, or hybrid");
  }
  for (const field of ["title", "objective", "rationale"] as const) {
    if (typeof value[field] !== "string" || !value[field].trim() || value[field].length > 2_000) {
      errors.push(`plan.${field} is required and must be at most 2,000 characters`);
    }
  }
  if (
    value.audience !== undefined &&
    (typeof value.audience !== "string" || value.audience.length > 500)
  ) {
    errors.push("plan.audience must be at most 500 characters");
  }
  for (const field of [
    "concepts", "assumptions", "interactions", "dataRequirements",
    "assetRequirements", "accessibilityRequirements", "sourceReferences",
  ] as const) {
    if (!stringArray(value[field])) errors.push(`plan.${field} must be a bounded non-empty string array`);
  }
  if (Array.isArray(value.concepts) && value.concepts.length === 0) {
    errors.push("plan.concepts must not be empty");
  }
  if (Array.isArray(value.interactions) && value.interactions.length === 0) {
    errors.push("plan.interactions must not be empty");
  }
  if (!Array.isArray(value.controls) || value.controls.length > MAX_CONTROLS) {
    errors.push(`plan.controls must contain at most ${MAX_CONTROLS} controls`);
  } else {
    value.controls.forEach((control, index) => {
      if (!isRecord(control)) {
        errors.push(`plan.controls[${index}] must be an object`);
        return;
      }
      if (!ID_PATTERN.test(String(control.id ?? ""))) errors.push(`plan.controls[${index}].id is invalid`);
      if (typeof control.label !== "string" || !control.label.trim()) errors.push(`plan.controls[${index}].label is required`);
      if (!["range", "number", "select", "toggle", "button"].includes(String(control.type))) {
        errors.push(`plan.controls[${index}].type is invalid`);
      }
      if (typeof control.purpose !== "string" || !control.purpose.trim()) {
        errors.push(`plan.controls[${index}].purpose is required`);
      }
      for (const numeric of ["minimum", "maximum", "step"] as const) {
        if (control[numeric] !== undefined && !finite(control[numeric])) {
          errors.push(`plan.controls[${index}].${numeric} must be finite`);
        }
      }
    });
  }
  if (!Array.isArray(value.outputs) || value.outputs.length > MAX_OUTPUTS) {
    errors.push(`plan.outputs must contain at most ${MAX_OUTPUTS} outputs`);
  } else {
    value.outputs.forEach((output, index) => {
      if (
        !isRecord(output) ||
        !ID_PATTERN.test(String(output.id ?? "")) ||
        typeof output.label !== "string" ||
        !output.label.trim() ||
        typeof output.purpose !== "string" ||
        !output.purpose.trim()
      ) {
        errors.push(`plan.outputs[${index}] is invalid`);
      }
    });
  }
  if (value.animation !== undefined) {
    if (
      !isRecord(value.animation) ||
      typeof value.animation.enabled !== "boolean" ||
      typeof value.animation.canPause !== "boolean" ||
      typeof value.animation.canReset !== "boolean"
    ) {
      errors.push("plan.animation must declare enabled, canPause, and canReset");
    }
  }
  return {
    plan: errors.length === 0 ? value as unknown as InteractiveVisualizerPlan : null,
    errors,
  };
}

function validateManifest(
  value: unknown,
  plan: InteractiveVisualizerPlan | null,
): { manifest: InteractiveVisualizerManifest | null; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { manifest: null, errors: ["manifest must be an object"] };
  if (value.schemaVersion !== 1) errors.push("manifest.schemaVersion must be 1");
  if (value.artifactType !== "interactive-visualizer") {
    errors.push("manifest.artifactType must be interactive-visualizer");
  }
  for (const field of ["title", "description", "accessibilityDescription"] as const) {
    const text = value[field];
    if (typeof text !== "string" || !text.trim() || text.length > 2_000) {
      errors.push(`manifest.${field} is required and must be bounded`);
    }
  }
  if (!["2d", "3d", "hybrid"].includes(String(value.mode))) {
    errors.push("manifest.mode must be 2d, 3d, or hybrid");
  }
  if (plan && value.mode !== plan.mode) errors.push("manifest.mode must match the approved plan");
  if (value.entry !== "index.html") errors.push("manifest.entry must be index.html");
  if (!isRecord(value.runtime)) {
    errors.push("manifest.runtime is required");
  } else {
    if (value.runtime.id !== "breadboard-interactive-visualizer") {
      errors.push("manifest.runtime.id is invalid");
    }
    if (value.runtime.version !== INTERACTIVE_VISUALIZER_RUNTIME_VERSION) {
      errors.push(`manifest.runtime.version must be ${INTERACTIVE_VISUALIZER_RUNTIME_VERSION}`);
    }
    if (
      (value.mode === "3d" || value.mode === "hybrid") &&
      value.runtime.threeVersion !== INTERACTIVE_VISUALIZER_THREE_VERSION
    ) {
      errors.push(`3d and hybrid manifests must pin Three.js ${INTERACTIVE_VISUALIZER_THREE_VERSION}`);
    }
    if (value.mode === "2d" && value.runtime.threeVersion !== undefined) {
      errors.push("2d manifests must not request Three.js");
    }
  }
  if (EXTERNAL_URL_RE.test(JSON.stringify(value))) errors.push("manifest contains an external URL");
  return {
    manifest: errors.length === 0 ? value as unknown as InteractiveVisualizerManifest : null,
    errors,
  };
}

function validateHtml(source: string): { html: string; errors: string[] } {
  const errors: string[] = [];
  if (Buffer.byteLength(source, "utf8") > MAX_HTML_BYTES) {
    errors.push(`index.html exceeds ${MAX_HTML_BYTES} bytes`);
  }
  if (EXTERNAL_URL_RE.test(source)) errors.push("index.html contains an external or executable URL");
  if (/<!ENTITY|<!\[CDATA|<\?xml/i.test(source)) errors.push("XML entities and processing instructions are not allowed");
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, "");
  const stack: string[] = [];
  let foundAppRoot = false;
  let cursor = 0;
  const tagPattern = /<!doctype\s+html\s*>|<\/?([A-Za-z][A-Za-z0-9-]*)([^>]*)>/gi;
  for (const match of withoutComments.matchAll(tagPattern)) {
    const index = match.index ?? 0;
    const textBetween = withoutComments.slice(cursor, index);
    if (/[<>]/.test(textBetween)) errors.push("index.html contains malformed markup");
    cursor = index + match[0].length;
    if (/^<!doctype/i.test(match[0])) continue;
    const tag = (match[1] ?? "").toLowerCase();
    if (!ALLOWED_HTML_TAGS.has(tag) && !VOID_HTML_TAGS.has(tag)) {
      errors.push(`HTML tag <${tag || "unknown"}> is not allowed`);
      continue;
    }
    const closing = /^<\//.test(match[0]);
    if (closing) {
      const expected = stack.pop();
      if (expected !== tag) errors.push(`HTML closing tag </${tag}> is unbalanced`);
      continue;
    }
    const attributes = match[2] ?? "";
    const scrubbed = attributes.replace(
      /([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g,
      (whole, rawName: string) => {
        const name = rawName.toLowerCase();
        if (
          name !== "id" &&
          name !== "class" &&
          name !== "role" &&
          name !== "lang" &&
          !name.startsWith("aria-") &&
          !name.startsWith("data-")
        ) {
          errors.push(`HTML attribute ${name} is not allowed`);
        }
        if (/^on/i.test(name) || ["src", "href", "action", "formaction", "style", "srcdoc"].includes(name)) {
          errors.push(`HTML capability attribute ${name} is forbidden`);
        }
        if (name === "id" && /\bapp\b/.test(whole)) foundAppRoot = true;
        return "";
      },
    );
    if (scrubbed.trim() && scrubbed.trim() !== "/") errors.push(`HTML attributes on <${tag}> are malformed`);
    if (!VOID_HTML_TAGS.has(tag) && !/\/\s*>$/.test(match[0])) stack.push(tag);
  }
  if (stack.length) errors.push(`HTML tag <${stack.at(-1)}> is not closed`);
  if (!foundAppRoot || !/<(?:main|div)\b[^>]*\bid\s*=\s*(?:"app"|'app'|app)(?=\s|\/?>)/i.test(withoutComments)) {
    errors.push('index.html must contain <main id="app"> or <div id="app">');
  }
  if (/<(?:script|style|link|iframe|object|embed|form|input|button|canvas|svg)\b/i.test(withoutComments)) {
    errors.push("index.html may only define a passive shell; controls and canvases are created by the trusted runtime");
  }
  return { html: withoutComments.trim(), errors: [...new Set(errors)] };
}

function validateCss(source: string): { css: string; errors: string[] } {
  const errors: string[] = [];
  if (Buffer.byteLength(source, "utf8") > MAX_CSS_BYTES) {
    errors.push(`styles.css exceeds ${MAX_CSS_BYTES} bytes`);
  }
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (
    /@import|@charset|@namespace|url\s*\(|expression\s*\(|behavior\s*:|-moz-binding|javascript:|data:|https?:|file:/i.test(css)
  ) {
    errors.push("styles.css contains a network, executable, or external-resource capability");
  }
  if (/@(?!media\b|supports\b|keyframes\b|-webkit-keyframes\b)/i.test(css)) {
    errors.push("styles.css contains an unsupported at-rule");
  }
  let braces = 0;
  for (const character of css) {
    if (character === "{") braces += 1;
    if (character === "}") braces -= 1;
    if (braces < 0) errors.push("styles.css has unbalanced braces");
  }
  if (braces !== 0) errors.push("styles.css has unbalanced braces");
  return { css, errors: [...new Set(errors)] };
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
      if (ts.isComputedPropertyName(property.name)) {
        throw new Error("computed property names are not allowed");
      }
      const key =
        ts.isIdentifier(property.name) ||
        ts.isStringLiteral(property.name) ||
        ts.isNumericLiteral(property.name)
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

function parseDefinition(source: string): {
  value: unknown;
  imports: string[];
  astNodeCount: number;
  errors: string[];
} {
  const errors: string[] = [];
  const imports: string[] = [];
  const maxSourceBytes = interactiveVisualizerConfig().maxSourceBytes;
  if (Buffer.byteLength(source, "utf8") > maxSourceBytes) {
    return {
      value: null,
      imports,
      astNodeCount: 0,
      errors: [`main.ts exceeds ${maxSourceBytes} bytes`],
    };
  }
  const file = ts.createSourceFile("main.ts", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  for (const diagnostic of diagnostics) {
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
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      errors.push("dynamic import() is not allowed");
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (astNodeCount > MAX_AST_NODES) errors.push(`AST exceeds ${MAX_AST_NODES} nodes`);

  let exportExpression: ts.Expression | null = null;
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const moduleName = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : "";
      imports.push(moduleName);
      if (moduleName !== SDK_IMPORT) errors.push(`import ${moduleName || "(unknown)"} is not allowed`);
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings) || bindings.elements.length !== 1) {
        errors.push("the SDK import must contain only defineVisualizer");
      } else if (
        bindings.elements[0].name.text !== "defineVisualizer" ||
        bindings.elements[0].propertyName
      ) {
        errors.push("the SDK import must contain only defineVisualizer without aliases");
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
  if (imports.length !== 1 || imports[0] !== SDK_IMPORT) {
    errors.push(`main.ts must import only defineVisualizer from ${SDK_IMPORT}`);
  }
  if (!exportExpression) errors.push("main.ts requires a default defineVisualizer export");
  let value: unknown = null;
  if (exportExpression) {
    const expression = unwrapExpression(exportExpression);
    if (
      !ts.isCallExpression(expression) ||
      !ts.isIdentifier(expression.expression) ||
      expression.expression.text !== "defineVisualizer" ||
      expression.arguments.length !== 1
    ) {
      errors.push("default export must be defineVisualizer({ ...literal definition... })");
    } else {
      try {
        value = literalFromAst(expression.arguments[0]);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "main.ts literal could not be parsed");
      }
    }
  }
  return { value, imports, astNodeCount, errors: [...new Set(errors)] };
}

function validateExpression(
  value: unknown,
  knownInputs: ReadonlySet<string>,
  errors: string[],
  label: string,
  depth = 0,
  counter = { value: 0 },
): value is VisualExpression {
  counter.value += 1;
  if (counter.value > MAX_EXPRESSION_NODES) {
    errors.push(`${label} exceeds ${MAX_EXPRESSION_NODES} expression nodes`);
    return false;
  }
  if (depth > 18 || !isRecord(value)) {
    errors.push(`${label} is invalid or too deeply nested`);
    return false;
  }
  if (value.kind === "constant") {
    if (!finite(value.value)) errors.push(`${label}.value must be finite`);
    return finite(value.value);
  }
  if (value.kind === "input") {
    if (typeof value.id !== "string" || !knownInputs.has(value.id)) {
      errors.push(`${label}.id references an unknown input`);
      return false;
    }
    return true;
  }
  if (value.kind === "binary") {
    if (!["add", "subtract", "multiply", "divide", "power", "min", "max"].includes(String(value.op))) {
      errors.push(`${label}.op is invalid`);
    }
    return [
      validateExpression(value.left, knownInputs, errors, `${label}.left`, depth + 1, counter),
      validateExpression(value.right, knownInputs, errors, `${label}.right`, depth + 1, counter),
    ].every(Boolean);
  }
  if (value.kind === "unary") {
    if (!["negate", "abs", "sqrt", "sin", "cos", "tan", "exp", "log"].includes(String(value.op))) {
      errors.push(`${label}.op is invalid`);
    }
    return validateExpression(value.argument, knownInputs, errors, `${label}.argument`, depth + 1, counter);
  }
  if (value.kind === "clamp") {
    return ["value", "min", "max"].map((field) =>
      validateExpression(value[field], knownInputs, errors, `${label}.${field}`, depth + 1, counter),
    ).every(Boolean);
  }
  if (value.kind === "conditional") {
    if (!["lt", "lte", "gt", "gte", "eq"].includes(String(value.comparison))) {
      errors.push(`${label}.comparison is invalid`);
    }
    return ["left", "right", "whenTrue", "whenFalse"].map((field) =>
      validateExpression(value[field], knownInputs, errors, `${label}.${field}`, depth + 1, counter),
    ).every(Boolean);
  }
  errors.push(`${label}.kind is invalid`);
  return false;
}

/**
 * Diagram sizes are static in schema v1. Generated definitions sometimes use
 * the expression-tree spelling for a literal constant because adjacent
 * coordinates are expressions. Treat that one representation as the same
 * static number and canonicalize it before the definition reaches the runtime.
 * Dynamic size expressions remain rejected.
 */
function staticNumber(value: unknown): number | null {
  if (finite(value)) return Number(value);
  if (
    isRecord(value) &&
    value.kind === "constant" &&
    finite(value.value)
  ) {
    return Number(value.value);
  }
  return null;
}

function validateControl(
  value: unknown,
  errors: string[],
  index: number,
): value is InteractiveVisualizerControl {
  if (!isRecord(value)) {
    errors.push(`controls[${index}] must be an object`);
    return false;
  }
  const id = typeof value.id === "string" ? value.id : "";
  if (!ID_PATTERN.test(id)) errors.push(`controls[${index}].id is invalid`);
  if (typeof value.label !== "string" || !value.label.trim()) errors.push(`controls[${index}].label is required`);
  if (!["slider", "number", "select", "toggle", "button"].includes(String(value.type))) {
    errors.push(`controls[${index}].type is invalid`);
  }
  if (value.type === "slider" || value.type === "number") {
    if (![value.min, value.max, value.step, value.defaultValue].every(finite)) {
      errors.push(`controls[${index}] numeric bounds/default must be finite`);
    } else if (Number(value.min) >= Number(value.max) || Number(value.step) <= 0) {
      errors.push(`controls[${index}] numeric bounds or step are invalid`);
    }
  }
  if (value.type === "select") {
    if (!stringArray(value.options, 20) || value.options.length < 2) {
      errors.push(`controls[${index}].options must contain 2-20 values`);
    }
  }
  if (value.type === "toggle" && typeof value.defaultValue !== "boolean") {
    errors.push(`controls[${index}].defaultValue must be boolean`);
  }
  return true;
}

function validateScene(
  value: unknown,
  controls: ReadonlySet<string>,
  expressionInputs: ReadonlySet<string>,
  errors: string[],
  index: number,
): value is InteractiveVisualizerScene {
  if (!isRecord(value)) {
    errors.push(`scenes[${index}] must be an object`);
    return false;
  }
  if (typeof value.title !== "string" || !value.title.trim()) errors.push(`scenes[${index}].title is required`);
  if (value.kind === "plot2d") {
    if (![value.xMin, value.xMax, value.samples].every(finite) || Number(value.xMin) >= Number(value.xMax)) {
      errors.push(`scenes[${index}] plot bounds are invalid`);
    }
    if (!Number.isInteger(value.samples) || Number(value.samples) < 16 || Number(value.samples) > 600) {
      errors.push(`scenes[${index}].samples must be 16-600`);
    }
    if (!Array.isArray(value.series) || value.series.length === 0 || value.series.length > 8) {
      errors.push(`scenes[${index}].series must contain 1-8 series`);
    } else {
      value.series.forEach((series, seriesIndex) => {
        if (!isRecord(series) || !ID_PATTERN.test(String(series.id ?? "")) || typeof series.label !== "string") {
          errors.push(`scenes[${index}].series[${seriesIndex}] metadata is invalid`);
          return;
        }
        validateExpression(
          series.expression,
          expressionInputs,
          errors,
          `scenes[${index}].series[${seriesIndex}].expression`,
        );
      });
    }
    return true;
  }
  if (value.kind === "diagram2d") {
    if (
      !finite(value.width) ||
      !finite(value.height) ||
      value.width < 100 ||
      value.width > 2_000 ||
      value.height < 100 ||
      value.height > 2_000
    ) {
      errors.push(`scenes[${index}] diagram dimensions must be 100-2000`);
    }
    if (!Array.isArray(value.elements) || value.elements.length === 0 || value.elements.length > 240) {
      errors.push(`scenes[${index}].elements must contain 1-240 elements`);
    } else {
      const ids = new Set<string>();
      value.elements.forEach((element, elementIndex) => {
        if (
          !isRecord(element) ||
          !ID_PATTERN.test(String(element.id ?? "")) ||
          ids.has(String(element.id)) ||
          typeof element.label !== "string" ||
          !element.label.trim() ||
          !["circle", "rect", "line", "text"].includes(String(element.kind)) ||
          !/^#[0-9a-f]{6}$/i.test(String(element.color ?? ""))
        ) {
          errors.push(`scenes[${index}].elements[${elementIndex}] metadata is invalid`);
          return;
        }
        ids.add(String(element.id));
        const expressionFields = element.kind === "circle"
          ? ["cx", "cy"]
          : element.kind === "rect" || element.kind === "text"
            ? ["x", "y"]
            : ["x1", "y1", "x2", "y2"];
        for (const field of expressionFields) {
          validateExpression(
            element[field],
            expressionInputs,
            errors,
            `scenes[${index}].elements[${elementIndex}].${field}`,
          );
        }
        if (
          element.kind === "circle" &&
          (() => {
            const radius = staticNumber(element.radius);
            if (radius === null || radius <= 0 || radius > 500) return true;
            element.radius = radius;
            return false;
          })()
        ) {
          errors.push(
            `scenes[${index}].elements[${elementIndex}].radius must be a positive static number`,
          );
        }
        if (
          element.kind === "rect" &&
          (() => {
            const width = staticNumber(element.width);
            const height = staticNumber(element.height);
            if (
              width === null ||
              height === null ||
              width <= 0 ||
              height <= 0 ||
              width > 2_000 ||
              height > 2_000
            ) {
              return true;
            }
            element.width = width;
            element.height = height;
            return false;
          })()
        ) {
          errors.push(
            `scenes[${index}].elements[${elementIndex}].width and height must be positive static numbers`,
          );
        }
        if (
          element.kind === "text" &&
          (typeof element.text !== "string" || !element.text.trim() || element.text.length > 500)
        ) errors.push(`scenes[${index}].elements[${elementIndex}].text is invalid`);
      });
    }
    return true;
  }
  if (value.kind === "double-pendulum") {
    for (const field of [
      "gravityInput", "length1Input", "length2Input", "mass1Input",
      "mass2Input", "angle1Input", "angle2Input",
    ] as const) {
      if (typeof value[field] !== "string" || !controls.has(value[field])) {
        errors.push(`scenes[${index}].${field} must reference a control`);
      }
    }
    if (value.speedInput !== undefined && !controls.has(String(value.speedInput))) {
      errors.push(`scenes[${index}].speedInput must reference a control`);
    }
    if (typeof value.trail !== "boolean") errors.push(`scenes[${index}].trail must be boolean`);
    return true;
  }
  if (value.kind === "orbit3d") {
    const configured = interactiveVisualizerConfig();
    for (const field of [
      "timeScaleInput",
      "gravityInput",
      "initialVelocityInput",
      "showTrailsInput",
      "showVelocityVectorsInput",
    ] as const) {
      if (value[field] !== undefined && !controls.has(String(value[field]))) {
        errors.push(`scenes[${index}].${field} must reference a control`);
      }
    }
    if (
      value.trailSamples !== undefined &&
      (!finite(value.trailSamples) ||
        !Number.isInteger(value.trailSamples) ||
        value.trailSamples < 2 ||
        value.trailSamples > 240)
    ) {
      errors.push(`scenes[${index}].trailSamples must be an integer from 2 to 240`);
    }
    if (
      !isRecord(value.centralBody) ||
      typeof value.centralBody.label !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(String(value.centralBody.color ?? "")) ||
      !finite(value.centralBody.radius) ||
      value.centralBody.radius <= 0 ||
      value.centralBody.radius > 100
    ) {
      errors.push(`scenes[${index}].centralBody is invalid`);
    }
    if (!Array.isArray(value.bodies) || value.bodies.length === 0 || value.bodies.length > 16) {
      errors.push(`scenes[${index}].bodies must contain 1-16 bodies`);
    } else {
      const bodyIds = new Set<string>();
      value.bodies.forEach((body, bodyIndex) => {
        if (
          !isRecord(body) ||
          !ID_PATTERN.test(String(body.id ?? "")) ||
          bodyIds.has(String(body.id)) ||
          typeof body.label !== "string" ||
          !/^#[0-9a-f]{6}$/i.test(String(body.color ?? "")) ||
          ![body.radius, body.distance, body.orbitSpeed].every(finite) ||
          Number(body.radius) <= 0 ||
          Number(body.radius) > 100 ||
          Number(body.distance) <= 0 ||
          Number(body.distance) > 1_000
        ) {
          errors.push(`scenes[${index}].bodies[${bodyIndex}] is invalid`);
        }
        bodyIds.add(String(body.id ?? ""));
      });
      const objectCount = 4 + value.bodies.length * 3;
      const vertexCount = 1_200 + value.bodies.length * 900;
      if (objectCount > configured.maxThreeObjects) {
        errors.push(`scenes[${index}] exceeds ${configured.maxThreeObjects} Three.js objects`);
      }
      if (vertexCount > configured.maxVertices) {
        errors.push(`scenes[${index}] exceeds ${configured.maxVertices} generated vertices`);
      }
    }
    return true;
  }
  if (value.kind === "scene3d") {
    const configured = interactiveVisualizerConfig();
    if (!["perspective", "orthographic"].includes(String(value.camera))) {
      errors.push(`scenes[${index}].camera is invalid`);
    }
    if (value.rotationSpeedInput !== undefined && !controls.has(String(value.rotationSpeedInput))) {
      errors.push(`scenes[${index}].rotationSpeedInput must reference a control`);
    }
    if (!Array.isArray(value.objects) || value.objects.length === 0 || value.objects.length > 96) {
      errors.push(`scenes[${index}].objects must contain 1-96 objects`);
    } else {
      const ids = new Set<string>();
      value.objects.forEach((object, objectIndex) => {
        if (
          !isRecord(object) ||
          !ID_PATTERN.test(String(object.id ?? "")) ||
          ids.has(String(object.id)) ||
          typeof object.label !== "string" ||
          !object.label.trim() ||
          !["sphere", "box", "cylinder", "torus"].includes(String(object.shape)) ||
          !/^#[0-9a-f]{6}$/i.test(String(object.color ?? "")) ||
          !Array.isArray(object.position) ||
          object.position.length !== 3 ||
          !Array.isArray(object.scale) ||
          object.scale.length !== 3 ||
          !object.scale.every((item) => finite(item) && item > 0 && item <= 100)
        ) {
          errors.push(`scenes[${index}].objects[${objectIndex}] is invalid`);
          return;
        }
        ids.add(String(object.id));
        object.position.forEach((expression, axis) =>
          validateExpression(
            expression,
            expressionInputs,
            errors,
            `scenes[${index}].objects[${objectIndex}].position[${axis}]`,
          ));
      });
      if (!Array.isArray(value.connections) || value.connections.length > 192) {
        errors.push(`scenes[${index}].connections must contain at most 192 connections`);
      } else {
        value.connections.forEach((connection, connectionIndex) => {
          if (
            !isRecord(connection) ||
            !ids.has(String(connection.from)) ||
            !ids.has(String(connection.to)) ||
            connection.from === connection.to ||
            !/^#[0-9a-f]{6}$/i.test(String(connection.color ?? ""))
          ) {
            errors.push(`scenes[${index}].connections[${connectionIndex}] is invalid`);
          }
        });
      }
      const objectCount = value.objects.length + (Array.isArray(value.connections) ? value.connections.length : 0) + 5;
      const vertexCount = value.objects.length * 1_200 + (Array.isArray(value.connections) ? value.connections.length * 2 : 0);
      if (objectCount > configured.maxThreeObjects) {
        errors.push(`scenes[${index}] exceeds ${configured.maxThreeObjects} Three.js objects`);
      }
      if (vertexCount > configured.maxVertices) {
        errors.push(`scenes[${index}] exceeds ${configured.maxVertices} generated vertices`);
      }
    }
    return true;
  }
  errors.push(`scenes[${index}].kind is invalid`);
  return false;
}

function validateDefinition(
  value: unknown,
  manifest: InteractiveVisualizerManifest | null,
): { definition: InteractiveVisualizerDefinition | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(value)) return { definition: null, errors: ["definition must be an object"], warnings };
  if (value.schemaVersion !== 1) errors.push("definition.schemaVersion must be 1");
  if (typeof value.title !== "string" || !value.title.trim()) errors.push("definition.title is required");
  if (typeof value.description !== "string" || !value.description.trim()) errors.push("definition.description is required");
  if (!Array.isArray(value.controls) || value.controls.length > MAX_CONTROLS) {
    errors.push(`definition.controls must contain at most ${MAX_CONTROLS} controls`);
  }
  if (!Array.isArray(value.outputs) || value.outputs.length > MAX_OUTPUTS) {
    errors.push(`definition.outputs must contain at most ${MAX_OUTPUTS} outputs`);
  }
  if (!Array.isArray(value.scenes) || value.scenes.length === 0 || value.scenes.length > MAX_SCENES) {
    errors.push(`definition.scenes must contain 1-${MAX_SCENES} scenes`);
  }
  if (EXTERNAL_URL_RE.test(JSON.stringify(value))) errors.push("definition contains an external URL");
  const controls = Array.isArray(value.controls) ? value.controls : [];
  const controlIds = new Set<string>();
  controls.forEach((control, index) => {
    if (validateControl(control, errors, index)) {
      if (controlIds.has(control.id)) errors.push(`controls[${index}].id is duplicated`);
      controlIds.add(control.id);
    }
  });
  const expressionInputs = new Set([...controlIds, "x", "t"]);
  const outputs = Array.isArray(value.outputs) ? value.outputs : [];
  const outputIds = new Set<string>();
  outputs.forEach((output, index) => {
    if (!isRecord(output) || !ID_PATTERN.test(String(output.id ?? "")) || typeof output.label !== "string") {
      errors.push(`outputs[${index}] is invalid`);
      return;
    }
    if (outputIds.has(String(output.id))) errors.push(`outputs[${index}].id is duplicated`);
    outputIds.add(String(output.id));
    if (output.expression !== undefined) {
      validateExpression(output.expression, expressionInputs, errors, `outputs[${index}].expression`);
    }
  });
  const scenes = Array.isArray(value.scenes) ? value.scenes : [];
  scenes.forEach((scene, index) => validateScene(scene, controlIds, expressionInputs, errors, index));
  const has3d = scenes.some((scene) =>
    isRecord(scene) && (scene.kind === "orbit3d" || scene.kind === "scene3d"));
  if ((manifest?.mode === "3d" || manifest?.mode === "hybrid") && !has3d) {
    errors.push("3d and hybrid artifacts require an orbit3d scene");
  }
  if (manifest?.mode === "2d" && has3d) errors.push("2d artifacts cannot contain an orbit3d scene");
  if (
    manifest?.mode === "hybrid" &&
    !scenes.some((scene) =>
      isRecord(scene) && scene.kind !== "orbit3d" && scene.kind !== "scene3d")
  ) {
    errors.push("hybrid artifacts require both 2D and 3D scenes");
  }
  if (manifest && value.title !== manifest.title) warnings.push("definition.title differs from manifest.title");
  if (isRecord(value.animation)) {
    if (!finite(value.animation.durationMs) || value.animation.durationMs < 250 || value.animation.durationMs > 120_000) {
      errors.push("animation.durationMs must be 250-120000");
    }
    if (typeof value.animation.autoplay !== "boolean" || typeof value.animation.loop !== "boolean") {
      errors.push("animation flags must be boolean");
    }
  }
  return {
    definition: errors.length === 0 ? value as unknown as InteractiveVisualizerDefinition : null,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  };
}

export function compileInteractiveVisualizerPackage(
  planValue: unknown,
  packageValue: unknown,
): CompiledInteractiveVisualizerPackage {
  const planResult = validateInteractiveVisualizerPlan(planValue);
  const packageErrors: string[] = [];
  if (!isRecord(packageValue)) packageErrors.push("package must be an object");
  const candidate = isRecord(packageValue) ? packageValue : {};
  if (candidate.schemaVersion !== 1) packageErrors.push("package.schemaVersion must be 1");
  const files = isRecord(candidate.files) ? candidate.files : {};
  const keys = Object.keys(files).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["index.html", "main.ts", "styles.css"])) {
    packageErrors.push("package.files must contain exactly index.html, styles.css, and main.ts");
  }
  const htmlSource = typeof files["index.html"] === "string" ? files["index.html"] : "";
  const cssSource = typeof files["styles.css"] === "string" ? files["styles.css"] : "";
  const moduleSource = typeof files["main.ts"] === "string" ? files["main.ts"] : "";
  if (!htmlSource) packageErrors.push("package.files.index.html is required");
  if (!moduleSource) packageErrors.push("package.files.main.ts is required");
  for (const field of ["assumptions", "limitations"] as const) {
    if (!stringArray(candidate[field], 32)) {
      packageErrors.push(`package.${field} must be a bounded string array`);
    }
  }
  if (!Array.isArray(candidate.semanticTests) || candidate.semanticTests.length === 0 || candidate.semanticTests.length > 24) {
    packageErrors.push("package.semanticTests must contain 1-24 structured assertions");
  } else {
    candidate.semanticTests.forEach((test, index) => {
      if (
        !isRecord(test) ||
        typeof test.name !== "string" ||
        !test.name.trim() ||
        typeof test.assertion !== "string" ||
        !test.assertion.trim()
      ) {
        packageErrors.push(`package.semanticTests[${index}] is invalid`);
      }
    });
  }
  if (!Array.isArray(candidate.sourceReferences) || candidate.sourceReferences.length > 32) {
    packageErrors.push("package.sourceReferences must be a bounded array");
  } else {
    candidate.sourceReferences.forEach((reference, index) => {
      if (
        !isRecord(reference) ||
        typeof reference.label !== "string" ||
        !reference.label.trim() ||
        reference.label.length > 500
      ) {
        packageErrors.push(`package.sourceReferences[${index}].label is invalid`);
      }
      if (
        reference.url !== undefined &&
        (
          typeof reference.url !== "string" ||
          reference.url.length > 2_000 ||
          !/^https:\/\/[^\s]+$/i.test(reference.url)
        )
      ) {
        packageErrors.push(`package.sourceReferences[${index}].url must be an HTTPS URL`);
      }
      if (
        reference.gardenSlug !== undefined &&
        (
          typeof reference.gardenSlug !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9/_-]{0,299}$/.test(reference.gardenSlug)
        )
      ) {
        packageErrors.push(`package.sourceReferences[${index}].gardenSlug is invalid`);
      }
    });
  }
  if (!Array.isArray(candidate.assets) || candidate.assets.length !== 0) {
    packageErrors.push("package.assets must be empty in schema version 1");
  }
  const manifestResult = validateManifest(candidate.manifest, planResult.plan);
  const htmlResult = validateHtml(htmlSource);
  const cssResult = validateCss(cssSource);
  const parsed = parseDefinition(moduleSource);
  const definitionResult = validateDefinition(parsed.value, manifestResult.manifest);
  const errors = [
    ...planResult.errors,
    ...packageErrors,
    ...manifestResult.errors,
    ...htmlResult.errors,
    ...cssResult.errors,
    ...parsed.errors,
    ...definitionResult.errors,
  ];
  const sourceEnvelope = JSON.stringify({
    schemaVersion: candidate.schemaVersion,
    manifest: candidate.manifest,
    assumptions: candidate.assumptions,
    limitations: candidate.limitations,
    sourceReferences: candidate.sourceReferences,
    semanticTests: candidate.semanticTests,
    assets: candidate.assets,
    files: {
      "index.html": htmlSource,
      "styles.css": cssSource,
      "main.ts": moduleSource,
    },
  });
  const configured = interactiveVisualizerConfig();
  const sourceBytes = Buffer.byteLength(sourceEnvelope, "utf8");
  if (sourceBytes > configured.maxSourceBytes) {
    errors.push(`source package exceeds ${configured.maxSourceBytes} bytes`);
  }
  if (manifestResult.manifest?.mode === "3d" && !configured.threeEnabled) {
    errors.push("3D interactive visualizers are disabled by server policy");
  }
  return {
    definition: errors.length === 0 ? definitionResult.definition : null,
    manifest: errors.length === 0 ? manifestResult.manifest : null,
    plan: errors.length === 0 ? planResult.plan : null,
    html: htmlResult.html,
    css: cssResult.css,
    validation: {
      valid: errors.length === 0,
      checkedAt: nowIso(),
      astNodeCount: parsed.astNodeCount,
      sourceBytes,
      imports: parsed.imports,
      errors: [...new Set(errors)],
      warnings: definitionResult.warnings,
    },
    sourceHash: sha256(sourceEnvelope),
  };
}

export function parseInteractiveVisualizerPackage(
  value: unknown,
): InteractiveVisualizerPackage | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.files)) return null;
  return value as unknown as InteractiveVisualizerPackage;
}
