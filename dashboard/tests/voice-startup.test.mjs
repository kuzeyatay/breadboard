import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSpeechSettings, invalidateSpeechSettings } from '../src/lib/speech/settings-client.ts';
import { voiceRequestOptions } from '../src/lib/speech/voice-request.ts';
import { DEFAULT_VOICE_ASSISTANT, parseVoiceAssistantPreferences } from '../src/lib/speech/assistant-preferences.ts';

test('voice model is an explicit per-turn choice and follows saved changes', async () => {
  const original = globalThis.fetch;
  let model = 'anthropic/claude-sonnet-4-5';
  let voiceThinking = 'fast';
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(url);
    return Response.json(url === '/api/profile/voice-assistant'
      ? { preferences: { ...DEFAULT_VOICE_ASSISTANT, voiceModel: model, voiceThinking } }
      : { model: 'gpt-6-astra', fallbackModel: 'gpt-6-sol' });
  };
  try {
    assert.deepEqual(await voiceRequestOptions(), { model, reasoningEffort: 'low', voice: true });
    assert.equal(urls.length, 1);
    const browserAccess = { port: 43210, token: 'a'.repeat(64) };
    assert.deepEqual(await voiceRequestOptions(undefined, { browserAccess }), { model, reasoningEffort: 'low', voice: true, browserAccess });
    assert.deepEqual(await voiceRequestOptions(undefined, { browserAccess: null }), { model, reasoningEffort: 'low', voice: true, browserAccess: null });
    assert.deepEqual(await voiceRequestOptions(undefined, { browserAccess: { port: 80, token: 'invalid' }, text: 'never forward' }),
      { model, reasoningEffort: 'low', voice: true, browserAccess: null });
    voiceThinking = 'high';
    assert.deepEqual(await voiceRequestOptions(), { model, reasoningEffort: 'high', voice: true });
    voiceThinking = 'fast';
    model = 'default';
    assert.deepEqual(await voiceRequestOptions(), { model: 'gpt-6-sol', reasoningEffort: 'low', voice: true });
    globalThis.fetch = async () => Response.json({ error: 'Sign in' }, { status: 401 });
    await assert.rejects(voiceRequestOptions(), /Sign in/);
    for (const voiceModel of ['none', 'chat', '', 'invalid model']) {
      assert.equal(parseVoiceAssistantPreferences({ ...DEFAULT_VOICE_ASSISTANT, voiceModel }), null);
    }
  } finally { globalThis.fetch = original; }
});

test('speech settings reuse one lookup, invalidate on change, and isolate caller cancellation', async () => {
  const original = globalThis.fetch;
  invalidateSpeechSettings();
  let calls = 0, complete;
  globalThis.fetch = () => { calls++; return new Promise(resolve => { complete = () => resolve(Response.json({ userId: '1', settings: { enabled: true, speechProvider: 'local' } })); }); };
  try {
    const controller = new AbortController();
    const cancelled = loadSpeechSettings(controller.signal);
    const other = loadSpeechSettings();
    controller.abort();
    await assert.rejects(cancelled, { name: 'AbortError' });
    complete();
    assert.equal((await other).settings.speechProvider, 'local');
    await loadSpeechSettings();
    assert.equal(calls, 1);
    invalidateSpeechSettings();
    globalThis.fetch = async () => { calls++; return Response.json({ userId: '2', settings: { enabled: true, speechProvider: 'elevenlabs' } }); };
    assert.equal((await loadSpeechSettings()).userId, '2');
    assert.equal(calls, 2);
  } finally { invalidateSpeechSettings(); globalThis.fetch = original; }
});
