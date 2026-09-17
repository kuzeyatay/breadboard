import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {
  chatMessageAttachments,
  normalizeChatMessageAttachments,
  visibleChatMessageAttachments,
} from '../src/lib/chat-attachments.ts';

const source = fs.readFileSync(new URL('../src/app/gardens/[clusterSlug]/workspace-client.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('workspace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && ['submitComposer', 'handleSubmit'].includes(node.name?.text)) {
    functions.set(node.name.text, node.getText(tree));
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(functions.size, 2);
const dispatchSource = ts.transpileModule([
  ...functions.values(),
  'const dispatch = handleSubmit; handleSubmit = (...args) => (globalThis.lastDispatch = dispatch(...args));',
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

const document = {
  type: 'document', name: 'results.pdf', format: 'pdf',
  blobId: `doc_${'a'.repeat(32)}`, sizeBytes: 1234, text: 'Extracted document evidence',
};
const question = 'Does this document explain the selected passage?';
const noop = () => {};
const ref = value => ({ current: value });

// Run the production submit handlers through their actual durable checkpoint.
// No model or user database is involved; storage can be paused or made to fail.
function harness({ mode = 'chat', active = false, failSave = false } = {}) {
  const context = vm.createContext({
    performance, crypto, chatMessageAttachments,
    input: question, chatAttachments: [{ ...document }],
    composerSelection: { id: 'selection:12345678', mode, sourceMessageId: 'msg_source', start: 0, end: 7, quote: 'passage' },
    canAskSelection: true, chatContentLoading: false,
    isStreaming: active, steerableTurnActive: active, externalRunHoldsQueue: false,
    activeChatId: 42, activeChat: { id: 42, conversationId: 'conversation:test', messages: [] },
    launchingExternalAgent: null, selectedDocumentSlugs: [], documents: [],
    stoppingGardenChat: false,
    retryBranchRef: ref(null), launchHopsRef: ref(0), launchRoundOriginsRef: ref(new Map()),
    awaitedLaunchesRef: ref(new Map()), activeGardenTurnRef: ref(null),
    streamingChatIdsRef: ref(new Set()), activeSteerContextRef: ref(null),
    inFlightChatMessagesRef: ref(new Map()), chatHistoryEpoch: ref(0),
    agentLaunchQueue: { reset: noop }, agentActivity: { bindSession: noop, finish: noop },
    isSuperAgentEnabled: () => false, isYoloModeEnabled: () => false,
    normalizeFocusedDocumentSlugs: value => value, normalizeFocusedDocumentNames: value => value,
    setPendingLaunchContinuations: noop, setSelectionMenu: noop, setOpenInlineAnswers: noop,
    setInlineSelectionRunId: noop, setChatStreaming: noop, addToast: noop,
    clusterName: 'Fixture', chatSaveFailureLabel: () => 'Save failed',
    stopActiveGardenTurn: () => { throw new Error('Ask here must not stop a running answer'); },
    sendInlineQuestion: (question, selection, attachments) => { context.inlineRequest = {question, selection, attachments}; },
    reserveGardenTurnCheckpoint: async (sessionId, clientMessageId, message) => {
      context.checkpoint = JSON.parse(JSON.stringify(message));
      if (failSave) throw new Error('Storage unavailable');
      await new Promise(() => {});
    },
  });
  for (const [setter, field] of Object.entries({
    setInput: 'input', setChatAttachments: 'chatAttachments', setComposerSelection: 'composerSelection',
  })) context[setter] = value => { context[field] = value; };
  context.updateChatMessages = (_sessionId, messages) => { context.transcript = messages; };
  vm.runInContext(dispatchSource, context);
  return context;
}

for (const mode of ['chat']) {
  test(`selected-text ${mode} sends retain the PDF after checkpoint serialization and reload`, async () => {
    const context = harness({ mode });
    vm.runInContext('submitComposer()', context);
    await Promise.resolve();
    const stored = context.checkpoint;
    assert.ok(stored, 'the selected-text composer reaches the checkpoint');
    assert.equal(stored.content, question);
    assert.equal(stored.textSelection.mode, mode);
    assert.equal(stored.selectedText, 'passage');
    const restored = normalizeChatMessageAttachments(stored.attachments);
    assert.deepEqual(restored, chatMessageAttachments([document]));
    assert.equal(visibleChatMessageAttachments(restored, stored.attachmentNames).attachments[0].blobId, document.blobId);
    assert.equal(context.input, '');
    assert.equal(context.chatAttachments.length, 0);
    assert.equal(context.transcript[0].attachments[0].blobId, document.blobId);
  });
}

test('an inline question starts immediately with its PDF while another answer runs', () => {
  const context = harness({ mode: 'inline', active: true });
  vm.runInContext('submitComposer()', context);
  assert.equal(context.inlineRequest.question, question);
  assert.equal(context.inlineRequest.selection.mode, 'inline');
  assert.equal(context.inlineRequest.attachments[0].blobId, document.blobId);
  assert.equal(context.input, '');
  assert.equal(context.chatAttachments.length, 0);
  assert.equal(context.isStreaming, true);
});

test('a failed selected-text checkpoint restores the question and PDF', async () => {
  const context = harness({mode: 'chat', failSave: true});
  vm.runInContext('submitComposer()', context);
  await context.lastDispatch;
  assert.equal(context.input, question);
  assert.equal(context.chatAttachments[0].blobId, document.blobId);
  assert.equal(context.chatAttachments[0].text, document.text);
});
