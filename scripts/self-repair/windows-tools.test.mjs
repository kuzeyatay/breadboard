import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {sourceRepairToolPath} from './windows-tools.mjs';

test('native closed PATH gains only the installed tools needed by repair', {skip:process.platform!=='win32'},()=>{
  const system=process.env.SystemRoot;
  const env={...process.env,PATH:[path.dirname(process.execPath),path.join(system,'System32'),system].join(';')};
  for(const cmd of ['git','powershell.exe'])assert.equal(spawnSync(cmd,['--version'],{env,windowsHide:true}).error?.code,'ENOENT');
  const original=env.PATH;env.PATH=sourceRepairToolPath(env);
  assert.ok(env.PATH.endsWith(original));
  for(const [cmd,args]of [['git',['--version']],['powershell.exe',['-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.ToString()']]]){
    const result=spawnSync(cmd,args,{env,windowsHide:true,encoding:'utf8',timeout:15000});
    assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
  }
  assert.equal(env.PATH.split(';').length,original.split(';').length+2);
});

test('missing or linked installed tools fail closed and other platforms keep their PATH',()=>{
  assert.equal(sourceRepairToolPath({PATH:'/usr/bin'},'linux'),'/usr/bin');
  if(process.platform!=='win32')return;
  assert.throws(()=>sourceRepairToolPath({SystemRoot:'relative',ProgramFiles:'relative'}),/roots/);
  assert.throws(()=>sourceRepairToolPath({SystemRoot:process.env.SystemRoot,ProgramFiles:path.resolve('.tmp/no-installed-git')}),/missing or linked/);
  const directory=fs.mkdtempSync(path.resolve('.tmp/source-repair-tests/tools-'));
  fs.mkdirSync(path.join(directory,'Git'),{recursive:true});
  fs.symlinkSync(path.join(process.env.ProgramFiles,'Git/cmd'),path.join(directory,'Git/cmd'),'junction');
  assert.throws(()=>sourceRepairToolPath({SystemRoot:process.env.SystemRoot,ProgramFiles:directory}),/missing or linked/);
});
