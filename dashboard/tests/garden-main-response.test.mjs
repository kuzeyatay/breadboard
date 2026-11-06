import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { gardenTurnCompletedOnServer, readGardenResponseData } from '../src/lib/hermes/garden-response-stream.ts';

// Execute the production send/catch/finally path with an HTTP stream that stays
// open, reproducing the stuck viewer without a browser or a model request.
const source = fs.readFileSync(new URL('../src/app/garden/garden-assistant.tsx', import.meta.url), 'utf8');
const start = source.indexOf('    let agentFailed = false;', source.indexOf('async function sendMessage('));
const end = source.indexOf('\n  }', start);
assert.ok(start > 0 && end > start);
const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const pollStart = source.indexOf('            const observer = turnObserverRef.current;');
const pollEnd = source.indexOf('            setChatSessions(', pollStart);
const reconcile = new Function('refreshed', 'turnObserverRef', 'gardenTurnCompletedOnServer', source.slice(pollStart, pollEnd));

async function runResponse(frames, durable) {
  const encoder = new TextEncoder();
  const state = { messages: [], saved: [], finishes: [], streaming: true, cancelled: false };
  const turnSignal = new AbortController().signal;
  const turnObserverRef = { current: null };
  const localTurnRef = { current: true };
  const steerContext = { messages: [] };
  const body = new ReadableStream({
    start(controller) { if (frames) controller.enqueue(encoder.encode(frames)); },
    cancel() { state.cancelled = true; },
  });
  const dependencies = {
    turnSignal, turnObserverRef, localTurnRef, steerContext,
    activeSteerContextRef: { current: steerContext },
    activeMarkdown: null, session: { id: 968 }, clientMessageId: 'current-turn',
    nextMessages: [], sessionTitle: 'RC question', pendingAttachments: [],
    activeClusterSlug: 'ec-2', model: 'selected', reasoningEffort: 'max', activeMarkdownContext: null,
    selectedText: '', selectionContext: undefined, superAgentEnabled: false, yoloModeEnabled: false,
    isDirectModeEnabled: () => false, isPersonalizeEnabled: () => false,
    responseStartedAt: performance.now(), turnCreatedAt: new Date().toISOString(),
    readGardenResponseData,
    fetchGardenChat: async () => {
      if (durable) setTimeout(() => reconcile(durable, turnObserverRef, gardenTurnCompletedOnServer), 0);
      return new Response(body);
    },
    agentActivity: { handleEvent() {}, finish: failed => state.finishes.push(failed) },
    setMessages: value => { state.messages = typeof value === 'function' ? value(state.messages) : value; },
    preserveInlineQuestionMessages: messages => messages,
    updateSessionMessages: (_id, messages) => { state.messages = messages; },
    persistChatSession: async (_id, messages) => { state.saved.push(messages); },
    setIsStreaming: value => { state.streaming = value; },
  };
  await new Function(...Object.keys(dependencies), `return(async()=>{
    let activityStarted=true;
    let assistantMessage={role:'assistant',clientMessageId:'current-turn',content:'Partial answer'};
    ${js}
  })()`)(...Object.values(dependencies));
  assert.equal(state.streaming, false);
  assert.equal(localTurnRef.current, false);
  assert.equal(turnObserverRef.current, null);
  assert.equal(turnSignal.aborted, false, 'viewer cleanup must not stop the server-owned run');
  assert.equal(state.cancelled, true);
  return state;
}

test('the main Garden viewer finishes on DONE even when HTTP stays open', { timeout: 1000 }, async () => {
  const state = await runResponse('data: [DONE]\n\n');
  assert.deepEqual(state.finishes, [false]);
  assert.equal(state.saved.length, 1);
  assert.equal(state.messages.at(-1).content, 'Partial answer');
  assert.ok(state.messages.at(-1).responseCompletedAt);
});

test('a streamed error stops thinking and retains the partial answer and actual error', { timeout: 1000 }, async () => {
  const state = await runResponse('data: {"type":"error","error":"The agent never sent output."}\n\n');
  assert.deepEqual(state.finishes, [true]);
  assert.equal(state.messages.at(-1).failed, true);
  assert.equal(state.messages.at(-1).content, 'Partial answer\n\nThe agent never sent output.');
});

test('durable completion retires a silent main stream without overwriting its saved failure', { timeout: 1000 }, async () => {
  const durable = { id: 968, title: 'RC question', active: false, messages: [{
    role: 'assistant', clientMessageId: 'current-turn', content: 'Saved failure', failed: true,
    responseCompletedAt: '2026-10-01T08:39:26.847Z',
  }] };
  const state = await runResponse('', durable);
  assert.deepEqual(state.finishes, [true]);
  assert.deepEqual(state.messages, durable.messages);
  assert.equal(state.saved.length, 0);
});

test('a new local turn is polled before the server marks its session active', () => {
  const start = source.indexOf('  const activeChatIdsKey =');
  const end = source.indexOf('  useEffect(', start);
  const getIds = new Function('chatSessions', 'isStreaming', 'activeChatId', `${source.slice(start, end)}return activeChatIdsKey;`);
  const sessions = [{ id: 968, active: false, messages: [{ role: 'assistant', content: '' }] }];
  assert.equal(getIds(sessions, true, 968), '968');
  assert.equal(getIds(sessions, false, 968), '');
});
