import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import {withInteractiveVisualizerInlineLayout} from '../src/lib/hermes/interactive-visualizer-inline.ts';

const root = path.resolve(import.meta.dirname, '..');
const preview = withInteractiveVisualizerInlineLayout(`<!doctype html><html><head><style>
  *{box-sizing:border-box}body{margin:0;padding:16px;font:16px system-ui}
  canvas{display:block;width:100%;height:280px;background:#e7eee8}
  label{display:block;margin:16px 0}input{max-width:100%}#details{height:900px}
</style></head><body><canvas width="600" height="280"></canvas>
  <label>dx <input type="range" min="1" max="10" value="3"></label><output>3</output>
  <button>Show details</button><div id="details" hidden>Expanded explanation</div>
  <script>
    const range=document.querySelector('input'),canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
    function draw(){ctx.clearRect(0,0,600,280);ctx.fillStyle='#446b50';ctx.fillRect(10,10,range.value*40,140);document.querySelector('output').value=range.value}
    range.oninput=draw;draw();
    document.querySelector('button').onclick=()=>{document.querySelector('#details').hidden=!document.querySelector('#details').hidden};
  </script></body></html>`);

test('floating answers recover their own interactive artifacts and expand within the viewport', {timeout:60_000}, async t => {
  // Only the unrelated full-screen editors are stubbed. Fetching, ownership,
  // preview sandbox, resize bridge and popover layout are production code.
  const stubs = {
    './artifact-viewer': `export default () => null;
      export const ARTIFACT_BROWSER_EVENT='artifact-test-refresh';
      export const artifactDescription=()=>'Interactive model';
      export const artifactPdfHref=()=>null;
      export const artifactVideoHref=()=>null;
      export const useFileExplorerAvailable=()=>false;
      export const artifactUrl=a=>'/preview?id='+a.id+'&version='+a.version;
      export const ArtifactFileIcon=()=>null;`,
    './artifact-image-studio': 'export default () => null;',
    './artifact-video-studio': 'export default () => null;',
  };
  const bundle = await build({bundle:true, write:false, outfile:'inline-answer-visualizer-test.js', platform:'browser', format:'iife', jsx:'automatic',
    alias:{'@':path.join(root,'src')}, logLevel:'silent', stdin:{resolveDir:root, loader:'tsx', contents:`
      import React,{useState} from 'react';import{createRoot}from'react-dom/client';
      import{InlineSelectionAnswerPopover}from'./src/app/components/chat-text-selection-ui';
      import Cards from './src/app/components/hermes/inline-artifact-cards';
      const legacy=new URLSearchParams(location.search).has('legacy');
      const scope=legacy?{legacyChatSessionId:42,gardenSlug:'vectors'}:{conversationId:'pdf-chat'};
      function App(){
        const [open,setOpen]=useState(true),[pending,setPending]=useState(false),[answer,setAnswer]=useState('Adjust dx to change the box.');
        window.controls={reopen:()=>setOpen(true),pending:setPending,answer:setAnswer};
        return <><header className='breadboard-flower-navbar' style={{position:'fixed',inset:'0 0 auto',height:52}}>Reader</header>
          {open&&<InlineSelectionAnswerPopover anchor={{left:242,right:820,top:410,bottom:455,width:578,height:45}}
            question='Show the volume element' answer={answer} answerMessageId='client:answer-1:assistant' pending={pending}
            artifacts={<Cards {...scope} ownerMessageId='answer-1'/>}
            onAskAgain={()=>{}} onClose={()=>setOpen(false)} onDelete={()=>setOpen(false)}/>}
          <div className='bb-composer-overlay' style={{position:'fixed',bottom:0,left:0,right:0,height:60}}>Composer</div>
        </>;
      }createRoot(document.getElementById('root')).render(<App/>);
    `}, plugins:[{name:'unrelated-editors',setup(builder){
      builder.onResolve({filter:/.*/},args=>args.path in stubs?{path:args.path,namespace:'fixture'}:null);
      builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:root}));
    }}]});
  const stylesheet = path.join(root,'src/app/globals.css');
  const css = (await postcss([tailwindcss({base:root})]).process(fs.readFileSync(stylesheet,'utf8'),{from:stylesheet})).css;
  const executablePath = [chromium.executablePath(),'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser = await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  t.after(()=>browser.close());
  for (const legacy of [false,true]) {
    const page = await browser.newPage({viewport:{width:1073,height:862}});
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    const artifact = {id:'volume',assistantMessageId:'answer-1',conversationId:'pdf-chat',version:2,
      title:'Volume element',status:'ready',renderer:'interactive-visualizer',kind:'html',
      sourceSkill:'interactive-visualizer-in-chat',previewAvailable:true,downloadAvailable:true};
    let published = false;
    await page.route('http://localhost:53158/**',route=>{
      const url = new URL(route.request().url());
      if (url.pathname==='/api/hermes/artifacts') {
        assert.equal(url.searchParams.get('presentation'),'transcript');
        assert.equal(url.searchParams.get(legacy?'chatSessionId':'conversationId'),legacy?'42':'pdf-chat');
        if (legacy) assert.equal(url.searchParams.get('gardenSlug'),'vectors');
        return route.fulfill({json:{artifacts:published?[artifact,{...artifact,id:'unrelated',assistantMessageId:'answer-2'}]:[]}});
      }
      if (url.pathname==='/preview') {
        assert.equal(url.searchParams.get('id'),'volume');
        assert.equal(url.searchParams.get('version'),'2');
        assert.equal(url.searchParams.get('presentation'),'inline');
        return route.fulfill({contentType:'text/html',body:preview});
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({json:{}});
      return route.fulfill({contentType:'text/html',body:'<!doctype html><html data-theme="light"><body><div id="root"></div></body></html>'});
    });
    const mount = async () => {
      await page.goto(`http://localhost:53158/${legacy?'?legacy':''}`);
      await page.addStyleTag({content:css});
      await page.addScriptTag({content:bundle.outputFiles[0].text});
    };
    await mount();
    const card = page.getByRole('dialog',{name:'Answer about highlighted text'});
    const width = () => card.evaluate(node=>node.getBoundingClientRect().width);
    await expect.poll(width).toBe(400);
    // The artifact arrives independently of the text stream, just as when the
    // response finishes before the final artifact publication event arrives.
    published = true;
    await page.evaluate(()=>dispatchEvent(new CustomEvent('artifact-test-refresh',{detail:{conversationId:'pdf-chat',gardenId:'vectors'}})));
    await expect(card.locator('iframe')).toHaveCount(1);
    await expect.poll(width).toBe(960);
    await expect(card.locator('iframe')).toHaveAttribute('sandbox','allow-scripts');
    const fits = () => page.waitForFunction(()=>{
      const card=document.querySelector('.bb-inline-answer').getBoundingClientRect();
      const bottom=document.querySelector('.bb-composer-overlay').getBoundingClientRect().top-16;
      return card.left>=16&&card.right<=innerWidth-16&&card.top>=66&&card.bottom<=bottom+1;
    });
    await fits();
    const frame = card.frameLocator('iframe');
    const range = frame.getByRole('slider');
    await range.focus();await range.press('ArrowRight');
    await expect(range).toHaveValue('4');
    await expect(frame.locator('output')).toHaveText('4');
    await frame.getByRole('button',{name:'Show details'}).click();
    await expect.poll(()=>card.locator('iframe').evaluate(node=>node.clientHeight)).toBeGreaterThan(1000);
    await fits();
    // Reflow and moving the enlarged card preserve the running frame.
    await card.getByRole('button',{name:'Move answer'}).focus();
    await card.getByRole('button',{name:'Move answer'}).press('ArrowLeft');
    await expect.poll(width).toBe(960);
    await expect(range).toHaveValue('4');
    await page.setViewportSize({width:390,height:740});
    await fits();
    await expect.poll(width).toBe(358);
    await expect(range).toHaveValue('4');
    await page.setViewportSize({width:1073,height:862});
    await expect.poll(width).toBe(960);
    await fits();
    // An artifact-only answer must not say that the highlight has no answer.
    await page.evaluate(()=>window.controls.answer(''));
    await expect(card.locator('.bb-inline-answer-empty')).toBeHidden();
    // While retrying, the previous completed artifact is withheld.
    await page.evaluate(()=>window.controls.pending(true));
    await expect(card.locator('iframe')).toHaveCount(0);
    await page.evaluate(()=>window.controls.pending(false));
    await expect(card.locator('iframe')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await page.evaluate(()=>window.controls.reopen());
    await expect(card.locator('iframe')).toHaveCount(1);
    await expect.poll(width).toBe(960);
    await mount();
    await expect(card.locator('iframe')).toHaveCount(1);
    await expect.poll(width).toBe(960);
    await fits();
    assert.deepEqual(errors,[]);
    await page.close();
  }
});
