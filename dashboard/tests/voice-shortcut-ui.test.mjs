import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';

test('Talk context menu opens full voice tabs and compact windows without dismissing before selection', { timeout: 60000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useRef} from 'react';import{createRoot}from'react-dom/client';
      import Speech from './src/app/components/speech-dictation-button';
      import VoicePage from './src/app/voice/page';
      window.commands=[];window.themes=[];window.inlineOpens=0;window.nativeCloses=0;window.failOpen=false;
      const listeners=new Set();window.tabState={enabled:true,tabs:[],selfId:2,activeId:location.search.includes('background')?1:2};
      window.emitTabs=patch=>{Object.assign(window.tabState,patch);for(const cb of listeners)cb({...window.tabState});};
      if(location.search.includes('desktop'))window.breadboardDesktop={
        tabs:async command=>{window.commands.push(command);return !window.failOpen;},
        setTheme:async theme=>{window.themes.push(theme);return true;},
        getTabsState:async()=>window.tabState,onTabsState:cb=>{listeners.add(cb);return()=>listeners.delete(cb);}
      };
      if(location.search.includes('native'))window.voiceCompanion={
        state:async()=>true,onOpen:()=>()=>{},close:async()=>{window.nativeCloses++;}
      };
      navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Microphone permission denied','NotAllowedError');};
      function Menu(){const textarea=useRef(null);return <div style={{padding:'80px 360px'}}>
        <textarea ref={textarea} aria-label="Message"/><Speech value="" onChange={()=>{}} textareaRef={textarea}
          placement="below" onOpenVoiceMode={()=>window.inlineOpens++}/>
      </div>;}
      createRoot(document.getElementById('root')).render(location.pathname==='/voice'?<VoicePage/>:<Menu/>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'voice-menu-services', setup(build) {
      const stubs = {
        'music-recognition-button': 'export default function(){return null}',
        'voice-assistant-runtime': 'export default function(){return null}',
        'use-agent-session': `const session={sessionId:'voice-test',messages:[],loadingSession:false,runState:'idle',send(){}};
          export const useAgentSession=()=>session;export const isActiveAgentRunState=()=>false;`,
        'use-assistant-intelligence': 'export const useAssistantIntelligence=()=>({})',
        'chat-notification-inbox': 'export function setActiveChatNotificationTarget(){}',
        'prepare-client': 'export async function prepareLocalSpeech(){}export const speechErrorMessage=(e,f)=>e?.message||f;',
        'subscription-live': 'export const subscriptionSelected=async()=>true;export async function connectSubscriptionVoice(){}',
        'voice-response': 'export default function(){return null}',
      };
      build.onResolve({ filter: /.*/ }, args => {
        const key = args.path.split('/').at(-1);
        return key in stubs ? { path: key, namespace: 'fixture' } : null;
      });
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  const styles = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8')
    .replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";', '@source "./components/speech-dictation-button.tsx"; @source "./components/link-context-menu.tsx"; @source "./components/voice-conversation-overlay.tsx";');
  const css = (await postcss([tailwind({ base: root })]).process(styles, { from: path.join(root, 'src/app/globals.css') })).css;
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
    else if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html data-theme="light"><head><link rel="stylesheet" href="/style.css"></head><body><main id="root"></main><script src="/app.js"></script></body></html>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1100, height: 750 }, reducedMotion: 'reduce' });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const page = await context.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const artifacts = path.join(root, '.tmp-voice-context-menu-qa');
  fs.mkdirSync(artifacts, { recursive: true });
  async function openMenu(suffix = '') {
    await page.goto(origin + '/' + suffix);
    await page.getByRole('button', { name: 'Voice options — double-tap to talk to the assistant' }).click();
    await page.getByRole('menuitem', { name: 'Talk to the assistant', exact: false }).click({ button: 'right' });
    await page.getByRole('menu', { name: 'Talk to the assistant', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.inlineOpens), 0);
  }
  await openMenu('?desktop');
  await page.screenshot({ path: path.join(artifacts, 'context-menu.png') });
  await page.getByRole('menuitem', { name: 'Open in new tab', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.commands), [{ type: 'open', url: origin + '/voice?view=full', background: true }]);
  assert.equal(await page.getByRole('menu', { name: 'Voice options', exact: true }).count(), 0);
  await openMenu('?desktop');
  await page.getByRole('menuitem', { name: 'Open in new window', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.commands), [{ type: 'voice-open' }]);
  await openMenu('?desktop');
  await page.evaluate(() => window.failOpen = true);
  await page.getByRole('menuitem', { name: 'Open in new window', exact: true }).click();
  await page.getByText('Voice could not open. Restart Breadboard and try again.', { exact: true }).waitFor();

  await openMenu();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('menu', { name: 'Talk to the assistant', exact: true }).count(), 0);
  await page.getByRole('menuitem', { name: 'Talk to the assistant', exact: false }).click();
  assert.equal(await page.evaluate(() => window.inlineOpens), 1);
  await openMenu();
  const fullTabPromise = page.waitForEvent('popup');
  await page.getByRole('menuitem', { name: 'Open in new tab', exact: true }).click();
  const fullTab = await fullTabPromise;
  await fullTab.locator('.voice-stage[data-stage="blocked"]').waitFor();
  assert.equal(new URL(fullTab.url()).search, '?view=full');
  assert.equal(await fullTab.locator('.voice-stage-compact').count(), 0);
  assert.equal(await fullTab.locator('.voice-companion-drag').count(), 0);
  assert.equal(await fullTab.locator('html[data-voice-widget]').count(), 0);
  assert.equal(await fullTab.locator('.voice-stage').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(193, 84, 60)');
  await fullTab.screenshot({ path: path.join(artifacts, 'full-tab.png') });
  await Promise.all([
    fullTab.waitForEvent('close'),
    fullTab.getByRole('button', { name: 'Close voice mode', exact: true }).click(),
  ]);

  await openMenu();
  const compactWindowPromise = page.waitForEvent('popup');
  await page.getByRole('menuitem', { name: 'Open in new window', exact: true }).click();
  const compactWindow = await compactWindowPromise;
  await compactWindow.locator('.voice-stage-compact[data-stage="blocked"]').waitFor();
  assert.equal(new URL(compactWindow.url()).pathname, '/voice');
  assert.equal(new URL(compactWindow.url()).search, '');
  assert.equal(await compactWindow.locator('html[data-voice-widget="true"]').count(), 1);
  assert.equal(await compactWindow.locator('.voice-companion-drag').count(), 1);
  await compactWindow.screenshot({ path: path.join(artifacts, 'compact-window.png') });
  await compactWindow.close();

  await page.goto(origin + '/voice?view=full&desktop&background');
  await page.locator('.voice-stage[data-stage="blocked"]').waitFor();
  assert.deepEqual(await page.evaluate(() => window.themes), []);
  await page.evaluate(() => window.emitTabs({ activeId: 2 }));
  assert.deepEqual(await page.evaluate(() => window.themes), ['voice']);
  await page.evaluate(() => window.emitTabs({ activeId: 1 }));
  assert.equal(await page.locator('.voice-stage').count(), 1);
  assert.deepEqual(await page.evaluate(() => window.themes), ['voice', 'light']);
  assert.equal(await page.evaluate(() => window.commands.some(command => command.type === 'close')), false);
  await page.evaluate(() => window.emitTabs({ activeId: 2 }));
  assert.deepEqual(await page.evaluate(() => window.themes), ['voice', 'light', 'voice']);
  await page.getByRole('button', { name: 'Close voice mode', exact: true }).click();
  assert.equal(await page.evaluate(() => window.commands.filter(command => command.type === 'close').length), 1);
  assert.deepEqual(await page.evaluate(() => window.themes), ['voice', 'light', 'voice', 'light']);
  await page.goto(origin + '/voice?native');
  await page.locator('.voice-stage-compact[data-stage="blocked"]').waitFor();
  await page.getByRole('button', { name: 'Close voice mode', exact: true }).click();
  assert.equal(await page.evaluate(() => window.nativeCloses), 1);
  assert.deepEqual(errors, []);
});

test('Voice opens from its optional navbar seat and searchable new-tab entry, with retry on native failure', {timeout:30000}, async () => {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const bundle=await esbuild.build({stdin:{resolveDir:root,loader:'tsx',contents:`
    import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import NavBar from './src/app/components/navbar';import NewTab from './src/app/new-tab/new-tab-client';
    import{DEFAULT_NAVBAR_SHORTCUTS}from'./src/lib/profile/navbar-shortcuts';
    window.commands=[];window.failOpen=false;
    window.breadboardDesktop={tabs:async command=>{window.commands.push(command);return !window.failOpen;},getTabsState:async()=>({enabled:true,tabs:[]}),onTabsState:()=>()=>{}};
    function App(){const[shortcuts,setShortcuts]=useState({...DEFAULT_NAVBAR_SHORTCUTS,workTimer:false,browser:false,clicky:false,plan:false});window.showVoice=enabled=>setShortcuts(s=>({...s,voice:enabled}));
      return <><NavBar email="you@example.com" username="You" showFlowers={false} shortcuts={shortcuts}/><NewTab gardens={[]} addressee="friend"/></>;}
    createRoot(document.getElementById('root')).render(<App/>);
  `},bundle:true,write:false,outfile:'voice-shortcut-fixture.js',platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture',setup(build){
    const modules={
      'next/link':`import React from'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
      'navbar-flower-wind':'export default function(){return null}',
      'work-timer-shortcut':'export default function(){return null}',
      'browser-shortcut':'export default function(){return null}',
      'clicky-shortcut':'export default function(){return null}',
      'link-context-menu':'export default function({children}){return children}',
      'browser-home-accessories':'export default function(){return null}',
      'browser-home-widgets':'export function BrowserSketchOutline(){return null}',
      'page-appearance':'export default function(){return null}',
      'use-page-appearance':'export function usePageAppearance(){return {}}',
      'use-desktop-tabs':'export function useDesktopTabs(){return {enabled:true}}',
      'use-new-tab-addressee':'export const useNewTabAddressee=name=>name',
      'new-tab-greeting':`import React from'react';export default function({addressee}){return <h1>Hello, {addressee}.</h1>}`,
      'new-tab-notepad':'export default function(){return null}',
      'navigation-progress':'export function startNavigationProgress(){}export function cancelNavigationProgress(){}',
    };
    build.onResolve({filter:/.*/},args=>{const key=args.path==='next/link'?args.path:args.path.split('/').at(-1);return key in modules?{path:key,namespace:'fixture'}:null;});
    build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:modules[args.path],loader:'tsx',resolveDir:root}));
  }}]});
  const styles=fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8').replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";', '@source "./components/navbar.tsx"; @source "./components/voice-shortcut.tsx";');
  const css=(await postcss([tailwind({base:root})]).process(styles,{from:path.join(root,'src/app/globals.css')})).css+'\n'+(bundle.outputFiles.find(file=>file.path.endsWith('.css'))?.text??'');
  const server=http.createServer((req,res)=>{
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles.find(file=>file.path.endsWith('.js')).text);return;}
    if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
    if(req.url==='/logo.png'){res.setHeader('Content-Type','image/png');res.end(fs.readFileSync(path.join(root,'public/logo.png')));return;}
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><html data-theme="light"><head><link rel="stylesheet" href="/style.css"></head><body style="margin:0;background:var(--paper-bg)"><main id="root" style="height:100vh;display:flex;flex-direction:column"></main><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(fs.existsSync);
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  try {
    const page=await browser.newPage({viewport:{width:1100,height:750}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const navbar=page.locator('.breadboard-flower-navbar'),places=page.getByRole('navigation',{name:'Places'});
    assert.equal(await navbar.getByRole('button',{name:'Voice',exact:true}).count(),0);
    await places.getByRole('button',{name:'Voice',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.commands),[{type:'voice-open'}]);
    await page.evaluate(()=>window.showVoice(true));await navbar.getByRole('button',{name:'Voice',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.commands.length),2);
    fs.mkdirSync(path.join(root,'.tmp-voice-assistant-qa'),{recursive:true});
    await page.screenshot({path:path.join(root,'.tmp-voice-assistant-qa','voice-new-tab.png')});
    await page.getByRole('searchbox').fill('voice');assert.equal(await places.getByRole('button',{name:'Voice',exact:true}).count(),1);assert.equal(await places.getByRole('link').count(),0);
    await page.evaluate(()=>window.failOpen=true);await places.getByRole('button',{name:'Voice',exact:true}).click();await places.getByRole('alert').waitFor();
    await page.evaluate(()=>window.failOpen=false);await places.getByRole('button',{name:'Voice',exact:true}).click();assert.equal(await places.getByRole('alert').count(),0);
    await page.getByRole('searchbox').fill('calendar');assert.equal(await places.getByRole('button',{name:'Voice',exact:true}).count(),0);
    await page.evaluate(()=>window.showVoice(false));assert.equal(await navbar.getByRole('button',{name:'Voice',exact:true}).count(),0);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});
