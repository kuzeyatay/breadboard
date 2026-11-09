import test from 'node:test';
import assert from 'node:assert/strict';
import {requestLiveSpeech} from '../src/lib/speech/live-output.ts';

test('an unacknowledged reading stops after five seconds even when transport ignores cancellation', async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let signal,acknowledge,calls=0;
 const pending=requestLiveSpeech(s=>{signal=s;calls++;return new Promise(resolve=>acknowledge=resolve);},new AbortController().signal);
 const failed=assert.rejects(pending,/voice service did not respond/);
 t.mock.timers.tick(4999);assert.equal(signal.aborted,false);
 t.mock.timers.tick(1);await failed;
 assert.equal(signal.aborted,true);acknowledge({ok:true});await Promise.resolve();assert.equal(calls,1,'an uncertain command is never repeated');
});
test('interruption cancels a pending command immediately',async()=>{
 const stop=new AbortController();let signal;
 const request=requestLiveSpeech(s=>{signal=s;return new Promise(()=>{});},stop.signal);
 stop.abort();await assert.rejects(request,{name:'AbortError'});assert.equal(signal.aborted,true);
});
test('an acknowledged reading clears the command timer without limiting the spoken paragraph',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let signal;
 assert.deepEqual(await requestLiveSpeech(async s=>{signal=s;return{ok:true};},new AbortController().signal),{ok:true});
 t.mock.timers.tick(120000);assert.equal(signal.aborted,false);
});
test('a cancelled turn cannot submit a reading later',async()=>{
 const stop=new AbortController();stop.abort();let calls=0;
 await assert.rejects(requestLiveSpeech(async()=>calls++,stop.signal),{name:'AbortError'});assert.equal(calls,0);
});
