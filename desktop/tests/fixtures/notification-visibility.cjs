const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { app, ipcMain, webContents } = require('electron');
const { WindowManager } = require('../../dist/main/window-manager.js');
const { isTabsCommand, IPC_CHANNELS } = require('../../dist/shared/ipc-contract.js');
const dir = process.argv[2];
app.setPath('userData', path.join(dir, 'user-data'));
const until = async (probe, label) => {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw Error('Timed out: ' + label);
};

app.whenReady().then(async () => {
  let inbox = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js' || req.url === '/style.css') {
      res.setHeader('Content-Type', req.url.endsWith('.js') ? 'application/javascript' : 'text/css');
      res.end(fs.readFileSync(path.join(dir, req.url.slice(1))));
    } else if (req.url.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ messages: inbox }));
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html data-breadboard-desktop="true"><head><title>Notification fixture</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const loading = path.join(dir, 'loading.html');
  fs.writeFileSync(loading, '<!doctype html><body>Loading</body>');
  const manager = new WindowManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).toString()]) },
    startupHtmlPath: loading, recoveryHtmlPath: loading, loadingHtmlPath: loading,
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'), minimumStartupVisibleMs: 0,
  });
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.tabs.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) =>
    isTabsCommand(command) && manager.tabs.handleCommand(event.sender, command));
  const window = manager.createMainWindow();
  window.setOpacity(0);
  window.showInactive();
  window.setContentSize(1000, 800);
  const base = window.webContents;
  await base.loadURL(origin + '/dashboard');
  manager.tabs.setNotificationOverlayUrl(origin + '/notification-overlay');
  manager.tabs.setNotificationsVisible(true);
  let overlay;
  await until(() => (overlay = webContents.getAllWebContents().find(c => c.getURL() === origin + '/notification-overlay')), 'overlay created');
  await until(() => overlay.executeJavaScript('Boolean(document.querySelector(".bb-notification-overlay-page"))'), 'overlay mounted');
  const view = window.contentView.children.find(child => child.webContents === overlay || child.children.some(nested => nested.webContents === overlay));
  // Electron 33 exposes setVisible without a getter. Record the native calls
  // while still applying them to the real view and checking its painted bounds.
  let visible;
  const setVisible = view.setVisible.bind(view);
  view.setVisible = value => { visible = value; setVisible(value); };
  manager.tabs.setNotificationsVisible(true);
  const geometry = () => overlay.executeJavaScript(`(() => {
    const host=document.querySelector('.bb-desktop-toast-host');
    const card=host?.firstElementChild;
    const response=document.querySelector('[aria-label="AI response"]');
    const rect=element=>element ? {width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height} : null;
    return {viewport:{width:innerWidth,height:innerHeight,outerWidth,outerHeight},host:rect(host),card:rect(card),response:rect(response)};
  })()`);
  const assertVisible = async label => {
    await until(() => view.getBounds().x < window.getContentSize()[0] - 1 && view.getBounds().y >= 0, label + ' is onscreen');
    assert.equal(visible, true, label + ' native view is visible');
    const children = window.contentView.children;
    assert.equal(children[children.length - 1], view, label + ' is above the active tab');
    await until(async () => !(await overlay.capturePage(undefined, {stayHidden:true})).isEmpty(), label + ' paints');
  };

  manager.tabs.publishNotificationToast(base, {id:'small',type:'success',message:'Saved'});
  await assertVisible('Short notification');
  const short = await geometry();
  assert.ok(short.card.height > 30, JSON.stringify(short));

  inbox = [{ id:'answer',title:'Response ready',type:'success',chatTitle:'Thermodynamics',
    response:'A complete answer that must be visible while voice reads it. '.repeat(80),
    target:{surface:'dashboard_terminal',chatId:'other-chat'},updatedAt:new Date().toISOString() }];
  await base.executeJavaScript(`window.deliverInbox(${JSON.stringify(inbox)})`);
  await assertVisible('Response notification');
  await until(async () => (await geometry()).response?.height > 100, 'readable response area after a short notification').catch(async error => { throw Error(error.message + ': ' + JSON.stringify(await geometry())); });
  assert.ok((await geometry()).response.width > 500, 'a response can grow wider than the previous short toast');
  const assertCardBounds = async () => {
    const measured = await geometry();
    const bounds = view.getBounds();
    const [width, height] = window.getContentSize();
    assert.ok(Math.abs(bounds.width - measured.host.width) <= 1, JSON.stringify({bounds,measured}));
    assert.ok(Math.abs(bounds.height - measured.host.height) <= 1, JSON.stringify({bounds,measured}));
    assert.equal(bounds.x + bounds.width, width);
    assert.equal(bounds.y + bounds.height, height);
  };
  await assertCardBounds();
  manager.tabs.handleCommand(base, {type:'voice-overlay',open:true});
  await assertVisible('Response notification during voice');
  manager.tabs.handleCommand(base, {type:'voice-overlay',open:false});

  window.setContentSize(1000, 650);
  await until(async () => Math.abs((await geometry()).viewport.height - window.getContentSize()[1]) <= 1 && (await geometry()).viewport.height < 800, 'renderer follows the resized window').catch(async error => { throw Error(error.message + ': ' + JSON.stringify({size:window.getContentSize(), geometry:await geometry()})); });
  await until(async () => Math.abs(view.getBounds().height - (await geometry()).host.height) <= 1, 'resized card bounds settle');
  await assertCardBounds();
  assert.ok((await geometry()).response.height > 100, 'resized response remains readable');
  if (process.env.BREADBOARD_NOTIFICATION_QA_DIR) {
    const output = path.resolve(process.env.BREADBOARD_NOTIFICATION_QA_DIR);
    fs.mkdirSync(output, {recursive:true});
    fs.writeFileSync(path.join(output, 'response.png'), (await overlay.capturePage(undefined, {stayHidden:true})).toPNG());
    fs.writeFileSync(path.join(output, 'geometry.json'), JSON.stringify({bounds:view.getBounds(), ...(await geometry())}, null, 2));
  }

  inbox = [];
  await overlay.executeJavaScript('document.querySelectorAll("[aria-label=\\"Dismiss message\\"]").forEach(button=>button.click())');
  await until(() => view.getBounds().y < 0, 'empty overlay parked after dismissing all cards');
  inbox = [{id:'next-answer',title:'Response ready',type:'success',chatTitle:'Next chat',response:'A newly completed response.',target:{surface:'dashboard_terminal',chatId:'next-chat'},updatedAt:new Date().toISOString()}];
  await base.executeJavaScript(`window.deliverInbox(${JSON.stringify(inbox)})`);
  await assertVisible('New response after dismissal');
  await until(async () => (await geometry()).response?.height > 10, 'new response paints after the overlay was empty');

  manager.tabs.setNotificationsVisible(false);
  assert.equal(visible, false, 'startup still controls notification visibility');
  assert.equal(overlay.isAudioMuted(), true, 'hidden startup notifications cannot chime');
  manager.tabs.setNotificationsVisible(true);
  await assertVisible('Notifications after startup');

  // App Router navigation and full loads both keep the timer free of cards.
  await base.executeJavaScript("history.pushState({}, '', '/pomodoro?theme=dark')");
  await until(() => visible === false, 'notifications hidden on same-document Pomodoro navigation');
  manager.tabs.publishNotificationToast(base, {id:'during-focus',type:'success',message:'Ready after focus'});
  await until(() => overlay.executeJavaScript("document.body.textContent.includes('Ready after focus')"), 'notification retained during focus');
  manager.tabs.resizeNotificationOverlay(overlay, {width:608,height:424});
  assert.equal(visible, false, 'incoming notifications cannot reveal the Pomodoro overlay');
  assert.equal(overlay.isAudioMuted(), true, 'incoming notifications cannot chime during Pomodoro');
  await base.loadURL(origin + '/dashboard');
  await assertVisible('Notifications restored after leaving Pomodoro');

  const baseId = manager.tabs.stateFor(base).activeId;
  manager.tabs.handleCommand(base, {type:'open',url:origin + '/pomodoro/'});
  await until(() => visible === false, 'notifications hidden in a new Pomodoro tab');
  const pomodoroId = manager.tabs.stateFor(base).activeId;
  assert.notEqual(pomodoroId, baseId);
  manager.tabs.handleCommand(base, {type:'activate',id:baseId});
  await assertVisible('Notifications restored by switching tabs');
  manager.tabs.handleCommand(base, {type:'activate',id:pomodoroId});
  await until(() => visible === false, 'notifications hidden when reselecting Pomodoro');
  manager.tabs.setNotificationsVisible(false);
  manager.tabs.handleCommand(base, {type:'activate',id:baseId});
  assert.equal(visible, false, 'leaving Pomodoro preserves the global notification setting');
  manager.tabs.setNotificationsVisible(true);
  await assertVisible('Notifications restored after enabling the global setting');

  assert.equal(overlay.isAudioMuted(), !window.isFocused(), 'only a foreground notification can chime');
  window.hide();
  assert.equal(overlay.isAudioMuted(), true, 'hiding the window silences its notifications');
  window.showInactive();
  window.minimize();
  await until(() => overlay.isAudioMuted(), 'minimized notifications are silent');

  window.destroy();
  server.closeAllConnections();
  server.close();
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
