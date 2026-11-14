import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import {compileCustomInteractiveVisualizerPackage,bundleCustomInteractiveVisualizer} from '../src/lib/hermes/interactive-visualizer-custom.ts';
import {validateInteractiveVisualizerPlan} from '../src/lib/hermes/interactive-visualizer-plan.ts';
import {withInteractiveVisualizerInlineLayout} from '../src/lib/hermes/interactive-visualizer-inline.ts';
import {runInteractiveVisualizerBrowserTestsInWorker} from '../scripts/runtime-v2-interactive-visualizer-executor.mjs';

const root=path.resolve(import.meta.dirname,'..');
const input=JSON.parse(fs.readFileSync(process.env.DIAGRAM_TEST_INPUT ?? path.join(root,'tests/fixtures/diagram-in-chat-compressor.json'),'utf8'));

test('a model-authored diagram passes publication and the shared chat surfaces', {timeout:120_000}, async t=>{
  assert.deepEqual(validateInteractiveVisualizerPlan(input.plan).errors,[]);
  const compiled=compileCustomInteractiveVisualizerPackage(input.plan,input.package);
  assert.equal(compiled.validation.valid,true,JSON.stringify(compiled.validation.errors));
  const bundle=await bundleCustomInteractiveVisualizer(input.package);
  const out=process.env.DIAGRAM_SCREENSHOT_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(),'breadboard-diagram-'));
  fs.mkdirSync(out,{recursive:true});
  const gateDir=fs.mkdtempSync(path.join(out,'gate-'));
  const gate=await runInteractiveVisualizerBrowserTestsInWorker({html:bundle.html,mode:'2d',requiresWebgl:false,outputDir:gateDir});
  assert.equal(gate.passed,true,JSON.stringify(gate.checks));
  const preview=withInteractiveVisualizerInlineLayout(bundle.html);
  // Keep the production artifact fetch/cache/ownership, card, iframe, resize,
  // theme and Ask Here components. Only unrelated editors and Electron IPC
  // are substituted, so a routing or display regression cannot pass as a PNG.
  const stubs={
    './artifact-viewer': `export default () => null;
      export const ARTIFACT_BROWSER_EVENT='diagram-refresh';
      export const artifactDescription=()=>'Diagram · HTML';
      export const artifactPdfHref=()=>null;export const artifactVideoHref=()=>null;
      export const useFileExplorerAvailable=()=>false;
      export const artifactUrl=a=>'/preview?id='+a.id+'&version='+a.version;
      export const ArtifactFileIcon=()=>null;`,
    './artifact-image-studio':'export default () => null;',
    './artifact-video-studio':'export default () => null;',
    '@/lib/desktop-browser-tabs': `export const desktopTabsBridge=()=>({onBrowserInlineAnswerState:cb=>{queueMicrotask(()=>cb(window.browserState));return ()=>{}}});
      export const sendDesktopTabsCommand=async()=>true;export const openInDesktopTab=async()=>false;
      export const getDesktopTabsSnapshot=()=>null;export const subscribeDesktopTabs=()=>()=>{};`,
  };
  const app=await build({bundle:true,write:false,outfile:'diagram-test.js',platform:'browser',format:'iife',jsx:'automatic',alias:{'@':path.join(root,'src')},logLevel:'silent',
    stdin:{resolveDir:root,loader:'tsx',contents:`
      import React from 'react';import{createRoot}from'react-dom/client';
      import Cards from './src/app/components/hermes/inline-artifact-cards';
      import{InlineSelectionAnswerPopover}from'./src/app/components/chat-text-selection-ui';
      import BrowserAnswer from './src/app/browser/inline-answer/inline-answer';
      const mode=new URLSearchParams(location.search).get('surface');
      const scope=mode==='garden-chat'?{legacyChatSessionId:42,gardenSlug:'compressors'}:
        {conversationId:mode==='garden-workspace'?'garden-chat':'main-chat'};
      const cards=<Cards {...scope} ownerMessageId='answer-1'/>;
      window.browserState={requestId:'request-1',selectionId:'selection-1',conversationId:'main-chat',
        selection:{id:'selection-1',sourceMessageId:'source',quote:'compressor',start:0,end:10,mode:'inline'},
        viewport:{width:960,height:920},content:{question:'Draw the compressor system',answer:'Fill and vent are alternative valve states.',
          pending:false,answerMessageId:'answer-1',artifactMessageId:'answer-1',conversationId:'main-chat',canAsk:true,ownerReady:true}};
      createRoot(document.getElementById('root')).render(mode==='browser-answer'?<BrowserAnswer/>:
        mode==='ask-here'?<InlineSelectionAnswerPopover question='Draw the compressor system' answer='Fill and vent are alternative valve states.'
          answerMessageId='answer-1' pending={false} anchor={{left:80,right:760,top:90,bottom:110,width:680,height:20}}
          artifacts={cards} onAskAgain={()=>{}} onClose={()=>{}} onDelete={()=>{}}/>:
        <main style={{maxWidth:920,margin:'0 auto',padding:20}}><p>Fill and vent are alternative valve states.</p>{cards}</main>);
    `},plugins:[{name:'unrelated-surfaces',setup(b){
      b.onResolve({filter:/.*/},args=>args.path in stubs?{path:args.path,namespace:'fixture'}:null);
      b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:root}));
    }}]});
  const stylesheet=path.join(root,'src/app/globals.css');
  const css=(await postcss([tailwindcss({base:root})]).process(fs.readFileSync(stylesheet,'utf8'),{from:stylesheet})).css;
  const executablePath=[chromium.executablePath(),'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser=await chromium.launch({headless:true,executablePath});t.after(()=>browser.close());
  for(const surface of ['assistant','garden-chat','garden-workspace','ask-here','browser-answer']) {
    if(process.env.DIAGRAM_TEST_SURFACE && process.env.DIAGRAM_TEST_SURFACE!==surface) continue;
    const page=await browser.newPage({viewport:{width:1100,height:1000},colorScheme:'dark'});
    page.setDefaultTimeout(8000);
    const errors=[];page.on('pageerror',e=>errors.push(e.stack ?? e.message));
    const artifact={id:'compressor',assistantMessageId:'answer-1',version:1,title:input.plan.title,
      status:'ready',renderer:'interactive-visualizer',kind:'html',filename:'compressor.html',
      sourceSkill:'diagram-in-chat',previewAvailable:true,downloadAvailable:true};
    await page.route('http://localhost:53168/**',route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/api/hermes/artifacts') {
        assert.equal(url.searchParams.get('presentation'),'transcript');
        assert.equal(url.searchParams.get(surface==='garden-chat'?'chatSessionId':'conversationId'),
          surface==='garden-chat'?'42':surface==='garden-workspace'?'garden-chat':'main-chat');
        return route.fulfill({json:{artifacts:[artifact,{...artifact,id:'other-response',assistantMessageId:'answer-2'}]}});
      }
      if(url.pathname==='/preview') {
        assert.equal(url.searchParams.get('id'),'compressor');
        assert.equal(url.searchParams.get('presentation'),'inline');
        return route.fulfill({contentType:'text/html',body:preview});
      }
      if(url.pathname==='/api/starred-messages')return route.fulfill({json:{messages:[]}});
      if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});
      return route.fulfill({contentType:'text/html',body:'<!doctype html><html data-theme="dark"><body><div id="root"></div></body></html>'});
    });
    const mount=async()=>{
      await page.goto(`http://localhost:53168/?surface=${surface}&theme=dark`);
      await page.addStyleTag({content:css});await page.addScriptTag({content:app.outputFiles[0].text});
      try { await expect(page.locator('iframe')).toHaveCount(1); }
      catch(error) {
        await page.screenshot({path:path.join(out,`${surface}-failed.png`),fullPage:true});
        throw new Error(`${surface}: ${errors.join('; ')}\n${await page.locator('body').innerText()}`,{cause:error});
      }
    };
    await mount();
    const iframe=page.locator('iframe');
    await expect(iframe).toHaveAttribute('sandbox','allow-scripts');
    const frame=await(await iframe.elementHandle()).contentFrame();
    await frame.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    const svg=frame.locator('svg[role="img"]');
    await expect(svg).toBeVisible();
    for(const label of ['Motor and air pump','Air tank','Outlet regulator','McKibben muscle','3/2 fill-and-vent valve','Exhaust to room']) {
      await expect(svg.getByText(label,{exact:true})).toBeVisible();
    }
    // Real geometry, not just presence of the SVG. Each routed endpoint must
    // coincide with its declared node boundary; every text label fits the view.
    const geometryErrors=await svg.evaluate(svg=>{
      const errors=[];
      const boundary=(p,rect)=>{
        const r=rect.getBoundingClientRect(),tolerance=2;
        return ((Math.abs(p.x-r.left)<tolerance||Math.abs(p.x-r.right)<tolerance)&&p.y>=r.top-tolerance&&p.y<=r.bottom+tolerance)||
          ((Math.abs(p.y-r.top)<tolerance||Math.abs(p.y-r.bottom)<tolerance)&&p.x>=r.left-tolerance&&p.x<=r.right+tolerance);
      };
      const edges=[...svg.querySelectorAll('path[data-from][data-to]')];
      if(edges.length<8)errors.push('Missing inspectable relationship geometry');
      for(const edge of edges)for(const [end,key]of[[0,'from'],[edge.getTotalLength(),'to']]){
        const node=svg.querySelector('[data-node="'+edge.dataset[key]+'"]');
        const rect=node?.tagName==='rect'?node:node?.querySelector('rect');
        const p=edge.getPointAtLength(end).matrixTransform(edge.getScreenCTM());
        if(!rect||!boundary(p,rect))errors.push('Detached '+key+' port: '+edge.dataset[key]);
      }
      const view=svg.getBoundingClientRect();
      for(const text of svg.querySelectorAll('text')){
        const r=text.getBoundingClientRect();
        if(r.left<view.left-1||r.right>view.right+1||r.top<view.top-1||r.bottom>view.bottom+1)errors.push('Clipped '+text.textContent);
      }
      return errors;
    });
    assert.deepEqual(geometryErrors,[],surface);
    const fitted=await svg.getAttribute('viewBox');
    const zoom=frame.getByRole('button',{name:'Zoom in',exact:true});
    assert.ok((await zoom.boundingBox()).height>=28,'zoom controls have usable height');
    await zoom.click();await expect(svg).not.toHaveAttribute('viewBox',fitted);
    const zoomed=await svg.getAttribute('viewBox');
    await svg.focus();await svg.press('ArrowRight');await expect(svg).not.toHaveAttribute('viewBox',zoomed);
    await frame.getByRole('button',{name:'Fit diagram',exact:true}).click();await expect(svg).toHaveAttribute('viewBox',fitted);
    const scene=await svg.boundingBox();
    await page.mouse.move(scene.x+scene.width/2,scene.y+80);await page.mouse.down();
    await page.mouse.move(scene.x+scene.width/2+40,scene.y+100);await page.mouse.up();
    await expect(svg).not.toHaveAttribute('viewBox',fitted);
    assert.equal(await frame.evaluate(()=>getSelection()?.toString()??''),'','panning must not select diagram labels');
    await frame.getByRole('button',{name:'Fit diagram',exact:true}).click();
    await svg.hover();await page.mouse.wheel(0,-160);await expect(svg).not.toHaveAttribute('viewBox',fitted);
    await frame.getByRole('button',{name:'Fit diagram',exact:true}).click();
    await page.waitForFunction(()=>{const f=document.querySelector('iframe');return f.clientHeight>500;});
    assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.screenshot({path:path.join(out,`${surface}-dark.png`),fullPage:true});
    await page.evaluate(()=>document.documentElement.dataset.theme='light');
    await frame.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    assert.equal(await frame.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'light');
    await page.screenshot({path:path.join(out,`${surface}-light.png`),fullPage:true});
    await page.setViewportSize({width:420,height:900});
    await expect(frame.getByRole('button',{name:'Fit diagram',exact:true})).toBeVisible();
    assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await mount();await expect(page.frameLocator('iframe').locator('svg[role="img"]')).toBeVisible();
    assert.deepEqual(errors,[],surface);await page.close();
  }
  fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({publication:gate,surfaces:['assistant','garden-chat','garden-workspace','ask-here','browser-answer']},null,2));
});
