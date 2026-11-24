import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeAgentRoute, withChatContext } from '../src/lib/hermes/runtime-agent-intent.ts';
import { taskFromBoltSlidesCommand, parseBoltSlidesRequest } from '../src/lib/bolt-slides/identity.ts';
import { runtimeAgentById } from '../src/lib/hermes/capability-combinations.ts';

const routed = (request, surface) => runtimeAgentRoute(request, surface)?.agentId ?? null;

test('requests whose deliverable is an agent\'s job route to that agent', () => {
  const cases = {
    'can you create a slide?': 'bolt-slides',
    'Make a presentation about dollar-cost averaging for new investors': 'bolt-slides',
    'build me a pitch deck for my coffee startup': 'bolt-slides',
    'I want a slide deck on the French revolution': 'bolt-slides',
    'please generate slides explaining transformers': 'bolt-slides',
    'could you prepare a short presentation on photosynthesis': 'bolt-slides',
    'convert this into slides': 'bolt-slides',
    'turn it into a presentation': 'bolt-slides',
    "design a slideshow for my sister's wedding": 'bolt-slides',
    'make a PowerPoint about budgeting': 'resource2skill',
    'create a pptx with three slides on owls': 'resource2skill',
    'write a research paper on sparse attention': 'paper-orchestra',
    'create a lesson on the Krebs cycle': 'classroom',
    'teach me linear algebra as a course': 'classroom',
    'compose a song about autumn': 'music-producer',
    'make me a lo-fi beat': 'music-producer',
    'design a circuit that blinks an LED with an ESP32': 'hardware-blueprint',
    'wire up an arduino to a servo': 'hardware-blueprint',
    'post this on LinkedIn tomorrow at 9': 'socials-manager',
    'schedule a tweet on twitter about the launch': 'socials-manager',
    'summarize my emails from today': 'inbox-zero',
    'clean up my inbox': 'inbox-zero',
    'analyze NVDA stock': 'stock-analyst',
    'find me remote jobs in Amsterdam': 'career-ops',
    'tailor my resume to this posting': 'career-ops',
    'download the paper "Attention is all you need"': 'get-doc',
    'fetch arxiv 2401.01234': 'get-doc',
    'summarize the meeting from this morning': 'meeting-notes',
    'what did we decide in the meeting yesterday?': 'meeting-notes',
    'do deep research on solid-state batteries': 'deep-research',
    'quiz me on my biology notes': 'deep-tutor',
    'simulate how gen z would react to this tagline': 'matraix',
    'show me Tokyo on the globe in night vision': 'gods-eye',
    'make a vox-style explainer about inflation': 'vox-director',
  };
  for (const [request, agent] of Object.entries(cases)) assert.equal(routed(request), agent, request);
});

test('naming an agent as the instrument routes to it, for any launchable agent', () => {
  assert.equal(routed('use deer flow to write a report on lithium supply'), 'deer-flow');
  assert.equal(routed('research the EU AI Act with OpenScience'), 'openscience');
  assert.equal(routed('fix the login bug using codex'), 'codex');
  assert.equal(routed('run max research on whether creatine helps memory'), 'max-research');
  assert.equal(routed('Start the Bolt Slides agent on a deck about owls'), 'bolt-slides');
  // Not launchable from a sentence: a route would only open its form.
  assert.equal(routed('use shorts to cut my stream'), null);
  assert.equal(runtimeAgentById('shorts').launchableByModel, false);
  // Terminal-only agents do not route in Garden Chat.
  assert.equal(routed('use agent tars to open my settings', 'dashboard_terminal'), 'agent-tars');
  assert.equal(routed('use agent tars to open my settings', 'garden_chat'), null);
});

test('mentions, questions, refusals, edits, software and pasted text stay ordinary turns', () => {
  for (const request of [
    'how do bolt slides work?',
    'what can I do with codex?',
    'what makes a good presentation?',
    "don't make a slide deck, just explain it",
    'add a slide to my deck',
    'can you show me the slide as an image?',
    'summarize the presentation I gave yesterday',
    'explain this:\n```\ncreate slides for the demo\n```',
    'review the "make a presentation" ticket',
    '/agents:bolt-slides a deck about owls',
    'write an essay about slides in playgrounds',
    'build a presentation layer for the API',
    'build a music app in React',
    'create a class for the parser',
    'find the failing jobs in CI',
    'find the cron jobs that run nightly',
    'create a meeting for tomorrow at 3',
    'send an email to Alex',
    'write a LinkedIn post about my promotion',
    'explain how stocks work',
    'make a meal plan',
    'hi',
    '',
  ]) {
    assert.equal(routed(request), null, request);
  }
});

test('a topic-less request borrows the chat, a topical one does not', () => {
  assert.equal(runtimeAgentRoute('can you create a slide?').needsContext, true);
  assert.equal(runtimeAgentRoute('make slides for this').needsContext, true);
  assert.equal(runtimeAgentRoute('turn it into a presentation').needsContext, true);
  assert.equal(runtimeAgentRoute('make a presentation about owls').needsContext, false);
  assert.equal(runtimeAgentRoute('compose a song about autumn').needsContext, false);
});

test('the command text is a valid request for the agent it names', () => {
  const route = runtimeAgentRoute('can you create a slide?');
  assert.equal(route.agentName, 'Bolt Slides');
  const text = withChatContext(route.commandText, ['Make a dollar-cost averaging post', 'Here is the graphic.']);
  const brief = taskFromBoltSlidesCommand(text);
  assert.ok(brief);
  const request = parseBoltSlidesRequest(brief);
  assert.equal(request.slides, 5, 'one slide asks for the shortest deck');
  assert.match(request.brief, /dollar-cost averaging/);
  assert.doesNotMatch(request.brief, /--slides/);
  assert.equal(parseBoltSlidesRequest(taskFromBoltSlidesCommand(runtimeAgentRoute('make a deck of slides about owls').commandText)).slides, 12);
  for (const request of ['compose a song about autumn', 'use deer flow to write a report on lithium']) {
    const r = runtimeAgentRoute(request);
    assert.ok(r.commandText.startsWith(runtimeAgentById(r.agentId).command + ' '), request);
  }
});
