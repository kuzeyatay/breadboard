import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
register('./teach-support/server-only-stub.mjs', import.meta.url);
const { breadboardUseCommandText } = await import('../src/lib/hermes/breadboard-use-intent.ts');
const { listFirstPartySkills } = await import('../src/lib/hermes/skills.ts');
const { allowedToolsForSurface } = await import('../src/lib/hermes/tool-scopes.ts');
const select = (text, extra = {}) => breadboardUseCommandText({ text, surface: 'dashboard_terminal', authenticated: true, ...extra });

test('Breadboard control requests select the skill on both authenticated chat surfaces', () => {
  for (const surface of ['dashboard_terminal', 'garden_chat']) {
    for (const text of ['open browser and search for sourdough recipes', 'Open Garden', 'close voice assistant', 'Please open the browser', 'Use Breadboard to click the settings button']) {
      assert.deepEqual(select(text, { surface }), { text: `/breadboard-use ${text}`, automatic: true });
    }
  }
  for (const text of ['Explain how Breadboard works', 'Open Chrome and search for cats', 'Build a browser', 'Search my garden notes for photosynthesis', 'Search the web for cats', '/watch this video', 'What is a voice assistant?']) {
    assert.equal(select(text).automatic, false, text);
  }
  assert.equal(select('Open Garden', { authenticated: false }).automatic, false);
  assert.equal(select('Open Garden', { surface: 'quartz_ai' }).automatic, false);
  assert.equal(select('Now click the first result', { priorMessages: [
    { role: 'user', content: 'Open browser and search for sourdough recipes' },
    { role: 'assistant', content: 'Opened the search results.' },
  ] }).automatic, true);
});

test('first-party skill is discoverable, ready, and backed by the scoped tool', () => {
  for (const surface of ['dashboard_terminal', 'garden_chat']) {
    const skill = listFirstPartySkills(surface).find(s => s.slug === 'breadboard-use');
    assert.ok(skill);
    assert.equal(skill.availability, 'ready');
    assert.equal(skill.classification, 'eligible_general');
    assert.ok(allowedToolsForSurface(surface).includes('breadboard_use'));
  }
  assert.ok(!allowedToolsForSurface('quartz_ai').includes('breadboard_use'));
});

test('profile reads, switches, and settings edits route to app control', () => {
  for (const surface of ['dashboard_terminal', 'garden_chat']) {
    for (const text of [
      'Turn off startup sound', 'Enable browser navigation', 'Open my profile page',
      'Please disable read aloud notifications', 'Turn on always on voice assistant',
      'Set clap sensitivity to 70 in my profile', 'Close the finger-snap controls',
      'Change review delivery to off', 'Show my profile settings',
      'Which profile switches are enabled?', 'Can you turn off navbar flowers?',
      'Turn the location switch off in the profile page',
    ]) assert.deepEqual(select(text, { surface }), { text: `/breadboard-use ${text}`, automatic: true }, text);
  }
  for (const text of [
    'Explain the startup sound', 'Build a profile settings page',
    'Do not turn off startup sound', 'If I turn off startup sound, what happens?',
    'Turn off startup sound tomorrow', 'Open Windows settings',
    'Write a guide about profile settings', 'The example says "turn off startup sound"',
  ]) assert.equal(select(text).automatic, false, text);
  assert.equal(select('Turn off startup sound', { authenticated: false }).automatic, false);
  assert.equal(select('Turn off startup sound', { surface: 'quartz_ai' }).automatic, false);
  assert.equal(select('Now turn it back on', { priorMessages: [
    { role: 'user', content: 'Turn off startup sound' },
    { role: 'assistant', content: 'Startup sound is off.' },
  ] }).automatic, true);
});
