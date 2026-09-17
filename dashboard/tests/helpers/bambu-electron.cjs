// Electron host for the real task renderer and HTTP route/service test fixture.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const profile=path.join(process.argv.at(-2),'electron-profile');
fs.mkdirSync(profile,{recursive:true});
app.setPath('userData',profile);
app.whenReady().then(async()=>{
  // Keep ordinary Chromium compositing: Electron 33's offscreen capture can
  // return damaged incremental tiles on Windows. The test windows stay outside
  // the visible desktop and never take focus or appear in the taskbar.
  const options={x:-12000,y:-12000,width:1000,height:1000,show:false,skipTaskbar:true,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}};
  const window=new BrowserWindow(options);
  window.showInactive();
  await window.webContents.session.clearStorageData();
  await window.loadURL(process.argv.at(-1));
  const qa=process.argv.at(-2), request=path.join(qa,'capture-request.json');
  let capturing=false;
  const timer=setInterval(async()=>{
    const windowRequest=path.join(qa,'window-request.json');
    if(fs.existsSync(windowRequest)){fs.unlinkSync(windowRequest);const second=new BrowserWindow(options);second.showInactive();void second.loadURL(process.argv.at(-1)+'/?garden=1');}
    if(capturing || !fs.existsSync(request))return;capturing=true;
    try { const {name}=JSON.parse(fs.readFileSync(request,'utf8'));fs.unlinkSync(request);if(!/^[a-z-]+\.png$/.test(name))throw Error('Invalid screenshot name');const rect=await window.webContents.executeJavaScript('window.scrollTo(0,0);({x:0,y:0,width:innerWidth,height:innerHeight})');await new Promise(r=>setTimeout(r,250));const png=await window.webContents.capturePage(rect,{stayHidden:true,stayAwake:true});fs.writeFileSync(path.join(qa,name),png.toPNG());fs.writeFileSync(path.join(qa,'capture-done.json'),JSON.stringify({name})); }
    catch(error){fs.writeFileSync(path.join(qa,'capture-done.json'),JSON.stringify({error:error.message}));}
    finally{capturing=false;}
  },50);
  app.on('before-quit',()=>clearInterval(timer));
});
app.on('window-all-closed',()=>app.quit());
