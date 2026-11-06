import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const image = { type: 'image', name: 'equation.png', dataUrl: 'data:image/png;base64,aGVsbG8=' };
const selection = { id: 'highlight', mode: 'inline', sourceMessageId: 'answer', start: 0, end: 8, quote: 'Equation' };

function callback(file, name) {
  const source = fs.readFileSync(new URL('../src/app/' + file, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) result = node.initializer.arguments[0].getText(tree);
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(tree);
    if (ts.isJsxAttribute(node) && node.name.text === name) result = node.initializer.expression.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(result, `${file}: ${name}`);
  return ts.transpileModule(`globalThis.ask = ${result};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

for (const file of ['components/hermes/dashboard-agent-terminal.tsx', 'components/hermes/garden-agent-chat.tsx']) {
  test(`${file}: popup images reach the model without consuming the main draft's attachments`, async () => {
    const calls = [];
    const context = vm.createContext({
      runtimeUnavailable: false, busy: false, model: 'model', reasoningEffort: 'high',
      chatAttachments: [{ ...image, name: 'main-draft.png' }],
      setChatAttachments: () => assert.fail('Inline questions must not clear main attachments'), setAttachmentStatus: () => {},
      session: { send: async (...args) => calls.push(args) },
      inlineQuestions: { send: async (question, selection, options) => calls.push([question, { ...options, textSelection: selection }]) },
    });
    vm.runInContext(callback(file, 'askSelection'), context);
    await context.ask('Explain this', selection, [image]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].attachments[0], image);
    assert.equal(calls[0][1].textSelection, selection);
  });
}

test('PDF popup forwards pasted images to the PDF context preparation path', async () => {
  const calls = [];
  const context = vm.createContext({ send: async (...args) => calls.push(args) });
  vm.runInContext(callback('components/pdf-assistant.tsx', 'onAskSelection'), context);
  await context.ask('Compare this image', selection, [image]);
  assert.equal(calls[0][2].attachments[0], image);
  assert.equal(calls[0][1], selection);
});

for (const file of ['components/hermes/agent-runtime-panel.tsx', 'gardens/[clusterSlug]/workspace-client.tsx']) {
  test(`${file}: editing and retry forward popup attachments`, () => {
    const calls = [];
    const context = vm.createContext({
      inlineSelectionThreads: new Map(), conversationLocked: false, chatContentLoading: false, canAskSelection: true,
      setComposerSelection: () => {}, setInlineSelectionRunId: () => {},
      onAskSelection: async (...args) => calls.push(args), sendInlineQuestion: async (...args) => calls.push(args),
    });
    vm.runInContext(callback(file, 'askInlineSelectionAgain'), context);
    context.ask(selection, 'Explain this', [image]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][2][0], image);
    assert.equal(calls[0][1], selection);
  });
}
