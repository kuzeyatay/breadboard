const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {app, BrowserWindow, ipcMain} = require('electron');
const {TabManager} = require('../../dist/main/tab-manager.js');
const {IPC_CHANNELS, isTabsCommand} = require('../../dist/shared/ipc-contract.js');
const dir = process.argv.at(-1);
app.setPath('userData', path.join(dir, 'profile'));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.on('window-all-closed', () => {});
const until = async (probe, label) => {
  for (const end = Date.now() + 10000; Date.now() < end;) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error('Timed out: ' + label);
};
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)));

app.whenReady().then(async () => {
  const streams = new Set();
  const website = http.createServer((req, res) => {
    if (req.url === '/worker.js') {
      res.writeHead(200, {'content-type':'application/javascript'});
      return res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));");
    }
    if (req.url === '/events') {
      res.writeHead(200, {'content-type':'text/event-stream'}); res.write(': ready\n\n');
      streams.add(res); req.on('close', () => streams.delete(res)); return;
    }
    res.writeHead(200, {'content-type':'text/html'});
    res.end(`<!doctype html><title>Notification site</title><body>Notification site<input value="unsaved draft"><script>
      window.clicks=0; window.deliveries=0; window.notificationMode='page';
      window.registration=navigator.serviceWorker.register('/worker.js').then(()=>navigator.serviceWorker.ready);
      window.feed=new EventSource('/events');
      feed.onmessage=async event=>{
        window.deliveries++;
        if(window.notificationMode==='registration') {
          const registration=await window.registration;
          for(const note of await registration.getNotifications({tag:'inbox'}))note.close();
          await registration.showNotification('Website alert',{body:event.data,tag:'inbox',data:{senders:new Map([['sender','example']])}});
          window.persistentDelivered=true;
        } else {
          const note=new Notification('Website alert',{body:event.data});note.onclick=()=>window.clicks++;
        }
      };
    </script></body>`);
  });
  const web = await listen(website);
  const internal = http.createServer((req, res) => {
    res.writeHead(200, {'content-type':'text/html'});
    res.end(`<!doctype html><title>Breadboard ${req.url}</title><body style="background:#43885a">Breadboard ${req.url}<script>
      window.notices=[];
      if(location.pathname==='/notification-overlay') {
        breadboardDesktop.onNotificationToast(notice=>{notices.push(notice);document.body.textContent=notice.message;
          breadboardDesktop.resizeNotificationOverlay({width:320,height:100});});
        breadboardDesktop.resizeNotificationOverlay({width:0,height:0});
      }
    </script></body>`);
  });
  const origin = await listen(internal);
  const loading = path.join(dir, 'loading.html'); fs.writeFileSync(loading, '<!doctype html><body>Loading</body>');
  const manager = new TabManager({
    allowed:{origins:new Set([origin]),localFiles:new Set([pathToFileURL(loading).href])},
    preloadPath:path.resolve(__dirname,'../../dist/preload/preload.js'),
    loadingHtmlPath:()=>loading,recoveryHtmlPath:()=>loading,theme:()=> 'light',openWindow:()=>{},
    browserPreferencesConfigDir:path.join(dir,'preferences'),
  });
  ipcMain.handle(IPC_CHANNELS.getTabsState, event=>manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand,(event,command)=>isTabsCommand(command)&&manager.handleCommand(event.sender,command));
  ipcMain.handle('breadboard:get-browser-downloads',()=>({items:[],error:null}));
  ipcMain.handle('breadboard:get-browser-bookmarks',()=>[]);
  ipcMain.handle('breadboard:get-browser-recent-searches',()=>[]);
  manager.setBrowserUrl(origin + '/browser');
  manager.setNotificationOverlayUrl(origin + '/notification-overlay');
  manager.setNotificationsVisible(true);
  const window = new BrowserWindow({show:false,width:1000,height:750,
    webPreferences:{preload:path.resolve(__dirname,'../../dist/preload/preload.js'),contextIsolation:true,sandbox:true}});
  manager.attach(window, process.env.BB_NOTIFICATION_TEST_SHELL==='persistent');
  window.showInactive();
  const host = manager.hosts.get(window.id);
  const base = manager.baseContents(window);
  await base.loadURL(origin + '/dashboard');
  await until(()=>host.base.loaded && !host.pending,'dashboard ready');
  if (host.shell) await until(()=>host.shellEnabled,'persistent shell ready');
  const command = value=>manager.handleCommand(base,value);
  const overlay = host.notificationOverlay.contents;
  await until(()=>host.notificationOverlay.ready,'overlay listener ready');
  command({type:'browser-notification-permission',origin:web,permission:'granted'});
  const open = async (url = web + '/') => {
    assert.equal(command({type:'browser',url}),true);
    const tab = host.tabs.find(tab=>tab.id===host.activeId);
    await until(()=>tab.browser?.ready && !host.pending,'website ready').catch(async error=>{
      console.error(JSON.stringify({url,id:tab.id,active:host.activeId,ready:tab.browser?.ready,loaded:tab.loaded,committed:tab.browser.documentCommitted,attached:tab.browser.attached,painting:!!tab.browser.paintController,aborted:tab.browser.paintController?.signal.aborted,pending:!!host.pending,front:host.pendingAtFront,bounds:tab.browser.view.getBounds(),shellEnabled:host.shellEnabled,shellBounds:host.shell?.view.getBounds(),children:window.contentView.children.map(v=>({id:v.webContents?.id,bounds:v.getBounds()})),document:await tab.browser.contents.executeJavaScript('({visibility:document.visibilityState,ready:document.readyState,paints:performance.getEntriesByType("paint").map(p=>p.name)})')}));throw error;
    });
    return tab;
  };
  const close = async tab => {
    assert.equal(command({type:'close',id:tab.id}),true);
    await until(()=>!host.pending,'closed tab replaced');
    assert.equal(host.tabs.includes(tab),false,'closed site is absent from the tab strip');
  };
  const deliver = async message => {
    for (const stream of streams) stream.write('data: ' + message + '\n\n');
    await until(()=>overlay.executeJavaScript(`notices.some(n=>n.message===${JSON.stringify(message)})`),'server event reaches global overlay: ' + message);
    assert.equal(host.notificationOverlay.view.getBounds().y + host.notificationOverlay.view.getBounds().height, window.getContentSize()[1]);
    assert.equal(window.contentView.children.at(-1),host.notificationOverlay.view,'notification above the selected page');
    return overlay.executeJavaScript(`notices.find(n=>n.message===${JSON.stringify(message)}).website.id`);
  };

  const tab = await open();
  const page = tab.browser.contents;
  await until(()=>streams.size===1,'site connected');
  await deliver('Before closing');
  command({type:'browser-media-permission',origin:web,media:['microphone'],permission:'granted'});
  await page.executeJavaScript('navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{window.track=stream.getAudioTracks()[0]})',true);
  await close(tab);
  assert.equal(page.isDestroyed(),false,'notification connection survives closure');
  assert.equal(tab.browser.attached,false,'closed site has no native surface');
  assert.equal(page.isAudioMuted(),true,'closed site cannot play audio');
  await until(()=>page.executeJavaScript("track.readyState==='ended'"),'closing releases the microphone');
  assert.equal(await page.executeJavaScript("navigator.mediaDevices.getUserMedia({audio:true}).then(()=>false,error=>error.name==='NotAllowedError')"),true);
  assert.equal(await page.executeJavaScript('typeof breadboardDesktop'),'undefined','site remains sandboxed');
  await deliver('After closing');
  assert.equal(host.activeId,host.base.id,'delivery does not steal the selected page');
  for (const route of ['/garden','/dashboard?terminalChat=example','/browser/settings']) {
    await base.loadURL(origin + route);
    await deliver('On ' + route);
  }
  manager.setMemoryPressure('critical');
  const id = await deliver('After memory pressure');
  assert.equal(manager.handleCommand(base,{type:'browser-notification-action',id,action:'click'}),false);
  assert.equal(manager.handleCommand(overlay,{type:'browser-notification-action',id,action:'click'}),true);
  await until(()=>host.activeId===tab.id && !host.pending,'notification restores original tab');
  assert.equal(tab.browser.contents,page,'no duplicate page or reload');
  await until(()=>page.executeJavaScript('clicks===1'),'click callback delivered to original notification');
  assert.equal(await page.executeJavaScript("document.querySelector('input').value"),'unsaved draft');
  assert.equal(page.isAudioMuted(),false,'original audio preference restored');
  await close(tab);
  assert.equal(command({type:'reopen'}),true);
  await until(()=>host.activeId===tab.id && !host.pending,'Ctrl+Shift+T reuses background page');
  await close(tab);
  const reused = await open();
  assert.equal(reused,tab,'opening same URL reuses background page');
  // Snapchat's actual sequence: getNotifications -> close old notices ->
  // showNotification. Electron's native getNotifications never resolves.
  assert.deepEqual(await page.executeJavaScript('registration.then(r=>r.getNotifications()).then(notices=>notices.map(n=>n.title))'),[]);
  await page.executeJavaScript("window.notificationMode='registration'; true");
  await close(tab);
  const persistentId = await deliver('Service worker registration after closing');
  await until(()=>page.executeJavaScript('window.persistentDelivered===true'),'registration show promise resolves');
  assert.deepEqual(await page.executeJavaScript("registration.then(r=>r.getNotifications({tag:'inbox'})).then(notices=>notices.map(n=>({body:n.body,sender:n.data.senders.get('sender')})))"),
    [{body:'Service worker registration after closing',sender:'example'}],'notification data preserves Maps for message grouping');
  assert.deepEqual(await page.executeJavaScript("registration.then(r=>r.getNotifications({tag:'other'}))"),[]);
  await deliver('Replacement registration notice');
  assert.equal(await page.executeJavaScript('registration.then(r=>r.getNotifications()).then(n=>n.length)'),1,'replacement closes previous persistent card');
  assert.equal(manager.handleCommand(overlay,{type:'browser-notification-action',id:persistentId,action:'click'}),false,'replaced card is no longer actionable');
  const replacementId = await overlay.executeJavaScript("notices.find(n=>n.message==='Replacement registration notice').website.id");
  assert.equal(manager.handleCommand(overlay,{type:'browser-notification-action',id:replacementId,action:'click'}),true);
  await until(()=>host.activeId===tab.id && !host.pending,'registration alert restores closed source site');
  await until(()=>page.executeJavaScript('registration.then(r=>r.getNotifications()).then(n=>n.length===0)'),'clicked registration card leaves the store');
  command({type:'browser-notification-permission',origin:web,permission:'denied'});
  assert.equal(await page.executeJavaScript("registration.then(r=>r.showNotification('Blocked')).then(()=>false,e=>e instanceof TypeError)"),true,'registration API honors site permission');
  command({type:'browser-notification-permission',origin:web,permission:'granted'});
  await close(tab);
  assert.equal(command({type:'browser-notification-permission',origin:web,permission:'denied'}),true);
  await until(()=>page.isDestroyed(),'blocking permission destroys closed page');
  assert.equal(manager.backgroundNotificationTabs.size,0);

  command({type:'browser-notification-permission',origin:web,permission:'granted'});
  const one = await open(web + '/one');
  const onePage = one.browser.contents;
  await close(one);
  const two = await open(web + '/two');
  const twoPage = two.browser.contents;
  await close(two);
  await until(()=>onePage.isDestroyed(),'one background connection per origin');
  assert.equal(manager.backgroundNotificationTabs.size,1);
  command({type:'browser-notifications-enabled',enabled:false});
  await until(()=>twoPage.isDestroyed(),'global switch shuts down background pages');
  const denied = await open();
  const deniedPage = denied.browser.contents;
  await close(denied);
  await until(()=>deniedPage.isDestroyed(),'disabled notifications do not retain closed tabs');
  command({type:'browser-notifications-enabled',enabled:true});
  const redirected = await open();
  const redirectedPage = redirected.browser.contents;
  await close(redirected);
  void redirectedPage.loadURL(origin + '/other-origin').catch(()=>{});
  await until(()=>redirectedPage.isDestroyed(),'background page cannot carry permission to a different origin');
  const signedIn = await open();
  const signedInPage = signedIn.browser.contents;
  await close(signedIn);
  assert.equal(await manager.resetBrowserSignIns(),true,'reset remains available after tabs close');
  await until(()=>signedInPage.isDestroyed(),'reset stops background sites before clearing their cookies');
  const final = await open();
  const finalPage = final.browser.contents;
  await close(final);
  window.destroy();
  await until(()=>finalPage.isDestroyed(),'window shutdown cleans background sites');
  assert.equal(manager.backgroundNotificationTabs.size,0);
  fs.writeFileSync(path.join(dir,'passed.json'),JSON.stringify({passed:true}));
}).catch(error=>{console.error(error.stack||error);app.exit(1);});
