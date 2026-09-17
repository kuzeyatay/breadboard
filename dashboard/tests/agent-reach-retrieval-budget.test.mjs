import assert from 'node:assert/strict';
import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {withinRetrievalBudget} from '../src/lib/agent-reach/retrieval-budget.ts';

test('a slow retrieval ends while preserving the parent and collected findings for writing', async () => {
  const parent=new AbortController();
  const findings=[];
  const result=await withinRetrievalBudget(async signal=>{
    findings.push('A source actually retrieved');
    await delay(1000,undefined,{signal});
    findings.push('Must not be invented after timeout');
    return true;
  },parent.signal,20);
  assert.equal(result,null);
  assert.equal(parent.signal.aborted,false);
  assert.deepEqual(findings,['A source actually retrieved']);
});

test('user cancellation and real retrieval errors are not turned into a budget completion', async () => {
  const parent=new AbortController();
  const reason=new Error('Stopped by user');
  const result=withinRetrievalBudget(async signal=>{await delay(1000,undefined,{signal});},parent.signal,200);
  parent.abort(reason);
  await assert.rejects(result,error=>error===reason);
  await assert.rejects(withinRetrievalBudget(async()=>{throw new Error('Source failed');},new AbortController().signal,200),/Source failed/);
});
