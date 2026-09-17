import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import esbuild from 'esbuild';
import ts from 'typescript';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const weather = '```weather-results\n' + JSON.stringify({ location: 'Eindhoven', country: 'Netherlands', days: [
  { date: '2026-09-07', temperatureC: 20, minC: 15, maxC: 22, code: 0, condition: 'Clear', isDay: true },
] }) + '\n```';
const images = '```image-results\n' + JSON.stringify({ query: 'Bread', items: [
  { title: 'Fresh bread', image: 'https://example.com/bread.png', thumb: 'https://example.com/bread.png', page: 'https://example.com/bread', site: 'example.com' },
] }) + '\n```';
const product = title => ({
  schemaVersion: 1, kind: 'product-search', renderer: 'product-carousel', id: 'products-1', title: 'Headphones', createdAt: '2026-09-07T10:00:00Z',
  actions: ['open-details', 'find-similar', 'compare', 'visit'], data: { query: 'Headphones', sources: [
    { id: 'shop', title: 'Audio shop', url: 'https://example.com/headphones', site: 'example.com', accessedAt: '2026-09-07T10:00:00Z' },
  ], products: [
    { id: 'headphones', title, merchant: 'Audio shop', url: 'https://example.com/headphones', sourceIds: ['shop'], description: 'Comfortable studio headphones.' },
  ] },
});
const garden = {
  schemaVersion: 1, kind: 'garden-search', renderer: 'garden-navigator', id: 'gardens-1', title: 'Your gardens', createdAt: '2026-09-07T10:00:00Z', actions: ['open-garden', 'open-page'],
  data: { query: 'Fitness', gardens: [{ slug: 'fitness', name: 'Fitness', results: [{ pageSlug: 'workouts', title: 'Workouts' }] }] },
};

// Execute the actual response JSX and tool-event branches from both large panels.
// Keep unrelated page providers/services outside this focused browser fixture.
function surface(file) {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const cards = {};
  let eventBody;
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node)) cards[node.tagName.getText(source)] = node.getText(source);
    if (ts.isIfStatement(node) && node.expression.getText(source).includes('event.type') &&
        node.thenStatement.getText(source).includes('normalizeGenerativeUiResources(event.uiResources)')) eventBody = node.thenStatement.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(eventBody, `${file} must consume widget tool events`);
  return { cards, eventBody };
}

test('Quartz and Workspace preserve streamed widgets, controls, and restored resource-only answers', { timeout: 60000 }, async () => {
  await import('../scripts/build-assistant-widgets.mjs');
  const quartz = surface('src/app/garden/garden-assistant.tsx');
  const workspace = surface('src/app/gardens/[clusterSlug]/workspace-client.tsx');
  assert.ok(quartz.cards.AssistantRichResponse);
  assert.ok(workspace.cards.GenerativeUiRenderer);
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useState} from 'react';import{createRoot}from'react-dom/client';
      import AssistantRichResponse from './src/app/components/assistant-rich-response';
      import GenerativeUiRenderer from './src/app/components/hermes/generative-ui-renderer';
      import {SelectableAssistantMarkdown} from './src/app/components/chat-text-selection-ui';
      import {normalizeGenerativeUiResources} from './src/lib/generative-ui/contracts';
      import {uiResourcesForUserRequest} from './src/lib/generative-ui/request-policy';
      import {createAssistantWidgetHost} from '../quartz/quartz/components/scripts/assistantWidgets';
      import '../quartz/quartz/components/scripts/breadboardAI.inline';
      window.sent=[];
      const mode=new URLSearchParams(location.search).get('surface');
      if(mode==='panel') {
        const dashboard=new URLSearchParams(location.search).get('dashboard');
        const element=document.getElementById('root');
        element.className='breadboard-ai';element.dataset.dashboard=dashboard;element.dataset.garden='fitness';element.dataset.page='workouts';
        element.innerHTML='<button class="breadboard-ai-toggle">Assistant</button><section class="breadboard-ai-panel"><div class="breadboard-ai-messages"></div><form class="breadboard-ai-composer"><textarea class="breadboard-ai-input"></textarea><button class="breadboard-ai-send">Send</button><button type="button" class="breadboard-ai-stop">Stop</button></form><div class="breadboard-ai-error" hidden></div></section>';
        const restored=${JSON.stringify([null, product('Studio headphones'), garden])};
        const nativeFetch=window.fetch;
        window.fetch=async(url,options)=>{
          if(String(url).includes('/api/quartz-ai/sessions'))return Response.json({sessions:[{id:1,title:'Widgets',active:false,messages:[{role:'assistant',content:'',uiResources:restored}]}]});
          if(String(url).includes('/api/quartz-ai/chat'))return Response.json({sessionId:1,accepted:true});
          if(String(url).includes('/api/quartz-ai/events'))return new Response([
            {type:'tool.completed',payload:{uiResources:[${JSON.stringify(product('Old headphones'))}]}},
            {type:'tool.completed',payload:{uiResources:restored}},
            {type:'assistant.delta',payload:{text:${JSON.stringify(weather)}}},{type:'done'},
          ].map(event=>'data: '+JSON.stringify(event)+'\\n\\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
          return nativeFetch(url,options);
        };
        sessionStorage.setItem('breadboard-ai:fitness:workouts',JSON.stringify({sessionId:1}));
        window.addCleanup=()=>{};
        document.dispatchEvent(new CustomEvent('nav'));
      } else if(mode==='standalone') {
        const element=document.getElementById('root');
        const host=createAssistantWidgetHost(location.origin,text=>window.sent.push(text));
        window.answer=(content,uiResources=[])=>host.render(element,{content,uiResources});
        window.dispose=()=>host.dispose();
      } else {
        function App(){
          const[message,setMessage]=useState(()=>JSON.parse(sessionStorage.getItem(mode)||'null')||{content:'',uiResources:[]});
          const[userRequest,setUserRequest]=useState(()=>sessionStorage.getItem(mode+'-request')||'Show the Garden search widget');
          const uiResources=uiResourcesForUserRequest(message.uiResources,userRequest);
          window.request=text=>{sessionStorage.setItem(mode+'-request',text);setUserRequest(text)};
          const msg=message,visibleAssistantContent=message.content,chatSessionId=1,i=0;
          const onSend=text=>window.sent.push(text),onGenerativeUiAction=action=>window.sent.push(action.type);
          const activeProductComparison=null,annotationsByMessage=new Map(),EMPTY_CHAT_ANNOTATIONS=[];
          const messageSelectionSourceId=()=>'',onTextSelection=()=>{},onOpenAnnotation=()=>{};
          window.answer=(content,uiResources=[])=>setMessage({content,uiResources});
          window.save=()=>sessionStorage.setItem(mode,JSON.stringify(message));
          window.tool=event=>{
            let assistantMessage=message,assistantMsg={...message},finalMessages;
            const sessionId=1,handleGardenSourceImportResult=()=>{};
            const updateAssistant=()=>setMessage({...assistantMessage});
            const messagesWithAssistant=()=>[{...assistantMsg}],updateChatMessages=(_id,m)=>setMessage(m[0]);
            if(mode==='quartz') ${quartz.eventBody} else ${workspace.eventBody}
          };
          return mode==='quartz'?${quartz.cards.AssistantRichResponse}:<>
            ${workspace.cards.SelectableAssistantMarkdown}${workspace.cards.GenerativeUiRenderer}
          </>;
        }createRoot(document.getElementById('root')).render(<App/>);
      }
    ` }, bundle: true, outfile: 'app.js', write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"development"' },
  });
  const serve = (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/assistant-widgets/')) {
      const file = path.join(root, 'public', pathname);
      if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.html') ? 'text/html' : 'application/octet-stream');
      res.end(fs.readFileSync(file)); return;
    }
    if (pathname === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html><head><link rel="stylesheet" href="/assistant-widgets/renderer.css"></head><body><main id="root"></main><script src="/app.js"></script></body></html>');
  };
  const server = http.createServer(serve);
  const widgetServer = http.createServer(serve);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => widgetServer.listen(0, '127.0.0.1', resolve));
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const artifacts = path.join(root, '.tmp-quartz-widgets-qa'); fs.mkdirSync(artifacts, { recursive: true });
  try {
    for (const mode of ['quartz', 'workspace', 'standalone']) {
      const page = await browser.newPage({ viewport: { width: 400, height: 700 }, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('https://example.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="tan"/></svg>' }));
      await page.goto(`http://127.0.0.1:${server.address().port}/?surface=${mode}`);
      await page.waitForFunction(() => typeof window.answer === 'function');
      const response = mode === 'standalone' ? page.frameLocator('iframe') : page;
      await page.evaluate(content => window.answer(content), weather.slice(0, 75));
      if (mode === 'standalone') await response.locator('#root').waitFor({ state: 'attached' });
      assert.doesNotMatch(await response.locator('body').innerText(), /temperatureC|country|```/);
      await page.evaluate(content => window.answer(content), weather);
      await response.locator('.chat-weather-card').waitFor();
      if (mode !== 'standalone') {
        await page.evaluate(resource => window.tool({ type: 'tool', status: 'completed', uiResources: [resource] }), product('Old headphones'));
        await response.getByRole('button', { name: 'Open details for Old headphones', exact: true }).waitFor({ timeout: 5000 }).catch(async error => {
          throw new Error(`${mode}: ${error.message}\n${await response.locator('body').innerText()}\n${errors.join('\n')}`);
        });
        await page.evaluate(resource => window.tool({ type: 'tool', status: 'completed', uiResources: [resource] }), product('Studio headphones'));
        await response.getByRole('button', { name: 'Open details for Studio headphones', exact: true }).waitFor();
        await page.evaluate(resource => window.tool({ type: 'tool', status: 'completed', uiResources: [resource] }), garden);
        assert.equal(await response.locator('[data-generative-ui="product-carousel"]').count(), 1);
        assert.doesNotMatch(await response.locator('body').innerText(), /Old headphones/);
      } else await page.evaluate(resources => window.answer('', resources), [product('Studio headphones'), garden]);
      await response.locator('[data-generative-ui="product-carousel"]').waitFor();
      await response.locator('[data-generative-ui="garden-navigator"]').waitFor();
      if (mode !== 'workspace') {
        await response.getByRole('button', { name: 'Open details for Studio headphones', exact: true }).click();
        await response.getByText('Comfortable studio headphones.', { exact: true }).waitFor();
        await response.getByRole('button', { name: 'Similar', exact: true }).first().click();
        await page.waitForFunction(() => window.sent.length > 0);
        assert.equal(await page.evaluate(() => window.sent.at(-1)), 'Find products similar to Studio headphones from Audio shop.');
      }
      if (mode !== 'standalone') {
        await page.evaluate(resources => { window.answer('', resources); }, [product('Studio headphones'), garden]);
        await response.locator('.chat-weather-card').waitFor({ state: 'detached' });
        await page.evaluate(() => window.save());
        await page.reload();
        await response.locator('[data-generative-ui="product-carousel"]').waitFor();
        await response.locator('[data-generative-ui="garden-navigator"]').waitFor();
      }
      await page.screenshot({ path: path.join(artifacts, `${mode}-resources.png`) });
      if (mode === 'quartz') {
        await page.evaluate(() => window.request('based on our conversations here on this topc, can ytou write this markdowns introduction again?'));
        await response.locator('[data-generative-ui="garden-navigator"]').waitFor({ state: 'detached' });
        await response.locator('[data-generative-ui="product-carousel"]').waitFor();
        await page.evaluate(resource => window.tool({ type: 'tool', status: 'completed', uiResources: [resource] }), garden);
        assert.equal(await response.locator('[data-generative-ui="garden-navigator"]').count(), 0);
        await page.evaluate(() => window.save());
        await page.reload();
        await response.locator('[data-generative-ui="product-carousel"]').waitFor();
        assert.equal(await response.locator('[data-generative-ui="garden-navigator"]').count(), 0);
        await page.evaluate(() => window.request('Show the Garden search widget'));
        await response.locator('[data-generative-ui="garden-navigator"]').waitFor();
      }
      await page.evaluate(content => window.answer(content), images);
      await response.locator('.chat-image-results button').first().click();
      await response.getByRole('dialog', { name: 'Fresh bread', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      await response.getByRole('dialog', { name: 'Fresh bread', exact: true }).waitFor({ state: 'detached' });
      assert.equal(await response.locator('body').evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(artifacts, `${mode}-image.png`) });
      assert.deepEqual(errors, []);
      await page.close();
    }
    // The published Quartz panel runs on a different origin. Exercise its real
    // history restoration, SSE handler, and origin-checked iframe handshake.
    const page = await browser.newPage({ viewport: { width: 400, height: 700 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?surface=panel&dashboard=${encodeURIComponent(`http://127.0.0.1:${widgetServer.address().port}`)}`);
    const answer = () => page.locator('.breadboard-ai-assistant').last().frameLocator('iframe');
    await answer().locator('[data-generative-ui="product-carousel"]').waitFor();
    await answer().locator('[data-generative-ui="garden-navigator"]').waitFor();
    await page.locator('.breadboard-ai-input').fill('Show me widgets');
    await page.locator('.breadboard-ai-send').click();
    await answer().locator('.chat-weather-card').waitFor();
    await answer().locator('[data-generative-ui="garden-navigator"]').waitFor();
    assert.equal(await answer().locator('[data-generative-ui="product-carousel"]').count(), 1);
    assert.doesNotMatch(await answer().locator('body').innerText(), /Old headphones/);
    await page.reload();
    await answer().locator('[data-generative-ui="product-carousel"]').waitFor();
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => widgetServer.close(resolve))]);
  }
});
