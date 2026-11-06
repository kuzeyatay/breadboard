import assert from 'node:assert/strict';
import test from 'node:test';
import { composerMode, toggleComposerMode } from '../src/lib/composer-mode.ts';
import { listFirstPartySkills } from '../src/lib/hermes/skills.ts';
import { resolveCommandMessage } from '../src/lib/hermes/commands.ts';

test('mode switches preserve the draft and other leading capabilities', () => {
  const original = '/office /reference:123 Build a report\nKeep this formatting.';
  const goal = toggleComposerMode(original, 'goal');
  assert.equal(composerMode(goal), 'goal');
  const plan = toggleComposerMode(goal, 'plan-mode');
  assert.equal(plan, `/plan-mode ${original}`);
  assert.equal(toggleComposerMode(plan, 'plan-mode'), original);
  assert.equal(toggleComposerMode('', 'goal'), '/goal ');
  assert.equal(composerMode('Explain /goal in a sentence'), null);
  assert.equal(toggleComposerMode('Explain /goal in a sentence', 'plan-mode'), '/plan-mode Explain /goal in a sentence');
});

test('planning is a separate, available skill on chat surfaces', () => {
  for (const surface of ['dashboard_terminal', 'garden_chat']) {
    const skill = listFirstPartySkills(surface, []).find((entry) => entry.slug === 'plan-mode');
    assert.ok(skill);
    assert.equal(skill.classification, 'eligible_general');
    assert.equal(skill.availability, 'ready', skill.unavailableReasons.join('; '));
    assert.match(skill.instructions, /Do not execute the plan/);
  }
});

test('menu modes resolve into actual runtime guidance with the user request intact', async () => {
  for (const mode of ['goal', 'plan-mode']) {
    const result = await resolveCommandMessage(null, toggleComposerMode('Design my garden', mode));
    assert.ok(result.invocations.some((entry) => entry.kind === 'skill' && entry.slug === mode));
    assert.equal(result.userText, 'Design my garden');
    assert.match(result.text, mode === 'goal' ? /create_goal/ : /Do not execute the plan/);
  }
});
