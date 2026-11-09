const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {app, Menu, ipcMain} = require('electron');
const {WindowManager} = require('../../dist/main/window-manager.js');
const {IPC_CHANNELS} = require('../../dist/shared/ipc-contract.js');
const dir = process.argv.at(-1);
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
};
app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><title>Terminal fixture</title><body>${req.url}<script>
      window.actions=[];window.addEventListener('breadboard:browser-menu-action',e=>actions.push(e.detail));
      </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scene = path.join(dir, 'scene.html'); fs.writeFileSync(scene, '<!doctype html>');
  const manager = new WindowManager({
    allowed:{origins:new Set([origin]),localFiles:new Set([pathToFileURL(scene).href])},
    preloadPath:path.resolve(__dirname,'../../dist/preload/preload.js'),
    startupHtmlPath:scene,recoveryHtmlPath:scene,loadingHtmlPath:scene,
    minimumStartupVisibleMs:0,browserHistoryConfigDir:dir,
  });
  ipcMain.handle(IPC_CHANNELS.getTabsState,event=>manager.tabs.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand,(event,command)=>manager.tabs.handleCommand(event.sender,command));
  manager.tabs.setEnabled(true);
  manager.tabs.setNewTabUrl(origin+'/new-tab');
  manager.tabs.setBrowserUrl(origin+'/browser');
  const window = manager.createMainWindow(); window.hide();
  const base = manager.page(window);
  await base.loadURL(origin+'/new-tab');
  const host = manager.tabs.hosts.get(window.id);
  const tab = host.tabs.find(tab=>tab.contents===base);
  let menu, anchor;
  Menu.prototype.popup = function(options) { menu=this;anchor=options;options.callback?.(); };
  const command = type => ({type,x:1000,y:60,profileLabel:'Fixture profile'});
  assert.equal(await manager.tabs.handleCommand(base,command('browser-menu')),true);
  assert.equal(menu.getMenuItemById('profile').label,'Settings');
  assert.equal(menu.getMenuItemById('save').enabled,false,'page-only actions retain browser-home rules');
  assert.equal(anchor.y,60+(tab.view?.getBounds().y??0),'native popup accounts for the Terminal view offset');
  for (const action of ['history','visited-pages','bookmarks','downloads']) {
    menu.getMenuItemById(action).click();
    await until(()=>base.executeJavaScript(`actions.includes(${JSON.stringify(action)})`),action+' delivered to Terminal');
  }
  assert.equal(await manager.tabs.handleCommand(base,command('browser-downloads-popover')),true);
  assert.ok(host.downloadsPopover);
  assert.equal(host.downloadsPopover.contents.getURL(),origin+'/browser/downloads-popover');
  assert.equal(manager.tabs.stateFor(base).tabs.find(t=>t.id===tab.id).downloadsOpen,true);
  host.downloadsPopover.resize(220);
  assert.equal(host.downloadsPopover.view.getBounds().y,60+(tab.view?.getBounds().y??0));
  assert.equal(await manager.tabs.handleCommand(host.downloadsPopover.contents,{type:'browser-downloads-show-all'}),true);
  assert.equal(host.downloadsPopover,undefined);
  assert.equal(manager.tabs.stateFor(base).tabs.find(t=>t.id===tab.id).downloadsOpen,false);
  menu.getMenuItemById('settings').click();
  await until(()=>host.tabs.some(t=>t.url===origin+'/browser/settings'),'real settings tab opened');
  assert.equal(await manager.tabs.handleCommand(base,command('browser-menu')),false,'inactive Terminal cannot open a menu');
  await manager.tabs.handleCommand(base,{type:'activate',id:tab.id});
  await base.loadURL(origin+'/profile');
  assert.equal(await manager.tabs.handleCommand(base,command('browser-menu')),false,'other local pages cannot impersonate Terminal');
  assert.equal(await manager.tabs.handleCommand(base,command('browser-downloads-popover')),false);
  console.log('Terminal native menu actions, downloads, coordinates and ownership checks passed');
  fs.writeFileSync(path.join(dir,'passed.json'),JSON.stringify({passed:true}));
}).catch(error=>{console.error(error.stack);app.exit(1);});
