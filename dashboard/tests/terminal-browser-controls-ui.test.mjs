import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium,expect} from '@playwright/test';

const root=path.resolve(import.meta.dirname,'..');
const bundle=await build({
  stdin:{resolveDir:root,loader:'tsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import NavBar from './src/app/components/navbar';
    import TerminalControls from './src/app/new-tab/terminal-browser-controls';
    import BrowserNavigation from './src/app/browser/browser-navigation';
    createRoot(document.getElementById('root')).render(location.pathname==='/browser'
      ? <BrowserNavigation showFlowers={false} restoreOwnerKey="fixture" onPanel={()=>{}}/>
      : <NavBar email="fixture" showFlowers={false} showActions={false} trailingActions={<TerminalControls ownerKey="fixture"/>}/>);
  `},
  bundle:true,write:false,outfile:'fixture.js',platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},
  plugins:[{name:'unrelated-navbar-services',setup(b){
    b.onResolve({filter:/(?:navbar-flower-wind|work-timer-shortcut|voice-shortcut)$/},()=>({path:'empty',namespace:'fixture'}));
    b.onResolve({filter:/navigation-link$/},()=>({path:'link',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},({path:name})=>({resolveDir:root,loader:'jsx',contents:name==='link'
      ? `import React from 'react';export default function Link({newTab,label,...props}){return <a {...props}/>}`
      : 'export default function Empty(){return null}'}));
  }}],
});
const globalPath=path.join(root,'src/app/globals.css');
const globals=await postcss([tailwind({base:root})]).process(fs.readFileSync(globalPath,'utf8'),{from:globalPath});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=globals.css+'\n'+bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;

test('Terminal matches browser control placement and opens the shared libraries', {timeout:30000},async()=>{
  const server=http.createServer((req,res)=>{
    if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(js);return;}
    if(req.url==='/fixture.css'){res.setHeader('content-type','text/css');res.end(css);return;}
    if(req.url.startsWith('/api/')||req.url.startsWith('/favicon')){res.setHeader('content-type','application/json');res.end('{}');return;}
    res.setHeader('content-type','text/html');res.end('<!doctype html><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();
    page.on('pageerror',error=>console.error(error.message));
    await page.addInitScript(()=>{
      window.commands=[];
      window.visits=[
        {url:'https://example.com/visited?source=fixture#part',title:'Visited fixture',visitedAt:Date.now()},
        {url:'https://www.google.com/search?q=visited+query&start=10',title:'Visited search result',visitedAt:Date.now()-1000},
      ];
      window.recentSearches=['fixture search','visited query'];
      window.bookmarks=[{url:'https://example.com/',title:'Saved fixture',iconUrl:'data:image/png;base64,iVBORw0KGgo='}];
      window.breadboardDesktop={
        getTabsState:async()=>({enabled:true,selfId:1,activeId:1,presentationRevision:1,extensions:[],tabs:[{id:1,generation:1,url:location.href}]}),
        onTabsState:()=>()=>{},tabs:async command=>{window.commands.push(command);return true;},
        getBrowserBookmarks:async()=>window.bookmarks,setBrowserBookmarks:async(_owner,items)=>{window.bookmarks=items;return true;},
        getBrowserRecentSearches:async()=>window.recentSearches,setBrowserRecentSearches:async(_owner,items)=>{window.recentSearches=items;return true;},
        getBrowserHistory:async()=>({items:window.visits,error:null}),browserHistoryCommand:async command=>{
          window.visits=command.type==='clear'?[]:window.visits.filter(item=>item.url!==command.url);return true;
        },onBrowserHistoryChanged:()=>()=>{},
        getBrowserDownloads:async()=>({items:[],error:null}),browserDownloadCommand:async()=>({ok:true}),
      };
    });
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:900});
      const boxes=[];
      for(const route of ['/browser','/new-tab']){
        await page.goto(origin+route);
        const downloads=page.getByRole('button',{name:'Downloads',exact:true});
        const menu=page.getByRole('button',{name:'Browser menu',exact:true});
        await expect(downloads).toBeVisible();await expect(menu).toBeVisible();
        boxes.push([await downloads.boundingBox(),await menu.boundingBox()]);
      }
      for(let i=0;i<2;i++)for(const key of ['x','y','width','height']){
        assert.ok(Math.abs(boxes[0][i][key]-boxes[1][i][key])<=1,`${width}px control ${i} ${key} matches browser: ${JSON.stringify(boxes)}`);
      }
    }
    await page.getByRole('button',{name:'Downloads',exact:true}).click();
    await page.getByRole('button',{name:'Browser menu',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>commands.map(c=>c.type)),['browser-downloads-popover','browser-menu']);
    for(const [action,label] of [['history','Browser history'],['visited-pages','Visited pages'],['bookmarks','Starred pages'],['downloads','Downloads']]){
      await page.evaluate(action=>window.dispatchEvent(new CustomEvent('breadboard:browser-menu-action',{detail:action})),action);
      await expect(page.getByRole('dialog',{name:label,exact:true})).toBeVisible();
      if(action==='visited-pages'){
        await expect(page.getByRole('link').filter({hasText:'Visited fixture'})).toBeVisible();
        await expect(page.getByRole('link').filter({hasText:'fixture search'})).toHaveCount(0);
        await page.getByPlaceholder('Search history by title or URL').fill('missing-page');
        await expect(page.getByText('No matching history')).toBeVisible();
        await page.getByPlaceholder('Search history by title or URL').fill('source=fixture');
        await expect(page.getByRole('dialog',{name:'Visited pages',exact:true}).getByRole('link')).toHaveCount(1);
      }
      if(action==='bookmarks'){
        await expect(page.getByRole('button',{name:'Saved fixture example.com'})).toBeVisible();
        await page.getByRole('button',{name:'Remove Saved fixture bookmark'}).click();
        await expect(page.getByText('No starred pages yet')).toBeVisible();
        assert.deepEqual(await page.evaluate(()=>bookmarks),[]);
      }
      await page.getByRole('button',{name:'Close browser library'}).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('breadboard:browser-menu-action',{detail:'history'})));
    await page.getByRole('link').filter({hasText:'fixture search'}).click();
    assert.equal(await page.evaluate(()=>commands.at(-1).url),'https://www.google.com/search?q=fixture%20search');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const visited=()=>page.evaluate(()=>window.dispatchEvent(new CustomEvent('breadboard:browser-menu-action',{detail:'visited-pages'})));
    await visited();
    await page.getByRole('link').filter({hasText:'Visited fixture'}).click();
    assert.equal(await page.evaluate(()=>commands.at(-1).url),'https://example.com/visited?source=fixture#part');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await visited();
    await page.getByRole('button',{name:'Remove Visited search result from history',exact:true}).click();
    await expect(page.getByRole('link').filter({hasText:'Visited search result'})).toHaveCount(0);
    assert.deepEqual(await page.evaluate(()=>recentSearches),['fixture search','visited query'],'removing a visited search page preserves saved search terms');
    await page.getByRole('button',{name:'Clear',exact:true}).click();
    await expect(page.getByText('No browsing history yet')).toBeVisible();
    assert.deepEqual(await page.evaluate(()=>recentSearches),['fixture search','visited query'],'clearing visited pages preserves saved search terms');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
});
