import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import esbuild from "esbuild";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const dashboardRoot = fileURLToPath(new URL("../", import.meta.url));
const workspacePath = path.join(dashboardRoot, "src/app/gardens/[clusterSlug]/workspace-client.tsx");
const source = ts.createSourceFile(
  workspacePath, fs.readFileSync(workspacePath, "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
);

// Render the actual Garden transcript, including its ActivityPanel and action
// buttons. Extract it so the test does not boot the workspace's agent launchers.
// Only unrelated card components and virtual-list layout are replaced.
const declarations = new Set([
  "ChatTranscript", "buildTranscriptRows", "transcriptRowKey",
  "transcriptRowHeight", "EMPTY_CHAT_ANNOTATIONS",
  "messageSelectionSourceId",
]);
const statements = source.statements.filter((node) =>
  (ts.isFunctionDeclaration(node) && declarations.has(node.name?.text)) ||
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(
    (declaration) => declarations.has(declaration.name.getText(source)),
  )),
);
assert.equal(statements.length, declarations.size);
const used = new Set();
function visit(node) {
  if (ts.isIdentifier(node)) used.add(node.text);
  ts.forEachChild(node, visit);
}
statements.forEach(visit);
const imports = [];
const stubs = [];
const realComponents = new Set(["ActivityPanel", "AssistantMessageActions", "MessageActionsSlot", "AssistantResponseNotice"]);
for (const node of source.statements) {
  if (!ts.isImportDeclaration(node) || !node.importClause || node.importClause.isTypeOnly) continue;
  const clause = node.importClause;
  const specifier = JSON.stringify(node.moduleSpecifier.text);
  const bindings = [
    ...(clause.name ? [{ name: clause.name.text, imported: "default" }] : []),
    ...(clause.namedBindings && ts.isNamedImports(clause.namedBindings)
      ? clause.namedBindings.elements.filter((item) => !item.isTypeOnly).map((item) => ({
          name: item.name.text, imported: item.propertyName?.text ?? item.name.text,
        })) : []),
  ];
  for (const { name, imported } of bindings) {
    if (!used.has(name)) continue;
    if (/^[A-Z]/.test(name) && !realComponents.has(name)) {
      stubs.push(name === "VirtualizedMessageList"
        ? `const ${name} = ({items, renderItem}) => items.map((item, index) => <div key={index} data-row={item.index}>{renderItem(item)}</div>);`
        : `const ${name} = ({children}) => children ?? null;`);
    } else {
      imports.push(imported === "default"
        ? `import ${name} from ${specifier};`
        : `import {${imported} as ${name}} from ${specifier};`);
    }
  }
}
const bundle = await esbuild.build({
  stdin: {
    contents: [imports.join("\n"), stubs.join("\n"), ...statements.map((node) => node.getText(source)), "export { ChatTranscript };"].join("\n"),
    loader: "tsx", resolveDir: path.dirname(workspacePath),
  },
  bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic",
  alias: { "@": path.join(dashboardRoot, "src") },
  external: ["react", "react-dom", "react/jsx-runtime"],
  logLevel: "silent",
});
const compiledModule = { exports: {} };
new Function("require", "exports", "module", bundle.outputFiles[0].text)(
  createRequire(import.meta.url), compiledModule.exports, compiledModule,
);
const { ChatTranscript } = compiledModule.exports;
const noop = () => {};

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(ChatTranscript, {
    clusterName: "Test Garden", clusterSlug: "test", chatSessionId: 1,
    isStreaming: false, loadingChats: false,
    messages: [
      { role: "user", content: "Start research", createdAt: "2026-09-05T09:55:00Z" },
      { role: "assistant", content: "", createdAt: "2026-09-05T09:55:00Z" },
    ],
    gardenSourceAttachments: [], activities: [], connection: "idle",
    pendingPermission: null, pendingClarification: null,
    onPermissionDecision: noop, onClarificationAnswer: noop,
    branchGroups: {}, annotationsByMessage: new Map(),
    delegationInFlight: false, transcriptScrollRef: { current: null },
    ...overrides,
  }));
}

function actionCount(html) {
  return (html.match(/aria-label="More response actions"/g) ?? []).length;
}

test("Garden hides response buttons throughout external-agent preparation and connection transitions", () => {
  // prepareExternalAgentSession retires the draft before the launcher has a
  // run ID. Its connection is already active while isStreaming is still false.
  for (const connection of ["connecting", "streaming", "waiting"]) {
    const html = render({ connection });
    assert.match(html, /Thinking/);
    assert.equal(actionCount(html), 0, `buttons appeared during ${connection}`);
  }
  assert.equal(actionCount(render({ isStreaming: true, connection: "streaming" })), 0);
  assert.equal(actionCount(render({ isStreaming: true, connection: "idle" })), 0);
  assert.equal(actionCount(render({ delegationInFlight: true })), 0);
});

test("empty and failed launches offer recovery without answer actions", () => {
  for (const connection of ["idle", "error"]) {
    const html = render({ connection });
    assert.equal(actionCount(html), 0);
    assert.match(html, /assistant-response-notice/);
    assert.match(html, />Retry<\/button>/);
  }
});

test("an active Garden response keeps the previous answer's controls available", () => {
  const html = render({
    connection: "connecting",
    messages: [
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: "Start research" },
      { role: "assistant", content: "" },
    ],
  });
  assert.equal(actionCount(html), 1);
  assert.match(html, /Thought/);
  assert.match(html, /Thinking/);
});
