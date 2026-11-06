const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const http=require('node:http');
const {app,BrowserWindow,session,ipcMain}=require('electron');
const {registerAppAssetScheme,installAppAssetTransport}=require('../../dist-tests/src/main/app-assets.js');
const {registerTerminalDataHandlers}=require('../../dist-tests/src/main/terminal-data-transport.js');
const {IPC_CHANNELS}=require('../../dist-tests/src/shared/ipc-contract.js');
const directory=process.argv.at(-1);
app.setPath('userData',path.join(directory,'profile'));registerAppAssetScheme();
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  const streams=[],reads=[];const engine={status:'ready',ready:true,deviceId:'fixture',error:null};
  let heldRead=false,cancelledRead=false;
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://local');
    if(url.pathname==='/stream'){res.writeHead(200,{'content-type':'text/event-stream'});res.write(': open\n\n');streams.push(res);return;}
    if(url.pathname==='/_next/static/widgets.js'){res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(path.join(directory,'widgets.js')));return;}
    if(url.pathname==='/logo.png'){assert.equal(req.headers.cookie,undefined);res.setHeader('content-type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));return;}
    if(url.pathname.startsWith('/api/')){
      reads.push(url.pathname);assert.equal(req.method,'GET');assert.equal(req.headers.cookie,'test-session=private');
      if(url.searchParams.has('hold')){heldRead=true;res.on('close',()=>{cancelledRead=true});return;}
      const payloads={
        '/api/models':{data:[{id:'gpt-test'}]},'/api/cliproxy/status':{models:[]},
        '/api/usage-limits':{available:true,captured_at:new Date().toISOString(),primary:{used_percent:18,window_minutes:300,resets_in_seconds:3600}},
        '/api/browser/weather':{temperatureC:20,feelsLikeC:19,code:0,isDay:true},
        '/api/calendar/calendars':{calendars:[{id:1,visible:true}]},'/api/calendar/events':{occurrences:[]},
        '/api/assistant-preferences':{switches:{currentLocation:true}},
        '/api/profile/page-appearance':{preferences:{}},
      };
      res.setHeader('content-type','application/json');res.end(JSON.stringify(payloads[url.pathname]??{}));return;
    }
    res.setHeader('content-type','text/html');res.end('<!doctype html><html data-breadboard-startup="loading"><body><div id="root"></div></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const target=session.fromPartition('terminal-congestion',{cache:false});installAppAssetTransport(target,()=>origin);
  await target.cookies.set({url:origin,name:'test-session',value:'private',httpOnly:true});
  const window=new BrowserWindow({show:false,webPreferences:{session:target,preload:path.resolve(__dirname,'../../dist-tests/src/preload/preload.js'),backgroundThrottling:false}});
  window.setOpacity(0);window.setIgnoreMouseEvents(true);window.setSkipTaskbar(true);window.showInactive();
  const contents=window.webContents;
  registerTerminalDataHandlers(ipcMain,{ownsSender:sender=>sender===contents,dashboardUrl:()=>origin});
  ipcMain.handle(IPC_CHANNELS.getThemeState,()=>({theme:'light',schedule:{mode:'manual'}}));
  ipcMain.handle(IPC_CHANNELS.setTheme,()=>true);
  ipcMain.handle(IPC_CHANNELS.getCurrentLocationPreference,()=>true);
  ipcMain.handle(IPC_CHANNELS.setCurrentLocationPreference,()=>true);
  ipcMain.handle(IPC_CHANNELS.getTabsState,()=>({enabled:true,selfId:1,activeId:1,tabs:[],extensions:[]}));
  ipcMain.handle(IPC_CHANNELS.spotifyRequest,(_event,request)=>{
    assert.ok(request.method==='GET'||request.resource==='engine','startup must not control playback');
    return {status:200,body:JSON.stringify(request.resource==='engine'?engine:{connected:true,status:'connected',engine,playback:null,history:[]})};
  });
  await window.loadURL(origin+'/new-tab');
  await contents.mainFrame.executeJavaScript(`
    window.process={env:{}};
    localStorage.setItem('breadboard:current-location',JSON.stringify({useForAnswers:true,snapshot:{latitude:52,longitude:5,capturedAt:new Date().toISOString(),accuracyMeters:100,timeZone:'Europe/Amsterdam'}}));
    Promise.all(Array.from({length:6},(_,i)=>fetch('/stream?'+i))).then(()=>true)
  `);
  assert.equal(streams.length,6);
  const start=performance.now();
  await contents.mainFrame.executeJavaScript(`Promise.all([
    new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/_next/static/widgets.js';s.onload=resolve;s.onerror=reject;document.head.append(s)}),
    new Promise((resolve,reject)=>{const img=new Image();img.onload=resolve;img.onerror=reject;img.src='/logo.png';document.body.append(img)})
  ]).then(()=>true)`);
  let state;
  for(const end=Date.now()+5000;Date.now()<end;){
    state=await contents.mainFrame.executeJavaScript(`({ready:document.documentElement.dataset.breadboardStartup,appearance:window.appearanceReady,weather:document.querySelector('.browser-dock')?.textContent,calendar:document.querySelector('.browser-home-calendar')?.textContent,usage:document.querySelector('[data-provider="chatgpt"]')?.getAttribute('aria-label')})`);
    if(state.ready==='ready' && state.appearance)break;await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(state.ready,'ready',JSON.stringify(state));assert.match(state.weather,/20°/);assert.match(state.weather,/Spotify is ready/);
  assert.match(state.calendar,/No upcoming events/);assert.match(state.usage,/82% remaining/);
  assert.equal(state.appearance,true,'saved appearance must also restore without waiting behind streams');
  assert.equal(new Set(reads).size,8,'all startup data was authenticated and read through the real transport');
  assert.ok(streams.every(stream=>!stream.writableEnded),'no live work was interrupted to free a connection');
  const widgetsReadyMs=Math.round(performance.now()-start);assert.ok(widgetsReadyMs<3000,'the widgets cannot wait behind occupied connections');
  console.log(JSON.stringify({widgetsReadyMs,occupiedConnections:streams.length,authenticatedReads:reads.length}));
  await contents.mainFrame.executeJavaScript(`void window.breadboardDesktop.readTerminalData('cancel-fixture','/api/models?hold=1').then(result=>{window.cancelledResult=result.status})`);
  for(const end=Date.now()+2000;!heldRead&&Date.now()<end;)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(heldRead,true);
  await contents.mainFrame.executeJavaScript(`window.breadboardDesktop.cancelTerminalData('cancel-fixture')`);
  for(const end=Date.now()+2000;!cancelledRead&&Date.now()<end;)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(cancelledRead,true,'cancelling a widget read also closes its native connection');
  for(const stream of streams)stream.end();window.destroy();server.closeAllConnections();server.close();
  fs.writeFileSync(path.join(directory,'passed.json'),JSON.stringify({passed:true,widgetsReadyMs}));
}).catch(error=>{console.error(error.stack||error);app.exit(1)});
