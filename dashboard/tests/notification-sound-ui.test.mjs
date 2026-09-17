import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { chromium } from 'playwright';

test('notification sounds follow rendered cards, page visibility, native visibility, and scrolling', { timeout: 60_000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await esbuild.build({
    stdin: { loader: 'tsx', resolveDir: root, contents: `
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {Toaster,useToast} from './src/app/components/toast';
      const overlay=location.pathname==='/overlay';
      let nativeVisible=false; const listeners=new Set();
      window.nativeVisible=value=>{nativeVisible=value;for(const fn of listeners)fn(value);};
      if(overlay)window.breadboardDesktop={onNotificationOverlayVisibility:fn=>{listeners.add(fn);fn(nativeVisible);return()=>listeners.delete(fn);}};
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
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'navigation', setup(build) {
      build.onResolve({ filter: /^(next\/navigation|\.\/navigation-progress)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useRouter=()=>({push(){}});export const startNavigationProgress=()=>{};' }));
    } }],
  });
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
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
