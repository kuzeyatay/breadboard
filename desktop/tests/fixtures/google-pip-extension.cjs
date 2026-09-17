const assert = require('node:assert/strict');
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const {createRequire} = require('node:module');
const {app, BrowserWindow, WebContentsView, ipcMain, dialog, session, webContents} = require('electron');
const {TabManager, BROWSER_SESSION_PARTITION} = require('../../dist/main/tab-manager');
const {IPC_CHANNELS, isTabsCommand} = require('../../dist/shared/ipc-contract');
const {readBrowserExtensionPaths} = require('../../dist/main/browser-extensions');
const {GOOGLE_PIP_EXTENSION_ID:id} = require('../../dist/main/google-pip-extension');
require('../../dist/main/browser-picture-in-picture').toggleBrowserPictureInPicture = () => assert.fail('Google action must not call the built-in replacement');
const [phase, dir] = process.argv.slice(2);
app.setPath('userData', path.join(dir, 'profile')); app.on('window-all-closed', () => {});
const until = async (probe, label) => {
  console.log('Checking:', label);
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { const result = await probe(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error('Timed out: ' + label);
};
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)));
app.whenReady().then(async () => {
  const dashboard = path.resolve(__dirname, '../../../dashboard');
  const bundle = createRequire(path.join(dashboard, 'package.json'))('esbuild').buildSync({
    stdin: {contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {useDesktopTabs} from './src/app/components/use-desktop-tabs';
      import Button from './src/app/browser/browser-extensions-button';
      import Popup from './src/app/browser/browser-extensions-popover';
      function Chrome(){const state=useDesktopTabs();const tab=state?.tabs.find(t=>t.id===state.selfId);
        return <div className="browser-toolbar" style={{marginTop:32}}><div className="browser-address-form" style={{display:'flex',justifyContent:'space-between'}}>
          <span>{tab?.browser?.address}</span><Button open={tab?.browser?.extensionsOpen??false} count={state?.extensions.length??0}/></div></div>}
      createRoot(document.getElementById('root')).render(location.pathname==='/browser/extensions-popover'?<Popup/>:<Chrome/>);
    `, resolveDir:dashboard, loader:'tsx'}, bundle:true, write:false, outdir:'out', format:'iife', platform:'browser', define:{'process.env.NODE_ENV':'"production"'},
  }).outputFiles;
  const server = http.createServer((req,res) => {
    if (req.url === '/global.css') {res.setHeader('Content-Type','text/css');return res.end(fs.readFileSync(path.join(dashboard,'src/app/globals.css')));}
    if (req.url === '/app.js' || req.url === '/app.css') { const ext=path.extname(req.url);res.setHeader('Content-Type',ext==='.css'?'text/css':'text/javascript');return res.end(bundle.find(file=>file.path.endsWith(ext)).text); }
    res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html data-theme="dark"><head><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/app.css"><style>
      body{margin:0;font-family:Arial}*,::before,::after{box-sizing:border-box;border:0 solid}button{font:inherit;color:inherit;background:transparent}
      :root{--font-source-sans:Arial;--font-schibsted:Arial;--ink-heading:#ededed;--ink-muted:#a5a5a5;--botanical:#9bb999;--paper-surface:#20211f;--paper-raised:#20211f;--line-strong:#454642}
    </style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
  });
  const external = http.createServer((_req,res) => {res.setHeader('Content-Type','text/html');res.end(`<!doctype html><title>Google PiP fixture video</title><video id="video" autoplay muted controls></video><script>
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');let tick=0;
    setInterval(()=>{ctx.fillStyle=tick++%2?'#275941':'#376985';ctx.fillRect(0,0,640,360)},40);document.querySelector('video').srcObject=canvas.captureStream(25);
    window.presentedFrames=()=>{const q=document.querySelector('video').getVideoPlaybackQuality();return q.totalVideoFrames-q.droppedVideoFrames};
  </script>`);});
  const origin=await listen(server), web=await listen(external);
  const loading=path.join(dir,'loading.html');fs.writeFileSync(loading,'<!doctype html>');
  const preload=path.resolve(__dirname,'../../dist/preload/preload.js');
  const errors=[];const browserSession=session.fromPartition(BROWSER_SESSION_PARTITION);
  browserSession.serviceWorkers.on('console-message',(_event,details)=>{if(details.level>=3)errors.push(details.message);});
  const manager=new TabManager({allowed:{origins:new Set([origin])},preloadPath:preload,loadingHtmlPath:()=>loading,recoveryHtmlPath:()=>loading,theme:()=> 'dark',browserExtensionsConfigDir:dir,openWindow:()=>assert.fail('Unexpected window'),log:console.log});
  manager.setEnabled(true);
  manager.setBrowserUrl(origin+'/browser');
  const window=new BrowserWindow({show:false,width:1100,height:750,webPreferences:{preload,contextIsolation:true,sandbox:true}});
  manager.attach(window);
  ipcMain.handle(IPC_CHANNELS.getTabsState,event=>manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand,(event,command)=>isTabsCommand(command)&&manager.handleCommand(event.sender,command));
  await window.loadURL(origin+'/dashboard');window.showInactive();
  await manager.handleCommand(window.webContents,{type:'browser',url:web});
  const page=await until(()=>webContents.getAllWebContents().find(c=>c.getURL()===web+'/'&&!c.isLoading()),'video page');
  await until(()=>page.executeJavaScript('document.querySelector("video").readyState>=2'),'video playing');
  await until(()=>window.contentView.children.some(view=>view.webContents?.id===page.id)&&!manager.stateFor(window.webContents).navigationPending,'browser revealed');
  const chrome=webContents.getAllWebContents().find(c=>c.getURL()===origin+'/browser');
  const sourceId=manager.stateFor(chrome).selfId;
  const original=path.join(dir,'extension');
  const originalFiles=Object.fromEntries(['manifest.json','background.js','script.js','autoPip.js'].map(name=>[name,fs.readFileSync(path.join(original,name))]));
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[original]});
  let popup;
  const openPopup=async()=>{
    await new Promise(resolve=>setTimeout(resolve,250));
    await chrome.executeJavaScript("document.querySelector('[aria-label=Extensions]').click()");
    popup=await until(()=>webContents.getAllWebContents().find(c=>c.getURL().startsWith(origin+'/browser/extensions-popover')&&!c.isLoading()),'extensions popup');
    await until(()=>window.contentView.children.find(view=>view.webContents?.id===popup.id)?.getBounds().y>0,'popup visible');
  };
  const click=async selector=>{
    await until(()=>popup.executeJavaScript('Boolean(document.querySelector('+JSON.stringify(selector)+') && !document.querySelector('+JSON.stringify(selector)+').disabled)'),'action available: '+selector);
    const point=await popup.executeJavaScript('(()=>{const button=document.querySelector('+JSON.stringify(selector)+');button.scrollIntoView({block:"nearest"});const r=button.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
    popup.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});popup.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
  };
  await openPopup();
  if(phase==='install')await click('.browser-extension-load');
  const extension=await until(()=>manager.stateFor(chrome).extensions.find(ext=>ext.id===id&&ext.action),'Google background initialized');
  assert.equal(extension.version,'1.14');
  assert.equal(extension.action.menus[0].checked,phase==='install');
  assert.ok(Object.values(browserSession.serviceWorkers.getAllRunning()).some(worker=>worker.scriptUrl.includes(id)),'real extension worker is running');
  const bridge=()=>webContents.getAllWebContents().find(c=>c.getURL()===`chrome-extension://${id}/breadboard-extension-host.html`);
  const registered=()=>bridge().executeJavaScript('chrome.scripting.getRegisteredContentScripts()');
  assert.equal((await registered()).some(script=>script.id==='autoPip'),phase==='install');
  assert.equal(await bridge().executeJavaScript('typeof window.breadboardDesktop'), 'undefined','extension host has no product privileges');
  assert.equal(await manager.handleCommand(page,{type:'browser-extension-action',id}),false,'websites cannot invoke extension actions');
  assert.equal(isTabsCommand({type:'browser-extension-action',id,menuId:42}),false);
  await until(()=>popup.executeJavaScript("document.body.innerText.includes('Automatic picture-in-picture (BETA)')"),'Google context-menu option in popup');
  assert.equal(await popup.executeJavaScript("document.body.innerText.includes('Built in')"),false,'Google is the primary PiP action when installed');
  const qa=process.env.BREADBOARD_GOOGLE_PIP_QA_DIR;
  if(qa){fs.mkdirSync(qa,{recursive:true});fs.writeFileSync(path.join(qa,phase+'-google-extension.png'),(await popup.capturePage()).toPNG());}
  await click('[aria-label="Run Picture-in-Picture Extension (by Google)"]');
  await until(()=>page.executeJavaScript('Boolean(document.pictureInPictureElement && document.querySelector("video").hasAttribute("__pip__"))'),'Google script opens native PiP');
  const before=await page.executeJavaScript('({time:document.querySelector("video").currentTime,frames:window.presentedFrames()})');
  manager.handleCommand(chrome,{type:'activate',id:1});
  await until(()=>page.executeJavaScript(`Boolean(document.pictureInPictureElement && document.querySelector('video').currentTime>${before.time+.3} && window.presentedFrames()>${before.frames+2})`),'Google PiP keeps playing on a product tab');
  await manager.handleCommand(window.webContents,{type:'browser',url:web+'/other'});
  await until(()=>manager.stateFor(chrome).tabs.some(tab=>tab.url===web+'/other'),'another browser tab');
  assert.equal(await page.executeJavaScript('!!document.pictureInPictureElement'),true);
  manager.handleCommand(chrome,{type:'activate',id:sourceId});
  await until(()=>window.contentView.children.some(view=>view.webContents?.id===page.id)&&!manager.stateFor(chrome).navigationPending,'source reattached');
  page.sendInputEvent({type:'keyDown',keyCode:'P',modifiers:['alt']});page.sendInputEvent({type:'keyUp',keyCode:'P',modifiers:['alt']});
  await until(()=>page.executeJavaScript('!document.pictureInPictureElement && !document.querySelector("video").hasAttribute("__pip__")'),'Alt+P invokes Google to exit');
  await openPopup();
  if(phase==='install'){
    await click('[role=checkbox]');
    await until(()=>manager.stateFor(chrome).extensions.find(ext=>ext.id===id)?.action?.menus[0].checked===false,'Google setting switches off');
    assert.equal(await bridge().executeJavaScript('(async()=> (await chrome.storage.local.get("autoPip")).autoPip)()'),false);
    assert.equal((await registered()).length,0);
    const previousHostId = bridge().id;
    await click('[aria-label="Reload Picture-in-Picture Extension (by Google)"]');
    await until(()=>manager.stateFor(chrome).extensions.find(ext=>ext.id===id)?.action?.menus[0].checked===false&&bridge()&&bridge().id!==previousHostId,'reload preserves disabled setting');
    assert.equal((await registered()).length,0);
    // Suspend the actual service worker; the next shortcut must wake it and
    // keep its user gesture after the asynchronous startup work completes.
    const host=bridge();host.debugger.attach('1.3');await host.debugger.sendCommand('ServiceWorker.enable');
    const version=Object.keys(browserSession.serviceWorkers.getAllRunning())[0];
    await host.debugger.sendCommand('ServiceWorker.stopWorker',{versionId:version});
    await until(()=>!Object.keys(browserSession.serviceWorkers.getAllRunning()).length,'worker stopped');
    host.debugger.detach();
    await manager.handleCommand(chrome,{type:'browser-extensions-close'});page.focus();
    page.sendInputEvent({type:'keyDown',keyCode:'P',modifiers:['alt']});page.sendInputEvent({type:'keyUp',keyCode:'P',modifiers:['alt']});
    await until(()=>page.executeJavaScript('!!document.pictureInPictureElement && document.querySelector("video").hasAttribute("__pip__")'),'Google wakes and opens PiP after suspension');
    await page.executeJavaScript('document.exitPictureInPicture()');
    assert.deepEqual(readBrowserExtensionPaths(dir),[original],'persist original package path for restart');
  } else {
    await click('[role=checkbox]');
    await until(()=>manager.stateFor(chrome).extensions.find(ext=>ext.id===id)?.action?.menus[0].checked===true,'Google setting switches on after app restart');
    assert.deepEqual((await registered()).map(script=>script.id),['autoPip']);
    await click('[aria-label="Remove Picture-in-Picture Extension (by Google)"]');
    await until(()=>!browserSession.getExtension(id)&&!bridge(),'remove unloads package and host');
    assert.deepEqual(readBrowserExtensionPaths(dir),[]);
  }
  for(const [name,bytes]of Object.entries(originalFiles))assert.deepEqual(fs.readFileSync(path.join(original,name)),bytes,'downloaded '+name+' remains unchanged');
  assert.deepEqual(errors,[],'no service worker initialization/runtime errors');
  console.log('Google 1.14 initialization, native UI/action, Alt+P, cross-tab playback, settings and '+phase+' verified.');
  fs.writeFileSync(path.join(dir,'passed.json'),JSON.stringify({passed:true}));
}).catch(error=>{console.error(error.stack||error);app.exit(1)});
