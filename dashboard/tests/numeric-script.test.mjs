import test from 'node:test';
import assert from 'node:assert/strict';
import {numericSpeechScript} from '../src/lib/speech/numeric-script.ts';
test('standalone English quantities have an unambiguous local reading',()=>{
  for(const [input,expected] of [['28','twenty eight'],['21','twenty one'],['0','zero'],['-105.04','minus one hundred five point zero four'],['1,234','one thousand two hundred thirty four'],['1000000000001','one trillion one'],['007','zero zero seven']]) {
    assert.equal(numericSpeechScript(input,'en'),expected);
  }
});
test('prose, identifiers with units and another selected language preserve their script',()=>{
  for(const text of ['It is 28 degrees.','28°C','3/14/2024','28 cats','one million','12,34'])assert.equal(numericSpeechScript(text,'en'),text);
  assert.equal(numericSpeechScript('28','nl'),'28');
  assert.equal(numericSpeechScript('28','en-GB'),'twenty eight');
  assert.equal(numericSpeechScript('9007199254740993','en'),'nine zero zero seven one nine nine two five four seven four zero nine nine three');
});

test('conversation gives bare numbers a full sentence while preserving every value',()=>{
  for(const [value,reading] of [['21','twenty one'],['-105.04','minus one hundred five point zero four'],['+3.50','plus three point five zero'],['007','zero zero seven'],['0','zero'],['123,456','one hundred twenty three thousand four hundred fifty six'],['9007199254740993','nine zero zero seven one nine nine two five four seven four zero nine nine three']]) {
    assert.equal(numericSpeechScript(value,'en',true),'The answer is '+reading+'.');
    assert.equal(numericSpeechScript(value,'en'),reading);
  }
  assert.equal(numericSpeechScript('21!','en',true),'The answer is twenty one!');
  assert.equal(numericSpeechScript('21!','en'),'twenty one!');
});
test('conversational framing never rewrites prose, units, other languages or malformed numbers',()=>{
  for(const value of ['The answer is 21.','21°C','21 percent','3/14/2024','12,34','21 and 28','−21','1e3'])assert.equal(numericSpeechScript(value,'en',true),value);
  for(const language of ['nl','tr','fr'])assert.equal(numericSpeechScript('21',language,true),'21');
});

test('standalone numeric questions keep their question meaning in conversation',()=>{
  for(const [input,expected]of [['21?','twenty one?'],['-3.50?','minus three point five zero?'],['007?','zero zero seven?']])assert.equal(numericSpeechScript(input,'en',true),expected);
});
