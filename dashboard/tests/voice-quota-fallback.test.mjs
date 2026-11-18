import test from 'node:test';
import assert from 'node:assert/strict';
import { modelIsOutOfQuota, pickClaudeStandIn } from '../src/lib/speech/voice-quota-fallback.ts';

test('voice detects a spent ChatGPT pool or a cooling model', () => {
  const spent = { accounts: [{ available: false }, { available: false }], cooldowns: [] };
  assert.equal(modelIsOutOfQuota('gpt-6-luna', spent), true);
  assert.equal(modelIsOutOfQuota('gpt-6-luna', { accounts: [{ available: false }, { available: true }] }), false);
  assert.equal(modelIsOutOfQuota('gpt-6-luna', { accounts: [] }), false);
  assert.equal(modelIsOutOfQuota('cliproxy/gemini-3.8-flash', spent), false);
  assert.equal(modelIsOutOfQuota('cliproxy/gemini-3.8-flash', { cooldowns: [{ key: 'cliproxy/gemini-3.8-flash' }] }), true);
});

test('the Claude stand-in prefers Sonnet', () => {
  assert.equal(pickClaudeStandIn(['openrouter/x', 'cliproxy/claude-opus-5', 'cliproxy/claude-sonnet-5-5']), 'cliproxy/claude-sonnet-5-5');
  assert.equal(pickClaudeStandIn(['cliproxy/claude-sonnet-5', 'cliproxy/claude-sonnet-5-5', 'cliproxy/claude-sonnet-4-6']), 'cliproxy/claude-sonnet-5-5');
  assert.equal(pickClaudeStandIn(['cliproxy/claude-opus-5']), 'cliproxy/claude-opus-5');
  assert.equal(pickClaudeStandIn(['cliproxy/gemini-3.8-flash-high']), null);
});
