import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { chromium } from 'playwright';

test('inactive native tabs stop polling the inbox while the overlay keeps checking', { timeout: 30_000 }, async t => {
  const bundle = await esbuild.build({
    stdin: { loader: 'tsx', resolveDir: fileURLToPath(new URL('../', import.meta.url)), contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {useToast} from './src/app/components/toast';
      let state={selfId:'background',activeId:'foreground',windowFocused:true}; const listeners=new Set();
      window.breadboardDesktop={getTabsState:async()=>state,tabs:async()=>{},onTabsState:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}};
      window.activate=active=>{state={...state,activeId:active?'background':'foreground'};for(const fn of listeners)fn(state);window.dispatchEvent(new Event('focus'));};
      const overlay=location.pathname==='/overlay';
      Object.defineProperty(document,'visibilityState',{configurable:true,value:overlay?'hidden':'visible'});
      window.polls=0; window.fetch=async()=>{window.polls++;return Response.json({messages:[]});};
      function App(){useToast({desktopOverlay:overlay});return <div>Ready</div>;}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, outfile: 'fixture.js', format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'navigation', setup(build) {
      build.onResolve({ filter: /^(next\/navigation|\.\/navigation-progress)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useRouter=()=>({push(){}});export const startNavigationProgress=()=>{};' }));
    } }],
  });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.clock.install();
  await page.route('https://native-inbox.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.goto('https://native-inbox.test/tab');
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.getByText('Ready', { exact: true }).waitFor();
  const before = await page.evaluate(() => window.polls);
  await page.clock.runFor(20_001);
  assert.equal(await page.evaluate(() => window.polls), before, 'parked but visible native tabs do not queue inbox reads');
  await page.evaluate(() => window.activate(true));
  await page.waitForFunction(before => window.polls > before, before);
  const active = await page.evaluate(() => window.polls);
  await page.clock.runFor(4_001);
  assert.ok(await page.evaluate(() => window.polls) > active, 'the active tab refreshes normally');
  await page.evaluate(() => window.activate(false));
  const parked = await page.evaluate(() => window.polls);
  await page.clock.runFor(20_001);
  assert.equal(await page.evaluate(() => window.polls), parked);
  await page.goto('https://native-inbox.test/overlay');
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.getByText('Ready', { exact: true }).waitFor();
  const overlay = await page.evaluate(() => window.polls);
  await page.clock.runFor(4_001);
  assert.ok(await page.evaluate(() => window.polls) > overlay, 'the hidden native overlay still receives notifications');
});

test('notification sounds follow rendered cards, page visibility, native visibility, and scrolling', { timeout: 60_000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await esbuild.build({
    stdin: { loader: 'tsx', resolveDir: root, contents: `
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {Toaster,useToast} from './src/app/components/toast';
      const overlay=location.pathname==='/overlay';
      let nativeVisible=false; const listeners=new Set();
      window.nativeVisible=value=>{nativeVisible=value;for(const fn of listeners)fn(value);};
      // A real overlay only chimes for cards inside uncovered native regions, so the stub must be a complete tabs bridge.
      if(overlay)window.breadboardDesktop={onNotificationOverlayVisibility:fn=>{listeners.add(fn);fn(nativeVisible);return()=>listeners.delete(fn);},
        getTabsState:async()=>({enabled:true,tabs:[],extensions:[],notificationVisibleRects:[{x:0,y:0,width:4000,height:4000}]}),onTabsState:()=>()=>{},tabs:async()=>true};
      let now=10000; Date.now=()=>now;
      window.notes=0;
      window.AudioContext=class {
        state='running';currentTime=0;destination={};
        async resume(){}async close(){this.state='closed';}
        createOscillator(){return {frequency:{setValueAtTime(){}},connect:node=>node,start(){window.notes++;},stop(){}};}
        createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}
      };
      function App(){
        const [mounted,setMounted]=useState(false);
        const {toasts,addToast,dismissToast}=useToast({desktopOverlay:overlay});
        window.mount=setMounted;
        window.add=(id,permission=false)=>{now+=2000;addToast(id,'success',undefined,undefined,undefined,undefined,permission?{id,origin:'https://example.com'}:undefined,id);};
        return mounted?<Toaster toasts={toasts} onDismiss={dismissToast} mode={overlay?'desktop-overlay':'page'}/>:null;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, outfile: 'fixture.js', format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'navigation', setup(build) {
      build.onResolve({ filter: /^(next\/navigation|\.\/navigation-progress)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useRouter=()=>({push(){}});export const startNavigationProgress=()=>{};' }));
    } }],
  });
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles.find(file => file.path.endsWith('.js')).text); }
    else if (req.url.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); res.end('{"messages":[]}'); }
    else { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><style>
      .bb-page-toast-host,.bb-desktop-toast-host{position:fixed;right:16px;bottom:16px;display:flex;flex-direction:column;width:320px;max-height:80px;overflow:auto}
      .bb-page-toast-host>div,.bb-desktop-toast-host>div{height:80px;flex-shrink:0;background:white}
      body.hidden [aria-live]{display:none}
    </style><div id="root"></div><script src="/app.js"></script>`); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const errors = [];
  const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50)))));
  for (const scenario of ['unmounted', 'css-hidden', 'background', 'native-hidden', 'clipped']) {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/${scenario === 'native-hidden' ? 'overlay' : 'web'}`);
    await page.waitForFunction(() => window.add);
    await page.evaluate(scenario => {
      if (scenario !== 'unmounted') window.mount(true);
      if (scenario === 'css-hidden') document.body.classList.add('hidden');
      if (scenario === 'background') Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      window.add('first');
    }, scenario);
    await settle(page);
    if (scenario === 'clipped') {
      await page.waitForFunction(() => window.notes === 2);
      await page.evaluate(() => window.add('second'));
      await settle(page);
      assert.equal(await page.evaluate(() => window.notes), 2, 'a card clipped out of the stack stays silent');
      await page.evaluate(() => document.querySelector('[aria-live]').scrollTop = 1000);
      await page.waitForFunction(() => window.notes === 4);
    } else {
      assert.equal(await page.evaluate(() => window.notes), 0, `${scenario} cannot chime`);
      await page.evaluate(scenario => {
        if (scenario === 'unmounted') window.mount(true);
        if (scenario === 'css-hidden') document.body.classList.remove('hidden');
        if (scenario === 'background') { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); }
        if (scenario === 'native-hidden') window.nativeVisible(true);
      }, scenario);
      await page.waitForFunction(() => window.notes === 2);
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
});
