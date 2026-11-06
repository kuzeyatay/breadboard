import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import esbuild from 'esbuild';
import {chromium, expect} from '@playwright/test';

async function fixture(t) {
  const root = path.resolve(import.meta.dirname, '..');
  const bundle = await esbuild.build({
    stdin: {resolveDir: root, loader: 'tsx', contents: `
      import React,{StrictMode,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import NewTabGreeting from './src/app/new-tab/new-tab-greeting';
      import {useGreetingTypewriter} from './src/app/components/use-greeting-typewriter';
      import controls from './src/app/new-tab/new-tab-controls.module.css';
      import home from './src/app/new-tab/combined-home.module.css';
      const legacy = new URLSearchParams(location.search).has('legacy');
      function App() {
        const [name,setName] = useState(legacy ? '' : 'tiny titan');
        const [tone,setTone] = useState('dark');
        window.setName = setName;
        window.setTone = setTone;
        const typed = useGreetingTypewriter(legacy ? name : '');
        return <main className={home.surface+' '+controls.surface+' browser-home-widget-surface'}
          data-wallpaper-tone={tone} data-wallpaper-ready="true" style={{background:tone==='dark'?'#101b17':'#e4eee4'}}>
          <header className={home.heading+' '+controls.heading}>
            {legacy ? <h1 data-animating={typed.animating}><span data-legacy>{typed.displayed || '\\u00a0'}</span></h1> : <NewTabGreeting addressee={name}/>}
          </header>
        </main>;
      }
      createRoot(document.getElementById('root')).render(<StrictMode><App/></StrictMode>);
    `},
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', outfile: 'greeting.js',
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
  const globals = fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8').replace(/^@import[^;]+;/gm,'');
  const server = http.createServer((req,res) => {
    if(req.url === '/greeting.js') {res.setHeader('Content-Type','text/javascript');return res.end(js)}
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><html data-theme="dark"><style>${globals}\n${css}
      html{--font-schibsted:Arial;--font-source-sans:Arial}body{margin:0}main{padding:160px 24px;min-height:100vh}
      .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    </style><div id="root"></div><script src="/greeting.js"></script></html>`);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => {server.closeAllConnections();server.close()});
  const browser = await chromium.launch({headless:true,channel:'msedge'});
  t.after(() => browser.close());
  return {browser, base:`http://127.0.0.1:${server.address().port}`};
}

async function record(page) {
  await page.evaluate(() => {
    window.samples = [];
    const heading = document.querySelector('h1');
    window.greetingText = () => heading.querySelector('[class*="greetingText"], [data-legacy]').textContent.replaceAll('\u00a0','');
    const sample = () => window.samples.push({text:window.greetingText(),height:heading.getBoundingClientRect().height});
    window.greetingObserver?.disconnect();
    window.greetingObserver = new MutationObserver(sample);
    window.greetingObserver.observe(heading,{childList:true,subtree:true,characterData:true,attributes:true});
    sample();
  });
}
const text = page => page.evaluate(() => window.greetingText());
async function finished(page, value) {
  await expect.poll(() => text(page)).toBe(value);
  await expect(page.locator('h1')).toHaveAttribute('data-animating','false');
}
async function assertRetyped(page) {
  const samples = await page.evaluate(() => window.samples);
  assert(samples.some((sample,i) => i && sample.text.length < samples[i-1].text.length),'visible characters are deleted');
  assert(samples.some((sample,i) => i && sample.text.length > samples[i-1].text.length),'replacement characters are typed');
  assert(samples.some(sample => sample.text === ''),'the old line is fully erased');
  assert(Math.max(...samples.map(sample=>sample.height))-Math.min(...samples.map(sample=>sample.height)) < 1,'heading height stays stable');
}

test('Terminal waits for reveal before erasing and typing, and keeps the nickname green',{timeout:45_000},async t => {
  const {browser,base} = await fixture(t);
  const page = await browser.newPage({viewport:{width:1200,height:600},reducedMotion:'no-preference'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(() => {
    const listeners = new Set();
    window.tabState = {enabled:true,selfId:2,activeId:1,presentedId:1,visibleId:1,presentationStatus:'presented',preparingNewTab:true,tabs:[],extensions:[]};
    window.breadboardDesktop = {getTabsState:async()=>window.tabState,onTabsState:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},tabs:async()=>true};
    window.nativeState = patch => {window.tabState={...window.tabState,...patch};for(const listener of listeners)listener(window.tabState)};
    let visible=true;
    Object.defineProperty(document,'visibilityState',{get:()=>visible?'visible':'hidden'});
    window.documentVisible = value => {visible=value;document.dispatchEvent(new Event('visibilitychange'))};
  });
  await page.goto(base);
  await expect(page.getByRole('heading')).toHaveAccessibleName('Where to, tiny titan?');
  await record(page);
  // A warm spare can exist for minutes; it must retain the full initial text.
  await page.waitForTimeout(2400);
  await finished(page,'Where to, tiny titan?');
  assert.equal((await page.evaluate(()=>window.samples)).length,1);
  await page.evaluate(()=>window.nativeState({preparingNewTab:false,activeId:2,visibleId:2,presentationStatus:'pending'}));
  await page.waitForTimeout(350);
  await finished(page,'Where to, tiny titan?');
  await page.evaluate(()=>window.nativeState({presentedId:2,presentationStatus:'presented'}));
  await expect(page.locator('h1')).toHaveAttribute('data-animating','true');
  await finished(page,'Where to, tiny titan?');
  await assertRetyped(page);

  // Ordinary shell updates and revisiting a finished greeting must not replay it.
  await record(page);
  await page.evaluate(()=>window.nativeState({activeId:1,presentedId:1,visibleId:1}));
  await page.evaluate(()=>window.nativeState({activeId:2,presentedId:2,visibleId:2,windowFocused:false}));
  await page.waitForTimeout(350);
  await finished(page,'Where to, tiny titan?');
  assert.equal((await page.evaluate(()=>window.samples)).length,1);

  // A background tab cannot consume a pending nickname change.
  await page.evaluate(()=>window.documentVisible(false));
  await page.evaluate(()=>window.setName('canal captain'));
  await page.waitForTimeout(350);
  assert.equal(await text(page),'Where to, tiny titan?');
  await record(page);
  await page.evaluate(()=>window.documentVisible(true));
  await expect(page.locator('h1')).toHaveAttribute('data-animating','true');
  await finished(page,'Where to, canal captain?');
  await assertRetyped(page);

  const nickname=page.locator('[class*="addressee"]');
  for(const theme of ['light','dark']) for(const tone of ['light','dark']) {
    await page.evaluate(({theme,tone})=>{document.documentElement.dataset.theme=theme;window.setTone(tone)},{theme,tone});
    await expect.poll(()=>nickname.evaluate(el=>getComputedStyle(el).color)).toBe(tone==='dark'?'rgb(154, 198, 172)':'rgb(106, 141, 117)');
    assert.notEqual(await nickname.evaluate(el=>getComputedStyle(el).color),await page.locator('h1').evaluate(el=>getComputedStyle(el).color));
    if(process.env.GREETING_QA_DIR && theme==='dark') {
      fs.mkdirSync(process.env.GREETING_QA_DIR,{recursive:true});
      await page.screenshot({path:path.join(process.env.GREETING_QA_DIR,`greeting-${tone}.png`)});
    }
  }
  assert.deepEqual(errors,[]);
});

test('visible browser greetings animate on first render and honor reduced motion',{timeout:30_000},async t => {
  const {browser,base} = await fixture(t);
  const page = await browser.newPage({reducedMotion:'no-preference'});
  await page.goto(base);
  await record(page);
  await expect(page.locator('h1')).toHaveAttribute('data-animating','true');
  await finished(page,'Where to, tiny titan?');
  await assertRetyped(page);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.reload();await record(page);
  await finished(page,'Where to, tiny titan?');
  await page.evaluate(()=>window.setName('stargazer'));
  await finished(page,'Where to, stargazer?');
  await page.waitForTimeout(250);
  assert((await page.evaluate(()=>window.samples)).every(sample=>['Where to, tiny titan?','Where to, stargazer?'].includes(sample.text)));

  // The shared hook's async-browser behavior remains immediate typing from empty.
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto(base+'/?legacy');await record(page);
  assert.equal(await text(page),'');
  await page.evaluate(()=>window.setName('Hello, world'));
  await expect.poll(()=>text(page)).toMatch(/^H/);
  await finished(page,'Hello, world');
  await record(page);
  await page.evaluate(()=>window.setName('Welcome back'));
  await expect(page.locator('h1')).toHaveAttribute('data-animating','true');
  await finished(page,'Welcome back');
  await assertRetyped(page);
});
