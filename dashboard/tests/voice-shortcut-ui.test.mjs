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
