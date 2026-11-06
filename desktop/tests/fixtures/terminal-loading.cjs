const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {app,ipcMain} = require('electron');
const {WindowManager} = require('../../dist/main/window-manager.js');
const {IPC_CHANNELS} = require('../../dist/shared/ipc-contract.js');
const dir=process.argv.at(-1);
app.setPath('userData',path.join(dir,'profile'));
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
app.on('window-all-closed',()=>{});
const until=async(probe,label)=>{
  for(const end=Date.now()+7000;Date.now()<end;){
    if(await probe())return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error('Timed out: '+label);
};
app.whenReady().then(async()=>{
  let imageRequested=false,frameRequests=0,releaseDocument;
  const html='<!doctype html><title>Terminal</title><body><button id="work" onclick="this.textContent=\'clicked\'">Working Terminal</button>';
  const server=http.createServer((req,res)=>{
    if(req.url==='/logo.png'){imageRequested=true;return;}
    if(req.url.startsWith('/background-frame')){frameRequests++;return;}
    const respond=()=>{res.setHeader('content-type','text/html');res.end(html+(req.url==='/new-tab'?'<img src="/logo.png">':''));};
    if(req.url==='/cold'){releaseDocument=respond;return;}
    respond();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const scene=path.join(dir,'scene.html');fs.writeFileSync(scene,'<!doctype html>');
  const manager=new WindowManager({
    allowed:{origins:new Set([origin]),localFiles:new Set([pathToFileURL(scene).href])},
    preloadPath:path.resolve(__dirname,'../../dist/preload/preload.js'),
    startupHtmlPath:scene,recoveryHtmlPath:scene,loadingHtmlPath:scene,minimumStartupVisibleMs:0,
    browserHistoryConfigDir:dir,
  });
  ipcMain.handle(IPC_CHANNELS.getTabsState,event=>manager.tabs.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand,(event,command)=>manager.tabs.handleCommand(event.sender,command));
  manager.tabs.setEnabled(true);
  const window=manager.createMainWindow();window.setOpacity(0);window.showInactive();
  const base=manager.page(window),host=manager.tabs.hosts.get(window.id);
  const tab=host.tabs.find(t=>t.contents===base);
  const state=()=>manager.tabs.stateFor(base).tabs.find(t=>t.id===tab.id);
  const progressBusy=()=>host.shell.contents.executeJavaScript("document.querySelector('[aria-label=\"Loading page\"]')?.getAttribute('aria-busy')");
  void base.loadURL(origin+'/new-tab').catch(()=>{});
  await until(()=>imageRequested&&tab.loaded&&host.shellEnabled,'Terminal parsed with stalled logo');
  assert.equal(base.isLoading(),true,'Chromium is still waiting for the logo');
  assert.equal(await base.mainFrame.executeJavaScript("document.readyState"),'interactive');
  await base.mainFrame.executeJavaScript("document.querySelector('#work').click()");
  assert.equal(await base.mainFrame.executeJavaScript("document.querySelector('#work').textContent"),'clicked');
  assert.equal(state().loading,false,'ready Terminal must not wait for an image to stop its loading indicator');
  await until(async()=>await progressBusy()==='false','persistent top bar finishes');

  // Real page work owns its own progress, independent of passive resources.
  const report=pending=>manager.tabs.handleCommand(base,{type:'page-loading',id:tab.id,documentGeneration:tab.generation,pending});
  assert.equal(report(true),true);
  await until(async()=>await progressBusy()==='true','actual page work keeps loading visible');
  assert.equal(report(false),true);
  await until(async()=>await progressBusy()==='false','page work releases loading');

  // A later iframe cannot restart the document's completed loading cycle.
  await base.mainFrame.executeJavaScript("const frame=document.createElement('iframe');frame.src='/background-frame';document.body.append(frame)");
  await until(()=>frameRequests===1,'background frame requested');
  assert.equal(state().loading,false);
  assert.equal(await progressBusy(),'false');

  // A full navigation must still start a new loading cycle, even while the
  // previous document has never emitted did-stop-loading.
  const previousGeneration=tab.generation;
  const cold=base.loadURL(origin+'/cold').catch(error=>{
    // Replacing a document with a held image can abort the outgoing loadURL
    // listener too. Verify the new document itself below.
    if(error.errno!==-3&&error.code!=='ERR_ABORTED')throw error;
  });
  await until(()=>releaseDocument&&tab.generation>previousGeneration,'next document requested');
  assert.equal(state().loading,true,'waiting for the next document is real navigation');
  await until(async()=>await progressBusy()==='true','cold navigation shows progress');
  assert.equal(manager.tabs.handleCommand(base,{type:'page-loading',id:tab.id,documentGeneration:previousGeneration,pending:true}),false,'stale pages cannot reassert loading');
  releaseDocument();await cold;
  await until(()=>base.getURL()===origin+'/cold'&&!state().loading,'next document completes');
  await until(async()=>await progressBusy()==='false','next document clears bar');
  await base.executeJavaScript("history.pushState({},'', '/cold#section')");
  assert.equal(state().loading,false,'same-document navigation stays ready');
  assert.equal(base.isLoading(),false);
  await base.executeJavaScript("const frame=document.createElement('iframe');frame.src='/background-frame?late';document.body.append(frame)");
  await until(()=>frameRequests===2,'frame starts after document completion');
  assert.equal(base.isLoading(),true,'late iframe produces a new Chromium loading cycle');
  assert.equal(state().loading,false,'late child loading cannot restart the completed document indicator');
  assert.equal(await progressBusy(),'false');
  console.log('Ready Terminal, stalled image/frame, real page work and subsequent navigation checks passed');
  fs.writeFileSync(path.join(dir,'passed.json'),JSON.stringify({passed:true}));
}).catch(error=>{console.error(error.stack);app.exit(1);});
