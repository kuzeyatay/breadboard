import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mcpFailureGuidance,
  renderConnectionShortlistDirective,
  shortlistConnections,
} from '../src/lib/hermes/connection-routing.ts';

const catalog = [
  { slug: 'github', name: 'GitHub', tools: ['search_issues', 'create_issue', 'get_pull_request', 'list_commits'] },
  { slug: 'linear', name: 'Linear', tools: ['linear_search_issues', 'linear_create_issue'] },
  { slug: 'notion', name: 'Notion', tools: ['notion_search', 'notion_create_page', 'notion_update_page'] },
  { slug: 'gmail', name: 'Gmail', tools: ['GMAIL_SEND_EMAIL', 'GMAIL_FETCH_EMAILS'] },
  { slug: 'filesystem', name: 'Filesystem', tools: ['read_file', 'write_file', 'list_directory'] },
];

test('a request is routed to the connections whose tools fit it, best first', () => {
  assert.equal(shortlistConnections('open an issue on github about the login crash', catalog)[0].slug, 'github');
  assert.equal(shortlistConnections('add a page to my notion workspace about the trip', catalog)[0].slug, 'notion');
  assert.equal(shortlistConnections('fetch my latest emails from gmail', catalog)[0].slug, 'gmail');
  const issues = shortlistConnections('search issues mentioning the memory leak', catalog).map((entry) => entry.slug);
  assert.ok(issues.includes('github') && issues.includes('linear'), `both issue trackers offered: ${issues}`);
  assert.ok(shortlistConnections('open an issue on github about the login crash', catalog)[0].matchingTools.includes('create_issue'));
});

test('chit-chat and unrelated requests route nowhere', () => {
  for (const request of ['hi', 'thanks!', 'explain the french revolution', 'what is 2+2']) {
    assert.deepEqual(shortlistConnections(request, catalog), [], request);
  }
});

test('the directive states the try-next order and is empty without matches', () => {
  assert.equal(renderConnectionShortlistDirective([]), '');
  const text = renderConnectionShortlistDirective(shortlistConnections('search issues mentioning the memory leak', catalog));
  assert.match(text, /^# relevant_connections/);
  assert.match(text, /move to the next one/);
  assert.match(text, /^1\. /m);
});

test('a failed call names its next move: retry transient errors, then the closest stand-in', () => {
  const timeout = mcpFailureGuidance({ failedSlug: 'github', tool: 'search_issues', code: 'mcp_tool_timeout', args: { query: 'leak' }, alternatives: catalog });
  assert.match(timeout, /Retry this call once/);
  assert.match(timeout, /linear \(Linear\)/, 'the other issue tracker is the first stand-in');
  assert.ok(timeout.indexOf('linear') < (timeout.indexOf('notion') === -1 ? Infinity : timeout.indexOf('notion')));
  assert.doesNotMatch(timeout, /github \(GitHub\)/, 'never suggests the connection that just failed');
  assert.match(timeout, /built-in Breadboard tool/);

  const broken = mcpFailureGuidance({ failedSlug: 'notion', tool: 'notion_create_page', code: 'mcp_tool_failed', alternatives: catalog });
  assert.doesNotMatch(broken, /Retry this call once/, 'a real failure is not retried blindly');
  assert.match(broken, /built-in Breadboard tool/);

  assert.equal(mcpFailureGuidance({ failedSlug: 'github', tool: 'x', code: 'mcp_tool_cancelled', alternatives: catalog }), '');
  const alone = mcpFailureGuidance({ failedSlug: 'github', tool: 'search_issues', code: 'mcp_tool_failed', alternatives: [catalog[0]] });
  assert.doesNotMatch(alone, /another connection/);
  assert.match(alone, /built-in Breadboard tool/);
});

test('a call that never reached its server is retried; writes and real failures are not', async () => {
  const { retryTransient } = await import('../src/lib/hermes/connection-routing.ts');
  const transient = (error) => error.message === 'unavailable';
  const flaky = (failures) => { let calls = 0; const fn = async () => { calls += 1; if (calls <= failures) throw new Error('unavailable'); return 'ok'; }; fn.calls = () => calls; return fn; };

  const recovers = flaky(2);
  assert.equal(await retryTransient(recovers, { idempotent: true, isTransient: transient, delaysMs: [1, 1] }), 'ok');
  assert.equal(recovers.calls(), 3);

  const exhausted = flaky(5);
  await assert.rejects(retryTransient(exhausted, { idempotent: true, isTransient: transient, delaysMs: [1, 1] }), /unavailable/);
  assert.equal(exhausted.calls(), 3, 'two retries, then the failure stands');

  const write = flaky(1);
  await assert.rejects(retryTransient(write, { idempotent: false, isTransient: transient, delaysMs: [1, 1] }));
  assert.equal(write.calls(), 1, 'a write is never repeated');

  let real = 0;
  await assert.rejects(retryTransient(async () => { real += 1; throw new Error('bad arguments'); }, { idempotent: true, isTransient: transient, delaysMs: [1, 1] }));
  assert.equal(real, 1, 'a real failure is not retried');
});
