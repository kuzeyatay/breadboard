import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runElectronFixture } from './helpers/run-electron-fixture';

test('native visible regions follow physical pixels while a different app has focus', {skip:process.platform!=='win32'}, async()=>{
  const desktop=path.resolve(__dirname,'../..');
  const temporaryRoot=path.join(desktop,'.tmp-notification-visibility-tests');
  fs.mkdirSync(temporaryRoot,{recursive:true});
  const dir=fs.mkdtempSync(path.join(temporaryRoot,'regions-'));
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  let previousFocus='';
  const started=Date.now(),receiptPath=path.join(temporaryRoot,`attempt-${started}.json`);
  const receipt: Record<string,unknown>={startedAt:new Date(started).toISOString(),passed:false};
  try {
    const windows=process.env.SystemRoot||'C:\\Windows';
    const compiler=path.join(windows,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const compile=spawnSync(compiler,['/nologo','/target:winexe','/platform:x64',`/out:${path.join(dir,'notification-cover.exe')}`,
      '/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll',path.join(desktop,'tests/fixtures/notification-cover.cs')],{encoding:'utf8',windowsHide:true});
    assert.equal(compile.status,0,compile.stdout+compile.stderr);
    previousFocus=spawnSync(path.join(dir,'notification-cover.exe'),['foreground'],{encoding:'utf8',windowsHide:true}).stdout.trim();
    const esbuild=require(require.resolve('esbuild',{paths:[path.join(desktop,'../dashboard')]}));
    await esbuild.build({stdin:{resolveDir:path.join(desktop,'../dashboard'),contents:`
      import {registerChatNotificationTarget,isChatNotificationRecordViewed} from './src/lib/chat-notification-inbox';
      const id=new URL(location.href).searchParams.get('surface')||'fixture';
      const target={surface:'dashboard_terminal',chatId:id};
      document.querySelector('[data-notification-chat]').dataset.notificationChat='dashboard_terminal:'+id;
      document.querySelector('[data-notification-message]').dataset.notificationMessage=JSON.stringify(['client:'+id]);
      registerChatNotificationTarget({...target,observeMessages:true});
      window.isViewed=()=>isChatNotificationRecordViewed({id,target,messageKeys:['client:'+id]});
    `},bundle:true,platform:'browser',format:'iife',outfile:path.join(dir,'surface.js')});
    fs.writeFileSync(path.join(dir,'preload.cjs'),`const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('breadboardDesktop',{
      getTabsState:()=>ipcRenderer.invoke('test-state'),onTabsState:cb=>{const listener=(_e,s)=>cb(s);ipcRenderer.on('test-state',listener);return()=>ipcRenderer.removeListener('test-state',listener);}});`);
    fs.writeFileSync(path.join(dir,'surface.html'),`<!doctype html><body style="margin:0;background:#eee"><section data-notification-chat="dashboard_terminal:fixture">
      <div data-notification-message='["client:fixture"]' style="position:absolute;left:80px;top:80px;width:240px;height:60px">
      <div data-chat-selectable-message style="width:240px;height:60px">A readable assistant answer.</div></div></section><script>window.fetch=async()=>({ok:true,json:async()=>({acknowledged:[]})});</script><script src="surface.js"></script>`);
    // Physical visibility is the assertion: STARTUPINFO's hidden first window
    // would invalidate it even when Electron's isVisible() says true.
    const result=await runElectronFixture(require('electron') as string,[path.join(desktop,'tests/fixtures/notification-visible-region.cjs'),path.join(desktop,'dist'),dir],desktop,env,60_000,true);
    Object.assign(receipt,{durationMs:Date.now()-started,status:result.status,error:result.error?.message,output:result.output});
    if(fs.existsSync(path.join(dir,'passed.json'))){
      const native=JSON.parse(fs.readFileSync(path.join(dir,'passed.json'),'utf8'));receipt.native=native;receipt.passed=native.passed===true&&!result.error&&result.status===0;
      console.log(JSON.stringify(native));
    }
    else {
      if(fs.existsSync(path.join(dir,'partial.json')))receipt.native=JSON.parse(fs.readFileSync(path.join(dir,'partial.json'),'utf8'));
      fs.writeFileSync(path.join(temporaryRoot,'last-failure.log'),result.output);
    }
    assert.equal(result.error,undefined,result.output);assert.equal(result.status,0,result.output);
  } finally {
    let focusRestored=true;
    if(previousFocus) {
      const restore=spawnSync(path.join(dir,'notification-cover.exe'),['restore',previousFocus],{encoding:'utf8',windowsHide:true});
      focusRestored=restore.stdout?.trim()==='restored';
      receipt.focusRestoration=restore.stdout?.trim()||restore.error?.message;
    }
    receipt.focusRestored=focusRestored;receipt.passed=receipt.passed===true&&focusRestored;receipt.finishedAt=new Date().toISOString();
    fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2));
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(temporaryRoot));
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    assert.equal(focusRestored,true,'restore the previously focused app');
  }
});
