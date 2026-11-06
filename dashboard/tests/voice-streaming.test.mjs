import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const root=new URL('../src/',import.meta.url);
const source=fs.readFileSync(new URL('lib/speech/voice-conversation.ts',root),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const exports={};
new Function('exports','require',compiled)(exports,()=>({responseTextForSpeech:async text=>text}));
const {createVoiceNarrationQueue}=exports;
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('public voice sentences start before final text, then cross tool boundaries without replay',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const spoken=[];
  const queue=createVoiceNarrationQueue({startIndex:0,streamAnswers:true,speak:async item=>spoken.push(item),onIdle:()=>{},onError:error=>{throw error;}});
  try {
    const intro="I'll check the current forecast for you. ";
    queue.update([{role:'assistant',content:'',voiceStream:{text:intro,segment:0}}],true);
    t.mock.timers.tick(exports.VOICE_ANSWER_COALESCE_MS);
    await tick();
    assert.equal(spoken.length,1);
    assert.equal(spoken[0].text,intro.trim());
    assert.equal(spoken[0].final,false);
    queue.update([{role:'assistant',content:'',progressNotes:[intro],voiceStream:{text:intro,segment:0}}],true);
    await tick();
    assert.equal(spoken.length,1,'classifying a spoken segment as progress does not speak it again');
    const answer='Rain is expected in the afternoon. ';
    queue.update([{role:'assistant',content:'',progressNotes:[intro],voiceStream:{text:answer,segment:1}}],true);
    t.mock.timers.tick(exports.VOICE_ANSWER_COALESCE_MS);
    await tick();
    assert.equal(spoken.length,2);
    assert.equal(spoken[1].text,answer.trim());
    // The canonical API refresh deliberately has no ephemeral voice fields.
    queue.update([{role:'assistant',content:answer+'Take an umbrella.',progressNotes:[intro]}],false);
    await tick();
    assert.equal(spoken.length,3);
    assert.equal(spoken[2].text,'Take an umbrella.');
    assert.equal(spoken[2].final,undefined);
  } finally {queue.cancel();}
});

test('interrupting the voice stream aborts the playing phrase and discards queued and late words',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const spoken=[];let signal;
  const queue=createVoiceNarrationQueue({startIndex:0,streamAnswers:true,speak:async(item,s)=>{spoken.push(item);signal=s;await new Promise(resolve=>s.addEventListener('abort',resolve,{once:true}));},onIdle:()=>{},onError:error=>{throw error;}});
  const text='Here is the first sentence of the story. Here is a second sentence that must never be played. ';
  queue.update([{role:'assistant',content:'',voiceStream:{text,segment:0}}],true);
  t.mock.timers.tick(exports.VOICE_ANSWER_COALESCE_MS);
  assert.equal(spoken.length,1);
  queue.cancel();
  assert.equal(signal.aborted,true);
  queue.update([{role:'assistant',content:text+'The ending.',voiceStream:{text,segment:0}}],false);
  await tick();
  assert.equal(spoken.length,1);
});

test('the API emits a speech-only channel for an active voice run; stopped and typed turns cannot emit it',()=>{
  const text=fs.readFileSync(new URL('lib/hermes/event-stream.ts',root),'utf8');
  const start=text.indexOf('          if (event.type === "assistant.delta")');
  const end=text.indexOf('          } else if (event.type === "assistant.segment")',start);
  assert.ok(start>=0&&end>start);
  const block=text.slice(start,end)+'          }';
  const code=ts.transpileModule(block,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  function run(voice,status){
    const emitted=[];
    new Function('event','parseRuntimeRunDispatch','getRuntimeRun','emit',`
      let assistantMessageId,assistantText='',sawTurnOutput=false,forwardEvent=true;
      const streamRun={id:'test'};const narrationSegments=[];
      for(const once of [0]){${code}}
      return {assistantText,forwardEvent};
    `)({type:'assistant.delta',payload:{text:'A public sentence. '},messageId:'m'},()=>({voice}),()=>({status}),event=>emitted.push(event));
    return emitted;
  }
  assert.equal(run(true,'active')[0].type,'assistant.voice.delta');
  assert.equal(run(true,'cancelled').length,0);
  assert.equal(run(false,'active').length,0);
});

test('the client speech channel leaves the normal response text stable',()=>{
  const text=fs.readFileSync(new URL('app/components/hermes/use-agent-session.ts',root),'utf8');
  const start=text.indexOf('            case "assistant.voice.delta":');
  const end=text.indexOf('            case "assistant.delta":',start);
  const code=ts.transpileModule('switch(event.type){'+text.slice(start,end)+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  let committed;
  const result=new Function('event','payload','commit',`let assistant={content:'Stable previous text'};${code};return assistant;`)({type:'assistant.voice.delta'},{text:'Spoken now. ',segment:2},value=>{committed=value;});
  assert.equal(result.content,'Stable previous text');
  assert.deepEqual(committed.voiceStream,{text:'Spoken now. ',segment:2});
});

