const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {app, BrowserWindow, ipcMain, session} = require('electron');
const {TabManager, BROWSER_SESSION_PARTITION} = require('../../dist/main/tab-manager.js');
const {IPC_CHANNELS, isTabsCommand} = require('../../dist/shared/ipc-contract.js');
const dir = process.argv.at(-1);
const phase = process.argv.at(-2);
app.setPath('userData', path.join(dir, 'profile'));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.on('window-all-closed', () => {});
const until = async (probe, label) => {
  for (const end = Date.now() + 15000; Date.now() < end;) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error('Timed out: ' + label);
};
const listen = (server, port = 0) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port));
});

app.whenReady().then(async () => {
  const streams = new Set();
  const requests = [];
  const website = http.createServer((req, res) => {
    if (req.url === '/events') {
      assert.match(req.headers.cookie || '', /signedIn=yes/, 'receivers reuse the saved browser sign-in');
      res.writeHead(200, {'content-type':'text/event-stream'}); res.write(': ready\n\n');
      streams.add(res); req.on('close', () => streams.delete(res)); return;
    }
    requests.push(req.url);
    res.writeHead(200, {'content-type':'text/html'});
    res.end(`<!doctype html><title>Messages</title><body>Inbox<script>
      window.initialPermission=Notification.permission;
      window.feed=new EventSource('/events');
      feed.onmessage=event=>new Notification('Message after restart',{body:event.data});
    </script></body>`);
  });
  const addressFile = path.join(dir, 'website-port.json');
  const port = fs.existsSync(addressFile) ? JSON.parse(fs.readFileSync(addressFile, 'utf8')) : 0;
  const web = await listen(website, port);
  fs.writeFileSync(addressFile, JSON.stringify(website.address().port));
  const internal = http.createServer((req, res) => {
    res.writeHead(200, {'content-type':'text/html'});
    res.end(`<!doctype html><title>Breadboard</title><body>Breadboard<script>
      window.notices=[];
      if(location.pathname==='/notification-overlay') {
        breadboardDesktop.onNotificationToast(n=>{notices.push(n);breadboardDesktop.resizeNotificationOverlay({width:320,height:100});});
        breadboardDesktop.resizeNotificationOverlay({width:0,height:0});
      }
    </script></body>`);
  });
  const origin = await listen(internal);
  const loading = path.join(dir, 'loading.html'); fs.writeFileSync(loading, '<!doctype html><body>Loading</body>');
  const preferences = path.join(dir, 'preferences');
  const manager = new TabManager({
    allowed:{origins:new Set([origin]),localFiles:new Set([pathToFileURL(loading).href])},
    preloadPath:path.resolve(__dirname,'../../dist/preload/preload.js'),
    loadingHtmlPath:()=>loading,recoveryHtmlPath:()=>loading,theme:()=> 'light',openWindow:()=>{},
    browserPreferencesConfigDir:preferences, browserHistoryConfigDir:preferences,
    tabSessionConfigDir:preferences,
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
  if (host.shell) await until(()=>host.shellEnabled,'shell ready');
  await manager.restoreSession(window, origin + '/dashboard', ()=>{throw Error('unexpected extra window');});
  const command = value=>manager.handleCommand(base,value);
  const overlay = host.notificationOverlay.contents;
  await until(()=>host.notificationOverlay.ready,'notification overlay ready');
  const profile = session.fromPartition(BROWSER_SESSION_PARTITION);
  const close = async tab => {
    assert.equal(command({type:'close',id:tab.id}),true);
    await until(()=>!host.pending,'closed tab replaced');
  };
  const deliver = async message => {
    await until(()=>streams.size===1,'exactly one receiver connected');
    for (const stream of streams) stream.write('data: ' + message + '\n\n');
    await until(()=>overlay.executeJavaScript(`notices.some(n=>n.message===${JSON.stringify(message)})`),'message received: ' + message);
    return overlay.executeJavaScript(`notices.find(n=>n.message===${JSON.stringify(message)}).website.id`);
  };
  if (phase === 'seed') {
    await profile.cookies.set({url:web,name:'signedIn',value:'yes',expirationDate:Date.now()/1000+86400});
    command({type:'browser-notification-permission',origin:web,permission:'granted'});
    command({type:'browser',url:web + '/web/inbox'});
    const tab = host.tabs.find(tab=>tab.id===host.activeId);
    await until(()=>tab.browser?.ready && !host.pending,'first visit ready');
    await deliver('Initial visit');
    await close(tab);
    assert.equal(manager.backgroundNotificationTabs.size,1);
  } else if (phase === 'reset' || phase === 'paused') {
    assert.equal(manager.backgroundNotificationTabs.size,0,'disabled/reset sites stay stopped on startup');
    assert.equal(host.tabs.some(tab=>tab.browser),false);
    assert.deepEqual(requests,[],'startup made no requests to the website');
    if (phase === 'paused') {
      command({type:'browser-notifications-enabled',enabled:true});
      const id = await deliver('Resumed without opening the site');
      const page = [...manager.backgroundNotificationTabs.keys()][0];
      assert.equal(manager.handleCommand(overlay,{type:'browser-notification-action',id,action:'click'}),true);
      await until(()=>!host.pending && host.tabs.some(tab=>tab.browser?.contents===page),'click opens the existing receiver');
      assert.equal(manager.backgroundNotificationTabs.size,0);
      assert.equal(requests.filter(url=>url==='/web/inbox').length,1,'click does not reload the app');
    }
  } else if (phase === 'restore') {
    const selected = host.activeId;
    await deliver('No tab opened after restart');
    assert.equal(host.activeId,selected,'startup and messages preserve the selected tab');
    assert.equal(host.tabs.some(tab=>tab.browser),false,'restoration does not add a visible tab');
    assert.equal(manager.backgroundNotificationTabs.size,1);
    const [page, entry] = [...manager.backgroundNotificationTabs][0];
    assert.equal(page.getURL(),web + '/web/inbox','app path survives restart');
    assert.equal(page.isAudioMuted(),true);
    assert.equal(entry.tab.browser.attached,false);
    assert.equal(await page.executeJavaScript('initialPermission'),'granted');
    assert.equal(await page.executeJavaScript('typeof breadboardDesktop'),'undefined');
    assert.equal(await page.executeJavaScript("navigator.mediaDevices.getUserMedia({audio:true}).then(()=>false,e=>e.name==='NotAllowedError')"),true);
    command({type:'browser-notifications-enabled',enabled:false});
    await until(()=>page.isDestroyed(),'global disable stops restarted receiver');
  } else if (phase === 'existing') {
    await deliver('Saved open tab receives without selecting it');
    assert.equal(manager.backgroundNotificationTabs.size,0,'saved tab is reused without a duplicate receiver');
    const tab = host.tabs.find(tab=>tab.browser);
    assert.ok(tab);
    assert.notEqual(host.activeId,tab.id);
    await close(tab);
    const page = tab.browser.contents;
    command({type:'browser-notification-permission',origin:web,permission:'denied'});
    await until(()=>page.isDestroyed(),'revocation destroys receiver');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(preferences,'browser-notification-pages.json'),'utf8')).pages,{});
    command({type:'browser-notification-permission',origin:web,permission:'granted'});
    command({type:'browser',url:web + '/web/inbox'});
    const reopened = host.tabs.find(tab=>tab.id===host.activeId);
    await until(()=>reopened.browser?.ready && !host.pending,'website ready before reset');
    await close(reopened);
    assert.equal(await manager.resetBrowserSignIns(),true);
    assert.equal(manager.backgroundNotificationTabs.size,0);
  }
  manager.freezeSession();
  await profile.cookies.flushStore();
  profile.flushStorageData();
  fs.writeFileSync(path.join(dir,'passed.json'),JSON.stringify({passed:true}));
}).catch(error=>{console.error(error.stack||error);app.exit(1);});
