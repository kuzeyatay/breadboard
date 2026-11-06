import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
register('./teach-support/server-only-stub.mjs', import.meta.url);
const { breadboardUseCommandText } = await import('../src/lib/hermes/breadboard-use-intent.ts');
const { listFirstPartySkills } = await import('../src/lib/hermes/skills.ts');
const { allowedToolsForSurface } = await import('../src/lib/hermes/tool-scopes.ts');
const select = (text, extra = {}) => breadboardUseCommandText({ text, surface: 'dashboard_terminal', authenticated: true, ...extra });

test('explicit screen recording requests discover the tool without treating coding or discussion as capture', () => {
  for (const text of ['Record my screen for 15 seconds', 'Can you capture a video of this window?', 'Stop the screen recording', 'Save the desktop recording']) {
    assert.equal(select(text).automatic, true, text);
  }
  for (const text of ['How do I record my screen?', 'Add screen recording support', 'Make Breadboard able to record my screen', 'Do not record my screen', 'Tomorrow record my screen', 'The example says "record my screen"']) {
    assert.equal(select(text).automatic, false, text);
  }
  assert.equal(select('Record my screen', { authenticated: false }).automatic, false);
  assert.equal(select('Record my screen', { surface: 'quartz_ai' }).automatic, false);
});

test('signed-in site work selects live browser controls without requiring the word browser', () => {
  for (const surface of ['dashboard_terminal', 'garden_chat']) {
    for (const text of [
      'can you use my whatsapp to send messages in my name',
      'Send Alice "See you at six" using my WhatsApp',
      'Read my Instagram messages', 'Scroll TikTok and save three cooking posts',
      'Bookmark this post on X', 'Open x.com and check my feed',
      'Use the site I am logged in to and save the first post',
      'Check my inbox on this website', 'Browse my LinkedIn feed',
      'Visit https://portal.example.test and fill the project search field',
      'Open tasks.example.org and click the saved projects tab',
      'Go to https://shop.example.net and save this item to my wishlist',
      'Use the university website I am signed in to and submit the form',
      'Scroll the feed in this web app',
    ]) assert.deepEqual(select(text, { surface }), { text: `/breadboard-use ${text}`, automatic: true }, text);
  }
  for (const text of [
    'Send this to my WhatsApp', 'Send me this on Telegram', 'WhatsApp me the summary',
    'Explain how WhatsApp Web works', 'Build Instagram browser automation',
    'Draft a message to Alice on WhatsApp', 'Do not use my WhatsApp',
    'The post says "save this on Instagram"', 'Search the web for Instagram statistics',
    'How do I save posts on TikTok?', 'Read variable x',
    'Summarize https://docs.example.org/guide', 'Read https://news.example.net/story',
  ]) assert.equal(select(text).automatic, false, text);
  assert.equal(select('Open Instagram', { authenticated: false }).automatic, false);
  assert.equal(select('Open Instagram', { surface: 'quartz_ai' }).automatic, false);
  assert.equal(select('Now save that post', { priorMessages: [
    { role: 'user', content: 'Read my Instagram feed' },
    { role: 'assistant', content: 'The first post is a recipe.' },
  ] }).automatic, true);
  assert.equal(select('Send this to my WhatsApp', { priorMessages: [
    { role: 'user', content: 'Read my Instagram feed' },
  ] }).automatic, false);
});

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

test('reference destinations do not turn lesson content into app-control requests', () => {
  const lesson = 'Use the attached material to continue this lesson.\n\nA system changes an input into an output. See [the previous lesson](/garden/signals-and-systems?note=lti).';
  for (const surface of ['dashboard_terminal', 'garden_chat']) {
    for (const text of [lesson,
      'Use these notes: [linear systems](/garden/signals-and-systems/linear_(time_invariant)).',
      'Use these notes: [linear systems][source].\n\n[source]: /garden/signals-and-systems',
    ]) assert.deepEqual(select(text, { surface }), { text, automatic: false });
    for (const text of ['Open [Garden](/garden/ec-2)',
      'Open [the course site](https://courses.example.org) and click the lessons tab',
      'Open Garden and show [signal processing](/garden/signals-and-systems/edge)',
    ]) assert.deepEqual(select(text, { surface }), { text: `/breadboard-use ${text}`, automatic: true });
  }
  assert.equal(select('Now select an example', {
    priorMessages: [{ role: 'user', content: lesson }],
  }).automatic, false);
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
