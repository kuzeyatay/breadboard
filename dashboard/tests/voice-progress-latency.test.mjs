import assert from 'node:assert/strict';
import test from 'node:test';
import {createVoiceNarrationQueue,VOICE_PROGRESS_DELAY_MS,VOICE_PROGRESS_INTERVAL_MS} from '../src/lib/speech/voice-conversation.ts';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(t){
  const spoken=[],done=[],idle=[];
  const queue=createVoiceNarrationQueue({startIndex:0,streamAnswers:true,
    speak(item){spoken.push(item);return new Promise(resolve=>done.push(resolve));},
    onIdle:value=>idle.push(value),onError:error=>{throw error;}});
  t.after(()=>queue.cancel());return {queue,spoken,done,idle};
}

test('a generic tool status cannot hold up an already completed short answer',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  const h=harness(t);
  h.queue.update([{role:'user',content:'Check the requested information.'},{role:'assistant',content:''}],true);
  t.mock.timers.tick(4000);
  h.queue.update([{role:'assistant',content:'',progressNotes:['Running command']}],true);
  t.mock.timers.tick(0);
  t.mock.timers.tick(220); // Tool finished quickly; its label carries no result.
  t.mock.timers.tick(1800);
  const answer='I checked the requested information. Here is the complete answer.';
  h.queue.update([{role:'assistant',content:answer,voiceStream:{text:answer,segment:0}}],false);
  assert.deepEqual(h.spoken.map(item=>({kind:item.kind,text:item.text})),[{kind:'answer',text:answer}],
    'first available answer must not wait for a generic status synthesis/playout');
  h.done[0]();await flush();assert.deepEqual(h.idle,[true]);
});

test('generic execution labels are visual-only while useful public work descriptions remain speakable',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  for(const note of ['Running command','Executing a tool…','Calling the tool.','Using tools','Running an operation!']){
    const h=harness(t);
    h.queue.update([{role:'assistant',content:'',progressNotes:[note]}],true);
    t.mock.timers.tick(VOICE_PROGRESS_DELAY_MS+100);
    assert.deepEqual(h.spoken,[],note);h.queue.cancel();
  }
  const h=harness(t);
  h.queue.update([{role:'assistant',content:'',progressNotes:['Checking the model for holes before exporting it.']}],true);
  t.mock.timers.tick(VOICE_PROGRESS_DELAY_MS);
  assert.equal(h.spoken[0]?.text,'Checking the model for holes before exporting it.');
});

test('substantive updates stay occasional and cancellation stops their pending audio',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  const h=harness(t),first='I found the source project and am checking the export.',next='The geometry is valid. I am preparing the download.';
  h.queue.update([{role:'assistant',content:'',progressNotes:[first]}],true);
  t.mock.timers.tick(VOICE_PROGRESS_DELAY_MS);
  h.done[0]();await flush();
  h.queue.update([{role:'assistant',content:'',progressNotes:[first,next]}],true);
  t.mock.timers.tick(VOICE_PROGRESS_INTERVAL_MS-1);
  assert.deepEqual(h.spoken.map(item=>item.text),[first]);
  h.queue.cancel();t.mock.timers.tick(1000);
  assert.deepEqual(h.spoken.map(item=>item.text),[first]);
});
