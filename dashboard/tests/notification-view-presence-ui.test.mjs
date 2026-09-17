import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { chromium } from 'playwright';
import { sameChatNotificationTarget } from '../src/lib/chat-notification-inbox.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const terminal = { surface: 'dashboard_terminal', chatId: 'conv_terminal' };
const garden = { surface: 'garden_chat', gardenSlug: 'signals', chatId: '42', conversationId: 'conv_garden' };
const learn = { surface: 'garden_learn', gardenSlug: 'signals', chatId: 'job_1' };

test('green dots synchronize across chat surfaces, reloads, hidden tabs, and stale polls', { timeout: 60_000 }, async t => {
  const bundle = await esbuild.build({
    stdin: { loader: 'tsx', resolveDir: root, contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {useUnreadChats} from './src/lib/conversations/unread-client';
      import {setActiveChatNotificationTarget,registerChatNotificationTarget,isChatNotificationTargetViewed} from './src/lib/chat-notification-inbox';
      import {UnreadChatDot} from './src/app/components/hermes/history-client';
      window.setChat=setActiveChatNotificationTarget;
      window.registerChat=registerChatNotificationTarget; window.isViewed=isChatNotificationTargetViewed;
      function App(){const {unreadChats}=useUnreadChats(location.pathname==='/garden'?'signals':undefined);
        window.dots=[...unreadChats]; window.rendered.push([...window.dots]);
        return <div>{window.dots.map(id=><UnreadChatDot key={id} label={id+' unread'}/>)}</div>;}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  const records = [];
  const dismissed = new Set();
  let hold = false;
  let failPolls = false;
  const waiting = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (req.url.startsWith('/api/chat-notifications')) {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST') {
        let raw=''; for await (const chunk of req) raw+=chunk;
        const body=JSON.parse(raw);
        for(const id of body.read??[]) dismissed.add(id);
        if(body.seen) for(const record of records) if(sameChatNotificationTarget(body.seen,record.target)) dismissed.add(record.id);
        res.end('{"ok":true}'); return;
      }
      if (failPolls) { res.statusCode=500; res.end('{}'); return; }
      const snapshot=JSON.stringify({unread:records.filter(record=>!dismissed.has(record.id))});
      if(hold) waiting.push(()=>res.end(snapshot)); else res.end(snapshot);
      return;
    }
    res.setHeader('Content-Type','text/html'); res.end('<!doctype html><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  t.after(()=>browser.close());
  const context=await browser.newContext();
  const errors=[];
  async function pageAt(route,selfId){
    const page=await context.newPage(); page.setDefaultTimeout(5_000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(selfId=>{
      window.rendered=[];
      localStorage.setItem('breadboard:terminal:unread-chats','["conv_stale"]');
      let state={selfId,activeId:0,windowFocused:true,enabled:true,tabs:[],extensions:[]};
      const listeners=new Set();
      window.breadboardDesktop={getTabsState:async()=>state,onTabsState:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
      window.setTabs=patch=>{state={...state,...patch};for(const fn of listeners)fn(state);};
    },selfId);
    await page.goto(`http://127.0.0.1:${server.address().port}${route}`);
    await page.waitForFunction(()=>Array.isArray(window.dots)); return page;
  }
  const hub=await pageAt('/terminal',1);
  const page=await pageAt('/garden',2);
  const hosts=[hub,page];
  const refresh=()=>Promise.all(hosts.map(p=>p.evaluate(()=>window.dispatchEvent(new Event('focus')))));
  const clear=()=>Promise.all(hosts.map(p=>p.waitForFunction(()=>window.dots.length===0)));
  const bothUnread=async()=>{
    await refresh();
    await hub.waitForFunction(()=>window.dots.includes('conv_garden'));
    await page.waitForFunction(()=>window.dots.includes('42'));
  };
  await clear(); // Ignore stale per-surface localStorage dots.
  records.push({id:'msg_1',target:garden});
  await bothUnread();
  // A transient failed refresh must not clear a real dot.
  failPolls=true; await refresh();
  assert.deepEqual(await hub.evaluate(()=>window.dots),['conv_garden']);
  failPolls=false;
  await page.evaluate(target=>{window.setTabs({activeId:2});window.setChat(target);},garden);
  await clear();
  await page.waitForResponse(response=>response.request().method()==='GET'&&response.url().includes('unread=1'));
  assert.ok(dismissed.has('msg_1'));
  await page.evaluate(()=>window.setChat(null));
  await hub.reload(); await hub.waitForFunction(()=>Array.isArray(window.dots)); await clear();
  // A fresh answer in the same conversation becomes unread again.
  records.push({id:'msg_2',target:garden}); await bothUnread();
  // Merely selecting a chat in an inactive desktop tab cannot mark it read.
  await page.evaluate(target=>{window.setTabs({activeId:1});window.setChat(target);},garden);
  await bothUnread(); assert.equal(dismissed.has('msg_2'),false);
  // Hold stale GET snapshots across a read and a switch away from the chat.
  hold=true; await refresh();
  await new Promise(resolve=>{const check=()=>waiting.length?resolve():setTimeout(check,10);check();});
  await hub.evaluate(()=>{window.setTabs({activeId:1});window.setChat({surface:'dashboard_terminal',chatId:'conv_garden'});});
  await clear();
  await new Promise(resolve=>{const check=()=>dismissed.has('msg_2')?resolve():setTimeout(check,10);check();});
  await hub.evaluate(()=>{window.setChat(null);window.rendered=[];});
  await page.evaluate(()=>{window.setChat(null);window.rendered=[];});
  hold=false; for(const release of waiting.splice(0))release();
  await refresh(); await clear();
  for(const host of hosts) assert.equal(await host.evaluate(()=>window.rendered.some(ids=>ids.length)),false);
  records.push({id:'msg_3',target:garden}); await bothUnread();
  await hub.evaluate(target=>{
    window.setChat({surface:'dashboard_terminal',chatId:'conv_terminal'});
    window.closeEditor=window.registerChat(target);
  },garden);
  await clear();
  await hub.evaluate(()=>window.closeEditor());
  assert.equal(await hub.evaluate(target=>window.isViewed(target),terminal),true,'closing an embedded editor preserves the surrounding chat presence');
  assert.equal(await hub.evaluate(target=>window.isViewed(target),garden),false);
  assert.deepEqual(errors,[]);
});

test('every notification host suppresses the viewed target and preserves background answers', { timeout: 60_000 }, async t => {
  const bundle = await esbuild.build({
    stdin: { loader: 'tsx', resolveDir: root, contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {Toaster,useToast} from './src/app/components/toast';
      import {setActiveChatNotificationTarget,setActiveLearnNotificationGarden,isChatNotificationTargetViewed} from './src/lib/chat-notification-inbox';
      import {isNotificationPageActive,registerInlineSelectionNotificationView} from './src/lib/notification-view-presence';
      window.openInline=registerInlineSelectionNotificationView;
      window.setChat=setActiveChatNotificationTarget; window.setLearn=setActiveLearnNotificationGarden;
      window.isViewed=isChatNotificationTargetViewed; window.isActive=isNotificationPageActive;
      function App(){const {toasts,dismissToast}=useToast({desktopOverlay:location.pathname==='/overlay'});
        window.shown=toasts.map(t=>t.notificationId); window.rendered.push(...window.shown);
        return <><output>{JSON.stringify(window.shown)}</output><Toaster toasts={toasts} onDismiss={dismissToast}
          mode={location.pathname==='/overlay'?'desktop-overlay':'page'}
          onOpenChat={target=>{window.openedTarget=target;return true;}}/></>;}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'navigation-fixture', setup(build) {
      build.onResolve({ filter: /^(next\/navigation|\.\/navigation-progress)$/ }, a => ({ path: a.path, namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useRouter=()=>({push(){}});export const startNavigationProgress=()=>{};' }));
    } }],
  });
  let records = [];
  const dismissed = new Set();
  let holdPolls = false;
  const waitingPolls = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (req.url === '/api/chat-notifications') {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST') {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        for (const id of body.dismiss ?? []) dismissed.add(id);
        if (body.seen) for (const record of records) {
          if (sameChatNotificationTarget(body.seen, record.target) ||
              (body.seen.surface === 'garden_learn' && record.target.surface === 'garden_learn' && body.seen.gardenSlug === record.target.gardenSlug)) dismissed.add(record.id);
        }
        res.end('{"ok":true}'); return;
      }
      // Capture a stale server snapshot to exercise an in-flight polling race.
      const snapshot = JSON.stringify({ messages: records.filter(record => !dismissed.has(record.id)) });
      if (holdPolls) waitingPolls.push(() => res.end(snapshot));
      else res.end(snapshot);
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const errors = [];
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function pageAt(route, selfId, activeId = selfId, desktop = true) {
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(({selfId, activeId, desktop}) => {
      window.rendered = [];
      if (!desktop) return;
      let state = {selfId, activeId, windowFocused: true, enabled: true, tabs: [], extensions: []};
      const listeners = new Set();
      window.breadboardDesktop = {
        getTabsState: async () => state,
        onTabsState: callback => {listeners.add(callback); return () => listeners.delete(callback);},
      };
      window.setTabs = patch => {state = {...state, ...patch}; for (const callback of listeners) callback(state);};
    }, {selfId, activeId, desktop});
    await page.goto(origin + route);
    await page.waitForFunction(() => Array.isArray(window.shown));
    return page;
  }
  const active = await pageAt('/chat', 1);
  await active.evaluate(target => window.setChat(target), terminal);
  const overlay = await pageAt('/overlay', null, 1);
  const background = await pageAt('/quartz', 2, 1);
  const secondWindow = await pageAt('/other-window', 3);
  await secondWindow.evaluate(() => window.setTabs({windowFocused: false}));
  const hosts = [active, overlay, background, secondWindow];
  const add = (id, target) => records.push({ id, title: target.surface === 'garden_learn' ? 'Learn complete' : 'Response ready', type: 'success', response: 'Answer', chatTitle: 'Chat', target, updatedAt: new Date().toISOString() });
  async function pollAll() {
    await Promise.all(hosts.map(async page => {
      if (await page.evaluate(() => document.visibilityState !== 'visible')) return;
      const response = holdPolls ? null : page.waitForResponse(r => r.url().endsWith('/api/chat-notifications') && r.request().method() === 'GET');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      if (response) {
        await (await response).finished();
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
    }));
  }
  async function absent(id) {
    for (const page of hosts) assert.equal(await page.evaluate(id => window.rendered.includes(id), id), false, `${id} flashed in ${page.url()}`);
  }

  // The overlay starts after the opened event; it must read live presence.
  add('msg_active', terminal);
  await pollAll();
  await overlay.waitForFunction(() => window.isViewed({surface:'dashboard_terminal',chatId:'conv_terminal'}));
  assert.ok(dismissed.has('msg_active'));
  await absent('msg_active');

  await active.evaluate(() => window.setChat({surface:'dashboard_terminal',chatId:'conv_garden'}));
  add('msg_hub', garden);
  await pollAll();
  await overlay.waitForFunction(() => !window.shown.includes('msg_hub'));
  // A Garden's canonical id matches the hub without changing its deep link.
  assert.equal(await overlay.evaluate(target => window.isViewed(target), garden), true);
  await absent('msg_hub');

  await active.evaluate(() => window.setLearn('signals'));
  add('learn_job_1:complete', learn);
  await pollAll();
  assert.equal(await overlay.evaluate(target => window.isViewed(target), learn), true);
  await absent('learn_job_1:complete');

  // Switching away immediately re-enables future answers; no 20-second grace.
  await active.evaluate(() => {window.setChat(null); window.setLearn(null);});
  // An Ask Here popup can show an answer from a different canonical chat.
  await active.evaluate(() => {window.closeInline=window.openInline('selection-visible');});
  records.push({id:'msg_inline_visible',title:'Response ready',type:'success',response:'Already reading this',
    chatTitle:'Side question',target:terminal,inlineSelectionId:'selection-visible',updatedAt:new Date().toISOString()});
  await pollAll();
  await absent('msg_inline_visible');
  assert.ok(dismissed.has('msg_inline_visible'));
  await active.evaluate(() => window.setTabs({activeId:2}));
  records.push({id:'msg_inline_hidden',title:'Response ready',type:'success',response:'Finished in another tab',
    chatTitle:'Side question',target:terminal,inlineSelectionId:'selection-visible',updatedAt:new Date().toISOString()});
  await pollAll();
  await overlay.waitForFunction(() => window.shown.includes('msg_inline_hidden'));
  await active.evaluate(() => window.setTabs({activeId:1}));
  await overlay.waitForFunction(() => !window.shown.includes('msg_inline_hidden'));
  add('msg_other_while_inline_open',terminal);
  await pollAll();
  await overlay.waitForFunction(() => window.shown.includes('msg_other_while_inline_open'));
  await active.evaluate(() => window.closeInline());
  records.push({id:'msg_inline_closed',title:'Response ready',type:'success',response:'Finished after closing',
    chatTitle:'Side question',target:terminal,inlineSelectionId:'selection-visible',updatedAt:new Date().toISOString()});
  await pollAll();
  await overlay.waitForFunction(() => window.shown.includes('msg_inline_closed'));

  add('msg_background', garden);
  await pollAll();
  await overlay.waitForFunction(() => window.shown.includes('msg_background'));
  await active.evaluate(target => window.setChat(target), garden);
  await overlay.waitForFunction(() => !window.shown.includes('msg_background'));
  assert.ok(dismissed.has('msg_background'));

  records.push({ id:'question_visible', kind:'chat_question', title:'Answer needed', type:'success',
    response:'Which time period?', chatTitle:'Research', target:garden, updatedAt:new Date().toISOString() });
  await pollAll();
  await absent('question_visible');
  assert.ok(dismissed.has('question_visible'));
  await active.evaluate(() => window.setChat(null));
  records.push({ id:'question_background', kind:'chat_question', title:'Answer needed', type:'success',
    response:'Which time period?', chatTitle:'Research', target:garden, updatedAt:new Date().toISOString() });
  await pollAll();
  await overlay.waitForFunction(() => window.shown.includes('question_background'));
  const questionCard = overlay.getByRole('status').filter({hasText:'Answer needed'});
  assert.match(await questionCard.textContent(),/Which time period\?/);
  assert.equal(await questionCard.getByRole('textbox').count(),0,'a question opens its existing answer card rather than starting another turn');
  await questionCard.getByRole('button',{name:'Open chat to answer',exact:true}).last().click();
  assert.deepEqual(await overlay.evaluate(() => window.openedTarget),garden);
  await pollAll();
  assert.ok(dismissed.has('question_background'));
  for (const host of hosts) assert.equal(await host.evaluate(() => window.shown.includes('question_background')),false);
  await active.evaluate(target => window.setChat(target),garden);

  // Electron can leave a selected page mounted in a hidden tab/window.
  await active.evaluate(() => window.setTabs({activeId: 2}));
  add('msg_hidden_tab', garden);
  await pollAll();
  await overlay.waitForFunction(() => window.shown.includes('msg_hidden_tab'));
  await active.evaluate(() => window.setTabs({activeId:1, windowFocused:false}));
  add('msg_unfocused', garden);
  await pollAll();
  await overlay.waitForFunction(() => window.shown.includes('msg_unfocused'));
  await active.evaluate(() => window.setTabs({windowFocused:true}));
  await overlay.waitForFunction(() => !window.shown.includes('msg_unfocused') && !window.shown.includes('msg_hidden_tab'));

  // A response already in flight must be checked against the *current* view.
  await active.evaluate(() => window.setChat(null));
  add('msg_race', terminal);
  holdPolls = true;
  await pollAll();
  await new Promise(resolve => { const check = () => waitingPolls.length ? resolve() : setTimeout(check, 10); check(); });
  await active.evaluate(target => window.setChat(target), terminal);
  holdPolls = false;
  for (const release of waitingPolls.splice(0)) release();
  await pollAll();
  await absent('msg_race');

  // Close/unload releases presence; old crashed-renderer leases expire.
  await active.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  assert.equal(await overlay.evaluate(target => window.isViewed(target), terminal), false);
  await overlay.evaluate(target => {
    localStorage.setItem('breadboard:notification-view:v1:crashed', JSON.stringify({targets:[target],expiresAt:Date.now()-1}));
    localStorage.setItem('breadboard:notification-view:v1:invalid', '{');
  }, terminal);
  assert.equal(await overlay.evaluate(target => window.isViewed(target), terminal), false);

  // Browser builds use DOM focus and visibility without Electron. Headless
  // Chromium reports every page focused, so drive those platform signals.
  const browserTab = await pageAt('/browser-chat', null, null, false);
  hosts.push(browserTab);
  await browserTab.evaluate(() => {
    window.browserFocused = true;
    window.browserVisible = true;
    document.hasFocus = () => window.browserFocused;
    Object.defineProperty(document, 'visibilityState', {get: () => window.browserVisible ? 'visible' : 'hidden'});
  });
  await browserTab.evaluate(target => window.setChat(target), terminal);
  assert.equal(await browserTab.evaluate(() => window.isActive()), true);
  add('msg_browser_viewed', terminal);
  await pollAll();
  await absent('msg_browser_viewed');
  await browserTab.evaluate(() => {
    window.browserFocused = false;
    window.dispatchEvent(new Event('blur'));
  });
  await browserTab.waitForFunction(() => !window.isActive());
  add('msg_browser_background', terminal);
  await pollAll();
  await overlay.waitForFunction(() => window.shown.includes('msg_browser_background'));
  await browserTab.evaluate(() => {
    window.browserFocused = true;
    window.browserVisible = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await browserTab.evaluate(() => window.isActive()), false);
  assert.equal(await overlay.evaluate(target => window.isViewed(target), terminal), false);
  assert.deepEqual(errors, []);
});
