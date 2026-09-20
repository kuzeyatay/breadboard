import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const root = path.resolve(import.meta.dirname, '..');

test('artifact browser filters, sorts, keeps chat widgets, selects Learn artifacts, attaches and fits narrow screens', { timeout: 60_000 }, async () => {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import Archive from './src/app/components/hermes/artifact-panel';
    function App(){const [attached,setAttached]=useState(new Set());return <Archive compact hideHeader gardenSlug="demo" sourceSurface="garden_chat" attachedArtifactIds={attached} onToggleArtifactAttachment={async item=>{window.attachCalls=(window.attachCalls||0)+1;setAttached(current=>{const next=new Set(current);if(!next.delete(item.id))next.add(item.id);return next;});}}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, outfile: 'fixture.js', bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': path.join(root, 'src') }, plugins: [{ name: 'viewer-boundaries', setup(builder) {
    builder.onResolve({ filter: /^\.\/artifact-(viewer|image-studio|video-studio)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', resolveDir: root, contents: args.path.endsWith('viewer') ? `
      import React from 'react';
      export default function Viewer(){return null;}
      export const ARTIFACT_BROWSER_EVENT='artifact-browser',ARTIFACT_AI_EDIT_EVENT='artifact-edit',GARDEN_DOCUMENTS_CHANGED_EVENT='garden-changed';
      export const artifactDescription=item=>item.kind,artifactPdfHref=()=>null,artifactVideoHref=()=>null,artifactUrl=item=>'/thumb/'+item.id;
      export const deleteArtifactRequest=async()=>{},highlightArtifactRequest=async()=>{};
      export function ArtifactFileIcon(){return <svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6"/></svg>}
      export const ArtifactArchiveIcon=ArtifactFileIcon;
    ` : 'export default function Studio(){return null;}' }));
  } }] });
  const utilityCss = await postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "../src/app/components/hermes/artifact-panel.tsx"; @source "../src/app/components/hermes/artifact-card-content.tsx";', { from: path.join(root, 'tests/archive-fixture.css') });
  const css = utilityCss.css + bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const common = { conversationId:'chat-1',gardenId:'demo',status:'ready',version:1,downloadAvailable:true,previewAvailable:true,metadata:{},updatedAt:'2026-09-12T12:00:00Z',highlight:null };
  const items = [
    {...common,id:'web',title:'Energy dashboard',filename:'energy-dashboard.html',kind:'html',renderer:'html-file'},
    {...common,id:'paper',title:'Research notes — thermal systems and energy transfer',filename:'thermal-research.pdf',kind:'pdf',renderer:'pdf'},
    {...common,id:'image',title:'Autumn in the garden',filename:'garden-study.png',kind:'image',renderer:'image-file'},
    {...common,id:'model',title:'Heat transfer explorer',filename:'heat-transfer.html',kind:'html',renderer:'interactive-visualizer'},
    {...common,id:'sheet',title:'Experiment results',filename:'results.csv',kind:'data',renderer:'csv'},
  ];
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,chromium.executablePath(),'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p));
  const browser = await chromium.launch({ executablePath,headless:true });
  try {
    const page = await browser.newPage({viewport:{width:420,height:850}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    let selectedLearn=[]; let refuseLearn=false;
    await page.route('http://localhost:53148/**',route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/api/hermes/artifacts'){
        assert.equal(url.searchParams.get('presentation'),'archive');
        return route.fulfill({json:{artifacts:items}});
      }
      if(url.pathname==='/api/gardens/demo/learn/artifacts'){
        if(route.request().method()==='POST'){
          if(refuseLearn)return route.fulfill({status:409,json:{error:'Learn is currently running.'}});
          const body=route.request().postDataJSON();
          const item=items.find(item=>item.id===body.artifactId);
          assert.equal(body.version,item.version);
          selectedLearn=selectedLearn.filter(item=>item.id!==body.artifactId);
          if(body.included)selectedLearn.push(item);
        }
        return route.fulfill({json:{artifacts:selectedLearn}});
      }
      if(url.pathname.startsWith('/thumb/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="120"><rect width="100" height="120" fill="#dce9d6"/><path d="M0 95 42 30 70 75 100 40V120H0" fill="#56785a"/><circle cx="75" cy="25" r="14" fill="#eab26f"/></svg>'});
      return route.fulfill({contentType:'text/html',body:`<style>:root{--paper-surface:#fafbf9;--paper-strong:#edf1e9;--paper-raised:#fff;--line:#dde3d8;--line-strong:#bec8b7;--ink:#343c31;--ink-heading:#293824;--ink-muted:#737f6c;--botanical:#48663a}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}#root{height:100dvh}${css}</style><div id="root"></div><script>${js}</script>`});
    });
    await page.goto('http://localhost:53148/');
    const cards=page.locator('.bb-neu-artifact-card');
    const card=title=>cards.filter({has:page.getByTitle(title,{exact:true})});
    await page.getByRole('button',{name:'Add Energy dashboard v1 to Learn',exact:true}).waitFor();
    assert.equal(await cards.count(),5);
    assert.equal(await cards.locator('.bb-neu-artifact-preview-tilted').count(),5);
    await page.getByRole('button',{name:'Web & interactive',exact:true}).click();
    assert.equal(await cards.count(),2);
    await page.getByRole('searchbox').fill('heat html');
    assert.equal(await cards.count(),1);
    const color=()=>card('Heat transfer explorer').getByRole('button',{name:'Artifact color; click twice to select for chat',exact:true});
    await color().dblclick();
    await card('Heat transfer explorer').getByRole('button',{name:'Artifact color; selected for chat',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.attachCalls),1);
    await card('Heat transfer explorer').getByRole('button',{name:'Artifact color; selected for chat',exact:true}).dblclick();
    await color().waitFor();
    assert.equal(await page.evaluate(()=>window.attachCalls),2);
    await page.getByRole('button',{name:'Add Heat transfer explorer v1 to Learn',exact:true}).click();
    await page.getByRole('button',{name:'Remove Heat transfer explorer v1 from Learn',exact:true}).waitFor();
    assert.equal(selectedLearn.length,1);
    await page.reload();
    await page.getByRole('button',{name:'Remove Heat transfer explorer v1 from Learn',exact:true}).waitFor();
    refuseLearn=true;
    await page.getByRole('button',{name:'Add Energy dashboard v1 to Learn',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Learn is currently running.'}).waitFor();
    assert.equal(selectedLearn.length,1);
    refuseLearn=false;
    await page.getByRole('button',{name:'Remove Heat transfer explorer v1 from Learn',exact:true}).click();
    await page.getByRole('button',{name:'Add Heat transfer explorer v1 to Learn',exact:true}).waitFor();
    await page.getByRole('searchbox').fill('missing');
    await page.getByRole('button',{name:'Clear filters',exact:true}).click();
    assert.equal(await cards.count(),5);
    await page.getByRole('combobox',{name:'Sort artifacts'}).selectOption('name');
    assert.match(await cards.first().innerText(),/Autumn in the garden/);
    await page.screenshot({path:path.join(root,'.tmp-artifact-browser-light.png')});
    await page.evaluate(()=>document.documentElement.style.cssText='--paper-surface:#20261e;--paper-strong:#2b3527;--paper-raised:#262e23;--line:#3b4536;--line-strong:#535e4c;--ink:#d5ddcf;--ink-heading:#e6ecdf;--ink-muted:#a0ad98;--botanical:#b5ce9f');
    await page.screenshot({path:path.join(root,'.tmp-artifact-browser-dark.png')});
    await page.setViewportSize({width:280,height:700});
    assert.ok(await page.getByRole('region',{name:'Artifacts',exact:true}).evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await card('Energy dashboard').getByRole('button',{name:'Artifact color; click twice to select for chat',exact:true}).dblclick();
    await card('Energy dashboard').getByRole('button',{name:'Artifact color; selected for chat',exact:true}).waitFor();
    await page.screenshot({path:path.join(root,'.tmp-artifact-browser-narrow.png')});
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
