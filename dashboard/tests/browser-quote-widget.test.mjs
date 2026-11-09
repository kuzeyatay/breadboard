import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import esbuild from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {BROWSER_DAILY_QUOTES,browserDailyQuote,browserQuoteAuthor,browserQuoteId,browserQuoteForChoice,validBrowserQuoteChoice} from '../src/app/browser/browser-daily-quotes.ts';
import {readBrowserQuoteChoice,writeBrowserQuoteChoice} from '../src/lib/browser-quote-store.ts';

const root=path.resolve(import.meta.dirname,'..');
const fixtureDb=()=>{const db=new Database(':memory:');db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2)');return db;};
test('quote choices use stable IDs and persist independently by account',t=>{
  const db=fixtureDb();t.after(()=>db.close());
  const ids=BROWSER_DAILY_QUOTES.map(browserQuoteId);
  assert.equal(new Set(ids).size,BROWSER_DAILY_QUOTES.length);
  assert.equal(readBrowserQuoteChoice(db,1),'daily');
  writeBrowserQuoteChoice(db,1,ids[3]);assert.equal(readBrowserQuoteChoice(db,1),ids[3]);assert.equal(readBrowserQuoteChoice(db,2),'daily');
  assert.equal(browserQuoteForChoice(ids[3]),BROWSER_DAILY_QUOTES[3]);
  assert(!validBrowserQuoteChoice('quote-missing'));assert(!validBrowserQuoteChoice(null));
  assert.throws(()=>writeBrowserQuoteChoice(db,1,'quote-missing'));assert.equal(readBrowserQuoteChoice(db,1),ids[3]);
  writeBrowserQuoteChoice(db,1,'daily');assert.equal(readBrowserQuoteChoice(db,1),'daily');
});

test('quote widget shows one daily quote without a picker or preference requests', {timeout:60_000},async t=>{
  const bundle=await esbuild.build({stdin:{loader:'tsx',resolveDir:root,contents:`
    import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import {BrowserDailyQuote}from'./src/app/browser/browser-personalization';
    import {DockPopover}from'./src/app/browser/browser-dock-popovers';
    import home from './src/app/new-tab/combined-home.module.css';
    function App(){const [panel,setPanel]=useState(null),owner=new URLSearchParams(location.search).get('owner')||'reader@test.local';return <main className={home.surface+' browser-home-widget-surface'}>
      <div className={home.chrome}><header>breadboard</header><div className={home.accessories}>
        <BrowserDailyQuote key={owner} ownerKey={owner}/>
        <DockPopover panel="network" open={panel==='network'} onOpenChange={open=>setPanel(open?'network':null)} trigger={<button className="fixture-dock">Online · Quick tools</button>}><p>Your connection is active.</p></DockPopover>
        <div className="fixture-dock">Calendar</div></div></div>
      <section className="fixture-main"><h1>Where to, stargazer?</h1><input aria-label="Search Breadboard" placeholder="Search all of Breadboard…"/></section>
    </main>};createRoot(document.getElementById('root')).render(<App/>);
  `},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',outfile:'quotes.js'});
  const script=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
  const globals=fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8').replace(/^@import[^;]+;/gm,'');
  const db=fixtureDb();t.after(()=>db.close());
  const browser=await chromium.launch({headless:true,channel:'msedge'});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1920,height:1080}});
  const quoteRequests=[];
  await context.route('https://quotes.test/**',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/app.js')return route.fulfill({contentType:'text/javascript',body:script});
    if(url.pathname==='/style.css')return route.fulfill({contentType:'text/css',body:globals+'\n'+css+`
      html{--font-source-sans:Arial;--font-schibsted:Arial}body{margin:0;background:#e5efe5}header{height:100px;padding:30px;box-sizing:border-box;background:var(--paper-surface);color:var(--ink);font:22px Arial}.fixture-dock{height:92px;border-radius:26px;border:1px solid var(--line);background:var(--paper-surface);color:var(--ink);padding:20px;font:16px Arial}.fixture-main{margin:60px auto;width:900px;max-width:90vw;color:var(--ink)}.fixture-main h1{font:600 36px Arial}.fixture-main input{width:100%;padding:18px;border-radius:16px;background:var(--paper-surface);color:var(--ink);border:1px solid var(--line)}
    `});
    if(url.pathname==='/api/profile/browser-quote'){
      quoteRequests.push(route.request().url());return route.fulfill({status:503,json:{error:'The quote widget must work offline'}});
    }
    return route.fulfill({contentType:'text/html',body:'<!doctype html><html data-theme="light"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script></html>'});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const screenshot=async name=>{if(process.env.BREADBOARD_QUOTE_SCREENSHOTS){fs.mkdirSync(process.env.BREADBOARD_QUOTE_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.BREADBOARD_QUOTE_SCREENSHOTS,name+'.png')});}};
  const date=new Date('2026-11-06T12:00:00Z');await page.clock.setFixedTime(date);
  // A stored picker choice from an older build must not override the daily widget.
  await context.addInitScript(()=>localStorage.setItem('breadboard:quote-choice:v1:reader@test.local',JSON.stringify({choice:'quote-obsolete',dirty:true})));
  await page.goto('https://quotes.test');
  const quote=page.getByRole('figure',{name:'Daily quote',exact:true});
  await expect(quote).toBeVisible();await expect(quote.locator('blockquote:visible')).toHaveCount(1);
  await expect(quote.locator('blockquote:visible')).toHaveText('“'+browserDailyQuote(date,'reader@test.local').quote+'”');
  await expect(quote.getByRole('button')).toHaveCount(0);assert.equal(await quote.getAttribute('tabindex'),null);
  await quote.click();await expect(page.getByRole('dialog',{name:'Quotes',exact:true})).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'Search quotes'})).toHaveCount(0);await screenshot('single-quote-light');
  await page.getByRole('button',{name:'Online · Quick tools'}).click();
  await expect(page.getByRole('dialog',{name:'Your connection',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await page.getByRole('textbox',{name:'Search Breadboard'}).fill('Keep the search usable');
  await page.setViewportSize({width:1280,height:800});await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await expect(quote.locator('blockquote:visible')).toHaveCount(1);
  await expect(quote.locator('blockquote:visible')).toHaveText('“'+browserDailyQuote(date,'reader@test.local',42).quote+'”');
  await screenshot('single-quote-compact-dark');
  const next=new Date('2026-11-07T12:00:00Z');await page.clock.setFixedTime(next);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(quote.locator('blockquote:visible')).toHaveText('“'+browserDailyQuote(next,'reader@test.local',42).quote+'”');
  await page.reload();await expect(quote.locator('blockquote:visible')).toHaveCount(1);
  // Anonymous credits remain visible in both layouts; named credits still match.
  for (const [width,height,limit] of [[1920,1080,Infinity],[1280,800,42]]) {
    await page.setViewportSize({width,height});
    await page.clock.setFixedTime(date);
    for (const anonymous of [false,true]) {
      let owner;
      for (let i=0;i<1000;i++) {
        const candidate='attribution-'+i;
        if ((!browserDailyQuote(date,candidate,limit).author)===anonymous) {owner=candidate;break;}
      }
      assert.ok(owner,'find a date/owner exercising the desired attribution');
      await page.goto('https://quotes.test/?owner='+owner);
      const expected=browserDailyQuote(date,owner,limit);
      await expect(quote.locator('blockquote:visible')).toHaveText('“'+expected.quote+'”');
      await expect(quote.locator('figcaption:visible')).toHaveCount(1);
      await expect(quote.locator('figcaption:visible')).toHaveText('— '+browserQuoteAuthor(expected));
    }
  }
  assert.deepEqual(quoteRequests,[],'daily quotes require no picker API or stored selection');
  assert.deepEqual(errors,[]);
});
