import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {runClassroomStep} from '../src/lib/classroom/setup.ts';
test('timed out setup releases its working directory before rollback starts',async t=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'classroom-timeout-'));
  const destination=base+'-renamed';
  t.after(()=>{for(const directory of [base,destination])fs.rmSync(directory,{recursive:true,force:true});});
  fs.writeFileSync(path.join(base,'wait.cjs'),'setInterval(()=>{},1000);');
  await assert.rejects(()=>runClassroomStep('Owned timeout fixture',process.execPath,[path.join(base,'wait.cjs')],{cwd:base,env:{SystemRoot:process.env.SystemRoot,TEMP:base,TMP:base},timeoutMs:100}),/time limit and was stopped/);
  fs.renameSync(base,destination);
  assert.ok(fs.existsSync(path.join(destination,'wait.cjs')));
});
