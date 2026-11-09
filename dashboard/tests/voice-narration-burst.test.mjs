import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {createVoiceNarrationQueue} from '../src/lib/speech/voice-conversation.ts';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/voice-narration-burst.json',import.meta.url),'utf8'));
test('a recorded token burst retains all three sentences in one bounded first reading',t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
 const spoken=[];
 const queue=createVoiceNarrationQueue({startIndex:0,streamAnswers:true,speak(item){spoken.push({text:item.text,atMs:Date.now()});return new Promise(()=>{});},onIdle(){},onError:error=>{throw error;}});
 t.after(()=>queue.cancel());
 for(const event of fixture.stream){
  t.mock.timers.tick(event.atMs-Date.now());
  queue.update([{role:'assistant',content:'',voiceStream:{text:fixture.answer.slice(0,event.length),segment:0}}],true);
 }
 t.mock.timers.tick(fixture.completeMs-Date.now());
 queue.update([{role:'assistant',content:fixture.answer,voiceStream:{text:fixture.answer,segment:0}}],false);
 assert.deepEqual(spoken,[{text:fixture.answer,atMs:fixture.completeMs}]);
 assert.ok(spoken[0].atMs-fixture.stream.find(event=>event.length>fixture.answer.indexOf('. ')+1).atMs<=600,'the original opening bound remains in force');
});
