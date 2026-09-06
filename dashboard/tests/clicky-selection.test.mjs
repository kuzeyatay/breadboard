import assert from 'node:assert/strict';
import test from 'node:test';
import { isClickyRequest } from '../src/lib/clicky/intent.ts';
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
const otherRequests = [
  'Clicky', 'What is Clicky?', 'How do I launch Clicky?', 'Can Hermes launch Clicky?',
  'Explain how Clicky works', 'Should I use Clicky?', 'Can you explain how to open Clicky?',
  "Don't launch Clicky", 'Please do not open Clicky', 'Never use Clicky',
  'Use Clicky? No, do not open it.', 'Show me where to click without Clicky',
  'Close Clicky', 'Stop Clicky', 'If I ask you later, launch Clicky',
  'Open Clicky tomorrow', 'Launch Clicky when I ask', 'Start Clicky in 10 minutes',
  'Write a guide that says launch Clicky', 'Build a screen companion',
  'Make sure Hermes can launch Clicky', 'Fix the launch Clicky button',
  'Open the Clicky repository', 'Open Clicky source code', "Open Clicky’s settings",
  'Run Clicky tests', 'Use Clicky analytics',
  '"Launch Clicky"', '`open Clicky`', '/computer-use click the button',
  '/breadboard-use launch Clicky',
  'Click the save button in Excel', 'Open Chrome and search for cats',
  'Take a screenshot of my screen', 'Explain this attached screenshot',
  'Help me understand screen readers', 'Open the companion repository',
];

test('Clicky selection recognizes launch and live guidance while rejecting discussion and unrelated work', () => {
  for (const text of requests) assert.equal(isClickyRequest(text), true, text);
  for (const text of otherRequests) assert.equal(isClickyRequest(text), false, text);
});

test('Clicky wins over generic desktop selection and retains the complete request on both chat surfaces', () => {
  for (const surface of ['dashboard_terminal', 'garden_chat']) {
    for (const text of requests) {
      const input = { text, surface, authenticated: true };
      const selected = breadboardUseCommandText(input);
      assert.deepEqual(selected, { text: `/breadboard-use ${text}`, automatic: true }, text);
      assert.deepEqual(computerUseCommandText({ ...input, text: selected.text }), {
        text: selected.text, automatic: false,
      });
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

test('Clicky does not convert later desktop actions into companion launches', () => {
  const input = { text: 'Click the save button in Excel', surface: 'dashboard_terminal', authenticated: true,
    priorMessages: [{ role: 'user', content: 'Launch Clicky' }, { role: 'assistant', content: 'Clicky opened.' }] };
  assert.equal(breadboardUseCommandText(input).automatic, false);
  assert.equal(computerUseCommandText(input).automatic, true);
});
