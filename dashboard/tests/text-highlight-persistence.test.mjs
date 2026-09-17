import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test, {after} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'breadboard-highlight-persistence-'));
process.env.BREADBOARD_DATA_DIR = root;
const {default: db} = await import('../src/lib/db.ts');
const {syncTextHighlights: sync} = await import('../src/lib/text-highlight-store.ts');
const types = await import('../src/lib/text-highlight-types.ts');
const core = await import('../src/lib/hermes/route-core.ts');
const originPolicy = {};
const originCode = ts.transpileModule(fs.readFileSync(new URL('../src/lib/request-origin.ts',import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('require','exports',originCode)(()=>({RouteError:class extends Error {constructor(status,message){super(message);this.status=status;}}}),originPolicy);
db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES (1,'alice','a@example.test','x'),(2,'bob','b@example.test','x')").run();
after(() => { db.close(); fs.rmSync(root, {recursive:true, force:true}); });
const key = 'breadboard:chat-highlights:unit';
const mark = (id, color = 'blue') => ({id, color, sourceMessageId:'message-1', start:0, end:8, quote:'Learning'});
const operation = (operationId, value, id = value?.id) => ({operationId, id, value});

test('all annotation kinds migrate to the durable store and remain private to their user and location', () => {
  for (const prefix of types.TEXT_HIGHLIGHT_PREFIXES) {
    const location = prefix + 'migration';
    const entry = prefix.includes('deleted-inline') ? 'deleted-selection' : mark('old');
    assert.deepEqual(sync(1, {key:location, entries:[entry]}).entries, [entry]);
    assert.deepEqual(sync(1, {key:location}).entries, [entry]);
    assert.deepEqual(sync(2, {key:location}).entries, []);
    assert.deepEqual(sync(1, {key:location + '-other'}).entries, []);
  }
  assert.throws(() => sync(1, {key:'unrelated:setting'}), e => e.status === 400);
  assert.throws(() => sync(1, {key, mutations:[operation('invalid',mark('b'),'a')]}), e => e.status === 400);
});

test('concurrent marks merge, and stale caches or retried edits cannot resurrect erased highlights', () => {
  sync(1, {key, entries:[mark('a')]});
  sync(1, {key, mutations:[operation('add-b', mark('b'))]});
  assert.equal(sync(1, {key, entries:[mark('a')]}).entries.length, 2);
  sync(1, {key, mutations:[operation('recolor-a',mark('a','pink'))]});
  sync(1, {key, mutations:[operation('erase-a',null,'a')]});
  const result = sync(1, {key, entries:[mark('a')], mutations:[operation('recolor-a',mark('a','pink'))]});
  assert.deepEqual(result.entries, [mark('b')]);
  assert.deepEqual(result.acknowledged, ['recolor-a']);
});

test('a fresh Node process restores highlights and deletion tombstones from the application database', () => {
  const moduleUrl = new URL('../src/lib/text-highlight-store.ts', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--experimental-strip-types','--input-type=module','-e',
    `const {syncTextHighlights}=await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify(syncTextHighlights(1,{key:${JSON.stringify(key)},entries:[${JSON.stringify(mark('a'))}]}).entries));`],
    {env:{...process.env, BREADBOARD_DATA_DIR:root}, encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), [mark('b')]);
});

test('the route authenticates writes, bounds requests, and permits only configured cross-origin clients', async () => {
  let userId = 1;
  const modules = {
    '@/lib/server-auth':{requireUserId:async()=>{if (!userId) throw Object.assign(new Error('Unauthorized'),{status:401});return userId;}},
    '@/lib/hermes/quartz-support.ts':{corsHeaders:origin=>({'Access-Control-Allow-Origin':origin === 'http://quartz.test' ? origin : 'http://dashboard.test'})},
    '@/lib/hermes/route-helpers.ts':{...core, apiErrorResponse:error=>Response.json({error:error.message},{status:error.status??500})},
    '@/lib/text-highlight-store.ts':{syncTextHighlights:sync},
    '@/lib/request-origin':originPolicy,
  };
  const code = ts.transpileModule(fs.readFileSync(new URL('../src/app/api/text-highlights/route.ts',import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const api = {};
  new Function('require','exports',code)(id=>modules[id],api);
  const post = (body, origin='http://quartz.test', extra={}) => api.POST(new Request('http://dashboard.test/api/text-highlights',{method:'POST',headers:{origin,...extra},body:JSON.stringify(body)}));
  const allowed = await post({key});
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('cache-control'),'no-store');
  assert.equal((await post({key},'http://attacker.test')).status,403);
  // The desktop's standalone server constructs Request.url from its bind
  // address, while the browser sends its actual loopback host and launch port.
  const desktop = await post({key},'http://127.0.0.1:55685',{host:'127.0.0.1:55685','sec-fetch-site':'same-origin'});
  assert.equal(desktop.status,200);
  assert.equal(desktop.headers.get('access-control-allow-origin'),'http://127.0.0.1:55685');
  assert.equal((await post({key},'https://breadboard.test',{'x-forwarded-host':'breadboard.test','x-forwarded-proto':'https'})).status,200);
  assert.equal((await post({key},'http://attacker.test',{host:'127.0.0.1:55685','sec-fetch-site':'cross-site'})).status,403);
  assert.equal((await post({key},'http://127.0.0.1:55686',{host:'127.0.0.1:55685'})).status,403);
  assert.equal((await post({key},undefined,{'content-length':String(9*1024*1024)})).status,413);
  userId = 0;
  assert.equal((await post({key})).status,401);
});

const dashboardRoot = fileURLToPath(new URL('../',import.meta.url));
const quartzRequire = createRequire(new URL('../../quartz/package.json', import.meta.url));
const highlightCss = quartzRequire('sass').compile(fileURLToPath(new URL('../../quartz/quartz/components/styles/highlighter.scss', import.meta.url))).css;
const headerCss = fs.readFileSync(new URL('../../quartz/quartz/components/Header.tsx', import.meta.url), 'utf8').match(/Header.css = `([\s\S]*?)`/)[1];
async function bundles() {
  const options = {bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}};
  const quartz = await build({...options,entryPoints:[fileURLToPath(new URL('../../quartz/quartz/components/scripts/highlighter.inline.ts',import.meta.url))]});
  const react = await build({...options,stdin:{resolveDir:dashboardRoot,loader:'tsx',contents:`
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {useTextHighlights} from './src/app/components/use-text-highlights';
    import {openTextHighlights} from './src/lib/text-highlight-client';
    import {TextHighlightSaveStatus} from './src/app/components/text-highlight-save-status';
    window.openStore = openTextHighlights;
    const normalize = value => Array.isArray(value) ? value : [];
    function App(){
      const [key,setKey]=useState('breadboard:pdf-highlights:document-a');
      const [marks,setMarks,error]=useTextHighlights(key,normalize);
      window.changeKey=setKey;
      return <><output>{JSON.stringify(marks)}</output><TextHighlightSaveStatus error={error}/>
        <button onClick={()=>setMarks(a=>[...a,{id:'mark-'+key,quote:key,color:'blue'}])}>Mark</button>
        <button onClick={()=>setMarks([])}>Erase</button></>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `}});
  // Exercise the Garden workspace's actual storage hooks, normalizers and
  // highlighter actions without mounting its unrelated runtime/tool surfaces.
  const source=fs.readFileSync(new URL('../src/app/gardens/[clusterSlug]/workspace-client.tsx',import.meta.url),'utf8').replaceAll('\r\n','\n');
  const tree=ts.createSourceFile('garden.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const functions=new Map();
  function visit(node){if(ts.isFunctionDeclaration(node)&&node.name)functions.set(node.name.text,node.getText(tree));ts.forEachChild(node,visit);}
  visit(tree);
  const declarations=source.slice(source.indexOf('const INLINE_SELECTION_STORAGE_PREFIX ='),source.indexOf('/**\n * The id selections anchor to.'));
  const start=source.indexOf('  const [savedInlineSelections, setSavedInlineSelections, inlineHighlightSaveError]');
  const state=source.slice(start,source.indexOf('  // A shared chat',start));
  assert.ok(state.includes('useTextHighlights'));
  const garden=await build({...options,stdin:{resolveDir:dashboardRoot,loader:'tsx',contents:`
    import React,{useState,useMemo,useCallback} from 'react';import {createRoot} from 'react-dom/client';
    import {useTextHighlights} from './src/app/components/use-text-highlights';
    import {normalizeChatTextSelectionReference,chatTextSelectionsOverlap} from './src/lib/chat-text-selection';
    import {isChatHighlightColor,normalizeChatHighlightNote,DEFAULT_CHAT_HIGHLIGHT_COLOR} from './src/lib/chat-highlights';
    ${declarations}
    ${['normalizeInlineSelections','normalizeDeletedInlineSelectionIds','normalizeSavedChatHighlight','normalizeChatHighlights'].map(name=>functions.get(name)).join('\n')}
    function App(){
      const [activeChatId,setActiveChatId]=useState(501);
      const selectionMenu={sourceMessageId:'msg_1',start:0,end:8,quote:'Learning',prefix:'',suffix:''};
      const setSelectionMenu=()=>{};
      ${state}
      ${functions.get('applySelectionHighlight')}
      ${functions.get('removeSelectionHighlight')}
      ${functions.get('saveSelectionNote')}
      window.changeGardenChat=setActiveChatId;
      return <><output>{JSON.stringify(savedChatHighlights)}</output><p role="status">{highlightSaveError}</p>
        <button onClick={()=>applySelectionHighlight('pink')}>Mark</button>
        <button onClick={()=>saveSelectionNote('Remember this connection')}>Note</button>
        <button onClick={removeSelectionHighlight}>Erase</button></>;
    }createRoot(document.getElementById('root')).render(<App/>);
  `}});
  return {quartz:quartz.outputFiles[0].text, react:react.outputFiles[0].text,garden:garden.outputFiles[0].text};
}

function html(script, article = 'Learning survives a restart. Another passage remains available.') {
  if (script !== 'quartz') return `<html><body><div id="root"></div><script src="/${script}.js"></script></body></html>`;
  return `<html><head><style>${headerCss}\n${highlightCss}</style></head><body data-slug="persistence-garden/lesson"><article class="popover-hint"><p>${article}</p></article>
    <div class="bb-highlighter" hidden><div class="bb-highlight-menu">
      <button data-highlight-color="blue">Blue</button><button data-highlight-color="pink">Pink</button>
      <button data-highlight-action="erase">Erase</button><button data-highlight-action="ask-inline">Ask here</button>
    </div></div><script>window.cleanups=[]; window.addCleanup=fn=>cleanups.push(fn);</script>
    <script src="/quartz.js"></script><script>document.dispatchEvent(new Event('nav'));</script></body></html>`;
}

async function harness(t) {
  // Browser cases reuse document slugs, but not each other's persisted marks
  // or inline answers. Each case still shares its DB across reloads/restarts.
  db.prepare('DELETE FROM text_highlights WHERE user_id = 1').run();
  db.prepare('DELETE FROM text_highlight_operations WHERE user_id = 1').run();
  const scripts = await bundles();
  let fail = false;
  let delayed = false;
  let article;
  const requests = [];
  const held = [];
  const create = async () => {
    const server = createServer(async(req,res)=>{
      const send = (status,body,type='application/json') => {res.writeHead(status,{'Content-Type':type,'Access-Control-Allow-Origin':req.headers.origin??'*','Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'});res.end(body);};
      if (req.url === '/api/text-highlights') {
        if(req.method==='OPTIONS') return send(204,'');
        let raw=''; for await(const part of req) raw+=part;
        if (fail) return send(503,JSON.stringify({error:'Offline'}));
        const input = JSON.parse(raw); requests.push(input);
        const result = sync(1,input);
        if (delayed && input.key.includes('slow')) {held.push(()=>send(200,JSON.stringify(result)));return;}
        return send(200,JSON.stringify(result));
      }
      if (req.url === '/quartz.js') return send(200,scripts.quartz,'application/javascript');
      if (req.url === '/react.js') return send(200,scripts.react,'application/javascript');
      if (req.url === '/garden.js') return send(200,scripts.garden,'application/javascript');
      if (req.url === '/garden') return send(200,html('garden'),'text/html');
      if (req.url === '/embedded') return send(200,`<iframe src="http://127.0.0.1:${quartzServer.address().port}/quartz-next" style="width:100%;height:90vh;border:0"></iframe><script>window.requests=[];addEventListener('message',e=>requests.push(e.data));</script>`,'text/html');
      if (req.url.startsWith('/quartz-next')) return send(200,html('quartz',article), 'text/html');
      // Quartz's normal iframe discovers the actual host from its referrer.
      if (req.url === '/quartz') {
        const document = html('quartz',article).replace('document.dispatchEvent',`Object.defineProperty(document,'referrer',{value:'http://127.0.0.1:${server.address().port}/garden'}); document.dispatchEvent`);
        return send(200,document,'text/html');
      }
      return send(200,html('react'),'text/html');
    });
    await new Promise(resolve=>server.listen(0,resolve));
    return server;
  };
  let server = await create();
  const createQuartz = async () => {
    const proxy=createServer(async(req,res)=>{
      const response=await fetch(`http://127.0.0.1:${server.address().port}${req.url}`);
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise(resolve=>proxy.listen(0,resolve));return proxy;
  };
  let quartzServer=await createQuartz();
  const close = async server => {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
  const browser = await chromium.launch(executablePath ? {executablePath,headless:true} : {headless:true});
  t.after(async()=>{for(const release of held) release();await browser.close();await close(quartzServer);await close(server);});
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  t.after(()=>assert.deepEqual(errors,[], 'browser JavaScript errors'));
  return {
    page,browser,requests,
    url:(p='/')=>`http://127.0.0.1:${p==='/quartz'?quartzServer.address().port:server.address().port}${p}`,
    setFail:value=>{fail=value;},setArticle:value=>{article=value;},setDelayed:value=>{delayed=value;},
    release:()=>{for(const release of held.splice(0))release();},
    restart:async()=>{await close(quartzServer);await close(server);server=await create();quartzServer=await createQuartz();},
  };
}

async function selectText(page, quote) {
  await page.evaluate(quote=>{
    const root=document.querySelector('article'); const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let node; while(node=walker.nextNode()) {const at=node.textContent.indexOf(quote);if(at<0)continue;
      const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+quote.length);
      getSelection().removeAllRanges();getSelection().addRange(range);document.body.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',bubbles:true}));return;
    } throw Error('Missing selection '+quote);
  },quote);
}

async function color(page, quote, name='Blue') {
  await selectText(page, quote);
  await page.getByRole('button',{name,exact:true}).click();
}

async function until(predicate) {
  const deadline=Date.now()+5_000;
  while(!predicate()) {assert.ok(Date.now()<deadline,'persistence did not finish');await delay(10);}
}

test('embedded Quartz keeps saving after full navigation, and inline answers fit and retry the same highlight', {timeout:60_000}, async t=>{
  const h=await harness(t);
  const {page}=h;
  await page.setViewportSize({width:600,height:700});
  await page.goto(h.url('/embedded'));
  let frame=page.frames().find(f=>f.parentFrame());
  await frame.waitForSelector('article');
  // Navigate from Quartz to Quartz, just as the reported numbered lesson does.
  await frame.evaluate(()=>{location.href='/quartz-next?lesson=2'});
  await frame.waitForURL('**/quartz-next?lesson=2');
  // The fixture uses the same lesson document for its clean and query URL.
  await frame.waitForSelector('article');
  assert.equal(new URL(await frame.evaluate(()=>document.referrer)).origin,new URL(frame.url()).origin);
  await color(frame,'Learning survives a restart.','Ask here');
  await page.waitForFunction(()=>requests.some(r=>r.type==='second-brain:assistant-ask-here'));
  const request=await page.evaluate(()=>requests.find(r=>r.type==='second-brain:assistant-ask-here'));
  assert.equal(request.text,'Learning survives a restart.');
  await frame.waitForFunction(()=>!Object.keys(localStorage).some(k=>k.startsWith('breadboard:highlight-outbox:')));
  await frame.evaluate(()=>location.reload());
  await frame.waitForSelector('mark.bb-hl');
  const question='what does this paragraph mean';
  await page.evaluate(({request,question})=>{
    const target=document.querySelector('iframe').contentWindow;
    for(const state of ['pending','complete']) target.postMessage({...request,type:'second-brain:assistant-inline-answer',question,answer:state==='complete'?'An explanation. '+('longword'.repeat(90)):'',state,responseDurationMs:17000},'*');
  },{request,question});
  await frame.waitForSelector('.bb-highlight-answer:not([hidden])');
  for(const viewport of [{width:600,height:700},{width:340,height:430}]) {
    await page.setViewportSize(viewport);
    await frame.waitForFunction(()=>document.querySelector('.bb-highlight-answer').getBoundingClientRect().right<=innerWidth);
    const layout=await frame.locator('.bb-highlight-answer').evaluate(el=>({
      rect:el.getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight,
      scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,headerMargin:getComputedStyle(el.querySelector('header')).marginTop,
    }));
    assert.ok(layout.rect.left>=0 && layout.rect.right<=layout.width, JSON.stringify(layout));
    assert.ok(layout.rect.top>=0 && layout.rect.bottom<=layout.height, JSON.stringify(layout));
    assert.equal(layout.scrollWidth,layout.clientWidth,'long answers wrap instead of scrolling sideways');
    assert.equal(layout.headerMargin,'0px','page header margins do not leak into answers');
  }
  assert.doesNotMatch(await frame.locator('.bb-highlight-answer').innerText(), /tokens unavailable/);
  if (process.env.QUARTZ_HIGHLIGHT_SCREENSHOT) {
    await page.screenshot({path:process.env.QUARTZ_HIGHLIGHT_SCREENSHOT});
  }
  await frame.getByRole('button',{name:'Close answer',exact:true}).click();
  assert.equal(await frame.locator('.bb-highlight-answer').isVisible(),false);
  assert.equal(await frame.locator('mark.bb-hl').count(),1);
  await frame.locator('mark.bb-hl').click();
  await frame.getByRole('button',{name:'Ask this question again',exact:true}).click();
  await page.waitForFunction(()=>requests.filter(r=>r.type==='second-brain:assistant-ask-here').length===2);
  const retry=await page.evaluate(()=>requests.filter(r=>r.type==='second-brain:assistant-ask-here').at(-1));
  assert.equal(retry.question,question);
  assert.equal(retry.highlightId,request.highlightId);
  assert.notEqual(retry.requestId,request.requestId);
  assert.equal(retry.text,request.text);
});

test('real garden highlights survive reload, absent text, fresh browser storage, changed ports and erasing', {timeout:60_000}, async t=>{
  const h=await harness(t); const {page}=h;
  await page.goto(h.url('/quartz'));
  await color(page,'Learning survives a restart.');
  await page.waitForFunction(()=>document.querySelector('mark.bb-hl')?.textContent==='Learning survives a restart.');
  const key='breadboard:garden-highlights:v1:persistence-garden/lesson';
  await page.waitForFunction(()=>!Object.keys(localStorage).some(key=>key.startsWith('breadboard:highlight-outbox:')));
  assert.equal(sync(1,{key}).entries.length,1);
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('mark.bb-hl')?.textContent==='Learning survives a restart.');
  h.setArticle('A lesson is temporarily rebuilding.');
  await page.reload();
  assert.equal(await page.locator('mark.bb-hl').count(),0);
  assert.equal(sync(1,{key}).entries.length,1);
  await color(page,'temporarily','Pink');
  await page.evaluate(()=>{document.querySelector('article').textContent='A lesson is temporarily rebuilding. Learning survives a restart.';});
  await page.waitForFunction(()=>document.querySelectorAll('mark.bb-hl').length===2);
  await page.waitForFunction(()=>!Object.keys(localStorage).some(key=>key.startsWith('breadboard:highlight-outbox:')));
  await page.goto('about:blank');
  h.setArticle(undefined);
  await h.restart();
  await page.goto(h.url('/quartz'));
  await page.waitForFunction(()=>document.querySelector('mark.bb-hl')?.textContent==='Learning survives a restart.');
  await color(page,'Learning survives a restart.','Erase');
  await page.waitForFunction(()=>!Object.keys(localStorage).some(key=>key.startsWith('breadboard:highlight-outbox:')));
  await page.reload();
  assert.equal(await page.locator('mark.bb-hl').count(),0);
  assert.equal(sync(1,{key}).entries.length,1,'only the unavailable temporary quote remains saved');
});

test('published Quartz notes attach to highlights and survive a server restart', {timeout:60_000}, async t=>{
  const h=await harness(t); const {page}=h;
  const key='breadboard:garden-highlights:v1:persistence-garden/lesson';
  await page.goto(h.url('/quartz'));
  await selectText(page,'Learning survives a restart.');
  await page.getByRole('button',{name:'Add note',exact:true}).click();
  await page.getByRole('textbox',{name:'Note about highlighted text',exact:true}).fill('Compare this with the previous lesson.');
  await page.getByRole('button',{name:'Save note',exact:true}).click();
  await until(()=>sync(1,{key}).entries.some(entry=>entry.note==='Compare this with the previous lesson.'));
  assert.equal(await page.locator('mark.bb-hl').getAttribute('title'),'Compare this with the previous lesson.');
  await page.goto('about:blank'); await h.restart(); await page.goto(h.url('/quartz'));
  const mark=page.locator('mark.bb-hl'); await mark.waitFor();
  assert.equal(await mark.getAttribute('title'),'Compare this with the previous lesson.');
  await mark.click();
  await page.getByRole('button',{name:'Edit note',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'Note about highlighted text',exact:true}).inputValue(),'Compare this with the previous lesson.');
});

test('document switches cannot overwrite another document and failed saves replay after reload', {timeout:60_000}, async t=>{
  const h=await harness(t);const {page}=h;
  await page.goto(h.url());
  await page.getByRole('button',{name:'Mark',exact:true}).click();
  await page.waitForFunction(()=>!Object.keys(localStorage).some(key=>key.startsWith('breadboard:highlight-outbox:')));
  await page.evaluate(()=>window.changeKey('breadboard:pdf-highlights:document-b'));
  await page.waitForFunction(()=>document.querySelector('output').textContent==='[]');
  await page.getByRole('button',{name:'Mark',exact:true}).click();
  await page.evaluate(()=>window.changeKey('breadboard:pdf-highlights:document-a'));
  await page.waitForFunction(()=>document.querySelector('output').textContent.includes('document-a'));
  assert.doesNotMatch(await page.locator('output').textContent(),/document-b/);
  h.setFail(true);
  await page.getByRole('button',{name:'Erase',exact:true}).click();
  await page.getByRole('status').filter({hasText:'retry automatically'}).waitFor();
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('output').textContent==='[]');
  h.setFail(false);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForFunction(()=>!Object.keys(localStorage).some(key=>key.startsWith('breadboard:highlight-outbox:')));
  assert.deepEqual(sync(1,{key:'breadboard:pdf-highlights:document-a'}).entries,[]);
  assert.equal(sync(1,{key:'breadboard:pdf-highlights:document-b'}).entries.length,1);
});

test('edits made during database hydration survive late responses and blocked localStorage still saves', {timeout:60_000}, async t=>{
  const h=await harness(t);const {page}=h;
  await page.goto(h.url());
  h.setDelayed(true);
  await page.evaluate(()=>{
    const store=window.openStore('breadboard:chat-highlights:slow');
    window.slow=store;store.subscribe(entries=>window.slowEntries=entries);
    store.update([{id:'new',quote:'Created while loading'}]);
  });
  await page.waitForFunction(()=>window.slowEntries?.length===1);
  h.setDelayed(false);h.release();
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForFunction(()=>!Object.keys(localStorage).some(key=>key.startsWith('breadboard:highlight-outbox:')));
  assert.equal(sync(1,{key:'breadboard:chat-highlights:slow'}).entries[0].id,'new');
  await page.evaluate(()=>{
    Storage.prototype.setItem=()=>{throw Error('Quota exceeded');};
    window.slow.update([{id:'new',quote:'Saved despite blocked cache'}]);
  });
  await page.waitForFunction(()=>window.slowEntries?.[0]?.quote==='Saved despite blocked cache');
  await page.evaluate(()=>window.slow.flush());
  assert.equal(sync(1,{key:'breadboard:chat-highlights:slow'}).entries[0].quote,'Saved despite blocked cache');
});

test('retry is clickable, shows saving progress, and waits for an active save to commit queued edits', {timeout:30_000}, async t=>{
  const h=await harness(t);const {page}=h;
  const key='breadboard:pdf-highlights:retry-slow';
  await page.goto(h.url());
  await page.evaluate(key=>window.changeKey(key),key);
  await page.waitForFunction(()=>document.querySelector('output').textContent==='[]');
  h.setFail(true);
  await page.getByRole('button',{name:'Mark',exact:true}).click();
  await page.getByRole('button',{name:'Retry saving',exact:true}).waitFor();
  h.setFail(false);h.setDelayed(true);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await until(()=>h.requests.some(r=>r.key===key&&r.mutations.length));
  await page.getByRole('button',{name:'Retry saving',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Saving…',exact:true}).isDisabled(),true);
  // Add an edit while the request is in flight; retry must wait for this too.
  await page.getByRole('button',{name:'Erase',exact:true}).click();
  h.setDelayed(false);h.release();
  await page.waitForFunction(()=>!Object.keys(localStorage).some(key=>key.startsWith('breadboard:highlight-outbox:')));
  assert.deepEqual(sync(1,{key}).entries,[]);
  assert.equal(await page.getByRole('button',{name:'Retry saving',exact:true}).count(),0);
  await page.reload();
  await page.evaluate(key=>window.changeKey(key),key);
  await page.waitForFunction(()=>document.querySelector('output').textContent==='[]');
});

test('failed saves retry automatically without a click or network event', {timeout:30_000}, async t=>{
  const h=await harness(t);const {page}=h;
  await page.clock.install();
  await page.goto(h.url());
  h.setFail(true);
  await page.getByRole('button',{name:'Mark',exact:true}).click();
  await page.getByRole('button',{name:'Retry saving',exact:true}).waitFor();
  h.setFail(false);
  await page.clock.runFor(10_001);
  await page.waitForFunction(()=>!Object.keys(localStorage).some(key=>key.startsWith('breadboard:highlight-outbox:')));
  assert.equal(sync(1,{key:'breadboard:pdf-highlights:document-a'}).entries.length,1);
  assert.equal(await page.getByRole('button',{name:'Retry saving',exact:true}).count(),0);
});

test('acknowledged highlights stay saved when a background refresh fails, and idle stores stop posting', {timeout:30_000}, async t=>{
  const h=await harness(t);const {page}=h;
  const key='breadboard:pdf-highlights:acknowledged-document';
  await page.clock.install();
  await page.goto(h.url());
  await page.evaluate(key=>window.changeKey(key),key);
  await page.waitForFunction(()=>document.querySelector('output').textContent==='[]');
  await page.getByRole('button',{name:'Mark',exact:true}).click();
  await page.waitForFunction(()=>!Object.keys(localStorage).some(key=>key.startsWith('breadboard:highlight-outbox:')));
  const saved=sync(1,{key}).entries;
  assert.equal(saved.length,1);
  const requests=h.requests.length;
  await page.clock.runFor(30_001);
  assert.equal(h.requests.length,requests,'idle stores do not poll every ten seconds');
  h.setFail(true);
  await page.evaluate(async key=>{await window.openStore(key).flush(true);},key);
  assert.equal(await page.getByRole('button',{name:'Retry saving',exact:true}).count(),0);
  assert.deepEqual(JSON.parse(await page.locator('output').textContent()),saved);
  // An actual unsaved deletion must still surface the failure and then retry.
  await page.getByRole('button',{name:'Erase',exact:true}).click();
  await page.getByRole('button',{name:'Retry saving',exact:true}).waitFor();
  assert.equal(sync(1,{key}).entries.length,1);
  h.setFail(false);
  await page.clock.runFor(10_001);
  await page.waitForFunction(()=>!Object.keys(localStorage).some(key=>key.startsWith('breadboard:highlight-outbox:')));
  assert.deepEqual(sync(1,{key}).entries,[]);
  assert.equal(await page.getByRole('button',{name:'Retry saving',exact:true}).count(),0);
});

test('closing during initial hydration sends unsaved highlights independently', {timeout:30_000}, async t=>{
  const h=await harness(t);const {page}=h;
  await page.goto(h.url());h.setDelayed(true);
  await page.evaluate(()=>{
    const store=window.openStore('breadboard:chat-highlights:close-slow');
    store.subscribe(()=>{});store.update([{id:'before-close',quote:'Keep this through shutdown'}]);
  });
  await until(()=>h.requests.some(r=>r.key.endsWith('close-slow')));
  await page.goto('about:blank');
  await until(()=>sync(1,{key:'breadboard:chat-highlights:close-slow'}).entries.length===1);
  h.setDelayed(false);h.release();
});

test('large legacy answer collections migrate in batches without truncation or duplicate entries', {timeout:30_000}, async t=>{
  const h=await harness(t);const {page}=h;
  await page.goto(h.url());
  const key='breadboard:garden-highlight-answers:v1:large-garden/lesson';
  await page.evaluate(key=>{
    const answers=Array.from({length:12},(_,i)=>({requestId:'answer-'+i,highlightId:'mark-'+i,question:'Explain',answer:'x'.repeat(100_000),state:'complete'}));
    localStorage.setItem(key,JSON.stringify(answers));
    window.large=window.openStore(key);window.large.subscribe(entries=>window.largeEntries=entries);
  },key);
  await until(()=>sync(1,{key}).entries.length===12);
  await page.waitForFunction(()=>window.largeEntries.length===12);
  const imports=h.requests.filter(r=>r.key===key);
  assert.ok(imports.length>=3);
  assert.ok(imports.every(r=>JSON.stringify(r).length<513_000));
  assert.equal(new Set(sync(1,{key}).entries.map(e=>e.requestId)).size,12);
});

test('two open views save their marks without overwriting each other', {timeout:30_000}, async t=>{
  const h=await harness(t);const second=await h.page.context().newPage();
  await Promise.all([h.page.goto(h.url()),second.goto(h.url())]);
  const key='breadboard:chat-highlights:two-views';
  await Promise.all([h.page,second].map((page,index)=>page.evaluate(({key,index})=>{
    window.shared=window.openStore(key);window.shared.subscribe(entries=>window.sharedEntries=entries);
    window.shared.update([...window.shared.getSnapshot(),{id:'view-'+index,quote:'View '+index}]);
  },{key,index})));
  await until(()=>sync(1,{key}).entries.length===2);
  await Promise.all([h.page,second].map(page=>page.evaluate(()=>window.dispatchEvent(new Event('online')))));
  await Promise.all([h.page,second].map(page=>page.waitForFunction(()=>window.sharedEntries.length===2)));
});

test('the native Garden chat saves actual highlight actions across chat switches and new launches', {timeout:30_000}, async t=>{
  const h=await harness(t);const {page}=h;
  await page.goto(h.url('/garden'));
  await page.getByRole('button',{name:'Mark',exact:true}).click();
  const key='breadboard:garden-chat-highlights:501';
  await until(()=>sync(1,{key}).entries.length===1);
  assert.equal(sync(1,{key}).entries[0].color,'pink');
  await page.getByRole('button',{name:'Note',exact:true}).click();
  await until(()=>sync(1,{key}).entries[0]?.note==='Remember this connection');
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('output').textContent.includes('Learning'));
  assert.match(await page.locator('output').textContent(),/Remember this connection/);
  await page.evaluate(()=>window.changeGardenChat(502));
  await page.waitForFunction(()=>document.querySelector('output').textContent==='[]');
  await page.evaluate(()=>window.changeGardenChat(501));
  await page.waitForFunction(()=>document.querySelector('output').textContent.includes('Learning'));
  await page.goto('about:blank');await h.restart();await page.goto(h.url('/garden'));
  await page.waitForFunction(()=>document.querySelector('output').textContent.includes('Learning'));
  await page.getByRole('button',{name:'Erase',exact:true}).click();
  await until(()=>sync(1,{key}).entries.length===0);
  await page.reload();assert.equal(await page.locator('output').textContent(),'[]');
});

test('existing annotations in unopened chats, PDFs and garden pages are migrated automatically', {timeout:30_000}, async t=>{
  const h=await harness(t);const {page}=h;
  await page.addInitScript(prefixes=>{
    for(const prefix of prefixes) localStorage.setItem(prefix+'unopened',JSON.stringify(
      [prefix.includes('deleted-inline')?'deleted-old':{id:'legacy-'+prefix,quote:'An existing highlighted passage'}],
    ));
  },types.TEXT_HIGHLIGHT_PREFIXES);
  await page.goto(h.url());
  await until(()=>types.TEXT_HIGHLIGHT_PREFIXES.every(prefix=>sync(1,{key:prefix+'unopened'}).entries.length===1));
});

test('installed Quartz builds the same persistence client without development repository imports', async()=>{
  const {stageQuartzHighlightAssets}=await import('../../desktop/scripts/quartz-highlight-assets.mjs');
  const target=path.join(root,'quartz-template');
  const scripts=path.join(target,'quartz','components','scripts');fs.mkdirSync(scripts,{recursive:true});
  for(const name of ['highlighter.inline.ts','highlightPalette.ts','generatedVisualHost.ts']) {
    fs.copyFileSync(new URL('../../quartz/quartz/components/scripts/'+name,import.meta.url),path.join(scripts,name));
  }
  stageQuartzHighlightAssets(fileURLToPath(new URL('../../',import.meta.url)),target);
  const bundled=await build({entryPoints:[path.join(scripts,'highlighter.inline.ts')],bundle:true,write:false,platform:'browser',format:'iife'});
  assert.ok(bundled.outputFiles[0].text.includes('/api/text-highlights'));
  assert.equal(fs.readFileSync(path.join(scripts,'text-highlight-client.ts'),'utf8'),fs.readFileSync(new URL('../src/lib/text-highlight-client.ts',import.meta.url),'utf8'));
});
