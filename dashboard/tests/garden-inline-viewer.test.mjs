import assert from 'node:assert/strict';
import test from 'node:test';
import { retireCompletedInlineQuestionViewers } from '../src/lib/conversations/garden-inline-question.ts';

test('saved completions retire only their matching inline viewer', () => {
  const makeRun = (sessionId, clientMessageId) => ({ sessionId, clientMessageId, retired: false, viewerController: new AbortController() });
  const failed = makeRun(1, 'failed'), complete = makeRun(1, 'complete');
  const pending = makeRun(1, 'pending'), otherChat = makeRun(2, 'failed');
  const runs = new Map(Object.entries({ failed, complete, pending, otherChat }));
  retireCompletedInlineQuestionViewers(runs, 1, [
    { role: 'assistant', clientMessageId: 'failed', failed: true },
    { role: 'assistant', clientMessageId: 'complete', responseCompletedAt: '2026-10-01T08:39:26.847Z' },
    { role: 'assistant', clientMessageId: 'pending', responseCompletedAt: 'invalid' },
    { role: 'user', clientMessageId: 'pending', failed: true },
  ]);
  assert.deepEqual([...runs.keys()], ['pending', 'otherChat']);
  for (const run of [failed, complete]) {
    assert.equal(run.retired, true);
    assert.equal(run.viewerController.signal.aborted, true);
  }
  for (const run of [pending, otherChat]) assert.equal(run.viewerController.signal.aborted, false);
  const retry = makeRun(1, 'retry');
  runs.set('failed', retry);
  retireCompletedInlineQuestionViewers(runs, 1, [{ role: 'assistant', clientMessageId: 'failed', failed: true }]);
  assert.equal(runs.get('failed'), retry);
  assert.equal(retry.viewerController.signal.aborted, false, 'a stale poll cannot retire a newer retry');
});
