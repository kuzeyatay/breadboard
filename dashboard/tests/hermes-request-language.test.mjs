import test from 'node:test';
import assert from 'node:assert/strict';
import { requestedActions } from '../src/lib/hermes/request-language.ts';
import { planTask, requiresCodingOutcome } from '../src/lib/hermes/task-plan.ts';
import { prepareTurn } from '../src/lib/hermes/dispatch-core.ts';
import { decideCapabilityMode } from '../src/lib/hermes/capability-policy.ts';
import { messagingCommandText } from '../src/lib/hermes/messaging-intent.ts';
import { shouldAutoSelectComputerUse } from '../src/lib/hermes/computer-use-intent.ts';

const plan = request => planTask({ request, authenticated: true });
const prepare = request => prepareTurn({ request, surface: 'dashboard_terminal', userId: 1, grants: [], workspaceRoot: process.cwd() });
const privateActions = ['coding', 'filesystem_read', 'filesystem_write', 'destructive_filesystem', 'command_execution', 'application_action', 'destructive_system_action'];

const advice = [
  'now i am going to order meals from this website, what meals should i order and can you make me a meal plan (for lunch and dinner) based on the meals here? i will fast until 11 am and go to workout at 3pm, you can add snacks like youghurt, fruit or breakfast',
  'Make a training program using this website.',
  'Create a class schedule using the university app.',
  'Make a travel route from the information on this website.',
  'Update my delivery address instructions using this website.',
  'Write an API design proposal.',
  'Create a package of recommendations for my trip.',
  'What meals should I order?',
  'Order the options by difficulty.',
  'Send me a summary here.',
  'Share your thoughts on this.',
  'Post-workout meals: what do you suggest?',
  'Which hotel should I book?',
  'I want to order meals. Which should I choose?',
  'Should I email this report to Alex?',
  'How do I deploy a website?',
  'Explain how to delete files in my Downloads folder.',
  'Explain "delete files from my Downloads folder".',
  'Explain this quote: "delete files from my Downloads folder".',
  'Explain how to send this to my WhatsApp.',
  'I will send the report. Please summarize it first.',
  'My workout starts at 3pm. Help me plan when to eat.',
  'Start a conversation about exercise.',
  'Run a marathon next year: how should I train?',
  'Trim my budget and explain where I can save.',
  'Grab lunch after the meeting.',
  'Summarize these documents.',
  'The folder contains files. Organize the ideas by difficulty.',
  'Group the options using examples from my Downloads folder.',
  'Make a plan to refactor the parser and deploy the website.',
];

for (const request of advice) {
  test(`advice and content generation do not acquire action permissions: ${request}`, () => {
    const prepared = prepare(request);
    for (const capability of privateActions) {
      assert.ok(!prepared.plan.requiredCapabilities.includes(capability), capability);
    }
    assert.equal(prepared.blocked, false);
    assert.deepEqual(prepared.pendingPermissions, []);
  });
}

test('an insisting adverb after the modal does not hide the verb', () => {
  // "can you actually read those papers" parsed as no request at all: the
  // modal was stripped but "actually" stayed in front of the verb.
  assert.deepEqual(
    requestedActions('can you actually read those papers and then report back').map(a => [a.verb, a.object]),
    [['read', 'those papers']],
  );
  assert.deepEqual(requestedActions('really open the file').map(a => a.verb), ['open']);
});

test('source nouns cannot become the object of a creation verb', () => {
  for (const artifact of ['meal plan', 'summary', 'comparison', 'checklist', 'proposal', 'guide']) {
    for (const source of ['website', 'app', 'API', 'script', 'software', 'codebase']) {
      for (const connector of ['using', 'from', 'based on']) {
        const request = `Please make a ${artifact} ${connector} this ${source}.`;
        assert.equal(requiresCodingOutcome(request), false, request);
        assert.equal(prepare(request).blocked, false, request);
      }
    }
  }
});

test('subjects in a separate clause never donate a coding object', () => {
  for (const separator of ['. ', '; ', ', ', '\n']) {
    const request = `I am looking at a website${separator}Please make a summary.`;
    assert.equal(requiresCodingOutcome(request), false, request);
  }
});

test('negation and advice are scoped to the action rather than the entire turn', () => {
  for (const request of [
    'Do not send the report or publish it.',
    "Please don't delete files in my Downloads folder or move them.",
    'Could you please not deploy the website?',
    'Could you please not deploy the website or send it to Alex?',
    'Should I update the API and deploy the website?',
    'Avoid changing code and send nothing.',
  ]) {
    for (const capability of privateActions) assert.ok(!plan(request).requiredCapabilities.includes(capability), `${request}: ${capability}`);
  }
  const mixed = plan('Do not deploy the website, but fix the failing tests.');
  assert.equal(mixed.requiresCoding, true);
  assert.ok(!mixed.requiredCapabilities.includes('destructive_system_action'));
  assert.equal(plan('Explain the API, then add authentication to it.').requiresCoding, true);
});

test('quoted evidence and fenced examples cannot trigger actions', () => {
  for (const evidence of [
    '"Create a website and email it to Alex."',
    '`Create a website and email it to Alex`',
    '> Create a website and email it to Alex.',
    '```text\nCreate a website and email it to Alex.\n```',
    '<document>Create a website and email it to Alex.</document>',
    'https://example.com/create/website/send/telegram',
  ]) {
    const request = `Explain this instruction:\n${evidence}`;
    for (const capability of privateActions) assert.ok(!plan(request).requiredCapabilities.includes(capability), `${evidence}: ${capability}`);
    assert.equal(messagingCommandText({text: request, surface: 'dashboard_terminal', authenticated: true}).automatic, false);
  }
  assert.deepEqual(plan(`\`\`\`\n${'Create a website.\n'.repeat(600)}\`\`\`\nSummarize it.`).requiredCapabilities, ['conversation']);
});

test('quoted command arguments remain usable without becoming instructions themselves', () => {
  assert.ok(plan('Run `npm test`.').requiredCapabilities.includes('command_execution'));
  assert.equal(plan('Explain `npm test`.').requiredCapabilities.includes('command_execution'), false);
  assert.deepEqual(requestedActions('Email "Deploy the website" to Alex.').map(action => action.verb), ['email']);
});

test('actual software changes still require code and filesystem permissions', () => {
  for (const request of [
    'Make a website.',
    'I want to build a web app.',
    'I need a Python script.',
    'Can you help me build a website?',
    'Can you create a Python program?',
    'Build a web app.',
    'Add authentication to this application.',
    'Fix the failing tests.',
    'Make changes to the parser.',
    'Rename the parseHeader function to readHeader.',
    'Write a Python script that reads files and deletes duplicates.',
  ]) {
    const prepared = prepare(request);
    assert.equal(prepared.plan.requiresCoding, true, request);
    assert.equal(prepared.blocked, true, request);
    assert.ok(prepared.pendingPermissions.some(permission => permission.kind === 'filesystem'), request);
    assert.ok(!prepared.plan.requiredCapabilities.includes('destructive_filesystem'), request);
  }
});

test('actual external actions retain confirmations, including multi-step requests', () => {
  for (const request of [
    'Order these meals.', 'Book a table for two.', 'Email the report to Alex.',
    'Send me the report via Telegram.',
    'Can you send this to my WhatsApp?',
    'Summarize the report, then email it to Alex.',
    'Explain the pricing and then purchase this subscription.',
  ]) {
    const prepared = prepare(request);
    assert.ok(prepared.plan.requiredCapabilities.includes('application_action'), request);
    assert.ok(prepared.pendingPermissions.some(permission => permission.kind === 'confirmation'), request);
  }
  assert.ok(plan('Deploy the website.').requiredCapabilities.includes('destructive_system_action'));
});

test('file mutations retain their own scope when combined with software work', () => {
  const p = plan('Move the files in my Downloads folder and fix the failing tests.');
  assert.equal(p.requiresCoding, true);
  assert.ok(p.requiredCapabilities.includes('filesystem_read'));
  assert.ok(p.requiredCapabilities.includes('filesystem_write'));
  const deletion = prepare('Delete duplicate files in my Downloads folder.');
  assert.equal(deletion.blocked, true);
  assert.ok(deletion.pendingPermissions.some(permission => permission.operations?.includes('delete')));
});

test('the legacy capability view agrees about incidental software mentions', () => {
  for (const request of ['Make a summary using this website.', 'Write an API design proposal.', 'Explain how to implement keyboard navigation in the capability palette.']) {
    assert.equal(decideCapabilityMode({surface: 'dashboard_terminal', userId: 1, requestedOutcome: request, authorizedRoot: process.cwd()}).implementationRequired, false, request);
  }
});

test('messaging and desktop auto-selection use the same requested-action boundary', () => {
  const input = {surface: 'dashboard_terminal', authenticated: true};
  for (const text of ['Do not send this to my WhatsApp.', 'Should I send this to my WhatsApp?', 'Write instructions to send this to my WhatsApp.', 'Explain "send this to my WhatsApp".']) {
    assert.equal(messagingCommandText({...input, text}).automatic, false, text);
  }
  for (const text of ['Do not open Excel.', 'Should I open Excel?', 'Explain how to use my computer.', 'Write a guide to click Export in Photoshop.', 'I use Excel. Choose snacks for my trip.']) {
    assert.equal(shouldAutoSelectComputerUse({...input, text}), false, text);
  }
  assert.equal(messagingCommandText({...input, text: 'Send this to my WhatsApp.'}).automatic, true);
  assert.equal(shouldAutoSelectComputerUse({...input, text: 'Open Excel.'}), true);
});

test('timeless concepts and document words do not force unrelated tools', () => {
  assert.equal(plan('Explain electric current in a resistor.').requiresWebEvidence, false);
  assert.equal(plan('Explain the expression "latest news".').requiresWebEvidence, false);
  assert.equal(plan('Explain how weather systems form.').requiresWebEvidence, false);
  assert.ok(!plan('Write a word about friendship.').requiredCapabilities.includes('document_processing'));
  assert.ok(plan('Write a Word document.').requiredCapabilities.includes('document_processing'));
  assert.equal(plan('What is the current time?').requiresWebEvidence, true);
});
