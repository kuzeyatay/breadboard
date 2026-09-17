import assert from 'node:assert/strict';
import test from 'node:test';
import { assessImageRouting, evaluateImageRouting } from '../scripts/evaluate-image-routing.mjs';

const call = (query, count) => ({ type: 'function', function: { name: 'image_search', arguments: JSON.stringify({ query, count }) } });
test('routing evaluator catches omitted searches, invented subjects and invalid counts', () => {
  const scenario = { search: true, subjects: [['robert downey', 'rdj']] };
  assert.equal(assessImageRouting(scenario, { content: 'He has brown hair.' }).passed, false);
  assert.equal(assessImageRouting(scenario, { tool_calls: [call('Tony Stark artwork', 1)] }).passed, false);
  for (const count of [undefined, 0, 6, 1.5, '1']) {
    assert.equal(assessImageRouting(scenario, { tool_calls: [call('Robert Downey Jr', count)] }).passed, false);
  }
  assert.equal(assessImageRouting(scenario, { tool_calls: [call('Robert Downey Jr portrait', 1)] }).passed, true);
});

test('routing evaluator checks combined counts and subject coverage across tool calls', () => {
  const scenario = { search: true, count: 2, subjects: [['red panda'], ['raccoon']] };
  assert.equal(assessImageRouting(scenario, { tool_calls: [call('red panda', 1), call('raccoon', 1)] }).passed, true);
  assert.equal(assessImageRouting(scenario, { tool_calls: [call('red panda', 3), call('raccoon', 3)] }).passed, false);
});

test('negative decisions require an actual response; provider errors never count as passes', async () => {
  assert.equal(assessImageRouting({ search: false }, undefined).passed, false);
  assert.equal(assessImageRouting({ search: false }, { tool_calls: {} }).passed, false);
  assert.equal(assessImageRouting({ search: false }, { content: {} }).passed, false);
  assert.equal(assessImageRouting({ search: false }, { content: 'Here is a text explanation.' }).passed, true);
  assert.equal(assessImageRouting({ search: false }, { tool_calls: [call('success', 1)] }).passed, false);
  const report = await evaluateImageRouting({ model: 'test-model', tools: [], prompt: 'policy',
    scenarios: [{ id: 'first', search: false, request: 'hello' }, { id: 'second', search: true, request: 'show a cat' }],
    fetcher: async () => new Response('unavailable', { status: 503 }),
  });
  assert.equal(report.passed, 0); assert.equal(report.unavailable, true); assert.equal(report.evaluated, 1);
});

test('routing evaluation sends conversation context and does not execute returned tools', async () => {
  const history = [{ role: 'assistant', content: 'Robert Downey Jr played Tony Stark.' }];
  let requests = 0;
  const report = await evaluateImageRouting({ model: 'test-model', tools: [{ type: 'function', function: { name: 'image_search' } }],
    prompt: 'image policy', scenarios: [{ id: 'follow-up', search: true, request: 'What does he look like?', history, subjects: [['robert downey']] }],
    fetcher: async (url, init) => {
      requests++;
      const payload = JSON.parse(init.body);
      assert.deepEqual(payload.messages.slice(1, -1), history);
      assert.equal(payload.model, 'test-model');
      assert.equal(payload.tools[0].function.name, 'image_search');
      return Response.json({ choices: [{ message: { tool_calls: [call('Robert Downey Jr portrait', 1)] } }] });
    },
  });
  assert.equal(requests, 1); assert.equal(report.passed, 1); assert.equal(report.failed, 0);
});
