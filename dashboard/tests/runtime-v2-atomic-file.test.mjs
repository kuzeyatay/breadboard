import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {renameRuntimeFileSync} from '../scripts/runtime-v2-atomic-file.mjs';

test('a transient Windows lock preserves the prior checkpoint until atomic replacement',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cinema-checkpoint-'));
 try {
  const prior=path.join(dir,'checkpoint.json'),pending=path.join(dir,'pending');
  fs.writeFileSync(prior,'old complete');fs.writeFileSync(pending,'new complete');
  let tries=0;const waits=[];
  renameRuntimeFileSync(pending,prior,{platform:'win32',pause:ms=>{
   waits.push(ms);assert.equal(fs.readFileSync(prior,'utf8'),'old complete');
  },rename:(a,b)=>{if(++tries<3)throw Object.assign(Error('reader lock'),{code:'EPERM'});fs.renameSync(a,b);}});
  assert.deepEqual(waits,[20,40]);assert.equal(tries,3);
  assert.equal(fs.readFileSync(prior,'utf8'),'new complete');assert.equal(fs.existsSync(pending),false);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('persistent Windows locks have a 620ms total retry budget',()=>{
 let tries=0;const waits=[];const error=Object.assign(Error('locked'),{code:'EBUSY'});
 assert.throws(()=>renameRuntimeFileSync('pending','target',{platform:'win32',pause:ms=>waits.push(ms),rename:()=>{tries++;throw error;}}),e=>e===error);
 assert.equal(tries,6);assert.deepEqual(waits,[20,40,80,160,320]);
});

test('permission errors on other systems and nontransient failures are not retried',()=>{
 for(const [platform,code] of [['linux','EPERM'],['win32','ENOENT'],['win32','ENOSPC']]){
  let tries=0;const error=Object.assign(Error('failure'),{code});
  assert.throws(()=>renameRuntimeFileSync('pending','target',{platform,pause:()=>assert.fail('unexpected wait'),rename:()=>{tries++;throw error;}}),e=>e===error);
  assert.equal(tries,1);
 }
});
