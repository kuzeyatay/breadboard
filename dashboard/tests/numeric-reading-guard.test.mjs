import assert from 'node:assert/strict';
import test from 'node:test';
import {createNumericReadingGuard} from '../src/lib/speech/numeric-reading-guard.ts';

for(const [script,wrong] of [
  ['twenty one','Unit '], ['twenty one','twenty two '], ['minus five','five '],
  ['zero zero seven','zero seven '], ['three point five zero','three point six '],
  ['The answer is twenty one.','The answer is twenty eight '],
  ['twenty one','Okay. Okay. '], ['twenty one','Mm-hmm. Okay. '],
  ['twenty one','Yes. '], ['twenty one','twenty one hundred '],
]) test('rejects the first confirmed differing numeric word: '+wrong,()=>{
  const guard=createNumericReadingGuard(script,'en',true);guard.feed(wrong);
  assert.equal(guard.diverged,true);
});

for(const acknowledgement of ['', 'Okay. ', 'Mm-hmm. '])for(const script of [
  'twenty one','minus one hundred five point zero four','zero zero seven',
  'plus three point five zero','The answer is twenty one.',
])test('partial tokens retain the complete numeric reading: '+acknowledgement+script,()=>{
  const guard=createNumericReadingGuard(script,'en',true),reading=acknowledgement+script;
  for(let length=1;length<=reading.length;length++){
    guard.feed(reading.slice(0,length));assert.equal(guard.diverged,false,'prefix '+reading.slice(0,length));
  }
  guard.feed(reading,true);assert.equal(guard.complete,true);assert.equal(guard.remainingWords,0);
});

test('an acknowledgement never advances answer progress or completes an empty answer',()=>{
  for(const reading of ['O','Oka','Okay.','Mm-','Mm-h','Mm-hmm.']){
    const guard=createNumericReadingGuard('twenty one','en',true);guard.feed(reading);
    assert.equal(guard.position,0);assert.equal(guard.complete,false);
  }
});

test('ordinary reading and other languages do not gain acknowledgement tolerance',()=>{
  for(const [language,conversation]of [['en',false],['nl',true]]){
    const guard=createNumericReadingGuard('twenty one',language,conversation);guard.feed('Okay. ');
    assert.equal(guard.diverged,true);
  }
});

test('an unfinished incorrect acknowledgement is rejected when final',()=>{
  const guard=createNumericReadingGuard('twenty one','en',true);guard.feed('Mm-h',true);assert.equal(guard.diverged,true);
});

for(const [digits,script]of [
  ['1052','one thousand fifty two'],['1,052','one thousand fifty two'],
  ['-105.04','minus one hundred five point zero four'],['007','zero zero seven'],
])for(const acknowledgement of ['', 'Okay. ', 'Mm-hmm. '])test('digit fragments are held until the value is complete: '+acknowledgement+digits,()=>{
  const guard=createNumericReadingGuard(script,'en',true),reading=acknowledgement+digits;
  for(let length=1;length<=reading.length;length++){
    guard.feed(reading.slice(0,length));assert.equal(guard.diverged,false,'prefix '+reading.slice(0,length));
    assert.equal(guard.position,0,'an unfinished numeric token cannot confirm part of the value');
  }
  guard.feed(reading,true);assert.equal(guard.complete,true);assert.equal(guard.remainingWords,0);
});

for(const [digits,script]of [
  ['21','twenty one'],['1052','one thousand fifty two'],['1,052','one thousand fifty two'],
  ['-105.04','minus one hundred five point zero four'],['+3.50','plus three point five zero'],['007','zero zero seven'],
])for(const acknowledgement of ['', 'Okay. ', 'Mm-hmm. '])test('completed digit expansion cannot hide an appended extra word: '+acknowledgement+digits,()=>{
  const guard=createNumericReadingGuard(script,'en',true),reading=acknowledgement+digits+' ';
  guard.feed(reading);assert.equal(guard.complete,true);assert.equal(guard.diverged,false);
  guard.feed(reading+'u');assert.equal(guard.diverged,false,'wait for the new word to finish');
  guard.feed(reading+'units ');assert.equal(guard.diverged,true,'do not skip a tail after numeric normalization');
});

test('a numeral in the middle retains its token identity as the transcript grows',()=>{
  const guard=createNumericReadingGuard('The answer is twenty one.','en',true);
  for(const text of ['The answer is 2','The answer is 21','The answer is 21. ']){
    guard.feed(text);assert.equal(guard.diverged,false);
  }
  assert.equal(guard.complete,true);
  guard.feed('The answer is 21. Unit ');assert.equal(guard.diverged,true);
});
