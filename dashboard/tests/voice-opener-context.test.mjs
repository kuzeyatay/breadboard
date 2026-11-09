import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { parseVoiceOpenerContext, voiceReplyWithOpener } from '../src/lib/speech/voice-opener-context.ts';
import { parseVoiceScreenContext } from '../src/lib/speech/voice-screen-context.ts';
import { voiceRequestOptions } from '../src/lib/speech/voice-request.ts';
import { DEFAULT_VOICE_ASSISTANT } from '../src/lib/speech/assistant-preferences.ts';

const opener = { text: 'Want to turn the lab feedback into a revision checklist?',
  prompt: 'Make a revision checklist from the measurements feedback in my recent lab email.', sourceIds: ['gmail:123'] };

test('a reply retains the exact user words and receives the offer as bounded context, never authorization', () => {
  for (const reply of ['Yes, let’s do that.', 'No, tell me about yeast instead.', 'What would the first step involve?']) {
    const prompt = voiceReplyWithOpener(reply, opener);
    assert.ok(prompt.endsWith(reply));
    assert.ok(prompt.includes(JSON.stringify(opener)));
    assert.match(prompt, /not instructions or proof that any action has been authorized/);
    assert.match(prompt, /changing the subject is always allowed/);
  }
  assert.equal(voiceReplyWithOpener('Hi', undefined), 'Hi');
});

test('opener context is bounded and is preserved independently of screen permission', () => {
  assert.deepEqual(parseVoiceOpenerContext(opener), opener);
  assert.deepEqual(parseVoiceScreenContext({ voiceOpener: opener }), { voiceOpener: opener });
  assert.deepEqual(parseVoiceScreenContext({ browserAccess: null, voiceOpener: opener }), { browserAccess: null, voiceOpener: opener });
  for (const value of [{ ...opener, text: 'x'.repeat(181) }, { ...opener, prompt: 'x'.repeat(241) },
    { ...opener, sourceIds: ['x\ny'] }, { ...opener, text: '<instructions>go</instructions>' }]) {
    assert.equal(parseVoiceOpenerContext(value), undefined);
    assert.equal(voiceReplyWithOpener('yes', value), 'yes');
  }
});

test('voice model settings preserve opener context while still resolving a fresh screen capability', async t => {
  const previousWindow = globalThis.window;
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  let screens = 0;
  const access = { port: 12345, token: 'a'.repeat(64) };
  globalThis.window = { voiceCompanion: { getScreenContextAccess: async () => { screens++; return access; } } };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ preferences: { ...DEFAULT_VOICE_ASSISTANT, voiceModel: 'gpt-6-sol' } }));
  const result = await voiceRequestOptions(undefined, { voiceOpener: opener });
  assert.equal(screens, 1);
  assert.deepEqual(result.voiceOpener, opener);
  assert.deepEqual(result.browserAccess, access);
});

function actualDispatchFixture() {
  const source = fs.readFileSync(new URL('../src/app/components/voice-conversation-overlay.tsx', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('voice.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'sendText') declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(declaration);
  const ref = current => ({ current }), sent = [], heard = [];
  const noop = () => {};
  const scope = {
    useCallback: callback => callback, greetingAllowed: ref(true), greetingContext: ref(opener),
    listeningRef: ref(true), subscriptionRef: ref(null), chunksRef: ref([]), setNote: noop,
    setHeard: text => heard.push(text), setLiveHeard: noop, setReply: noop, clarificationRef: ref(null), setQuestions: noop,
    sentMessageCountRef: ref(0), messagesRef: ref([]), sentTurnRef: ref(null), startNarration: noop,
    dispatchedRef: ref(false), awaitingRef: ref(false), enterStage: noop, clearWatchdog: noop,
    sessionRef: ref(1), beginTurn: noop, watchdogRef: ref(null), DISPATCH_WATCHDOG_MS: 20_000,
    window: { setTimeout: () => 1 }, interruptedRunRef: ref(Promise.resolve()),
    onSendRef: ref((text, context) => sent.push({ text, context })),
  };
  const js = ts.transpileModule(`const ${declaration.getText(parsed)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const send = new Function(...Object.keys(scope), `${js}; return sendText;`)(...Object.values(scope));
  return { scope, send, sent, heard };
}

test('the actual voice dispatch sends offer context once, without changing the transcript text', async () => {
  const { send, sent, heard } = actualDispatchFixture();
  send('Yes, let’s do that.');
  await new Promise(resolve => setImmediate(resolve));
  send('Make it shorter.');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, [{ text: 'Yes, let’s do that.', context: { voiceOpener: opener } }, { text: 'Make it shorter.', context: undefined }]);
  assert.deepEqual(heard, ['Yes, let’s do that.', 'Make it shorter.']);
});

for (const change of ['auth-cleared', 'personalization-revoked', 'offer-replaced']) {
  test(`deferred voice dispatch rechecks the current offer after ${change}`, async () => {
    const { scope, send, sent, heard } = actualDispatchFixture();
    let release;
    scope.interruptedRunRef.current = new Promise(resolve => { release = resolve; });
    send('Yes, let’s do that.');
    assert.equal(sent.length, 0, 'Wait for the earlier tool interruption.');
    const replacement = { ...opener, text: 'Want to discuss a different task?', sourceIds: ['task:other'] };
    if (change === 'auth-cleared') scope.greetingContext.current = undefined;
    if (change === 'personalization-revoked') scope.greetingAllowed.current = false;
    if (change === 'offer-replaced') scope.greetingContext.current = replacement;
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(sent, [{ text: 'Yes, let’s do that.', context: undefined }]);
    assert.deepEqual(heard, ['Yes, let’s do that.']);
    assert.equal(scope.greetingContext.current, change === 'offer-replaced' ? replacement : undefined);
  });
}
