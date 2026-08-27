/**
 * Worker-only generated-visual compiler.
 *
 * This module deliberately owns the TypeScript runtime and its AST cache. It
 * must only be imported by a fresh Runtime V2 worker (including Learn's own
 * disposable worker), never by a Next compatibility route.
 */
import crypto from "node:crypto";
import ts from "typescript";

import {
  GENERATED_VISUAL_CAPABILITY_MANIFEST,
  GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH,
} from "./generated-visual-capabilities.ts";
import {
  generatedVisualCompilerOpportunityCacheContract,
  type GeneratedVisualCompilation,
  validateGeneratedVisualizationDefinition,
} from "./generated-visuals.ts";
import { VISUAL_SDK_VERSION } from "./visual-sdk.ts";
import type { VisualizationOpportunity } from "./visualization-opportunities.ts";

const SDK_IMPORT = GENERATED_VISUAL_CAPABILITY_MANIFEST.sourceForm.importModule;
const IMPORT_ALLOWLIST = new Set([SDK_IMPORT, "react"]);
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
const MAX_SOURCE_CHARACTERS =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.sourceCharacters;
const GENERATED_COMPILATION_CACHE = new Map<
  string,
  GeneratedVisualCompilation
>();

function nowIso(): string {
  return new Date().toISOString();
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
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
  if (depth > MAX_LITERAL_DEPTH) {
    throw new Error("module literal nesting is too deep");
  }
  const node = unwrapExpression(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
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
      if (ts.isSpreadElement(element)) {
        throw new Error("spread elements are not allowed");
      }
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
  if (sourceCode.length > MAX_SOURCE_CHARACTERS) {
    return {
      definition: null,
      imports,
      errors: [`source exceeds ${MAX_SOURCE_CHARACTERS} characters`],
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
  if (astNodeCount > MAX_AST_NODES) {
    errors.push(`AST exceeds ${MAX_AST_NODES} nodes`);
  }

  let exportExpression: ts.Expression | null = null;
  let importCount = 0;
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      importCount += 1;
      const moduleName = ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : "";
      imports.push(moduleName);
      if (!IMPORT_ALLOWLIST.has(moduleName)) {
        errors.push(`import ${moduleName || "(unknown)"} is not allowed`);
      }
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
  if (!exportExpression) {
    errors.push("a default defineVisualization export is required");
  }

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

export function compileGeneratedVisualization(
  sourceCode: string,
  opportunity?: VisualizationOpportunity,
): GeneratedVisualCompilation {
  const sourceHash = sha256(sourceCode);
  const opportunityContractHash = opportunity
    ? sha256(
        JSON.stringify(
          generatedVisualCompilerOpportunityCacheContract(opportunity),
        ),
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
