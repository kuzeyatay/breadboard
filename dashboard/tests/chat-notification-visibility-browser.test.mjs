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

test('only readable messages suppress delivery across panes, editors, overlays and unread indicators', { timeout: 90_000 }, async t => {
  const bundle = await esbuild.build({
    stdin: { loader: 'tsx', resolveDir: root, contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {useToast} from './src/app/components/toast';
      import {useUnreadChats} from './src/lib/conversations/unread-client';
      import {useChatNotificationView} from './src/lib/use-chat-notification-view';
      import {isChatNotificationRecordViewed,chatNotificationTargetKey} from './src/lib/chat-notification-inbox';
      import {notifyTaskCompleted} from './src/lib/task-completion-notification';
      window.isViewed=isChatNotificationRecordViewed; window.complete=notifyTaskCompleted;
      function Surface({target,keys=[],mode='',name='chat'}) {
        useChatNotificationView(target);
        if(!target)return null;
        return <section data-name={name} data-notification-chat={chatNotificationTargetKey(target)}
          style={{width:300,height:140,overflow:'auto',display:mode==='hidden'?'none':'block',position:'relative'}}>
          {mode==='offscreen'&&<div style={{height:500}}>Earlier messages</div>}
          <div data-notification-message={JSON.stringify(keys)} style={{minHeight:50}}>
            {mode==='thinking'&&<div style={{height:500}}>Thinking</div>}
            <div data-chat-selectable-message="answer">A readable assistant answer</div>
            <div data-notification-run="run-1">Finished result</div>
          </div>
        </section>;
      }
      function App(){
        const {toasts,refreshNotifications}=useToast({desktopOverlay:location.pathname==='/overlay'});
        const {unreadChats}=useUnreadChats();
        const [views,setViews]=React.useState([]),[covered,setCovered]=React.useState(false);
        window.setViews=v=>flushSync(()=>setViews(v));window.cover=v=>flushSync(()=>setCovered(v));
        window.refresh=refreshNotifications;window.shown=toasts.map(t=>t.notificationId??t.title);window.flashes.push(...window.shown);
        window.unread=[...unreadChats];
        return <>{views.map(v=><Surface key={v.name??'chat'} {...v}/>)}
          {covered&&<div style={{position:'fixed',inset:0,background:'white',zIndex:20}}>Another surface covers the chat</div>}</>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', outfile:'app.js',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'navigation', setup(build) {
      build.onResolve({ filter: /^(next\/navigation|\.\/navigation-progress)$/ }, a => ({ path:a.path, namespace:'fixture' }));
      build.onLoad({ filter:/.*/, namespace:'fixture' }, () => ({ contents:'export const useRouter=()=>({push(){}});export const startNavigationProgress=()=>{};' }));
    }}],
  });
  const records = [];
  const announced = new Set();
  const dismissed = new Set();
  let rejectReceipts = false;
  const server = http.createServer(async(req,res)=>{
    if(req.url==='/app.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text);return;}
    if(req.url.startsWith('/api/chat-notifications')){
      res.setHeader('Content-Type','application/json');
      if(req.method==='POST'){
        let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
        if(rejectReceipts){res.statusCode=503;res.end('{}');return;}
        const acknowledged=[];
        for(const id of [...body.dismiss??[],...body.read??[]])dismissed.add(id);
        for(const record of records){
          if(body.seen&&sameChatNotificationTarget(record.target,body.seen))dismissed.add(record.id);
          if(body.viewed&&sameChatNotificationTarget(record.target,body.viewed.target)){
            const matched=record.messageKeys.filter(k=>body.viewed.messageKeys.includes(k));
            if(matched.length){dismissed.add(record.id);acknowledged.push(...matched);}
          }
        }
        res.end(JSON.stringify({ok:true,acknowledged}));return;
      }
      const pending=records.filter(r=>announced.has(r.id)&&!dismissed.has(r.id));
      res.end(JSON.stringify({messages:pending,unread:pending}));return;
    }
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  t.after(()=>browser.close());
  const context=await browser.newContext();
  const errors=[];
  async function pageAt(route,selfId){
    const page=await context.newPage();page.setDefaultTimeout(8_000);page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(selfId=>{
      window.flashes=[];
      if(window.parent!==window)return;
      let state={selfId,activeId:1,visibleId:1,windowFocused:true,enabled:true,tabs:[],extensions:[]};const listeners=new Set();
      if(location.pathname==='/voice')window.breadboardNotificationVisibility={getState:async()=>state,onState:cb=>{listeners.add(cb);return()=>listeners.delete(cb);}};
      else window.breadboardDesktop={getTabsState:async()=>state,onTabsState:cb=>{listeners.add(cb);return()=>listeners.delete(cb);}};
      window.setTabs=patch=>{state={...state,...patch};for(const cb of listeners)cb(state);};
    },selfId);
    await page.goto(`http://127.0.0.1:${server.address().port}${route}`);await page.waitForFunction(()=>window.refresh);return page;
  }
  const page=await pageAt('/chat',1),overlay=await pageAt('/overlay',null);
  const terminal={surface:'dashboard_terminal',chatId:'conv_terminal'};
  const garden={surface:'garden_chat',gardenSlug:'signals',chatId:'42',conversationId:'conv_terminal'};
  const add=(id,target=terminal,kind='chat_response')=>{
    const record={id,target,kind,title:kind==='chat_question'?'Answer needed':'Response ready',type:'success',response:'Answer',chatTitle:'Chat',updatedAt:new Date().toISOString(),messageKeys:[`client:${id}`]};
    records.push(record);return record;
  };
  const show=async(record,mode='',target=record.target)=>page.evaluate(async({record,mode,target})=>{
    window.setViews([{target,keys:record.messageKeys,mode}]);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  },{record,mode,target});
  // Make inbox arrival explicit: constructing a fixture is not an incoming
  // reply until its intended visibility (including its first paint) is set.
  const poll=()=>{for(const record of records)announced.add(record.id);return overlay.evaluate(()=>window.refresh());};
  const delivered=async(record)=>{await poll();await overlay.waitForFunction(id=>window.shown.includes(id),record.id);assert.equal(dismissed.has(record.id),false);};
  const read=async(record)=>{await page.waitForFunction(r=>window.isViewed(r),record);await poll();await overlay.waitForFunction(id=>!window.shown.includes(id),record.id);assert.ok(dismissed.has(record.id));};

  const offscreen=add('scrolled-away');await show(offscreen,'offscreen');await delivered(offscreen);
  await page.waitForFunction(()=>window.unread.includes('conv_terminal'));
  await page.locator('section').evaluate(el=>el.scrollTop=el.scrollHeight);await read(offscreen);
  await page.waitForFunction(()=>!window.unread.includes('conv_terminal'));

  const notRendered=add('not-rendered');await show({...notRendered,messageKeys:['client:older-answer']});await delivered(notRendered);
  const thinking=add('thinking-only');await show(thinking,'thinking');await delivered(thinking);
  await show(thinking);await read(thinking);

  const hidden=add('hidden-editor');await show(hidden,'hidden');await delivered(hidden);
  await show(hidden);await read(hidden);
  const covered=add('covered');await page.evaluate(()=>window.cover(true));await show(covered);await delivered(covered);
  await page.evaluate(()=>window.cover(false));await read(covered);

  const unfocused=add('unfocused');await page.evaluate(()=>window.setTabs({windowFocused:false}));await show(unfocused);await delivered(unfocused);
  await page.evaluate(()=>window.setTabs({windowFocused:true}));await read(unfocused);
  // Uncovered pixels alone are not reading while another app has focus: the
  // notice is delivered, and focusing the window with the answer on screen retires it.
  await page.evaluate(()=>window.setTabs({windowFocused:false,notificationVisibleRects:[{x:0,y:0,width:1200,height:900}]}));
  const beside=add('visible-beside-focused-app');await show(beside);await delivered(beside);
  await page.evaluate(()=>window.setTabs({windowFocused:true}));await read(beside);
  // All of the original 25/50/75% points are covered, but a readable strip remains.
  await page.evaluate(()=>window.setTabs({notificationVisibleRects:[{x:8,y:8,width:40,height:140}]}));
  const strip=add('readable-native-strip');await show(strip);await read(strip);
  const obscured=add('answer-covered-by-app');
  await page.evaluate(()=>window.setTabs({notificationVisibleRects:[{x:0,y:100,width:1200,height:600}]}));
  await show(obscured);await delivered(obscured);
  await page.evaluate(()=>window.setTabs({notificationVisibleRects:[{x:0,y:0,width:1200,height:900}]}));await read(obscured);
  const whole=add('window-covered-by-app');
  await page.evaluate(()=>window.setTabs({notificationVisibleRects:[]}));await show(whole);await delivered(whole);
  await page.evaluate(()=>window.setTabs({notificationVisibleRects:[{x:0,y:0,width:1200,height:900}]}));await read(whole);
  const preparing=add('preparing-tab');await page.evaluate(()=>window.setTabs({activeId:1,visibleId:2}));await show(preparing);await delivered(preparing);
  await page.evaluate(()=>window.setTabs({activeId:2,visibleId:1}));await read(preparing);
  const split=add('visible-split');await page.evaluate(()=>window.setTabs({activeId:2,visibleId:2,visibleIds:[1,2]}));await show(split);await read(split);
  const parked=add('parked-split');await page.evaluate(()=>window.setTabs({visibleIds:[2]}));await show(parked);await delivered(parked);
  await page.evaluate(()=>window.setTabs({activeId:1,visibleId:1,visibleIds:[1]}));

  const alias=add('garden-alias');await show(alias,'',garden);await read(alias);
  const question=add('question',terminal,'chat_question');question.messageKeys=['question:request-1'];
  await show(question,'offscreen');await delivered(question);await show(question);await read(question);

  // Reading one split/editor surface cannot acknowledge its neighbor's reply.
  const other={surface:'dashboard_terminal',chatId:'conv_other'};
  const left=add('left'),right=add('right',other);
  await page.evaluate(({left,right})=>window.setViews([
    {name:'left',target:left.target,keys:left.messageKeys},
    {name:'right',target:right.target,keys:right.messageKeys,mode:'hidden'},
  ]),{left,right});await read(left);await delivered(right);

  // The receipt is sent on rendering, before polling; closing cannot replay it.
  const brief=add('briefly-visible');await show(brief);
  await page.waitForResponse(r=>r.request().method()==='POST'&&r.request().postData()?.includes('briefly-visible'));
  await page.evaluate(()=>window.setViews([]));await poll();assert.ok(dismissed.has(brief.id));
  assert.equal(await overlay.evaluate(id=>window.flashes.includes(id),brief.id),false);

  const retry=add('retry-receipt');rejectReceipts=true;await show(retry);
  await page.waitForFunction(r=>window.isViewed(r),retry);await poll();
  await page.evaluate(()=>window.setViews([]));rejectReceipts=false;
  await page.waitForResponse(r=>r.request().method()==='POST'&&r.request().postData()?.includes('retry-receipt')&&r.status()===200);
  assert.ok(dismissed.has(retry.id));

  // A chat-owned agent run is delivered once through its persisted answer.
  await show(left);await page.evaluate(()=>window.complete('Finished',{runId:'run-1'}));
  assert.equal(await page.evaluate(()=>window.shown.includes('Task completed')),false);

  // The embedded Word assistant is visible even when focus stays in its host.
  await page.evaluate(()=>{window.setViews([]);const frame=document.createElement('iframe');frame.src='/editor';frame.style.cssText='width:400px;height:220px;border:0';document.body.append(frame);});
  const editor=await page.waitForEvent('framenavigated', {predicate:frame=>frame.url().endsWith('/editor')});
  await editor.waitForFunction(()=>window.setViews);
  await editor.evaluate(()=>{document.hasFocus=()=>false;});
  const embedded=add('embedded-editor');
  await editor.evaluate(record=>window.setViews([{target:record.target,keys:record.messageKeys}]),embedded);
  await editor.waitForFunction(r=>window.isViewed(r),embedded);await poll();assert.ok(dismissed.has(embedded.id));
  const coveredFrame=add('covered-frame');await page.evaluate(()=>window.cover(true));
  await editor.evaluate(record=>window.setViews([{target:record.target,keys:record.messageKeys}]),coveredFrame);
  await delivered(coveredFrame);
  await page.evaluate(()=>window.cover(false));
  await editor.waitForFunction(r=>window.isViewed(r),coveredFrame);await poll();
  await overlay.waitForFunction(id=>!window.shown.includes(id),coveredFrame.id);
  const nativeFrame=add('editor-covered-by-native-app');
  await page.evaluate(()=>window.setTabs({notificationVisibleRects:[{x:0,y:160,width:1200,height:600}]}));
  await editor.evaluate(record=>window.setViews([{target:record.target,keys:record.messageKeys}]),nativeFrame);
  await delivered(nativeFrame);
  await page.evaluate(()=>window.setTabs({windowFocused:true,notificationVisibleRects:[{x:0,y:0,width:1200,height:900}]}));
  await editor.waitForFunction(r=>window.isViewed(r),nativeFrame);await poll();
  await overlay.waitForFunction(id=>!window.shown.includes(id),nativeFrame.id);
  const voice=await pageAt('/voice',null);
  await voice.evaluate(()=>window.setTabs({notificationPageVisible:true,windowFocused:true,notificationVisibleRects:[{x:0,y:0,width:1200,height:900}]}));
  const spoken=add('standalone-voice-visible',{surface:'dashboard_terminal',chatId:'conv_voice'});
  await voice.evaluate(async record=>{window.setViews([{target:record.target,keys:record.messageKeys}]);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},spoken);
  await voice.waitForFunction(r=>window.isViewed(r),spoken);await poll();
  assert.equal(await overlay.evaluate(id=>window.flashes.includes(id),spoken.id),false);
  const coveredVoice=add('standalone-voice-covered',spoken.target);
  await voice.evaluate(record=>{window.setTabs({notificationVisibleRects:[]});window.setViews([{target:record.target,keys:record.messageKeys}]);},coveredVoice);
  await delivered(coveredVoice);
  await voice.evaluate(()=>window.setTabs({notificationVisibleRects:[{x:0,y:0,width:1200,height:900}]}));
  await voice.waitForFunction(r=>window.isViewed(r),coveredVoice);await poll();
  await overlay.waitForFunction(id=>!window.shown.includes(id),coveredVoice.id);
  assert.deepEqual(errors,[]);
});

test('all transcript families expose message identity and every inline run declares its owner',()=>{
  for(const file of ['app/components/hermes/agent-runtime-panel.tsx','app/components/voice-conversation-overlay.tsx','app/garden/garden-assistant.tsx',
    'app/gardens/[clusterSlug]/workspace-client.tsx','app/artifacts/[artifactId]/markdown/markdown-artifact-editor.tsx',
    'vendor/genoffice/docs/src/renderer/ai/AiPanel.tsx','vendor-overrides/genoffice/docs/src/renderer/ai/AiPanel.tsx']){
    const source=fs.readFileSync(path.join(root,'src',file),'utf8');
    assert.match(source,/data-notification-chat=/,file);assert.match(source,/data-notification-message=/,file);
  }
  const dir=path.join(root,'src/app/components/hermes');
  for(const file of fs.readdirSync(dir).filter(f=>f.startsWith('inline-')&&f.endsWith('.tsx'))){
    const source=fs.readFileSync(path.join(dir,file),'utf8');if(!source.includes('notifyTaskCompleted('))continue;
    assert.match(source,/data-notification-run=\{runId\}/,file);
    assert.match(source,/notifyTaskCompleted\([\s\S]*?\{ runId \}/,file);
  }
});
