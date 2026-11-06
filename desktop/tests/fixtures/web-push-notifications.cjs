const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {WebSocketServer} = require('ws');
const webpush = require('web-push');
const {app, BrowserWindow, ipcMain} = require('electron');
const {TabManager} = require('../../dist/main/tab-manager.js');
const {IPC_CHANNELS, isTabsCommand} = require('../../dist/shared/ipc-contract.js');
const dir = process.argv.at(-1);
const live = process.env.BB_WEB_PUSH_LIVE === '1';
const workerKind = process.env.BB_WEB_PUSH_WORKER_KIND || 'root';
const workerPath = workerKind === 'outside' ? '/service-worker/events.js' : '/worker.js';
const workerScope = workerKind === 'outside' ? '/service-worker/' : workerKind === 'custom' ? '/firebase-cloud-messaging-push-scope' : workerKind === 'module' ? '/app/' : '/';
const pagePath = workerKind === 'module' ? '/app/inbox' : '/';
const workerOptions = {scope:workerScope,type:workerKind === 'module' ? 'module' : 'classic'};
app.setPath('userData',path.join(dir,'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.on('window-all-closed',()=>{});
const until=async(probe,label)=>{
  for(const end=Date.now()+15000;Date.now()<end;){if(await probe())return;await new Promise(r=>setTimeout(r,25))}
  throw Error('Timed out: '+label);
};
const listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',()=>r('http://127.0.0.1:'+server.address().port)));
app.whenReady().then(async()=>{
  const vapid=webpush.generateVAPIDKeys();
  const pushOptions={vapidDetails:{subject:'https://github.com/kuzeyatay/breadboard',...vapid},TTL:60};
  let socket,channelID,connections=0;
  const acknowledgements=[];
  const pushServer=new WebSocketServer({host:'127.0.0.1',port:0});
  await new Promise(r=>pushServer.once('listening',r));
  pushServer.on('connection',client=>{
    socket=client;connections++;
    client.on('message',raw=>{
      const value=JSON.parse(raw.toString());
      if(value.messageType==='hello')client.send(JSON.stringify({messageType:'hello',status:200,uaid:'isolated-test-user',use_webpush:true}));
      if(value.messageType==='register'){
        channelID=value.channelID;
        assert.equal(value.key,vapid.publicKey);
        client.send(JSON.stringify({messageType:'register',status:200,channelID,pushEndpoint:'https://push.example.test/'+channelID}));
      }
      if(value.messageType==='unregister')client.send(JSON.stringify({messageType:'unregister',status:200,channelID:value.channelID}));
      if(value.messageType==='ack')acknowledgements.push(...value.updates);
    });
  });
  const website=http.createServer((req,res)=>{
    if(req.url===workerPath){
      res.writeHead(200,{'content-type':'application/javascript'});
      return res.end(`${workerKind === 'module' ? 'export {};' : ''}self.addEventListener('install',()=>self.skipWaiting());
        self.addEventListener('activate',e=>e.waitUntil(clients.claim()));
        self.addEventListener('push',event=>event.waitUntil((async()=>{
          const payload=event.data.json();
          const subscription=await self.registration.pushManager.getSubscription();
          if(!subscription || !(subscription instanceof PushSubscription) || subscription.getKey('auth').byteLength!==16 || subscription.getKey('p256dh').byteLength!==65)
            throw Error('Worker cannot read the browser push subscription');
          if(await self.registration.pushManager.permissionState({userVisibleOnly:true})!=='granted')throw Error('Worker lost permission');
          const existing=await self.registration.pushManager.subscribe(subscription.options);
          if(existing.endpoint!==subscription.endpoint)throw Error('Worker created a duplicate subscription');
          try {
            await self.registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:new Uint8Array(65)});
            throw Error('Worker accepted an invalid application key');
          } catch(error) { if(error.name!=='InvalidAccessError')throw error; }
          const options={body:payload.message,tag:'inbox',data:{senders:new Map([['sender','example']])}};
          const previous=await self.registration.getNotifications({tag:'inbox'});
          for(const notice of previous){if(!(notice.data.senders instanceof Map))throw Error('Lost structured data');notice.close()}
          if(payload.delegate){
            const pages=await clients.matchAll({type:'window',includeUncontrolled:true});
            if(!pages.length)throw Error('No retained notification client');
            pages[0].postMessage({type:'display-push',title:'Website push',options});
          }else await self.registration.showNotification('Website push',options);
        })()));
        self.addEventListener('notificationclick',event=>event.waitUntil((async()=>{
          for(const client of await clients.matchAll({type:'window',includeUncontrolled:true}))client.postMessage({type:'worker-click',structured:event.notification.data.senders instanceof Map});
        })()));
        self.addEventListener('message',event=>{
          if(event.data?.type!=='unsubscribe-in-worker')return;
          event.waitUntil((async()=>{
            const subscription=await self.registration.pushManager.getSubscription();
            const removed=await subscription.unsubscribe();
            event.ports[0].postMessage({removed,remaining:await self.registration.pushManager.getSubscription()});
          })());
        });`);
    }
    res.writeHead(200,{'content-type':'text/html'});
    res.end(`<!doctype html><title>Push site</title><body style="background:#43885a">Push receiving site<input value="draft"><script>
      window.workerClicks=0;window.delegatedPushes=0;window.pushError='';
      navigator.serviceWorker.addEventListener('message',async event=>{
        if(event.data?.type==='worker-click'){window.workerClicks++;window.structuredClick=event.data.structured}
        if(event.data?.type==='display-push'){
          // Snapchat delegates display to a client and awaits this same
          // getNotifications -> close -> showNotification sequence there.
          const registration=window.registration;
          for(const notice of await registration.getNotifications({tag:event.data.options.tag}))notice.close();
          await registration.showNotification(event.data.title,event.data.options);
          window.delegatedPushes++;
        }
      });
      window.subscriptionReady=(async()=>{
        window.registration=await navigator.serviceWorker.register(${JSON.stringify(workerPath)},${JSON.stringify(workerOptions)});
        // ChatGPT gets/subscribes immediately after register, from a page
        // outside /service-worker/. serviceWorker.ready would never resolve.
        await registration.pushManager.getSubscription();
        const key=Uint8Array.from(atob(${JSON.stringify(vapid.publicKey)}.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
        window.subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
        return subscription.toJSON();
      })().catch(error=>{window.pushError=error.name+': '+error.message;return null});
    </script>`);
  });
  const web=await listen(website);
  const internal=http.createServer((req,res)=>{
    res.writeHead(200,{'content-type':'text/html'});
    res.end(`<!doctype html><title>Breadboard</title><body style="background:#43885a">Breadboard ${req.url}<script>window.notices=[];
      if(location.pathname==='/notification-overlay'){breadboardDesktop.onNotificationToast(notice=>{
        notices.push(notice);breadboardDesktop.resizeNotificationOverlay({width:320,height:100});
      });breadboardDesktop.resizeNotificationOverlay({width:0,height:0});}</script>`);
  });
  const origin=await listen(internal);
  const loading=path.join(dir,'loading.html');fs.writeFileSync(loading,'<!doctype html>Loading');
  const preferences=path.join(dir,'preferences');
  const manager=new TabManager({allowed:{origins:new Set([origin]),localFiles:new Set([pathToFileURL(loading).href])},
    preloadPath:path.resolve(__dirname,'../../dist/preload/preload.js'),loadingHtmlPath:()=>loading,recoveryHtmlPath:()=>loading,
    theme:()=> 'light',openWindow:()=>{},browserPreferencesConfigDir:preferences});
  if(!live)manager.browserNotifications.webPush.client.options.url='ws://127.0.0.1:'+pushServer.address().port;
  ipcMain.handle(IPC_CHANNELS.getTabsState,event=>manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand,(event,command)=>isTabsCommand(command)&&manager.handleCommand(event.sender,command));
  ipcMain.handle('breadboard:get-browser-downloads',()=>({items:[],error:null}));
  ipcMain.handle('breadboard:get-browser-bookmarks',()=>[]);
  ipcMain.handle('breadboard:get-browser-recent-searches',()=>[]);
  manager.setBrowserUrl(origin+'/browser');manager.setNotificationOverlayUrl(origin+'/notification-overlay');manager.setNotificationsVisible(true);
  const window=new BrowserWindow({show:false,width:1000,height:750,webPreferences:{preload:path.resolve(__dirname,'../../dist/preload/preload.js'),contextIsolation:true,sandbox:true}});
  // Layered/transparent Windows windows can stop child-view compositor frames.
  manager.attach(window,true);window.showInactive();
  const host=manager.hosts.get(window.id);const base=manager.baseContents(window);
  await base.loadURL(origin+'/dashboard');await until(()=>!host.pending&&host.base.loaded,'dashboard');
  await until(()=>host.notificationOverlay.ready,'overlay ready');
  const command=value=>manager.handleCommand(base,value);
  command({type:'browser-notification-permission',origin:web,permission:'granted'});
  command({type:'browser',url:web+pagePath});
  const tab=host.tabs.find(t=>t.id===host.activeId);
  tab.browser.contents.on('console-message',(_event,level,message)=>{if(level>=2)console.error('site:',message)});
  tab.browser.contents.session.serviceWorkers.on('console-message',(_event,details)=>{if(details.level>=2)console.error('worker:',details.message)});
  await until(()=>tab.browser?.ready&&!host.pending,'site loaded').catch(async error=>{
    console.error(JSON.stringify({id:tab.id,active:host.activeId,ready:tab.browser?.ready,pending:!!host.pending,bounds:tab.browser.view.getBounds(),shellBounds:host.shell?.view.getBounds(),shell:await host.shell?.contents.executeJavaScript('document.body.innerText.slice(0,1000)'),document:await tab.browser.contents.executeJavaScript('({visibility:document.visibilityState,ready:document.readyState,error:window.pushError,paints:performance.getEntriesByType("paint").map(p=>p.name)})')}));throw error;
  });
  const page=tab.browser.contents;
  let subscription=await page.executeJavaScript('subscriptionReady');
  assert.ok(subscription,await page.executeJavaScript('pushError'));
  assert.equal(await page.executeJavaScript('subscription instanceof PushSubscription'),true);
  assert.equal(await page.executeJavaScript('registration.pushManager instanceof PushManager'),true);
  assert.equal(await page.executeJavaScript('registration.pushManager.getSubscription().then(s=>s.endpoint===subscription.endpoint)'),true);
  assert.equal((await page.executeJavaScript(`breadboardWebNotifications.push('get','https://other.example/')`)).name,'SecurityError');
  assert.equal(await page.executeJavaScript(`registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:new Uint8Array(65)}).then(()=>false,e=>e.name==='InvalidAccessError')`),true);
  const overlay=host.notificationOverlay.contents;
  await until(()=>host.notificationOverlay.ready,'overlay ready');
  let lastPush;
  const deliver=async(message,encoding='aes128gcm',delegate=false)=>{
    const payload=JSON.stringify({message,delegate});
    if(live)await webpush.sendNotification(subscription,payload,{...pushOptions,contentEncoding:encoding});
    else{
      const request=webpush.generateRequestDetails(subscription,payload,{...pushOptions,contentEncoding:encoding});
      lastPush={messageType:'notification',channelID,version:randomUUID(),data:request.body.toString('base64url'),headers:{
        encoding,encryption:request.headers.Encryption,crypto_key:request.headers['Crypto-Key'],
      }};
      socket.send(JSON.stringify(lastPush));
    }
    await until(()=>overlay.executeJavaScript(`notices.some(n=>!n.dismissed&&n.message===${JSON.stringify(message)})`),'server push displayed: '+message);
  };
  await deliver('Before close');
  if(!live){
    await until(()=>acknowledgements.length===1,'first push acknowledged');
    const count=await overlay.executeJavaScript('notices.length');
    socket.send(JSON.stringify(lastPush));
    await until(()=>acknowledgements.length===2,'duplicate push acknowledged');
    assert.equal(await overlay.executeJavaScript('notices.length'),count,'redelivery is not displayed twice');
    const corrupt=Buffer.from(lastPush.data,'base64url');corrupt[corrupt.length-1]^=1;
    socket.send(JSON.stringify({...lastPush,version:randomUUID(),data:corrupt.toString('base64url')}));
    await until(()=>acknowledgements.length===3,'tampered push rejected');
    assert.equal(acknowledgements.at(-1).code,101,'unauthenticated ciphertext is rejected');
    assert.equal(await overlay.executeJavaScript('notices.length'),count,'tampered push cannot display a card');
  }
  command({type:'close',id:tab.id});await until(()=>!host.pending,'close site');
  assert.equal(page.isDestroyed(),false);assert.equal(tab.browser.attached,false);
  assert.equal(await page.executeJavaScript('document.hasFocus()'),false,'closed page cannot suppress notifications as a focused conversation');
  for(const route of ['/garden','/browser/settings']){
    await base.loadURL(origin+route);await deliver('Push on '+route);
    assert.equal(host.activeId,host.base.id,'push does not steal focus');
    assert.equal(window.contentView.children.at(-1),host.notificationOverlay.view,'global notification above current page');
  }
  await deliver('Legacy encrypted push','aesgcm');
  await deliver('Worker delegates to the closed page','aes128gcm',true);
  await until(()=>page.executeJavaScript('delegatedPushes===1'),'page completes delegated display');
  if(!live){
    const count=connections;socket.terminate();await until(()=>connections>count&&manager.browserNotifications.webPush.client.connected,'push reconnect');
    await deliver('After connection recovery');
  }
  const stopWorker=async()=>{
    await until(()=>!page.debugger.isAttached(),'dispatch releases debugger');
    page.debugger.attach('1.3');
    await page.debugger.sendCommand('ServiceWorker.enable');
    await page.debugger.sendCommand('ServiceWorker.stopAllWorkers');
    page.debugger.detach();
    await until(()=>Object.keys(page.session.serviceWorkers.getAllRunning()).length===0,'worker becomes idle');
  };
  await stopWorker();
  await deliver('Push after the worker stops','aes128gcm',true);
  await until(()=>page.executeJavaScript('delegatedPushes===2'),'restarted worker delegates to the closed page');
  await stopWorker();
  const id=await overlay.executeJavaScript('notices.filter(n=>n.website&&!n.dismissed).at(-1).website.id');
  assert.equal(manager.handleCommand(overlay,{type:'browser-notification-action',id,action:'click'}),true);
  await until(()=>host.tabs.includes(tab)&&!host.pending,'click restores website');
  await until(()=>page.executeJavaScript('workerClicks===1&&structuredClick'),'worker receives notificationclick with Map data');
  assert.equal(await page.executeJavaScript('document.querySelector("input").value'),'draft');
  await page.reload();
  await until(()=>!page.isLoading()&&tab.browser.ready&&!host.pending,'site reload after push');
  const restored=await page.executeJavaScript('subscriptionReady');
  assert.equal(restored.endpoint,subscription.endpoint,'reload retains the push subscription');
  await deliver('After page reload');
  const encrypted=fs.readFileSync(path.join(preferences,'browser-web-push.encrypted'),'utf8');
  assert.ok(!encrypted.includes(subscription.keys.auth),'keys encrypted at rest');
  const {BrowserWebPush}=require('../../dist/main/browser-web-push.js');
  const recovered=new BrowserWebPush(preferences,()=> 'granted');
  assert.equal(recovered.client.get(web+workerScope).endpoint,subscription.endpoint,'a new receiver recovers the encrypted subscription');
  assert.equal(await page.executeJavaScript('subscription.unsubscribe()'),true);
  assert.equal(await page.executeJavaScript('registration.pushManager.getSubscription()'),null);
  subscription=await page.executeJavaScript(`registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:${JSON.stringify(vapid.publicKey)}}).then(s=>{window.subscription=s;return s.toJSON()})`);
  await deliver('After renewing a subscription');
  assert.deepEqual(await page.executeJavaScript(`new Promise((resolve,reject)=>{
    const ports=new MessageChannel();const timer=setTimeout(()=>reject(Error('Worker unsubscribe timed out')),5000);
    ports.port1.onmessage=event=>{clearTimeout(timer);ports.port1.close();resolve(event.data)};
    registration.active.postMessage({type:'unsubscribe-in-worker'},[ports.port2]);
  })`),{removed:true,remaining:null},'worker opt-out updates the same subscription seen by pages');
  assert.equal(await page.executeJavaScript('registration.pushManager.getSubscription()'),null);
  command({type:'browser-notification-permission',origin:web,permission:'denied'});
  assert.equal(await page.executeJavaScript(`registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:${JSON.stringify(vapid.publicKey)}}).then(()=>false,e=>e.name==='NotAllowedError')`),true);
  if(!live)await until(()=>acknowledgements.length>=8,'push acknowledgements');
  console.log(JSON.stringify({ok:true,transport:live?'Mozilla encrypted Web Push':'isolated encrypted Web Push'}));
  fs.writeFileSync(path.join(dir,'passed.json'),JSON.stringify({passed:true}));
}).catch(error=>{console.error(error.stack||String(error));app.exit(1)});
