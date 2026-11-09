import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const root = process.env.BREADBOARD_DASHBOARD_ROOT || path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'package.json'));
const {build} = require('esbuild');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const {chromium, expect} = require('@playwright/test');
const stage = process.env.TERMINAL_DRAG_STAGE;
const sourcePath = relative => stage && fs.existsSync(path.join(stage, path.basename(relative)))
  ? path.join(stage, path.basename(relative)) : path.join(root, relative);
const read = relative => fs.readFileSync(sourcePath(relative),'utf8').replace(/\r\n/g,'\n');
const terminal = read('src/app/components/hermes/dashboard-agent-terminal.tsx');
const between = (start,end) => terminal.slice(terminal.indexOf(start),terminal.indexOf(end,terminal.indexOf(start)));

test('Terminal drag follows the pointer without rerendering the chat; its grip and outline stay aligned', {timeout:60000}, async()=>{
 const fixture = `
 import {useState,useRef,useEffect,useLayoutEffect} from 'react';
 import {createRoot} from 'react-dom/client';
 import Handle from '@/app/components/hermes/terminal-dock-handle';
 import Outline from '@/app/components/terminal-dock-outline';
 import {createTerminalDockDrag} from '@/lib/terminal-dock-drag';
 import {useTerminalHeaderClickGuard} from '@/app/components/terminal-header-click-guard';
 const MIN_OPEN_HEIGHT=260,HEIGHT_KEY='test-terminal-height',DOCK_OPEN_MS=420,DOCK_CLOSE_MS=240;
 const DOCK_OPEN_EASING='ease',DOCK_CLOSE_EASING='ease';
 const terminalDockCollapsedHeight=()=>42,minOpenHeight=()=>260,maxHeight=()=>736;
 const clampHeight=n=>Math.min(736,Math.max(42,n));
 function Demo(){
  const [height,setHeight]=useState(42),[isResizing,setIsResizing]=useState(false);
  const [glide,setGlide]=useState(null),[glideBox,setGlideBox]=useState(null),[glideShift,setGlideShift]=useState(0);
  const isOpen=height>=260,drawerPresentation=false,glideMoving=!!glide,glassActive=false,bodyMounted=isOpen;
  const resizeStartRef=useRef(null),resizePaintRef=useRef(null),preferredOpenHeightRef=useRef(null),prewarmRef=useRef(false);
  const headerClickGuard=useTerminalHeaderClickGuard();
  ${between('  const dockRef = useRef<HTMLElement | null>(null);','  const barRef =')}
  ${between('  function visualHeight()', '  function toggleDock(')}
  const cancelGlide=()=>{setGlide(null);setGlideBox(null);setGlideShift(0);prewarmRef.current=false};
  const prewarmOpen=()=>{};
  const toggleDock=open=>{cancelGlide();setHeight(open?736:42)};
  ${between('  function handleResizeStart(', '  async function stopHistorySession(')}
  ${between('  const dockHeight =', '  const headerItemAnim =')}
  useLayoutEffect(()=>{window.commits=(window.commits||0)+1;});
  useEffect(()=>{
    if(isResizing||height<260)return;
    localStorage.setItem(HEIGHT_KEY,String(height));
    window.saves=(window.saves||0)+1;
  },[height,isResizing]);
  window.resetDock=()=>{cancelGlide();setHeight(42)};
  window.interruptGlide=()=>{setHeight(600);setGlideBox(600);setGlide('opening');setGlideShift(200)};
  return <><section ref={dockRef} data-terminal-dock className="bb-terminal-dock"
    data-terminal-collapsed={!isOpen&&!glide} style={terminalStyle}>
    <Outline targetRef={dockRef}/>
    <header onPointerDown={handleResizeStart} onPointerMove={handleResizeMove}
      onPointerUp={handleResizeEnd} onPointerCancel={handleResizeEnd} onLostPointerCapture={handleResizeEnd}>Terminal</header>
    {isOpen&&<div data-terminal-body><aside>Chats</aside><main>{Array.from({length:1500},(_,i)=><p key={i}>Message {i}</p>)}</main></div>}
   </section><Handle positionRef={handlePositionRef} dockStyle={terminalStyle} resizing={isResizing}
    onOpen={()=>toggleDock(true)} onResizeStart={handleResizeStart} onResizeMove={handleResizeMove} onResizeEnd={handleResizeEnd}/></>;
 }
 const app=createRoot(document.getElementById('root'));app.render(<Demo/>);window.unmountDock=()=>app.unmount();
 `;
 const bundle=await build({stdin:{contents:fixture,resolveDir:root,loader:'tsx'},bundle:true,write:false,
  format:'iife',platform:'browser',jsx:'automatic',nodePaths:[path.join(root,'node_modules')],plugins:[{name:'source',setup(builder){
   builder.onResolve({filter:/^@\//},args=>{const file=path.join(root,'src',args.path.slice(2));
    const match=['','.tsx','.ts','.js'].map(e=>file+e).find(f=>fs.existsSync(f))
     || file+'.ts'; return {path:sourcePath(path.relative(root,match))};});
   if(stage)builder.onResolve({filter:/terminal-(dock-handle|dock-drag|dock-outline-path|dock-outline)$/},args=>({path:path.join(stage,path.basename(args.path)+(args.path.endsWith('handle')||args.path.endsWith('/terminal-dock-outline')?'.tsx':'.ts'))}));
   builder.onResolve({filter:/^\.\.\/terminal-header-click-guard$/},()=>({path:path.join(root,'src/app/components/terminal-header-click-guard.ts')}));
  }}]});
 const handlePath=sourcePath('src/app/components/hermes/terminal-dock-handle.tsx').replaceAll('\\','/');
 const css=(await postcss([tailwind({base:root})]).process('@import "tailwindcss" source(none);\n@source "'+handlePath+'";',{from:path.join(root,'terminal-drag-test.css')})).css;
 const globals=read('src/app/globals.css');
 const outlineCss=globals.slice(globals.indexOf('.bb-terminal-dock {'),globals.indexOf('.bb-neu-toolbar {'));
 const dragCss=stage?read('drag.css'):globals.slice(globals.indexOf('/* The live drag owns both edges;'));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.route('https://terminal-drag.test/**',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.goto('https://terminal-drag.test');
  await page.addStyleTag({content:css+outlineCss+dragCss+`
   :root{--terminal-bar-radius:20px;--terminal-collapsed-height:42px;--botanical:#73aa91;--terminal-bar:#26221a;--paper-surface:rgba(20,40,30,.6)}
   body{background:linear-gradient(125deg,#d6d1a0,#66977e)}
   [data-terminal-dock]{position:fixed;inset:auto 0 0;display:flex;flex-direction:column;overflow:hidden;border-top:1px solid;color:white}
   header{flex-shrink:0;height:42px;background:#26221a;padding:10px;touch-action:none}
   [data-terminal-body]{display:flex;flex:1;min-height:0}aside{width:180px;background:#25342a}main{flex:1;overflow:auto}
   html[data-artifact-dock=open] [data-terminal-dock],html[data-artifact-dock=open] [data-terminal-handle-position]{right:300px!important}
  `});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const dock=page.locator('[data-terminal-dock]'),handle=page.getByRole('button',{name:'Fully open terminal'});
  const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const geometry=()=>page.evaluate(()=>{
   const d=document.querySelector('[data-terminal-dock]'),s=d.querySelector('svg'),h=document.querySelector('[data-terminal-handle-position] span');
   const rect=d.getBoundingClientRect(),grip=h.getBoundingClientRect();
   return {height:rect.height,width:rect.width,edge:rect.top,grip:grip.top+grip.height/2,view:[...s.viewBox.baseVal? [s.viewBox.baseVal.width,s.viewBox.baseVal.height]:[]],path:s.children[0].getAttribute('d'),commits:window.commits,saves:window.saves||0};
  });
  const aligned=async()=>{await settle();const g=await geometry();assert.equal(g.grip,g.edge+2);assert.deepEqual(g.view,[g.width,g.height]);return g};
  const start=async()=>{const b=await handle.boundingBox();const x=b.x+b.width/2,y=b.y+b.height/2;await page.mouse.move(x,y);await page.mouse.down();return{x,y}};
  await expect(handle).toBeVisible();await aligned();
  let p=await start();await page.mouse.move(p.x,p.y-80);let g=await aligned();
  assert.equal(g.height,122,'small drag follows the pointer without snapping');
  await expect(page.locator('[data-terminal-body]')).toBeHidden();
  await page.mouse.move(p.x,p.y-300);g=await aligned();assert.equal(g.height,342);
  const baseline=g;
  // Many pointer samples before one paint must coalesce without React commits.
  await page.evaluate(({x,y})=>{
   const el=document.querySelector('[aria-label="Fully open terminal"]');
   for(let i=301;i<=500;i++)el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,clientX:x,clientY:y-i}));
  },p);
  g=await aligned();assert.equal(g.height,542);assert.equal(g.commits,baseline.commits);assert.equal(g.saves,0);
  const topCount=Math.ceil((g.width-3.5-40)/30);
  const top=d=>d.split(' C ').slice(0,topCount+1).join(' C ');
  assert.equal(top(g.path),top(baseline.path),'resizing must not change the top edge waveform');
  await page.mouse.move(p.x,p.y-500);await page.mouse.up();g=await aligned();
  assert.equal(g.height,542);assert.equal(g.saves,1);assert.equal(await dock.getAttribute('data-terminal-resizing'),null);
  assert.equal(await dock.evaluate(e=>e.style.getPropertyValue('--terminal-drag-height')),'');
  await handle.click();await expect(dock).toHaveCSS('height','736px');await aligned();
  await page.evaluate(()=>window.resetDock());await expect(dock).toHaveCSS('height','42px');
  p=await start();await page.mouse.move(p.x,p.y-80);await aligned();await page.mouse.up();await expect(dock).toHaveCSS('height','42px');
  p=await start();await page.mouse.move(p.x,p.y-150);await aligned();await page.mouse.up();await expect(dock).toHaveCSS('height','260px');
  await page.evaluate(()=>window.resetDock());await expect(dock).toHaveCSS('height','42px');
  p=await start();await page.mouse.move(p.x,p.y-100);await page.mouse.move(p.x,p.y);await page.mouse.up();await expect(dock).toHaveCSS('height','42px');
  // A cancelled pointer usually carries zero coordinates; keep the last edge.
  p=await start();await page.mouse.move(p.x,p.y-400);await aligned();
  await handle.dispatchEvent('pointercancel',{pointerId:1,bubbles:true});await page.mouse.move(10,10);await page.mouse.up();await expect(dock).toHaveCSS('height','442px');await aligned();
  await page.evaluate(()=>document.documentElement.dataset.artifactDock='open');await aligned();
  await handle.focus();await page.keyboard.press('Enter');await expect(dock).toHaveCSS('height','736px');await aligned();
  await page.evaluate(()=>window.interruptGlide());await page.waitForTimeout(450);
  p=await start();await page.mouse.move(p.x,p.y-50);g=await aligned();assert.equal(g.height,450,'drag picks up the visible edge of an interrupted glide');await page.mouse.up();await aligned();
  p=await start();await page.mouse.move(p.x,p.y-30);await page.evaluate(()=>window.unmountDock());await page.mouse.up();await settle();
  assert.equal(await page.evaluate(()=>document.body.style.userSelect),'');assert.deepEqual(errors,[]);
 }finally{await browser.close()}
});
