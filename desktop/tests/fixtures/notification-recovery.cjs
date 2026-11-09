const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain } = require('electron');
const { TabManager } = require('../../dist/main/tab-manager.js');
const { IPC_CHANNELS } = require('../../dist/shared/ipc-contract.js');
const dir = process.argv.at(-1);
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error('Timed out: ' + label);
};
app.whenReady().then(async () => {
  let unavailable = true, requests = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/notification-overlay') {
      requests++;
      if (unavailable) { req.socket.destroy(); return; }
    }
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><body><script>
      window.notices=[];
      breadboardDesktop.onNotificationToast(notice=>{
        notices.push(notice);
        document.body.textContent=notice.message;
        breadboardDesktop.resizeNotificationOverlay({width:320,height:100});
      });
      breadboardDesktop.resizeNotificationOverlay({width:0,height:0});
    </script></body>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const loading = path.join(dir, 'loading.html');
  fs.writeFileSync(loading, '<!doctype html>');
  const manager = new TabManager({
    allowed: {origins:new Set([origin]),localFiles:new Set([pathToFileURL(loading).href])},
    preloadPath:path.resolve(__dirname,'../../dist/preload/preload.js'),
    loadingHtmlPath:()=>loading,recoveryHtmlPath:()=>loading,theme:()=> 'light',openWindow:()=>{},
  });
  ipcMain.handle(IPC_CHANNELS.getTabsState,event=>manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand,(event,command)=>manager.handleCommand(event.sender,command));
  const window = new BrowserWindow({show:false,width:1000,height:750});
  manager.attach(window, true);
  window.setOpacity(0);
  // This recovery/layout fixture models a foreground host without stealing focus.
  window.isFocused = () => true;
  window.showInactive();
  manager.setNotificationsVisible(true);
  manager.setNotificationOverlayUrl(origin+'/notification-overlay');
  const host = manager.hosts.get(window.id);
  const overlay = host.notificationOverlay;
  await until(()=>requests>0,'first failed request');
  assert.equal(manager.publishNotificationToast(overlay.contents,{id:'initial',type:'success',message:'Queued during failed load'}),true);
  assert.equal(overlay.ready,false);
  unavailable=false;
  await until(()=>overlay.ready,'failed initial load retries');
  await until(()=>overlay.contents.executeJavaScript("notices.some(n=>n.id==='initial')"),'queued startup card delivered');
  assert.ok(requests>=2);

  unavailable=true;
  const gone = new Promise(resolve=>overlay.contents.once('render-process-gone',resolve));
  overlay.contents.forcefullyCrashRenderer();
  await gone;
  assert.equal(overlay.ready,false,'crash clears the stale handshake immediately');
  assert.equal(manager.publishNotificationToast(overlay.contents,{id:'after-crash',type:'success',message:'Queued during crash recovery'}),true);
  await until(()=>requests>=3,'crash retries while service is unavailable');
  unavailable=false;
  await until(()=>overlay.ready && !overlay.contents.isCrashed(),'crashed overlay recovers');
  await until(()=>overlay.contents.executeJavaScript("notices.some(n=>n.id==='after-crash')"),'card survives renderer restart');
  assert.deepEqual(await overlay.contents.executeJavaScript('notices.map(n=>n.id)'),['after-crash']);
  assert.ok(overlay.view.getBounds().y>=0,'recovered card is on screen');
  assert.equal(window.contentView.children.at(-1),overlay.view,'recovered card is above the page');

  // A replaced/closed overlay must not keep retrying or resurrect itself.
  unavailable=true;
  void overlay.contents.loadURL(origin+'/notification-overlay').catch(()=>{});
  await until(()=>!overlay.ready,'manual navigation clears readiness');
  manager.setNotificationOverlayUrl(null);
  const finalRequests=requests;
  await new Promise(resolve=>setTimeout(resolve,1200));
  assert.equal(host.notificationOverlay,null);
  assert.equal(requests,finalRequests,'teardown cancels recovery');
  server.closeAllConnections(); server.close();
  fs.writeFileSync(path.join(dir,'passed.json'),JSON.stringify({passed:true}));
}).catch(error=>{console.error(error);app.exit(1);});
