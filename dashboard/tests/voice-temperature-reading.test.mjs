import test from 'node:test';
import assert from 'node:assert/strict';
import {createScriptGuard} from '../src/lib/speech/script-guard.ts';

function accept(script,reading) {
 const guard=createScriptGuard(script,{lookahead:1,tolerance:3});
 let text='';
 for(const chunk of reading.match(/.{1,5}/gu)) {text+=chunk;guard.feed(text);}
 guard.feed(text+' ');
 return {guard,accepted:!guard.diverged&&guard.remainingWords===0};
}

for(const [script,reading]of [
 ['Expect 6–9°C.','Expect six to nine degrees Celsius.'],
 ['Expect 6–9°C.','Expect 6–9 degrees Celsius.'],
 ['It is 21°C outside.','It is twenty-one degrees Celsius outside.'],
 ['It is 32°F outside.','It is thirty-two degrees Fahrenheit outside.'],
 ['The water is 37.5°C.','The water is thirty-seven point five degrees Celsius.'],
 ['It is −4°C.','It is minus four degrees Celsius.'],
 ['Expect −5–−2°C.','Expect minus five to minus two degrees Celsius.'],
 ['It is 18℃.','It is eighteen degrees Celsius.'],
 ['It is 65℉.','It is sixty-five degrees Fahrenheit.'],
 ['It is 6 degrees Celsius.','It is 6°C.'],
 ['It is 6°C.','It is six degrees centigrade.'],
 ['It is 6°C here and 32°F there.','It is six degrees Celsius here and thirty-two degrees Fahrenheit there.'],
])test('a faithful unit reading does not request a repeat: '+script+' / '+reading,()=>{
 const {guard,accepted}=accept(script,reading);assert.equal(accepted,true);assert.equal(guard.complete,true);
});

for(const reading of ['Expect 16–19°C.','Expect sixty to ninety degrees Celsius.',
 'Expect 6–9°F.','Expect six to nine degrees Fahrenheit.','Expect nine degrees Celsius.',
 'Expect degrees Celsius.','Expect 6–9°C, then 25°C.']) {
 test('a changed, missing or extra temperature is rejected: '+reading,()=>{
  assert.equal(accept('Expect 6–9°C.',reading).accepted,false);
 });
}
for(const [script,reading]of [
 ['It is 6°C.','It is sixteen degrees Celsius.'],
 ['It is 6°C.','It is minus six degrees Celsius.'],
 ['It is 6°C.','It is sixty-six degrees Celsius.'],
 ['It is 6°C.','It is one hundred six degrees Celsius.'],
 ['It is 6°C.','It is zero point six degrees Celsius.'],
 ['It is 6°C.','It is zero to six degrees Celsius.'],
 ['It is 37.5°C.','It is thirty-seven point six degrees Celsius.'],
 ['It is −4°C.','It is four degrees Celsius.'],
 ['It is 32°F.','It is thirty-two degrees Celsius.'],
])test('temperature value and unit remain exact: '+reading,()=>assert.equal(accept(script,reading).accepted,false));

test('ordinary letters and abbreviations do not become temperatures',()=>{
 assert.equal(accept('Use USB C. Choose option F.','Use USB C. Choose option F.').accepted,true);
});
test('a selected non-English language retains its number pronunciation',()=>{
 const guard=createScriptGuard('Het is 6°C.',{lookahead:1,tolerance:3,language:'nl'});
 guard.feed('Het is zes graden Celsius. ');
 assert.equal(guard.diverged,false);assert.equal(guard.remainingWords,0);
});
