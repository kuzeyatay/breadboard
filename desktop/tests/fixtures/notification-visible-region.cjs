const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn,spawnSync} = require('node:child_process');
const {createInterface} = require('node:readline');
const {app, BrowserWindow, WebContentsView, View, ipcMain, screen} = require('electron');
const [compiled, dir] = process.argv.slice(2);
const {watchNotificationVisibility, notificationVisibleRects, setNotificationViewVisible, trackTransparentNotificationView} = require(path.join(compiled, 'main/notification-visible-region.js'));
app.setPath('userData', path.join(dir, 'profile'));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => {});
const pause = ms => new Promise(r => setTimeout(r, ms));
const until = async (probe, label) => {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) { if (await probe()) return; await pause(25); }
  throw Error('Timed out: '+label);
};
let foreign, stop, window;
const progress={passed:false,receipts:[]};
app.whenReady().then(async () => {
  const primary = screen.getPrimaryDisplay().workArea;
  window = new BrowserWindow({show:false, frame:false, alwaysOnTop:true, x:primary.x+20,y:primary.y+40,width:640,height:480,
    webPreferences:{preload:path.join(dir,'preload.cjs'),contextIsolation:true,backgroundThrottling:false}});
  // This fixture isolates native pixel geometry. The renderer's focus rule
  // (unfocused window = not reading) is covered by chat-notification-visibility-browser.test.mjs.
  const state = contents => ({selfId:1,activeId:1,visibleIds:[1],windowFocused:true,
    enabled:true,tabs:[],extensions:[],notificationVisibleRects:notificationVisibleRects(window,contents)});
  ipcMain.handle('test-state',event=>state(event.sender));
  let child;
  stop=watchNotificationVisibility(window,()=>{
    for(const wc of [window.webContents,child?.webContents].filter(Boolean)) if(!wc.isDestroyed())wc.send('test-state',state(wc));
  });
  await window.loadFile(path.join(dir,'surface.html'));
  window.show();window.focus();
  const hostHandle=window.getNativeWindowHandle().readBigUInt64LE().toString();
  const activate=spawnSync(path.join(dir,'notification-cover.exe'),['focus-owned',hostHandle,String(process.pid)],{encoding:'utf8',windowsHide:true});
  assert.equal(activate.stdout.trim(),'input-sent',activate.stderr);
  await until(()=>spawnSync(path.join(dir,'notification-cover.exe'),['foreground'],{encoding:'utf8',windowsHide:true}).stdout.trim()===hostHandle,'actual Win32 host foreground');
  await until(()=>window.isFocused(),'host focus');
  const result=()=>window.webContents.executeJavaScript('window.isViewed()');
  try { await until(result,'focused message is visible'); }
  catch(error) {
    console.error('native window',window.getNativeWindowHandle(),spawnSync(path.join(dir,'notification-cover.exe'),['window-state',window.getNativeWindowHandle().readBigUInt64LE().toString()],{encoding:'utf8',windowsHide:true}).stdout);
    console.error('visibility diagnostic',state(window.webContents),window.getContentBounds(),await window.webContents.executeJavaScript(`(async()=>({focus:document.hasFocus(),visibility:document.visibilityState,viewport:[innerWidth,innerHeight],message:document.querySelector('[data-chat-selectable-message]').getBoundingClientRect().toJSON(),state:await breadboardDesktop.getTabsState()}))()`));throw error;
  }
  const receipts = progress.receipts;receipts.push({case:'focused with Win32 foreground verified',visible:true});
  const bounds=window.getContentBounds();
  const beside={x:bounds.x+650,y:bounds.y,width:200,height:150};
  const initial=screen.dipToScreenRect(window,beside);
  foreign=spawn(path.join(dir,'notification-cover.exe'),[initial.x,initial.y,initial.width,initial.height].map(String),{windowsHide:false,stdio:['pipe','pipe','pipe']});
  const lines=createInterface({input:foreign.stdout});const queued=[];const waiters=[];
  lines.on('line',line=>{const next=waiters.shift();if(next)next(line);else queued.push(line);});
  const nextLine=()=>queued.length?Promise.resolve(queued.shift()):new Promise(resolve=>waiters.push(resolve));
  assert.equal(await nextLine(),'ready');
  async function cover(rect){
    const physical=screen.dipToScreenRect(window,rect);
    foreign.stdin.write([physical.x,physical.y,physical.width,physical.height].join(',')+'\n');
    assert.equal(await nextLine(),'focused','the other process actually has keyboard focus');
    await until(()=>!window.isFocused(),'Breadboard loses focus');
    await pause(180);
  }
  await cover(beside);assert.equal(await result(),true);receipts.push({case:'pixels uncovered with other app focused (geometry only)',visible:true});
  // Resource sampling belongs in a dedicated audit. Other app instances can
  // legitimately run the same executable during this test.
  const performance={notMeasured:true};
  progress.performance=performance;
  await cover({x:bounds.x+60,y:bounds.y+70,width:300,height:100});
  await until(async()=>!await result(),'message is covered');receipts.push({case:'only message covered',visible:false});
  await cover({x:bounds.x+120,y:bounds.y,width:520,height:480});
  assert.equal(await result(),true);receipts.push({case:'40px readable strip',visible:true});
  await cover(bounds);await until(async()=>!await result(),'whole window covered');
  receipts.push({case:'whole window covered',visible:false});
  await cover(beside);await until(result,'uncovered while still unfocused');
  window.setOpacity(0);await until(async()=>!await result(),'zero opacity');
  receipts.push({case:'native window at zero opacity',visible:false});
  window.setOpacity(1);await until(result,'native opacity restored');
  window.minimize();await until(async()=>!await result(),'minimized');
  receipts.push({case:'minimized',visible:false});
  window.restore();await cover(beside);await until(result,'restored');
  window.webContents.setZoomFactor(1.5);await until(result,'zoomed');
  await cover({x:bounds.x+80,y:bounds.y+100,width:450,height:150});
  await until(async()=>!await result(),'zoomed message covered');receipts.push({case:'zoom 150 percent covered',visible:false});
  await cover(beside);await until(result,'zoomed uncovered');
  // Native Ask Here uses an oversized renderer clipped by a parent View.
  const parent=new View();parent.setBounds({x:300,y:200,width:300,height:200});window.contentView.addChildView(parent);
  child=new WebContentsView({webPreferences:{preload:path.join(dir,'preload.cjs'),contextIsolation:true,backgroundThrottling:false}});
  parent.addChildView(child);child.setBounds({x:-50,y:-30,width:640,height:480});
  await child.webContents.loadFile(path.join(dir,'surface.html'));
  await until(()=>child.webContents.executeJavaScript('window.isViewed()'),'nested native view');
  await cover({x:bounds.x+300,y:bounds.y+200,width:300,height:200});
  await until(()=>notificationVisibleRects(window,child.webContents).length===0,'nested native pixels covered');
  assert.equal(await child.webContents.executeJavaScript('window.isViewed()'),true,'the same answer is still visible in the main chat');
  receipts.push({case:'covered duplicate is seen in another surface',visible:true});
  await child.webContents.loadFile(path.join(dir,'surface.html'),{query:{surface:'native-answer'}});
  await until(async()=>!await child.webContents.executeJavaScript('window.isViewed()'),'nested native view covered');
  receipts.push({case:'nested native answer covered',visible:false});
  await cover(beside);await until(()=>child.webContents.executeJavaScript('window.isViewed()'),'nested native view uncovered');
  const sibling=new WebContentsView({webPreferences:{contextIsolation:true,backgroundThrottling:false}});
  sibling.setBackgroundColor('#123456');sibling.setBounds(parent.getBounds());window.contentView.addChildView(sibling);
  await sibling.webContents.loadURL('data:text/html,<body style="margin:0;background:rgb(18,52,86);height:100vh">Another native panel</body>');
  await until(async()=>!await child.webContents.executeJavaScript('window.isViewed()'),'higher native sibling covers distinct answer');
  receipts.push({case:'higher native sibling covers distinct answer',visible:false});
  sibling.setBounds({x:370,y:200,width:230,height:200});
  await until(()=>child.webContents.executeJavaScript('window.isViewed()'),'40px native sibling strip');
  receipts.push({case:'40px native sibling strip',visible:true});
  sibling.setBounds({x:331,y:200,width:269,height:200});
  await until(async()=>!await child.webContents.executeJavaScript('window.isViewed()'),'1px native sibling sliver');
  receipts.push({case:'1px native sibling sliver',visible:false});
  setNotificationViewVisible(sibling,false);
  await until(()=>child.webContents.executeJavaScript('window.isViewed()'),'hidden sibling does not cover the answer');
  receipts.push({case:'hidden native sibling',visible:true});
  setNotificationViewVisible(sibling,true);
  await until(async()=>!await child.webContents.executeJavaScript('window.isViewed()'),'reshown native sibling covers');
  window.contentView.addChildView(parent);
  await until(()=>child.webContents.executeJavaScript('window.isViewed()'),'native sibling moved behind answer');
  receipts.push({case:'native sibling behind answer',visible:true});
  window.contentView.removeChildView(sibling);sibling.webContents.close();
  const transparent=new WebContentsView({webPreferences:{contextIsolation:true,backgroundThrottling:false}});
  transparent.setBackgroundColor('#00000000');transparent.setBounds({x:0,y:0,width:640,height:480});
  trackTransparentNotificationView(transparent,'.painted');window.contentView.addChildView(transparent);
  await transparent.webContents.loadURL('data:text/html,<body style="margin:0;background:transparent"><div class="painted" style="position:absolute;left:600px;top:0;width:40px;height:40px;background:rgb(18,52,86)">Panel</div></body>');
  await until(()=>child.webContents.executeJavaScript('window.isViewed()'),'full-size transparent native shell leaves the answer visible');
  receipts.push({case:'full-size transparent native shell',visible:true});
  await transparent.webContents.executeJavaScript(`Object.assign(document.querySelector('.painted').style,{left:'300px',top:'200px',width:'300px',height:'200px'})`);
  await until(async()=>!await child.webContents.executeJavaScript('window.isViewed()'),'actual painted panel covers answer');
  receipts.push({case:'painted panel inside transparent shell',visible:false});
  await transparent.webContents.executeJavaScript(`document.querySelector('.painted').style.left='370px'`);
  await until(()=>child.webContents.executeJavaScript('window.isViewed()'),'transparent margin beside painted panel');
  receipts.push({case:'transparent margin beside painted panel',visible:true});
  await transparent.webContents.executeJavaScript(`document.querySelector('.painted').style.left='300px'`);
  await until(async()=>!await child.webContents.executeJavaScript('window.isViewed()'),'painted panel moved back');
  await transparent.webContents.executeJavaScript(`document.querySelector('.painted').remove()`);
  await until(()=>child.webContents.executeJavaScript('window.isViewed()'),'removed painted panel leaves no stale cover');
  receipts.push({case:'removed painted panel',visible:true});
  window.contentView.removeChildView(transparent);transparent.webContents.close();
  // Mapping must change even if foreign windows do not move.
  parent.setBounds({x:300,y:200,width:10,height:10});
  await until(async()=>!await child.webContents.executeJavaScript('window.isViewed()'),'native parent clip changes');
  receipts.push({case:'native parent clipped',visible:false});
  child.webContents.close();stop();stop=undefined;
  foreign.stdin.end('close\n');await pause(80);foreign.kill();foreign=undefined;
  window.destroy();window=undefined;
  fs.writeFileSync(path.join(dir,'passed.json'),JSON.stringify({passed:true,receipts,performance},null,2));
  console.log(JSON.stringify({passed:true,receipts,performance}));app.exit(0);
}).catch(error=>{
  fs.writeFileSync(path.join(dir,'partial.json'),JSON.stringify({...progress,error:error.stack},null,2));
  console.error(error);stop?.();foreign?.kill();if(window&&!window.isDestroyed())window.destroy();app.exit(1);
});
