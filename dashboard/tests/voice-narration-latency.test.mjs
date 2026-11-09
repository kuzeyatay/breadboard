import assert from 'node:assert/strict';
import test from 'node:test';
import {createVoiceNarrationQueue} from '../src/lib/speech/voice-conversation.ts';

function harness(t){
 const spoken=[],idle=[],complete=[];
 const queue=createVoiceNarrationQueue({startIndex:0,streamAnswers:true,
  speak(item){spoken.push(item);return new Promise(resolve=>complete.push(resolve));},
  onIdle:done=>idle.push(done),onError:error=>{throw error;}});
 t.after(()=>queue.cancel());return {queue,spoken,idle,complete};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('a stable answer speaks its short final sentence while run cleanup remains busy',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const h=harness(t),text='The revised plan is ready. You can start.';
 h.queue.update([{role:'assistant',content:'',voiceStream:{text,segment:0}}],true);
 assert.equal(h.spoken.length,0);
 h.queue.update([{role:'assistant',content:text,voiceStream:{text,segment:0}}],true);
 assert.deepEqual(h.spoken.map(item=>item.text),[text]);
 h.complete[0]();await flush();assert.deepEqual(h.idle,[false],'the host still owns the run');
 h.queue.update([{role:'assistant',content:text,voiceStream:{text,segment:0}}],false);
 assert.deepEqual(h.spoken.map(item=>item.text).filter(Boolean),[text],'the final event never replays speech');
 h.complete[1]();await flush();assert.deepEqual(h.idle,[false,true]);
});

test('a stable answer appends only its unread words after speech has already started',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const h=harness(t),first='The first part is complete. ',tail='Here is the next part. All done.';
 h.queue.update([{role:'assistant',content:'',voiceStream:{text:first,segment:0}}],true);
 t.mock.timers.tick(360);assert.deepEqual(h.spoken.map(item=>item.text),[first.trim()]);
 h.queue.update([{role:'assistant',content:first+tail,voiceStream:{text:first+tail,segment:0}}],true);
 h.complete[0]();await flush();assert.equal(h.spoken[1].text,tail);
 h.queue.update([{role:'assistant',content:first+tail}],false);
 h.complete[1]();await flush();h.complete[2]();await flush();
 assert.deepEqual(h.spoken.map(item=>item.text).filter(Boolean),[first.trim(),tail]);
 assert.deepEqual(h.idle,[true]);
});

test('provisional tool narration does not release an unfinished trailing word',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const h=harness(t),first='I will check the connected sources. ';
 h.queue.update([{role:'assistant',content:'',voiceStream:{text:first+'Unfin',segment:0}}],true);
 t.mock.timers.tick(360);assert.deepEqual(h.spoken.map(item=>item.text),[first.trim()]);
});

test('interrupting a queued stable answer prevents its tail from speaking',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const h=harness(t),first='The opening part of the explanation. ';
 h.queue.update([{role:'assistant',content:'',voiceStream:{text:first,segment:0}}],true);
 t.mock.timers.tick(360);
 h.queue.update([{role:'assistant',content:first+'This tail must be cancelled.',voiceStream:{text:first,segment:0}}],true);
 h.queue.cancel();h.complete[0]();await flush();t.mock.timers.tick(1000);
 assert.deepEqual(h.spoken.map(item=>item.text),[first.trim()]);assert.deepEqual(h.idle,[]);
});


test('an actively growing short answer stays in one reading without waiting past its bound',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
 const h=harness(t),first='The dough contains living yeast. ',second='It releases gas as it feeds. ',tail='Cover it while it rises.';
 const update=text=>h.queue.update([{role:'assistant',content:'',voiceStream:{text,segment:0}}],true);
 update(first+'It');t.mock.timers.tick(120);update(first+'It releases gas');
 t.mock.timers.tick(120);update(first+second+'Cover');
 assert.equal(h.spoken.length,0,'ongoing words should keep the nearby sentences connected');
 t.mock.timers.tick(180);
 const text=first+second+tail;
 h.queue.update([{role:'assistant',content:text,voiceStream:{text,segment:0}}],true);
 assert.deepEqual(h.spoken.map(item=>item.text),[text]);
 h.queue.update([{role:'assistant',content:text}],false);
 h.complete[0]();await flush();h.complete[1]();await flush();
 assert.deepEqual(h.spoken.map(item=>item.text).filter(Boolean),[text],'every sentence is read exactly once');
});

test('continuous partial tokens cannot postpone the first complete sentence beyond 600ms',t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
 const h=harness(t),first='Here is the completed opening sentence. ';
 for(let i=0;i<6;i++){
  h.queue.update([{role:'assistant',content:'',voiceStream:{text:first+'unfinished'.slice(0,i+1),segment:0}}],true);
  t.mock.timers.tick(100);
 }
 assert.deepEqual(h.spoken.map(item=>item.text),[first.trim()]);
});

test('duplicate stream refreshes do not delay the first sentence',t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
 const h=harness(t),text='This answer starts without a second sentence. ';
 const messages=[{role:'assistant',content:'',voiceStream:{text,segment:0}}];
 h.queue.update(messages,true);t.mock.timers.tick(150);h.queue.update(messages,true);
 t.mock.timers.tick(210);assert.deepEqual(h.spoken.map(item=>item.text),[text.trim()]);
});

test('interruption cancels a coalescing stream and all of its unsaid sentences',t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
 const h=harness(t),first='This sentence is waiting to be read. ';
 h.queue.update([{role:'assistant',content:'',voiceStream:{text:first,segment:0}}],true);
 t.mock.timers.tick(100);
 h.queue.update([{role:'assistant',content:'',voiceStream:{text:first+'The next',segment:0}}],true);
 h.queue.cancel();t.mock.timers.tick(1000);
 assert.deepEqual(h.spoken,[]);assert.deepEqual(h.idle,[]);
});
