import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('real chat Markdown opens an owned circuit in the artifact pane without navigating away', async()=>{
  const root=path.resolve(import.meta.dirname,'..');
  const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
    import React from 'react';import{createRoot}from'react-dom/client';
    import ChatMarkdown from './src/app/components/chat-markdown';
    import {ArtifactLinkContext,artifactLinkTarget} from './src/app/components/hermes/artifact-link-context';
    window.opened=[];
    createRoot(document.getElementById('root')).render(<ArtifactLinkContext.Provider value={href=>{
      const target=artifactLinkTarget(href,location.origin);
      if(target?.id!=='art_circuit')return false;window.opened.push(target);return true;
    }}><ChatMarkdown content={'[Circuit project](/api/hermes/artifacts/art_circuit/download?version=1)\\n\\n[External](https://example.com/circuit)'} /></ArtifactLinkContext.Provider>);
    window.checkClick=(text,ctrlKey=false)=>{const a=[...document.querySelectorAll('a')].find(a=>a.textContent===text);const event=new MouseEvent('click',{bubbles:true,cancelable:true,button:0,ctrlKey});a.addEventListener('click',()=>{}, {once:true});a.dispatchEvent(event);return event.defaultPrevented;};
  `},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',alias:{'@':path.join(root,'src')}});
  const browser=await chromium.launch({headless:true,executablePath:[process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,chromium.executablePath(),'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p))});
  try{
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('http://localhost:53222/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div><script>'+bundle.outputFiles[0].text+'</script>'}));
    await page.goto('http://localhost:53222/');await page.getByRole('link',{name:'Circuit project'}).waitFor();
    const before=page.url();await page.getByRole('link',{name:'Circuit project'}).click();
    assert.deepEqual(await page.evaluate(()=>window.opened),[{id:'art_circuit',version:1}]);assert.equal(page.url(),before);
    assert.equal(await page.getByRole('link',{name:'External'}).getAttribute('target'),'_blank');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
