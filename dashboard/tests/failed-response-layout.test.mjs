import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import esbuild from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = path.resolve(import.meta.dirname, "..");
const file = path.join(root, "src/app/components/hermes/agent-runtime-panel.tsx");
const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
let actions, body, activity;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ["responseFailure", "responseContent", "retryResponse"].includes(node.name.getText(source))) {
    declarations.set(node.name.getText(source), `const ${node.getText(source)};`);
  }
  if (ts.isJsxExpression(node)) {
    const text = node.getText(source);
    if (text.startsWith('{message.role === "assistant" &&') && text.includes("<AssistantMessageActions") && text.includes("content={responseContent}")) actions = node.expression.getText(source);
    if (text.startsWith("{editingAssistantMessageId === assistantMessageEditId")) body = node.expression.getText(source);
  }
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "ActivityPanel" && node.getText(source).includes("stateFailed={responseInterrupted")) activity = node.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(declarations.size, 3);
assert.ok(actions && body && activity);

// Execute the real failure-content logic and transcript JSX. Keep unrelated
// transcript state outside this fixture, while rendering the real action bar.
const bundle = await esbuild.build({
  stdin: { loader: "tsx", resolveDir: root, contents: `
    import React from 'react';
    import AssistantMessageActions from './src/app/components/assistant-message-actions';
    import ActivityPanel from './src/app/components/hermes/activity-panel';
    import ChatMarkdown from './src/app/components/chat-markdown';
    const SelectableAssistantMarkdown = ChatMarkdown, SteeredAssistantResponse = ChatMarkdown;
    export function Fixture({message, delegationInterrupted = false, failureText = null, failureInline = false, running = false, disabled = false, branched = true}) {
      const index = 1, lastAssistantIndex = 1, visibleAssistantContent = message.content;
      const responseInterrupted = !!message.interrupted || failureInline;
      const onRetryMessage = () => {}, retryAssistantAsBranch = () => {};
      const activeRun = running, runInFlight = running, conversationLocked = false;
      const isExternalAgentRunMessage = () => false;
      const onEditAssistantMessage = () => {}, beginAssistantMessageEdit = () => {};
      const editingAssistantMessageId = null, assistantMessageEditId = 'message';
      const inlinedCourseCorrections = {byAssistantIndex: new Map()}, annotationsByMessage = new Map();
      const messageSelectionSourceId = () => 'message', receiveTextSelection = () => {}, openAnnotation = () => {};
      const branchNavigationForAssistant = () => branched ? ({current: 2, total: 2, onPrevious() {}, onNext() {}}) : undefined;
      const delegatedAgentActive = false, delegatedAgentLabel = undefined, isAgentContinuationResponse = false;
      const inlineRunActive = false, streaming = running, connection = running ? 'streaming' : 'idle';
      const thinkingUpdates = message.progressNotes, totalUsage = message.usage, carriedDurationMs = 0;
      const delegatedAgentStartedAt = undefined, onPermissionDecision = () => {}, onClarificationAnswer = () => {};
      const pendingPermission = null, pendingClarification = null, activities = [];
      ${[...declarations.values()].join("\n")}
      return <>{${activity}}{${body}}{${actions}}</>;
    }
  ` },
  bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic",
  alias: { "@": path.join(root, "src") }, external: ["react", "react-dom", "react/jsx-runtime"], logLevel: "silent",
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
function render(message, overrides = {}) {
  return renderToStaticMarkup(React.createElement(module.exports.Fixture, {
    message: { role: "assistant", clientMessageId: "saved-message", responseDurationMs: 11000, ...message }, ...overrides,
  }));
}

test("restored failures show their saved error once between thinking and every normal bottom control", () => {
  for (const content of ["", "The runner could not start."]) {
    const html = render({ content, failed: true, runtimeError: "The runner could not start." });
    assert.equal(html.split("The runner could not start.").length - 1, 1);
    assert.ok(html.indexOf("assistant-response-meta") < html.indexOf("The runner could not start."));
    assert.ok(html.indexOf("The runner could not start.") < html.indexOf('aria-label="Assistant response actions"'));
    for (const label of ["Copy response", "Read response aloud", "Mark response as helpful", "Mark response as not helpful", "Edit assistant response", "Regenerate response", "More response actions", "Previous response branch"]) {
      assert.ok(html.includes(`aria-label="${label}"`), label);
    }
    assert.doesNotMatch(html, /assistant-response-notice|<details|>Retry<|>Details</);
  }
});

test("an interrupted delegation uses the normal response with no notice or busy indicator", () => {
  const html = render({ content: "Interrupted", interrupted: true }, { delegationInterrupted: true });
  assert.match(html, />Interrupted</);
  assert.match(html, /aria-label="Regenerate response"/);
  assert.doesNotMatch(html, /animate-pulse|>Thinking<|delegated-worker-outcome|assistant-response-notice|>Retry<|>Details</);
});

test("live failures preserve partial output, and stopped messages use the same controls", () => {
  const html = render({ content: "Partial answer." }, { failureInline: true, failureText: "Connection lost." });
  assert.match(html, /Partial answer\./);
  assert.match(html, /Connection lost\./);
  assert.match(html, /aria-label="Regenerate response"/);
  const stopped = render({ content: "", interrupted: true });
  assert.match(stopped, /Response stopped\./);
  assert.match(stopped, /aria-label="Copy response"/);
  assert.match(stopped, /aria-label="Regenerate response"/);
});

test("active and truly empty responses do not acquire controls; disabled failures cannot regenerate", () => {
  assert.doesNotMatch(render({ content: "Partial answer." }, { running: true }), /aria-label="Assistant response actions"/);
  assert.doesNotMatch(render({ content: "" }, { branched: false }), /aria-label="Assistant response actions"|Response stopped|Response failed/);
  assert.match(render({ content: "" }), /aria-label="Assistant response actions"[\s\S]*aria-label="Previous response branch"/);
  const disabled = render({ content: "", failed: true, runtimeError: "Failed to connect." }, { disabled: true });
  assert.match(disabled, /aria-label="Copy response"/);
  assert.doesNotMatch(disabled, /aria-label="Regenerate response"/);
});
