import assert from 'node:assert/strict';
import test from 'node:test';
import { voiceCapabilitiesContext } from '../src/lib/speech/voice-capabilities.ts';

const inventory = {
  skills: [{ slug: 'files', name: 'Files', description: 'x'.repeat(20_000) }],
  moreSkillSlugs: [], unlistedSkillCount: 0, skillSlugs: ['files', 'research', 'calendar'],
  connections: ['calendar-account', 'documents-account'], divisions: [], specialistCount: 20,
  runtimeAgents: [{id:'researcher',name:'Researcher',command:'/research',launchable:true},
    {id:'manual-worker',name:'Manual worker',command:'/manual-form',launchable:false}],
  workflowsReachable: true,
  workflows: [{id:'weekly-report',name:'Weekly report',active:true},{id:'old-report',name:'Old report',active:false}],
};

test('voice keeps the full discovery index without repeating long procedures', () => {
  const result = voiceCapabilitiesContext(inventory);
  for (const capability of [...inventory.skillSlugs, ...inventory.connections, 'researcher', '/manual-form', 'weekly-report', 'old-report']) {
    assert.ok(result.includes(capability), capability);
  }
  assert.ok(!result.includes('manual-worker'), 'form-only IDs must not be offered to agent_launch');
  assert.match(result, /old-report: Old report \(inactive\)/);
  assert.ok(result.length < inventory.skills[0].description.length / 2);
  assert.match(result, /tool_search.*tool_describe.*tool_call/);
  assert.match(result, /permission controls/);
});

test('request relevance ordering cannot invalidate the voice capability prefix', () => {
  const original = structuredClone(inventory);
  const reversed = { ...inventory, skills: [], skillSlugs: [...inventory.skillSlugs].reverse(),
    connections: [...inventory.connections].reverse(), runtimeAgents: [...inventory.runtimeAgents].reverse(),
    workflows: [...inventory.workflows].reverse() };
  assert.equal(voiceCapabilitiesContext(inventory), voiceCapabilitiesContext(reversed));
  assert.deepEqual(inventory, original, 'rendering must not reorder shared inventory');
});

test('unavailable workflow discovery is reported honestly', () => {
  const result = voiceCapabilitiesContext({...inventory,workflowsReachable:false});
  assert.match(result, /workflow catalog could not be read/);
  assert.doesNotMatch(result, /weekly-report/);
});
