import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { chromium } from 'playwright';
import { notificationTimestamp } from '../src/lib/notification-center.ts';
import Database from 'better-sqlite3';
import { saveNotificationHistory, listNotificationHistory, clearNotificationHistory, markNotificationHistoryRead } from '../src/lib/chat-notifications/history.ts';
import { notificationHistoryItem, parseDeliveredNotification } from '../src/lib/notification-history.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

test('notification center shares delivery, dismissal, navigation, sound and site permissions', { timeout: 90_000 }, async t => {
  assert.equal(notificationTimestamp('2026-10-10 10:00:00'), Date.parse('2026-10-10T10:00:00Z'));
  const bundle = await esbuild.build({
    stdin: { loader: 'tsx', resolveDir: root, contents: `
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import NotificationCenter from './src/app/components/notification-center';
      import {useToast} from './src/app/components/toast';
      import {publishNotificationDelivery} from './src/lib/speech/notification-events';
      import appearance from './src/app/components/page-appearance.module.css';
      window.commands=[]; window.routes=[]; window.failSave=false; window.deliver=publishNotificationDelivery;
      let state={enabled:true,selfId:1,activeId:1,windowFocused:true,tabs:[],browserPreferences:{notificationsEnabled:true,sites:{'https://example.com':'granted','https://blocked.test':'denied'}}};
      const listeners=new Set();
      window.breadboardDesktop={
        getTabsState:async()=>state,
        onTabsState:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
        publishNotificationToast:async()=>{},
        tabs:async command=>{
          window.commands.push(command); if(window.failSave)return false;
          const p={...state.browserPreferences,sites:{...state.browserPreferences.sites}};
          if(command.type==='browser-notifications-enabled')p.notificationsEnabled=command.enabled;
          if(command.type==='browser-notification-permission'){
            if(command.permission==='default')delete p.sites[command.origin];else p.sites[command.origin]=command.permission;
          }
          state={...state,browserPreferences:p}; for(const fn of listeners)fn(state); return true;
        }
      };
      function App(){
        const feed=useToast({notificationCenter:true}); const [open,setOpen]=useState(false);
        window.refresh=feed.refreshNotifications; window.add=feed.addToast; window.dismissBanner=feed.dismissToast; window.toastItems=feed.toasts;
        return <><NotificationCenter notifications={feed.centerNotifications} status={feed.inboxStatus} onRefresh={feed.refreshNotifications}
          onDismiss={feed.dismissCenterNotification} onRead={feed.readCenterNotification} onClear={feed.clearCenterNotifications} onOpenChat={()=>false} open={open} onOpenChange={setOpen}/>
          <div className={appearance.anchor} data-placement="terminal"><button aria-label="Customize appearance" className={appearance.customizeButton}>◌</button></div></>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, outfile: 'notification-center-fixture.js', format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'navigation', setup(build) {
      build.onResolve({ filter: /^(next\/navigation|\.\/navigation-progress)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useRouter=()=>({push:href=>window.routes.push(href)});export const startNavigationProgress=()=>{};' }));
    } }],
  });
  const stamp = Date.now();
  const message = (id, title, minutes, extra = {}) => ({ id, title: 'Response ready', type: 'success', response: 'The **answer** is ready. Open the chat to continue.', chatTitle: title,
    target: {surface:'dashboard_terminal',chatId:`conv_${id}`}, updatedAt: new Date(stamp-minutes*60_000).toISOString(), ...extra });
  const mathResponse = String.raw`The gate–drain capacitance \(C_{gd}\) reduces bandwidth. Here, \(R_S\) and \(r_o\) connect different nodes. The gain is $A_v=-g_mr_o$.`;
  const displayResponse = String.raw`Collect the \(v_{\text{out}}\) terms:

\[
v_{\text{out}}\frac{1+sC_Lr_o}{g_mr_o+1}+v_{\text{out}}sC_LR_S=v_{\text{in}}.
\]

Then simplify the result.`;
  let records = [message('msg_1','Circuit analysis',35,{response:displayResponse}), message('msg_2','Study plan',2,{response:mathResponse}),
    message('learn_job:complete','Electronics',12,{kind:'learn',title:'Learn complete',response:'',message:'All sections ready',progressPercent:100,target:{surface:'garden_learn',gardenSlug:'electronics',chatId:'job'}})];
  const dismissed = new Set();
  const db=new Database(':memory:');db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1);');t.after(()=>db.close());
  let failInbox = false;
  let failDismiss = false;
  const clearBatches=[];
  const server = http.createServer(async (req,res) => {
    if(req.url === '/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles.find(f=>f.path.endsWith('.js')).text);return;}
    if(req.url === '/app.css'){res.setHeader('Content-Type','text/css');res.end(fs.readFileSync(path.join(root,'node_modules/katex/dist/katex.min.css'),'utf8')+'\n'+bundle.outputFiles.find(f=>f.path.endsWith('.css')).text);return;}
    if(/^\/fonts\/[\w-]+\.(woff2?|ttf)$/.test(req.url)){res.end(fs.readFileSync(path.join(root,'node_modules/katex/dist/fonts',path.basename(req.url))));return;}
    if(req.url.startsWith('/api/chat-notifications')){
      res.setHeader('Content-Type','application/json');
      if(req.method === 'POST'){
        let body='';for await(const chunk of req)body+=chunk;
        const command=JSON.parse(body);
        if(failDismiss && (command.dismiss || command.clearHistory)){res.statusCode=503;res.end('{}');return;}
        if(command.clearHistory)clearBatches.push(command.clearHistory);
        if(command.notice){const notice=parseDeliveredNotification(command.notice);if(notice)saveNotificationHistory(db,1,[notice]);}
        const clear=command.clearHistory??[];
        clearNotificationHistory(db,1,clear);markNotificationHistoryRead(db,1,command.readHistory??[]);
        for(const id of [...(command.dismiss??[]),...[...clear,...(command.readHistory??[])].filter(id=>id.startsWith('chat-notification:')).map(id=>id.slice(18))])dismissed.add(id);
        res.end('{"ok":true}');return;
      }
      if(failInbox){res.statusCode=503;res.end('{}');return;}
      const messages=records.filter(r=>!dismissed.has(r.id));
      saveNotificationHistory(db,1,messages.map(record=>notificationHistoryItem(record)));
      res.end(JSON.stringify({messages,history:listNotificationHistory(db,1)}));return;
    }
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><html><head><link rel="stylesheet" href="/app.css"><style>
      :root{--paper:#f6f3ea;--paper-raised:#fffcf5;--paper-strong:#dedbd0;--ink:#3f4944;--ink-heading:#182a24;--ink-muted:#6b766f;--line:#d6d9d1;--line-strong:#adb9ae;--botanical:#557b68;--neu-surface:#f6f3ea;--neu-surface-pressed:#e4e9df;--neu-surface-raised:#fffcf5;--neu-border:#a9b9aa;--neu-focus:#557b68;--neu-raised-shadow:3px 3px 8px #0002,-3px -3px 8px #fff8;--neu-inset-shadow:inset 2px 2px 4px #0002;--danger:#b34a44;--font-source-sans:Arial;}
      [data-theme=dark]{--paper:#202824;--paper-raised:#343e37;--paper-strong:#455147;--ink:#dde7df;--ink-heading:#f3f7f1;--ink-muted:#afbcaf;--line:#505c53;--neu-surface:#343e37;}
      *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 65% 30%,#edc775,transparent 70%),linear-gradient(125deg,#656171,#ae914e 55%,#eef6ed);font-family:Arial}button{font-family:inherit}main{padding:120px 12%;color:#182a24}main h1{font-size:38px;font-weight:500}main p{font-size:16px}
      </style></head><body><main><h1>Where to, bub?</h1></main><div id="root"></div><script src="/app.js"></script></body></html>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const url=`http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  const bell=page.getByRole('button',{name:'Notifications, 3 unread',exact:true});await bell.waitFor();
  const b=await bell.boundingBox(),p=await page.getByRole('button',{name:'Customize appearance'}).boundingBox();
  assert.equal(b.x,p.x);assert.ok(b.y+b.height<p.y,'bell sits above the palette');
  await bell.click();
  const dialog=page.getByRole('dialog',{name:'Notifications',exact:true});await dialog.waitFor();
  const bounds=await dialog.boundingBox();assert.equal(bounds.width,480);assert.ok(bounds.height>=800);
  assert.equal(await page.locator('[data-notification-id]').first().getAttribute('data-notification-id'),'chat-notification:msg_2');
  assert.equal(await dialog.locator('img').count(),0,'no decorative logos');
  const mathCard=page.locator('[data-notification-id="chat-notification:msg_2"]');
  assert.equal(await mathCard.locator('.katex').count(),4,'inline TeX and dollar math render in the card');
  assert.deepEqual(await mathCard.locator('annotation').allTextContents(),['C_{gd}','R_S','r_o','A_v=-g_mr_o']);
  assert.equal(await dialog.locator('.katex-error').count(),0);
  assert.equal(await dialog.locator('button button, button a').count(),0,'previews cannot add nested controls');
  await page.evaluate(()=>document.fonts.ready);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await bell.focus();
  await page.keyboard.press('Enter');await dialog.waitFor();
  const capture=async name=>{if(process.env.BREADBOARD_NOTIFICATION_SCREENSHOT_DIR){fs.mkdirSync(process.env.BREADBOARD_NOTIFICATION_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.BREADBOARD_NOTIFICATION_SCREENSHOT_DIR,name)});}};
  await capture('notifications-desktop.png');
  records[0]={...records[0],title:'Response failed',type:'error'};
  await page.evaluate(()=>window.refresh());
  await page.waitForFunction(()=>window.toastItems.some(item=>item.notificationId==='msg_1'&&item.title==='Response failed'&&item.type==='error'));
  await dialog.getByRole('heading',{name:'Circuit analysis',exact:true}).waitFor();
  assert.equal(await dialog.getByText('Response failed',{exact:true}).count(),0,'chat notifications identify the source rather than a status label');
  failDismiss=true;
  const failedDismissal=page.waitForResponse(response=>response.url().endsWith('/api/chat-notifications')&&response.request().method()==='POST'&&response.status()===503);
  await page.evaluate(()=>window.dismissBanner('chat-notification:msg_1'));await failedDismissal;
  await page.evaluate(()=>window.refresh());
  await page.waitForFunction(()=>window.toastItems.some(item=>item.notificationId==='msg_1'));
  failDismiss=false;
  await page.getByRole('button',{name:'Notification settings',exact:true}).click();
  const sound=page.getByRole('switch',{name:'Notification sound',exact:true});
  assert.equal(await sound.getAttribute('aria-checked'),'true');await sound.click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('breadboard:notification-sound')),'false');
  const master=page.getByRole('switch',{name:'Website notifications',exact:true});await master.click();
  await page.waitForFunction(()=>window.commands.some(c=>c.type==='browser-notifications-enabled'&&!c.enabled));
  assert.equal(await master.getAttribute('aria-checked'),'false');
  const site=page.getByRole('switch',{name:'Notifications for https://example.com',exact:true});await site.click();
  await page.waitForFunction(()=>window.commands.some(c=>c.origin==='https://example.com'&&c.permission==='denied'));
  assert.equal(await site.getAttribute('aria-checked'),'false');
  await page.getByRole('button',{name:'Ask again for https://blocked.test',exact:true}).click();
  await page.getByRole('switch',{name:'Notifications for https://blocked.test',exact:true}).waitFor({state:'hidden'});
  await page.evaluate(()=>window.failSave=true);await master.click();
  await page.getByRole('alert').filter({hasText:'Couldn’t save'}).waitFor();
  assert.equal(await master.getAttribute('aria-checked'),'false','failed saves do not pretend permission changed');
  await page.evaluate(()=>window.failSave=false);
  await capture('notifications-settings.png');
  await page.getByRole('button',{name:'Back to notifications',exact:true}).click();
  failDismiss=true;
  await page.getByRole('button',{name:'Dismiss Study plan',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Couldn’t load'}).waitFor();
  assert.equal(await page.locator('[data-notification-id="chat-notification:msg_2"]').count(),1,'failed clears retain the card');
  failDismiss=false;
  await page.getByRole('button',{name:'Dismiss Study plan',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-notification-id="chat-notification:msg_2"]'));
  await page.evaluate(()=>window.refresh());assert.ok(dismissed.has('msg_2'));
  await page.locator('[data-notification-id="chat-notification:msg_1"] > button').first().click();
  await page.waitForFunction(()=>window.commands.some(c=>c.type==='notification-open'&&c.urls.some(url=>url.includes('conv_msg_1'))));
  assert.deepEqual(await page.evaluate(()=>window.commands.find(c=>c.type==='notification-open').urls),[url+'/new-tab?terminalChat=conv_msg_1']);
  await page.getByRole('button',{name:/^Notifications, \d+ unread$/}).click();
  await page.locator('[data-notification-id="chat-notification:msg_1"]').waitFor();
  assert.equal(listNotificationHistory(db,1).find(item=>item.id==='chat-notification:msg_1').read,true,'opening a chat retains history');
  await page.evaluate(()=>window.add('A site update','success','New message',undefined,undefined,{id:'web1',origin:'https://example.com'}));
  await page.locator('[data-notification-id="website:web1"]').waitFor();
  await page.locator('[data-notification-id="website:web1"] > button').first().click();
  await page.waitForFunction(()=>window.commands.some(c=>c.type==='browser-notification-action'&&c.id==='web1'&&c.action==='click'));
  await page.getByRole('button',{name:/^Notifications, \d+ unread$/}).click();
  await page.getByRole('button',{name:'Clear all',exact:true}).click();
  await page.getByText('No notifications',{exact:true}).waitFor();
  assert.equal(clearBatches.filter(ids=>ids.length>1).length,1,'Clear all is one batch');
  failInbox=true;await page.evaluate(()=>window.refresh());await page.getByRole('alert').filter({hasText:'Couldn’t load'}).waitFor();
  assert.equal(await page.getByText('No notifications',{exact:true}).count(),0,'failure is not an empty inbox');
  failInbox=false;await page.getByRole('button',{name:'Retry notifications',exact:true}).click();await page.getByText('No notifications',{exact:true}).waitFor();
  const otherTab=await context.newPage();await otherTab.goto(url);await otherTab.waitForFunction(()=>typeof window.add==='function');
  await otherTab.evaluate(()=>window.add('A background task finished','success','Task complete',undefined,undefined,undefined,undefined,'toast:internal'));
  await otherTab.close();
  await page.locator('[data-notification-id="toast:internal"]').waitFor();
  await page.reload();await page.getByRole('button',{name:/^Notifications, \d+ unread$/}).click();
  await page.locator('[data-notification-id="toast:internal"]').waitFor();
  await page.getByRole('button',{name:'Dismiss Task complete',exact:true}).click();await page.getByText('No notifications',{exact:true}).waitFor();
  records=Array.from({length:14},(_,i)=>message(`msg_${10+i}`,`Notification ${i+1}`,i,{response:i%2?displayResponse:mathResponse}));
  await page.evaluate(()=>window.refresh());await page.locator('[data-notification-id="chat-notification:msg_10"]').waitFor();
  await page.setViewportSize({width:375,height:812});
  const mobile=await dialog.boundingBox();assert.ok(mobile.x>=0&&mobile.x+mobile.width<=375);assert.ok(mobile.y+mobile.height<=812);
  assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false);
  assert.equal(await dialog.locator('.katex-error').count(),0);
  assert.equal(await dialog.locator('[data-notification-id]').evaluateAll(cards=>cards.some(card=>card.scrollWidth>card.clientWidth)),false,'long equations stay inside narrow cards');
  await capture('notifications-mobile.png');
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');await capture('notifications-dark.png');
  await page.getByRole('button',{name:'Notification settings',exact:true}).click();
  assert.equal(await sound.getAttribute('aria-checked'),'false','sound survives reopening');
  await page.setViewportSize({width:320,height:640});
  assert.equal(await page.getByRole('dialog').evaluate(el=>el.scrollWidth>el.clientWidth),false);
  await page.keyboard.press('Escape');
  await page.reload();await page.getByRole('button',{name:/^Notifications, \d+ unread$/}).click();
  await page.getByRole('button',{name:'Notification settings',exact:true}).click();assert.equal(await sound.getAttribute('aria-checked'),'false','sound survives reload');
  assert.deepEqual(errors,[]);
});
