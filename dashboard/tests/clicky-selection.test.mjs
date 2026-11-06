import assert from 'node:assert/strict';
import test from 'node:test';
import { breadboardUseCommandText } from '../src/lib/hermes/breadboard-use-intent.ts';
import { computerUseCommandText } from '../src/lib/hermes/computer-use-intent.ts';

const requests = [
  'Launch Clicky', 'Please open the Clicky app', 'Could you please start Clicky for me?',
  'Hermes, bring up Clicky', 'I want to use Clicky', 'I need Clicky to help me',
  'Ask Clicky to help me with Excel', 'Have Clicky show me this setting',
  'Use Clicky to explain this Chrome window', 'Open Clicky and explain how it works',
  'Open the screen companion', 'Use a floating screen companion',
  'Please launch the screen-aware companion', 'Open my screen helper',
  'Help me understand what is on my screen', 'Explain what’s on my screen',
  'Can you walk me through this app on my screen?',
  'Show me where to click on my screen', 'Tell me what to click in this dialog',
];
test('retired companion requests stay ordinary chat messages on both chat surfaces', () => {
  for (const surface of ['dashboard_terminal', 'garden_chat']) {
    for (const text of requests) {
      const input = { text, surface, authenticated: true };
      const selected = breadboardUseCommandText(input);
      assert.deepEqual(selected, { text, automatic: false }, text);
    }
  }
  for (const input of [
    { surface: 'quartz_ai', authenticated: true },
    { surface: 'dashboard_terminal', authenticated: false },
  ]) {
    assert.deepEqual(breadboardUseCommandText({ ...input, text: 'Launch Clicky' }), {
      text: 'Launch Clicky', automatic: false,
    });
  }
});

test('old companion conversations do not interfere with desktop action selection', () => {
  const input = { text: 'Click the save button in Excel', surface: 'dashboard_terminal', authenticated: true,
    priorMessages: [{ role: 'user', content: 'Launch Clicky' }, { role: 'assistant', content: 'Clicky opened.' }] };
  assert.equal(breadboardUseCommandText(input).automatic, false);
  assert.equal(computerUseCommandText(input).automatic, true);
});
