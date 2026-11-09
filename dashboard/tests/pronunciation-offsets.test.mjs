import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePronunciations} from '../src/lib/speech/pronunciation.ts';

test('recovery inside an expanded pronunciation restarts the original term',()=>{
  const prepared=preparePronunciations('Use AI. Keep going.','AI = Artificial. Intelligence');
  assert.equal(prepared.text,'Use Artificial. Intelligence. Keep going.');
  assert.equal(prepared.sourceOffset('Use Artificial. '.length),'Use '.length);
  assert.equal(prepared.sourceOffset('Use Artificial. Intelligence. '.length),'Use AI. '.length);
  assert.equal(prepared.sourceOffset(prepared.text.length),'Use AI. Keep going.'.length);
});

test('several replacements retain the source sentence after each change in length',()=>{
  const prepared=preparePronunciations('AI and International Business Machines. Continue.','AI = Artificial intelligence\nInternational Business Machines = IBM');
  assert.equal(prepared.sourceOffset('Artificial intelligence and IBM. '.length),'AI and International Business Machines. '.length);
  assert.equal(prepared.sourceOffset('Artificial intelligence and '.length),'AI and '.length);
});

test('unchanged scripts retain their original recovery positions',()=>{
  const text='Keep the words. Read every sentence.';
  const prepared=preparePronunciations(text);
  assert.equal(prepared.text,text);
  assert.equal(prepared.sourceOffset('Keep the words. '.length),'Keep the words. '.length);
});
