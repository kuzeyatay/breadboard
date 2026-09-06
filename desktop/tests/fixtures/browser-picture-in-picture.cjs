const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, Menu, webContents } = require('electron');
const { TabManager } = require('../../dist/main/tab-manager.js');
const { toggleBrowserPictureInPicture } = require('../../dist/main/browser-picture-in-picture.js');
const [dir] = process.argv.slice(2);
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) { if (await probe()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error(`Timed out: ${label}`);
};
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const videoHtml = `<!doctype html><title>PiP source</title><video id="small" autoplay muted style="width:80px;height:40px"></video><video id="large" autoplay muted controls style="width:640px;height:360px"></video><div id="shadow"></div>
  <script>
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');let frame=0;
    setInterval(()=>{ctx.fillStyle=frame++%2?'#1f684b':'#29497a';ctx.fillRect(0,0,640,360)},50);
    const stream=canvas.captureStream(20);for(const video of document.querySelectorAll('video'))video.srcObject=stream;
    window.pipEntries=0;const video=document.getElementById('large');
    video.addEventListener('enterpictureinpicture',()=>window.pipEntries++);
    window.presentedFrames=()=>{const quality=video.getVideoPlaybackQuality();return quality.totalVideoFrames-quality.droppedVideoFrames;};
  </script>`;

app.whenReady().then(async () => {
  const external = http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(videoHtml)});
  const videoOrigin = await listen(external);
  const server = http.createServer((req,res)=>{
    res.setHeader('Content-Type','text/html');
    if(req.url === '/embed')return res.end(`<!doctype html><iframe src="${videoOrigin}/" allow="picture-in-picture" style="width:800px;height:500px"></iframe>`);
    res.end('<!doctype html><title>Product tab</title>');
  });
  const origin = await listen(server);
  const loading=path.join(dir,'loading.html');fs.writeFileSync(loading,'<!doctype html>');
  const preload=path.resolve(__dirname,'../../dist/preload/preload.js');
  const manager=new TabManager({allowed:{origins:new Set([origin]),localFiles:new Set([pathToFileURL(loading).href])},preloadPath:preload,loadingHtmlPath:()=>loading,recoveryHtmlPath:()=>loading,theme:()=> 'light',openWindow:()=>{},log:console.log});
  manager.setBrowserUrl(origin+'/browser');
  const window=new BrowserWindow({show:false,width:1000,height:750,webPreferences:{preload,contextIsolation:true,sandbox:true}});
  manager.attach(window);await window.loadURL(origin+'/dashboard');window.showInactive();
  assert.equal(await manager.handleCommand(window.webContents,{type:'browser',url:videoOrigin}),true);
  let page;
  await until(()=>{page=webContents.getAllWebContents().find(contents=>contents.getURL()===videoOrigin+'/');return page&&!page.isLoading()},'source video');
  await until(()=>page.executeJavaScript("document.getElementById('large').readyState >= 2"),'video ready');
  await until(()=>window.contentView.children.some(view=>view.webContents?.id===page.id),'source view attached');
  const shell=webContents.getAllWebContents().find(contents=>contents.getURL()===origin+'/browser');
  const sourceId=manager.stateFor(shell).activeId;
  let menu;
  Menu.prototype.popup=function(){menu=this;};
  const choose=async id=>{
    manager.handleCommand(shell,{type:'browser-menu',x:800,y:60,profileLabel:'Fixture'});
    const item=menu.getMenuItemById(id);assert.ok(item,id);assert.equal(item.enabled,true);item.click();
  };
  await choose('picture-in-picture');
  await until(()=>page.executeJavaScript("document.pictureInPictureElement?.id === 'large'"),'largest playing video enters PiP');
  const pipBefore=await page.executeJavaScript('({time:document.pictureInPictureElement.currentTime,frames:window.presentedFrames()})');
  manager.handleCommand(shell,{type:'activate',id:1});
  // requestVideoFrameCallback belongs to the detached page's rendering steps.
  // Playback quality counts frames presented by the separate native PiP window.
  await until(()=>page.executeJavaScript(`Boolean(document.pictureInPictureElement && !document.pictureInPictureElement.paused && document.pictureInPictureElement.currentTime > ${pipBefore.time + .3} && window.presentedFrames() > ${pipBefore.frames + 2})`),'PiP continues rendering on a product tab');
  assert.equal(await manager.handleCommand(window.webContents,{type:'browser',url:origin+'/blank'}),true);
  await until(()=>manager.stateFor(window.webContents).tabs.some(tab=>tab.url===origin+'/blank'),'different browser tab');
  assert.equal(await page.executeJavaScript('!!document.pictureInPictureElement'),true,'PiP persists across browser tabs');
  const entries=await page.executeJavaScript('window.pipEntries');
  assert.equal(entries,1,'switching tabs never recreates the player');
  manager.handleCommand(window.webContents,{type:'activate',id:sourceId});
  await until(()=>window.contentView.children.some(view=>view.webContents?.id===page.id),'source tab reattached');
  page.sendInputEvent({type:'keyDown',keyCode:'P',modifiers:['alt']});
  page.sendInputEvent({type:'keyUp',keyCode:'P',modifiers:['alt']});
  await until(()=>page.executeJavaScript('!document.pictureInPictureElement'),'Alt+P closes existing PiP');

  await choose('extensions');
  await until(()=>menu.items.some(item=>item.label==='Picture in Picture (Built-in)'),'extensions menu opens');
  const builtIn=menu.items.find(item=>item.label==='Picture in Picture (Built-in)');
  assert.ok(builtIn,'built-in feature is discoverable among extensions');builtIn.click();
  await until(()=>page.executeJavaScript('!!document.pictureInPictureElement'),'built-in extension entry opens PiP');
  assert.equal(await toggleBrowserPictureInPicture(page),true);
  await until(()=>page.executeJavaScript('!document.pictureInPictureElement'),'toggle exits');

  // Respect a video's opt-out, and discover players in open shadow roots.
  await page.executeJavaScript("for (const video of document.querySelectorAll('video')) video.disablePictureInPicture=true");
  assert.equal(await toggleBrowserPictureInPicture(page),false);
  await page.executeJavaScript("const v=document.createElement('video');v.id='shadow-video';v.muted=true;v.autoplay=true;v.style='width:320px;height:180px';document.getElementById('shadow').attachShadow({mode:'open'}).append(v);v.srcObject=document.getElementById('large').srcObject;");
  await until(()=>page.executeJavaScript("document.getElementById('shadow').shadowRoot.querySelector('video').readyState>=2"),'shadow video ready');
  assert.equal(await toggleBrowserPictureInPicture(page),true);
  await until(()=>page.executeJavaScript('!!document.pictureInPictureElement'),'shadow player enters');
  assert.equal(await toggleBrowserPictureInPicture(page),true);

  await page.loadURL(origin+'/embed');
  await until(()=>page.mainFrame.frames.some(frame=>frame.url===videoOrigin+'/'),'embedded player loaded');
  const embedded=page.mainFrame.frames.find(frame=>frame.url===videoOrigin+'/');
  await until(()=>embedded.executeJavaScript("document.getElementById('large').readyState>=2"),'embedded video ready');
  assert.equal(await toggleBrowserPictureInPicture(page),true);
  await until(()=>embedded.executeJavaScript('!!document.pictureInPictureElement'),'cross-origin video enters PiP');
  await page.loadURL(origin+'/blank');
  assert.equal(await toggleBrowserPictureInPicture(page),false,'navigation to a page without video leaves no stale player');
  await page.loadURL(videoOrigin);
  await until(()=>page.executeJavaScript("document.getElementById('large').readyState>=2"),'source ready again');
  assert.equal(await toggleBrowserPictureInPicture(page),true);
  manager.handleCommand(shell,{type:'close',id:sourceId});
  await until(()=>page.isDestroyed(),'closing source releases its player');
  console.log('Verified menu, Alt+P, built-in entry, uninterrupted cross-tab playback, iframe and shadow players, opt-out, navigation and close.');
  fs.writeFileSync(path.join(dir,'passed.json'),JSON.stringify({passed:true}));
}).catch(error=>{console.error(error.stack||error);app.exit(1)});
