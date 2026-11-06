import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
import Database from 'better-sqlite3';
import esbuild from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {asciiWallpaperId,asciiWallpaperSlug} from '../src/lib/ascii-wallpapers.ts';
import {validBackground} from '../src/lib/page-appearance.ts';
import {readSavedPageAppearance,writeSavedBackground} from '../src/lib/page-appearance-store.ts';

const root=path.resolve(import.meta.dirname,'..'),assetRoot=path.join(root,'public/ascii-magic-art');
const catalog=JSON.parse(fs.readFileSync(path.join(assetRoot,'catalog.json'),'utf8'));
test('the complete pinned ASCII library resolves locally and selections persist per account and theme',async t=>{
  assert.equal(catalog.pieces.length,734);assert.equal(catalog.categories.length,24);
  const categories=new Set(catalog.categories.map(c=>c.id));
  for(const piece of catalog.pieces){
    assert(categories.has(piece.category));
    assert.equal(asciiWallpaperSlug(asciiWallpaperId(piece.slug)),piece.slug);
    assert(validBackground('ascii:'+piece.slug));
    assert(fs.existsSync(path.join(assetRoot,'pieces',piece.slug+'.js')));
  }
  for(const bad of ['ascii:missing-scene','ascii:../runtime/player','ascii:https://example.com/script','ascii:moonlit-sea?x=1'])assert.equal(validBackground(bad),false);
  for(const slug of ['moonlit-sea','matrix-rain','mountain-sunrise','spinning-torus','ocean-sunset']){
    const {default:create,meta}=await import(pathToFileURL(path.join(assetRoot,'pieces',slug+'.js')).href);
    const draw=create(),frame=draw(2),text=typeof frame==='string'?frame:frame.text;
    assert.equal(text.split('\n').length,meta.rows);
    assert(text.trim().length>0);
  }
  const db=new Database(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2)');
  writeSavedBackground(db,1,'new-tab','light',{background:'ascii:moonlit-sea',nextChangeAt:null});
  writeSavedBackground(db,1,'new-tab','dark',{background:'ascii:matrix-rain',nextChangeAt:null,rain:'on'});
  assert.equal(readSavedPageAppearance(db,1,'new-tab').light.background,'ascii:moonlit-sea');
  assert.equal(readSavedPageAppearance(db,1,'new-tab').dark.background,'ascii:matrix-rain');
  assert.deepEqual(readSavedPageAppearance(db,2,'new-tab'),{});
});

test('Appearance browses ASCII locally, applies animated art, restores it and respects reduced motion', {timeout:90_000},async t=>{
  const bundle=await esbuild.build({stdin:{loader:'tsx',resolveDir:root,contents:`
    import React from 'react';import {createRoot}from'react-dom/client';
    import Appearance from './src/app/components/page-appearance';
    import Artwork from './src/app/components/ascii-artwork';
    import {usePageAppearance}from'./src/app/components/use-page-appearance';
    function App(){const a=usePageAppearance('ascii-test','new-tab');return <>
      <div id="wallpaper" data-tone={a.asciiBackground?'dark':a.wallpaperTone} style={{position:'fixed',inset:0,backgroundImage:a.wallpaper?'url('+a.wallpaper.src+')':undefined}}>
        {a.asciiBackground&&<Artwork slug={a.asciiBackground}/>}</div>
      <main><h1>Where to, stargazer?</h1><input placeholder="Search all of Breadboard…" aria-label="Search"/><nav>Plan　 Organization　 Calendar　 Work Timer　 Profile　 Voice</nav><div className="garden">My gardens</div></main>
      <Appearance page="new-tab" ownerKey="ascii-test" triggerIcon="palette" placement="terminal"/>
    </>};createRoot(document.getElementById('root')).render(<App/>);
  `},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',outfile:'ascii.js'});
  const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
  const globals=fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8').replace(/^@import[^;]+;/gm,'');
  const db=new Database(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1)');
  const browser=await chromium.launch({headless:true,channel:'msedge'});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1440,height:960}}),requests=[],errors=[];
  let failCatalog=false;
  await context.route('https://ascii.test/**',route=>{
    const url=new URL(route.request().url());requests.push(url.pathname);
    if(url.pathname==='/app.js')return route.fulfill({contentType:'text/javascript',body:js});
    if(url.pathname==='/style.css')return route.fulfill({contentType:'text/css',body:globals+'\n'+css+`
      html{--font-source-sans:Arial;--font-schibsted:Arial;--bb-dock-height:42px}body{margin:0;background:#dce7d3}main{position:relative;padding:220px 220px 0;color:var(--ink);pointer-events:none}body:has(#wallpaper [data-ascii-artwork]) main{color:white}h1{font:600 40px Arial}main input{pointer-events:auto;width:650px;max-width:100%;padding:18px;border-radius:14px;background:var(--paper-surface);color:var(--ink);border:1px solid var(--line)}nav{margin:24px 0;font:14px Arial}.garden{margin-top:80px;padding:30px;background:var(--paper-surface);color:var(--ink);border-radius:14px;width:220px}
    `});
    if(url.pathname.startsWith('/ascii-magic-art/')||url.pathname.startsWith('/browser-wallpapers/')){
      if(failCatalog&&url.pathname.endsWith('/catalog.json'))return route.fulfill({status:503,body:'unavailable'});
      const file=path.join(root,'public',url.pathname);
      return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'image/webp',body:fs.readFileSync(file)});
    }
    if(url.pathname==='/api/profile/page-appearance'){
      if(route.request().method()==='PATCH'){const body=route.request().postDataJSON();return route.fulfill({json:{value:writeSavedBackground(db,1,body.page,body.theme,body.value)}});}
      return route.fulfill({json:{preferences:readSavedPageAppearance(db,1,'new-tab')}});
    }
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});
    return route.fulfill({contentType:'text/html',body:'<!doctype html><html data-theme="light"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script></html>'});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const screenshot=async name=>{if(process.env.BREADBOARD_ASCII_SCREENSHOTS){fs.mkdirSync(process.env.BREADBOARD_ASCII_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.BREADBOARD_ASCII_SCREENSHOTS,name+'.png')});}};
  await page.goto('https://ascii.test');
  await page.getByRole('button',{name:'Customize appearance'}).click();
  const panel=page.getByRole('dialog',{name:'Appearance',exact:true}),sources=panel.getByRole('group',{name:'Background source'});
  assert(!requests.some(p=>p.startsWith('/ascii-magic-art/')),'no ASCII runtime or catalog fetched before it is needed');
  for(const name of ['Generated','Human','ASCII'])await expect(sources.getByRole('button',{name,exact:true})).toBeAttached();
  failCatalog=true;await sources.getByRole('button',{name:'ASCII',exact:true}).click();
  await expect(panel.getByRole('alert')).toContainText('Couldn’t load the ASCII library');
  failCatalog=false;await panel.getByRole('button',{name:'Retry',exact:true}).click();
  const gallery=panel.getByRole('region',{name:'ASCII backgrounds'}),search=gallery.getByRole('textbox',{name:'Search ASCII backgrounds'});
  await expect(gallery.getByRole('status')).toHaveText('734 scenes');
  await expect(gallery.locator('.browser-wallpaper-option')).toHaveCount(18);
  await search.scrollIntoViewIfNeeded();await page.waitForTimeout(200);
  assert(requests.filter(p=>p.includes('/pieces/')).length<18,'offscreen cards do not download or paint all pieces');
  const tabs=await sources.getByRole('button').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().y));assert(tabs.every(y=>y===tabs[0]));
  await search.fill('moonlit sea');
  await expect(gallery.locator('.browser-wallpaper-option')).toHaveCount(1);
  const moon=gallery.getByRole('button',{name:'Moonlit Sea',exact:true});await expect(moon.locator('canvas')).toBeVisible();
  await moon.click();await expect.poll(()=>readSavedPageAppearance(db,1,'new-tab').light?.background).toBe('ascii:moonlit-sea');
  await expect(moon).toHaveAttribute('aria-pressed','true');
  await screenshot('appearance-ascii-light');
  await page.getByRole('button',{name:'Close appearance'}).click();
  const active=page.locator('#wallpaper canvas');await expect(active).toBeVisible();await expect(page.locator('#wallpaper')).toHaveAttribute('data-tone','dark');
  const frame=()=>active.evaluate(c=>c.toDataURL());
  const before=await frame();await page.waitForTimeout(450);assert.notEqual(await frame(),before,'the selected background really animates');
  await page.getByRole('textbox',{name:'Search',exact:true}).fill('Controls remain usable');
  const blurBefore=await frame();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.waitForTimeout(350);assert.notEqual(await frame(),blurBefore,'focus on another monitor does not pause animation');
  await screenshot('terminal-ascii-moonlit');
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);const still=await frame();await page.waitForTimeout(350);assert.equal(await frame(),still,'reduced motion produces a still');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('button',{name:'Customize appearance'}).click();await expect(sources.getByRole('button',{name:'ASCII',exact:true})).toHaveAttribute('aria-pressed','true');
  await search.fill('');await gallery.getByRole('combobox',{name:'ASCII category'}).selectOption('animals');await expect(gallery.getByRole('status')).toHaveText('20 scenes');
  await gallery.getByRole('combobox',{name:'ASCII category'}).selectOption('all');await gallery.getByRole('button',{name:'Show more',exact:true}).click();await expect(gallery.locator('.browser-wallpaper-option')).toHaveCount(36);
  await panel.getByRole('group',{name:'Background for',exact:true}).getByRole('button',{name:'Dark',exact:true}).click();
  await search.fill('digital rain');await gallery.getByRole('button',{name:'Digital Rain',exact:true}).click();await expect.poll(()=>readSavedPageAppearance(db,1,'new-tab').dark?.background).toBe('ascii:matrix-rain');
  assert.equal(readSavedPageAppearance(db,1,'new-tab').light.background,'ascii:moonlit-sea');
  await panel.getByRole('group',{name:'App theme',exact:true}).getByRole('button',{name:'Dark',exact:true}).click();
  await expect(page.locator('#wallpaper [data-ascii-artwork]')).toHaveAttribute('data-ascii-artwork','matrix-rain');
  await page.setViewportSize({width:375,height:812});await search.scrollIntoViewIfNeeded();assert.equal(await panel.evaluate(n=>n.scrollWidth>n.clientWidth),false);await screenshot('appearance-ascii-dark-narrow');
  await page.getByRole('button',{name:'Close appearance'}).click();await page.reload();
  await expect(page.locator('#wallpaper [data-ascii-artwork]')).toHaveAttribute('data-ascii-artwork','matrix-rain');await expect(active).toBeVisible();
  // A fresh browser origin copy must hydrate from the account store, not only localStorage.
  await page.evaluate(()=>localStorage.clear());await page.reload();await expect(page.locator('#wallpaper [data-ascii-artwork]')).toHaveAttribute('data-ascii-artwork','moonlit-sea');
  await page.getByRole('button',{name:'Customize appearance'}).click();await panel.getByRole('button',{name:'No image',exact:false}).click();await expect(page.locator('#wallpaper canvas')).toHaveCount(0);
  assert.deepEqual(errors,[]);
  t.diagnostic('ASCII catalog, lazy previews, real animation, focus continuity, light/dark saves, reload, category/search and reduced-motion checks passed.');
});

test('ASCII modules resolve from the page origin when the app chunk uses a separate asset origin', {timeout:30_000},async t=>{
  // Desktop redirects Next chunks to breadboard-assets://app/... . A root-relative
  // import inside that chunk resolves against the script, not the HTTP document.
  const bundle=await esbuild.build({stdin:{loader:'ts',resolveDir:root,contents:`
    import {asciiRuntime} from './src/lib/ascii-magic-client';
    window.startAscii=async()=>{
      const runtime=await asciiRuntime();const piece=await runtime.loadPiece('moonlit-sea');
      window.stopAscii=runtime.mount(document.querySelector('#art'),piece,{still:false,preview:false});
      return piece.meta.slug;
    };
  `},bundle:true,write:false,platform:'browser',format:'iife'});
  const browser=await chromium.launch({headless:true,channel:'msedge'});t.after(()=>browser.close());
  const context=await browser.newContext(),wrongOrigin=[];
  await context.route('https://assets.ascii.test/**',route=>{
    if(new URL(route.request().url()).pathname==='/_next/static/chunks/ascii.js')
      return route.fulfill({contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:bundle.outputFiles[0].text});
    wrongOrigin.push(route.request().url());return route.fulfill({status:404,body:'Not found'});
  });
  await context.route('https://ascii.test/**',route=>{
    const url=new URL(route.request().url());
    if(url.pathname.startsWith('/ascii-magic-art/'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'public',url.pathname))});
    return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="art"></div><script crossorigin="anonymous" src="https://assets.ascii.test/_next/static/chunks/ascii.js"></script>'});
  });
  const page=await context.newPage();await page.goto('https://ascii.test/new-tab');
  const result=await page.evaluate(async()=>{try{return await window.startAscii()}catch(e){return e.message}});
  assert.equal(result,'moonlit-sea','the player and its relative imports must use the document origin');
  assert.deepEqual(wrongOrigin,[],'no ASCII module may be requested from the redirected Next asset origin');
  const canvas=page.locator('#art canvas');await expect(canvas).toBeVisible();
  const first=await canvas.evaluate(c=>c.toDataURL());
  await expect.poll(()=>canvas.evaluate(c=>c.toDataURL())).not.toBe(first);
  await page.evaluate(()=>window.stopAscii());await expect(canvas).toHaveCount(0);
});
