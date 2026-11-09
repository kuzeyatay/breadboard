import assert from 'node:assert/strict';
import test from 'node:test';
import {createVoiceNarrationQueue, speakableText} from '../src/lib/speech/voice-conversation.ts';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(t){
  const spoken=[],finished=[],idle=[],errors=[];
  const queue=createVoiceNarrationQueue({startIndex:0,streamAnswers:true,
    speak(item,signal){spoken.push({...item,signal});return new Promise(resolve=>finished.push(resolve));},
    onIdle:done=>idle.push(done),onError:error=>errors.push(String(error))});
  t.after(()=>queue.cancel());
  const complete=async()=>{for(let i=0;i<finished.length;i++){finished[i]();await flush();}};
  const text=async()=>Promise.all(spoken.map(item=>speakableText(item.text))).then(parts=>parts.filter(Boolean).join(' '));
  return {queue,spoken,finished,idle,errors,complete,text};
}
const row=(content,stream,segment=0)=>({role:'assistant',content,...(stream===undefined?{}:{voiceStream:{text:stream,segment}})});

test('recorded tool-answer shape keeps every sentence after leading stream newlines disappear',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  const h=harness(t);
  h.queue.update([{...row('',''),progressNotes:['Checking the forecast.']}],true);
  t.mock.timers.tick(1500);
  const prose='Tomorrow in Delft, the forecast is **foggy**, with temperatures around **6–10°C**. Rain isn’t listed, so an umbrella doesn’t look necessary based on this forecast.';
  const stream='\n\n'+prose;
  // These are the observed accumulated delta lengths, including two leading
  // newlines. The final provider payload trims them and appends its display.
  for(const n of [10,13,19,20,24,33,36,39,42,44,47,52,65,72,75,76,77,79,81,83,84,89,93,95,102,103,106,109,118,124,126,131,141,147,150,155,164,165]){
    h.queue.update([row('',stream.slice(0,n))],true);
    t.mock.timers.tick(10);
  }
  const canonical=prose+'\n\n```weather-results\n{"location":"Delft"}\n```';
  h.queue.update([row(canonical,stream)],true);
  assert.equal(h.queue.update([row(canonical)],false),true);
  await h.complete();
  assert.equal(await h.text(),'Checking the forecast. '+await speakableText(prose));
  assert.deepEqual(h.idle,[true]);assert.deepEqual(h.errors,[]);
});

test('a played prefix survives whitespace trimming and soft line wrapping',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness(t),first='The first part is ready. ',tail='The next part is complete. All done.';
  h.queue.update([row('','\n\t'+first)],true);t.mock.timers.tick(240);
  assert.equal(h.spoken.length,1);
  const canonical='The first\npart is ready.\n\n'+tail;
  h.queue.update([row(canonical,'\n\t'+first+tail)],true);
  h.queue.update([row(canonical)],false);
  await h.complete();
  assert.equal(await h.text(),first+tail);
  assert.deepEqual(h.idle,[true]);
});

test('stable normalized tail starts while the host is still cleaning up',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness(t),first='The first result has arrived. ',tail='Here is the final detail.';
  h.queue.update([row('','\n\n'+first)],true);t.mock.timers.tick(240);
  h.queue.update([row(first+tail,'\n\n'+first+tail)],true);
  h.finished[0]();await flush();
  assert.equal(h.spoken[1]?.text,tail,'do not wait for busy=false to read a stable tail');
});

test('cosmetic emphasis changes neither replay a sentence nor hide the ending',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness(t),first='Your **finished model** is ready. ',tail='You can download both files.';
  h.queue.update([row('',first)],true);t.mock.timers.tick(240);
  const canonical='Your finished model is ready. '+tail;
  h.queue.update([row(canonical)],false);await h.complete();
  assert.equal(await h.text(),canonical);
});

test('worker hand-back finishes an earlier normalized tail before the next public row',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness(t),first='The model has been created. ',tail='The files passed validation.';
  h.queue.update([row('','\n\n'+first,2)],true);t.mock.timers.tick(240);
  const earlier=row(first+tail),later=row('The exported files are attached.');
  h.queue.update([earlier,later],true);
  h.queue.update([earlier,later],false);await h.complete();
  assert.equal(await h.text(),first+tail+' '+later.content);
});

for(const [before,after] of [
  ['There are thirteen matching records. ','There are thirty matching records. I checked the final count.'],
  ['The export is ready to print. ','The export is not ready to print. Its validation failed.'],
  ['The filename is input_data.csv. ','The filename is inputdata.csv. Use that exact name.'],
  ['The expression is `a_b`. ','The expression is `ab`. The subscript was incorrect.'],
]) test('a meaningful final rewrite is explicitly corrected: '+before,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness(t);
  h.queue.update([row('',before)],true);t.mock.timers.tick(240);
  h.queue.update([row(after)],false);await h.complete();
  assert.equal(h.spoken[1].text,'Correction: '+after);
  assert.equal(await h.text(),await speakableText(before)+' '+await speakableText('Correction: '+after));
  assert.deepEqual(h.idle,[true]);
});

test('interruption discards every recovered tail and ignores a late final update',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness(t),first='This is the opening sentence. ',tail='This sentence should never play.';
  h.queue.update([row('','\n\n'+first)],true);t.mock.timers.tick(240);
  h.queue.update([row(first+tail,'\n\n'+first+tail)],true);
  h.queue.cancel();assert.equal(h.spoken[0].signal.aborted,true);
  h.queue.update([row(first+tail)],false);await h.complete();
  assert.equal(await h.text(),first.trim());assert.deepEqual(h.idle,[]);
});

test('an intentionally repeated sentence in the unread tail is not deduplicated',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness(t),first='Repeat this instruction carefully. ';
  h.queue.update([row('','\n'+first)],true);t.mock.timers.tick(240);
  const final=first+first+'Then continue.';
  h.queue.update([row(final)],false);await h.complete();
  assert.equal(await h.text(),final);
});
