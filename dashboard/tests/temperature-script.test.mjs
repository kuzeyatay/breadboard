import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareTemperatureSpeechScript} from '../src/lib/speech/temperature-script.ts';

for(const [original,expected]of [
 ['High 11°C and low 5°C.','High 11 degrees Celsius and low 5 degrees Celsius.'],
 ['From −5–−2°C. Keep the lid closed.','From −5–−2 degrees Celsius. Keep the lid closed.'],
 ['Water at 37.5 °C; room at 21℃.','Water at 37.5 degrees Celsius; room at 21 degrees Celsius.'],
 ['Outside: 65℉ or 18 degrees C.','Outside: 65 degrees Fahrenheit or 18 degrees Celsius.'],
 ['Use USB C. Option F costs $5.','Use USB C. Option F costs $5.'],
 ['It is 11 degrees Celsius. Do not open it.','It is 11 degrees Celsius. Do not open it.'],
])test('speak explicit units without changing quantities or other content: '+original,()=>{
 const prepared=prepareTemperatureSpeechScript(original,'en');assert.equal(prepared.text,expected);
 assert.equal(prepared.sourceOffset(prepared.text.length),original.length);
});

test('every later sentence retains its exact source position after multiple expansions',()=>{
 const original='It is 11°C. Next, cool to 5°C. Do not open the lid.';
 const prepared=prepareTemperatureSpeechScript(original,'en');
 for(const sentence of ['Next,','Do not'])assert.equal(prepared.sourceOffset(prepared.text.indexOf(sentence)),original.indexOf(sentence));
 assert.equal(prepared.sourceOffset(prepared.text.indexOf('Celsius')),original.indexOf('°C'));
});

test('unsupported languages and disabled normalization preserve text and offsets',()=>{
 const original='Het is 11°C.';
 for(const language of [undefined,'nl','tr']){
  const prepared=prepareTemperatureSpeechScript(original,language);assert.equal(prepared.text,original);
  for(let index=0;index<=original.length;index++)assert.equal(prepared.sourceOffset(index),index);
 }
});
