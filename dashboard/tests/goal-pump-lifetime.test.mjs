import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireDetachedEventPump, waitForDetachedEventPumps } from '../src/lib/hermes/detached-event-pump.ts';

test('finite worker remains alive across the idle gap and joins the next goal turn', async () => {
  const goals = globalThis.__breadboardGoalContinuationPromises ??= new Map();
  let releaseContinuation;
  let finishNextTurn;
  let joined = false;
  const gate = new Promise(resolve => { releaseContinuation = resolve; });
  const nextTurn = new Promise(resolve => { finishNextTurn = resolve; });
  acquireDetachedEventPump('goal-lifetime-first', async () => {
    const continuation = gate.then(() => {
      acquireDetachedEventPump('goal-lifetime-next', () => nextTurn);
    }).finally(() => goals.delete(991));
    goals.set(991, continuation);
  });
  const joinedAll = waitForDetachedEventPumps().then(() => { joined = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(joined, false);
  releaseContinuation();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(joined, false);
  finishNextTurn();
  await joinedAll;
  assert.equal(joined, true);
});

test('finite worker waits across ordinary task recovery backoff', async () => {
  const recoveries=globalThis.__breadboardTaskRecoveryPromises ??= new Map();
  let release,finished=false;
  const next=new Promise(resolve=>{release=resolve;}).finally(()=>recoveries.delete('task-test'));
  recoveries.set('task-test',next);
  const wait=waitForDetachedEventPumps().then(()=>{finished=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(finished,false);
  release(); await wait;
  assert.equal(finished,true);
});
