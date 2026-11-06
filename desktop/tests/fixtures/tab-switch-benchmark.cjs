const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const { TabManager } = require("../../dist/main/tab-manager.js");
const { mainWindowOptions } = require("../../dist/main/window-options.js");
const { IPC_CHANNELS, isTabsCommand } = require("../../dist/shared/ipc-contract.js");
const [dir, mode, probeExe, reportPath] = process.argv.slice(2);
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (probe, name) => {
  for (let end = Date.now()+20000; Date.now()<end;) { if (await probe()) return; await sleep(10); }
  throw Error("Timed out: "+name);
};
const color = n => `#${(0x346c91+n*0x030201).toString(16).padStart(6,'0')}`;
const percentiles = values => {
  const sorted = [...values].sort((a,b)=>a-b);
  return Object.fromEntries([50,95,99].map(p=>['p'+p,sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p/100)-1)]]));
};
app.whenReady().then(async () => {
  const shellDir = path.resolve(__dirname,"../../dist/window-shell");
  const server = http.createServer((req,res) => {
    const asset = {"/controls.js":"index.js","/controls.css":"index.css","/shell.css":"shell.css"}[req.url];
    if(asset){res.setHeader('content-type',asset.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(path.join(shellDir,asset)));return;}
    const n = Number(new URL(req.url,'http://fixture').searchParams.get('n')) || 0;
    res.setHeader('content-type','text/html');
    res.end(`<!doctype html><html data-breadboard-desktop="true"><title>Fixture ${n}</title><link rel="stylesheet" href="/shell.css"><link rel="stylesheet" href="/controls.css"><style>body{margin:0;background:${color(n)}!important;min-height:100vh}#work{position:fixed;left:100px;top:180px;width:150px;height:60px}canvas{position:fixed;right:40px;top:180px}</style><body><div id="root"></div><button id="work" onclick="document.body.style.setProperty('background','#102030','important')">Usable ${n}</button><input value="Unsaved draft ${n}" style="position:fixed;left:100px;top:260px"><canvas width="150" height="100"></canvas><script>const c=document.querySelector('canvas').getContext('2d');c.fillStyle='#abcdef';c.fillRect(0,0,150,100)</script>${mode==='baseline'?'<script src="/controls.js"></script>':''}</body></html>`);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const preload = path.resolve(__dirname,"../../dist/preload/preload.js");
  const manager = new TabManager({allowed:{origins:new Set([origin]),localFiles:new Set()},loadingHtmlPath:()=>path.join(shellDir,"index.html"),recoveryHtmlPath:()=>path.join(shellDir,"index.html"),preloadPath:preload,theme:()=>"light",openWindow:()=>{throw Error('Unexpected window')}});
  manager.setBrowserUrl(origin+'/browser');
  ipcMain.handle(IPC_CHANNELS.getTabsState,e=>manager.stateFor(e.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand,(e,c)=>isTabsCommand(c)&&manager.handleCommand(e.sender,c));
  for(const name of ['getBrowserBookmarks','getBrowserRecentSearches'])ipcMain.handle(IPC_CHANNELS[name],()=>[]);
  ipcMain.handle(IPC_CHANNELS.getBrowserDownloads,()=>({items:[],error:null}));
  ipcMain.handle(IPC_CHANNELS.getBrowserHistory,()=>({items:[],error:null}));
  const window = new BrowserWindow({...mainWindowOptions(preload),width:1100,height:740,x:30,y:30,show:false});
  manager.attach(window,mode!=='baseline');
  const host = manager.hosts.get(window.id);
  if(mode==='baseline')manager.setMemoryPressure('critical');
  await manager.baseContents(window).loadURL(origin+'/dashboard?n=0');
  window.show();window.hide();window.show();window.setAlwaysOnTop(true);window.focus();
  if(host.shell)await until(()=>host.shellEnabled,"shell available");
  const command = c=>manager.handleCommand(manager.baseContents(window),c);
  if (process.env.BB_BENCH_EVICTED) manager.setMemoryPressure('critical');
  const worker = spawn(probeExe,[],{windowsHide:true,stdio:['pipe','pipe','inherit']});
  const answers=[];
  readline.createInterface({input:worker.stdout}).on('line',line=>answers.shift()?.(JSON.parse(line)));
  const measure = args=>new Promise(resolve=>{answers.push(resolve);worker.stdin.write(args.join(',')+'\n');});
  const rows=[];
  let next=1;
  for(const count of [5,15,30]) {
    while(host.tabs.length<count){
      const n=next++;
      command(n%2?{type:'open',url:origin+`/pdf?n=${n}`}:{type:'browser',url:origin+`/website?n=${n}`});
      try { await until(()=>!host.pending && host.presentationStatus==='presented','cold presentation'); }
      catch (error) {
        const tab=host.tabs.find(t=>t.id===host.activeId);
        console.error(JSON.stringify({n,active:host.activeId,presented:host.presentedId,pending:host.pending?.id,front:host.pendingAtFront,tab:{loaded:tab.loaded,painted:tab.painted,attached:tab.attached},browser:tab.browser&&{ready:tab.browser.ready,committed:tab.browser.documentCommitted,attached:tab.browser.attached},views:window.contentView.children.map(v=>({id:v.webContents?.id,bounds:v.getBounds()}))}));
        throw error;
      }
    }
    const targets=host.tabs.slice(-2);
    for (const tab of targets) {
      command({type:'activate',id:tab.id});await until(()=>!host.pending,'warmup');
    }
    const samples=[];
    for(let i=0;i<40;i++){
      const target=targets[i%2];
      const previous=host.tabs.find(t=>t.id===host.activeId);
      const chrome=host.shell?.contents??previous.contents;
      await chrome.mainFrame.executeJavaScript(`(()=>{if(!document.getElementById('probe-style')){const s=document.createElement('style');s.id='probe-style';s.textContent='.bb-tab[data-active="true"]::after{content:""!important;position:absolute!important;left:0!important;bottom:0!important;top:auto!important;height:3px!important;width:100%!important;background:#ff00ff!important;opacity:1!important;z-index:99999!important;transform:none!important}';document.head.append(s)}})()`);
      const rect=await chrome.mainFrame.executeJavaScript(`(()=>{const el=document.querySelector('[data-tab-id="${target.id}"]');el.scrollIntoView({inline:'nearest'});const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
      await sleep(35);
      const bounds=window.getContentBounds();
      const point=(x,y)=>screen.dipToScreenPoint({x:Math.round(bounds.x+x),y:Math.round(bounds.y+y)});
      const press=point(rect.x+18,rect.y+rect.height/2);
      const marker=point(rect.x+rect.width/2,rect.y+rect.height-1);
      const pixel=point(850,500);
      const button=point((target.browser?40:0)+175,(target.browser?135:mode==='baseline'?0:32)+210);
      const n=Number(new URL(target.url).searchParams.get('n'));
      const old=Number(new URL(previous.url).searchParams.get('n'));
      const resident=target.attached && (!target.browser || target.browser.attached);
      const sample=await measure([press.x,press.y,marker.x,marker.y,pixel.x,pixel.y,parseInt(color(n).slice(1),16),parseInt(color(old).slice(1),16),button.x,button.y]);
      if(sample.visibleMs<0 || sample.usableMs<0) {
        const display=screen.getDisplayMatching(window.getBounds());
        const page = target.browser?.contents ?? target.contents;
        const work = await page.executeJavaScript(`(()=>{const e=document.querySelector('#work'),r=e.getBoundingClientRect();return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},background:getComputedStyle(document.body).backgroundColor,element:document.elementFromPoint(r.x+75,r.y+30)?.outerHTML}})()`);
        throw Error('Native input/pixel probe failed: '+JSON.stringify({count,i,sample,rect,press,button,bounds,scale:display.scaleFactor,selected:host.activeId,target:target.id,work,views:window.contentView.children.map(v=>({id:v.webContents?.id,bounds:v.getBounds()})),targetContents:page.id}));
      }
      samples.push({...sample,resident});
      const page=target.browser?.contents??target.contents;
      await page.mainFrame.executeJavaScript(`document.body.style.setProperty('background','${color(n)}','important');new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    }
    await sleep(1000);
    app.getAppMetrics();await sleep(1000);
    const metrics=app.getAppMetrics();
    rows.push({tabs:count,samples,summary:{controls:percentiles(samples.map(s=>s.controlsMs)),visible:percentiles(samples.map(s=>s.visibleMs)),usable:percentiles(samples.map(s=>s.usableMs))},unexpectedPixelSamples:samples.reduce((n,s)=>n+s.unexpectedSamples,0),workingSetKiB:metrics.reduce((n,m)=>n+m.memory.workingSetSize,0),idleCpuPercent:metrics.reduce((n,m)=>n+m.cpu.percentCPUUsage,0),processes:metrics.length,cacheBudgetBytes:host.surfaces.budget});
    fs.writeFileSync(reportPath,JSON.stringify({mode,evicted:process.env.BB_BENCH_EVICTED==='1',electron:process.versions.electron,chromium:process.versions.chrome,scale:screen.getDisplayMatching(window.getBounds()).scaleFactor,rows},null,2));
  }
  worker.stdin.end();window.destroy();server.closeAllConnections();server.close();app.exit(0);
}).catch(error=>{console.error(error.stack||error);app.exit(1)});
