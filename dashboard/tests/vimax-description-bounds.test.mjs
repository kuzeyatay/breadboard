import assert from 'node:assert/strict';
import test from 'node:test';
import {scriptDescriptionSchema,storySchema} from '../src/lib/vimax/schemas.ts';
test('visual style can retain a bounded paragraph without rejecting the screenplay',()=>{
  const style='Quiet watercolour, soft daylight, clear geometric silhouettes and gentle movement. '.repeat(3).trim();
  assert.ok(style.length>120&&style.length<600);
  assert.equal(scriptDescriptionSchema.parse({title:'Acorn',logline:'An example',style}).style,style);
  assert.equal(storySchema.parse({title:'Acorn',story:'An example',style}).style,style);
  assert.equal(scriptDescriptionSchema.safeParse({title:'Acorn',style:'x'.repeat(601)}).success,false);
});
