import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceNarrationQueue,VOICE_PROGRESS_DELAY_MS,VOICE_PROGRESS_INTERVAL_MS} from '../src/lib/speech/voice-conversation.ts';

function harness(t) {
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  const spoken=[];
  const queue=createVoiceNarrationQueue({startIndex:0,speak:async item=>{spoken.push(item);},onIdle(){},onError(error){throw error;}});
  t.after(()=>queue.cancel());
  return {queue,spoken};
}

test('voice reads one brief sentence from a public progress paragraph',t=>{
  const {queue,spoken}=harness(t);
  queue.update([{role:'assistant',content:'',progressNotes:["I'm checking the current forecast. Then I will compare the hours and explain the best time to leave."]}],true);
  t.mock.timers.tick(VOICE_PROGRESS_DELAY_MS);
  assert.deepEqual(spoken.map(item=>item.text),["I'm checking the current forecast."]);
});

test('a long single progress sentence cannot hold the answer behind a monologue',t=>{
  const {queue,spoken}=harness(t);
  const note='I am checking the current forecasts across each requested day and comparing precipitation, wind speed, temperatures, travel conditions, and timing so you can choose the best time to leave.';
  queue.update([{role:'assistant',content:'',progressNotes:[note]}],true);
  t.mock.timers.tick(VOICE_PROGRESS_DELAY_MS);
  assert.deepEqual(spoken,[]);
  queue.update([{role:'assistant',content:'Leave after lunch.',progressNotes:[note]}],false);
  assert.deepEqual(spoken.map(item=>item.text),['Leave after lunch.']);
});

test('revised public planning paragraphs do not repeat the sentence already spoken',async t=>{
  const {queue,spoken}=harness(t);
  const message={role:'assistant',content:'',progressNotes:["I'm checking the source. Then I will compare the figures."]};
  queue.update([message],true);t.mock.timers.tick(VOICE_PROGRESS_DELAY_MS);await Promise.resolve();await Promise.resolve();
  message.progressNotes.push("I'm checking the source. Then I will explain the difference.");
  queue.update([message],true);t.mock.timers.tick(VOICE_PROGRESS_INTERVAL_MS);await Promise.resolve();
  assert.deepEqual(spoken.map(item=>item.text),["I'm checking the source."]);
});

test('fast answers bypass pending progress and private reasoning is never narrated',t=>{
  const {queue,spoken}=harness(t);
  const message={role:'assistant',content:'',reasoning:'Private reasoning must not be read.',progressNotes:['I am checking the result.']};
  queue.update([message],true);
  message.content='The answer is seven.';queue.update([message],false);
  t.mock.timers.tick(30_000);
  assert.deepEqual(spoken.map(item=>item.text),['The answer is seven.']);
});
