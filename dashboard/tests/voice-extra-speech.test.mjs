import test from 'node:test';
import assert from 'node:assert/strict';
import {createScriptGuard} from '../src/lib/speech/script-guard.ts';

for (const [script,reading] of [
  ['twenty eight','Twenty eight thirty '],
  ['The meeting is tomorrow.','The meeting is tomorrow. Monday '],
  ['Ready.','Ready. Ready '],
]) test('the first extra word after a finished script is rejected: '+script,()=>{
  const guard=createScriptGuard(script,{lookahead:1,tolerance:3});
  guard.feed(reading);
  assert.equal(guard.complete,true,'the intended answer has been reached');
  assert.equal(guard.diverged,true,'do not wait for two more invented words');
  assert.equal(guard.resumeAt,script.length,'do not replay an already spoken answer');
});

test('the final scripted word can finish streaming before extra speech is judged',()=>{
  const guard=createScriptGuard('The destination is Wellington.');
  guard.feed('The destination is Welling');assert.equal(guard.complete,false);assert.equal(guard.diverged,false);
  guard.feed('The destination is Wellington.');assert.equal(guard.complete,true);assert.equal(guard.diverged,false);
  guard.feed('The destination is Wellington. Syd');assert.equal(guard.diverged,false,'a growing token is not a confirmed extra word');
  guard.feed('The destination is Wellington. Sydney ');assert.equal(guard.diverged,true);
});
