import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import esbuild from 'esbuild';
import Database from 'better-sqlite3';
import {chromium,expect} from '@playwright/test';
import {normalizeShortcutOrder,orderedShortcuts,validShortcutOrder} from '../src/lib/shortcut-order.ts';
import {readShortcutOrder,writeShortcutOrder} from '../src/lib/shortcut-order-store.ts';
import {readShortcutEdits,writeShortcutEdits} from '../src/lib/shortcut-edits-store.ts';
import {applyShortcutEdits,validShortcutEdits} from '../src/lib/shortcut-edits.ts';

test('shortcut edits persist per account, reject unsafe addresses and preserve source identity',()=>{
  const db=new Database(':memory:');db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2)');
  try {
    const items=[{label:'Mail',url:'https://mail.google.com'},{label:'GitHub',url:'https://github.com'}];
    writeShortcutEdits(db,1,[{sourceUrl:items[0].url,hidden:true},{sourceUrl:items[1].url,label:'Code',url:'https://github.com/explore'}]);
    assert.deepEqual(readShortcutEdits(db,2),[]);
    const visible=applyShortcutEdits(items,readShortcutEdits(db,1));
    assert.equal(visible.length,1);assert.equal(visible[0].sourceUrl,'https://github.com/');
    assert.equal(visible[0].label,'Code');assert.equal(visible[0].url,'https://github.com/explore');
    assert(!validShortcutEdits([{sourceUrl:items[1].url,label:'Bad',url:'javascript:alert(1)'}]));
    assert(!validShortcutEdits([{sourceUrl:'https://user:secret@example.com',hidden:true}]));
    assert(!validShortcutEdits([{sourceUrl:items[1].url,label:'',url:items[1].url}]));
    assert.throws(()=>writeShortcutEdits(db,1,Array(33).fill({sourceUrl:items[0].url,hidden:true})));
  } finally { db.close(); }
});

test('shortcut order is account-scoped, normalizes URLs and keeps new shortcuts available',()=>{
  const db=new Database(':memory:');db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2)');
  try{
    assert.deepEqual(readShortcutOrder(db,1),[]);
    assert.deepEqual(writeShortcutOrder(db,1,['https://x.com','https://github.com','https://x.com/']),['https://x.com/','https://github.com/']);
    assert.deepEqual(readShortcutOrder(db,2),[]);
    assert(!validShortcutOrder(['javascript:alert(1)']));assert(!validShortcutOrder(['https://user:password@example.com']));
    assert.throws(()=>writeShortcutOrder(db,1,Array(33).fill('https://x.com')));
    const items=[{url:'https://github.com',label:'GitHub'},{url:'https://x.com',label:'X'},{url:'https://new.example',label:'New'}];
    assert.deepEqual(orderedShortcuts(items,readShortcutOrder(db,1)).map(x=>x.label),['X','GitHub','New']);
    assert.deepEqual(normalizeShortcutOrder([null,'not a URL','https://x.com','https://x.com/']),['https://x.com/']);
  }finally{db.close()}
});

test('shortcuts drag across rows, persist, sync and keep Add shortcut fixed at the right edge',{timeout:90_000},async t=>{
  const root=path.resolve(import.meta.dirname,'..');
  const bundle=await esbuild.build({stdin:{loader:'tsx',resolveDir:root,contents:`
    import React from 'react';import{createRoot}from'react-dom/client';
    import{BrowserQuickLinks}from'./src/app/browser/browser-home-widgets';
    import home from './src/app/new-tab/combined-home.module.css';
    const owner=new URLSearchParams(location.search).get('owner')||'one@test.local';
    window.navigations=[];
    createRoot(document.getElementById('root')).render(<main className={home.surface+' browser-home-widget-surface'}>
      <section className={home.launcher}><BrowserQuickLinks ownerKey={owner} navigate={url=>window.navigations.push(url)}/></section>
    </main>);
  `},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',outfile:'shortcuts.js'});
  const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
  const globals=fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8').replace(/^@import[^;]+;/gm,'');
  const db=new Database(':memory:');db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2)');t.after(()=>db.close());
  let custom=[{title:'X',url:'https://x.com/'},{title:'Figma',url:'https://figma.com/'}],failSave=false;
  const handler=async(req,res)=>{
    const url=new URL(req.url,'http://local');
    if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(js)}
    if(url.pathname==='/api/profile/shortcut-order'){
      const id=url.searchParams.get('ownerKey')==='two@test.local'?2:1;
      res.setHeader('Content-Type','application/json');
      if(req.method==='GET')return res.end(JSON.stringify({order:readShortcutOrder(db,id)}));
      if(failSave){res.statusCode=503;return res.end('{}')}
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      return res.end(JSON.stringify({order:writeShortcutOrder(db,id,JSON.parse(Buffer.concat(chunks)).order)}));
    }
    if(url.pathname==='/api/profile/shortcut-edits'){
      const id=url.searchParams.get('ownerKey')==='two@test.local'?2:1;
      res.setHeader('Content-Type','application/json');
      if(req.method==='GET')return res.end(JSON.stringify({edits:readShortcutEdits(db,id)}));
      if(failSave){res.statusCode=503;return res.end('{}')}
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      return res.end(JSON.stringify({edits:writeShortcutEdits(db,id,JSON.parse(Buffer.concat(chunks)).edits)}));
    }
    if(url.pathname==='/fixture/shortcuts'){
      if(req.method==='POST'){const chunks=[];for await(const chunk of req)chunks.push(chunk);custom=JSON.parse(Buffer.concat(chunks));}
      res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(custom));
    }
    if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');return res.end('{}')}
    res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html data-theme="light"><style>${globals}\n${css}
      body{margin:0;background:#e4eee4}html{--font-source-sans:Arial;--font-schibsted:Arial}
      main{padding:90px 24px;min-height:100vh}section{max-width:1024px;margin:auto}
      /* Tailwind's utility sheet is normally supplied by the app build. */
      .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    </style><div id="root"></div><script>
      window.breadboardDesktop={getBrowserShortcuts:()=>fetch('/fixture/shortcuts').then(r=>r.json()),setBrowserShortcuts:(_owner,items)=>fetch('/fixture/shortcuts',{method:'POST',body:JSON.stringify(items)}).then(r=>r.ok)};
    </script><script src="/app.js"></script></html>`);
  };
  const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()});
  const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,channel:'msedge'});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1440,height:900},permissions:['clipboard-read','clipboard-write']});
  await context.route('https://**/*',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#c68f45"/></svg>'}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);
  const grid=page.locator('.browser-quick-links'),links=grid.locator('[data-shortcut-url]'),add=grid.getByRole('button',{name:'Add shortcut',exact:true});
  const names=()=>links.evaluateAll(nodes=>nodes.map(n=>n.innerText.trim()));
  const target=name=>grid.getByRole('button',{name,exact:true});
  const fixedAdd=async()=>{
    // Resize and pointer-release CSS transitions settle asynchronously. Read
    // both rectangles in one frame rather than mixing two viewport layouts.
    await expect.poll(()=>grid.evaluate(node=>{
      const g=node.getBoundingClientRect(),a=node.querySelector('.browser-add-shortcut').getBoundingClientRect();
      return Math.abs(a.right-g.right)<1 && Math.abs(a.top-g.top)<1;
    }),{message:'Add stays in the first row at the right edge'}).toBe(true);
    assert.equal(await add.getAttribute('draggable'),'false');
  };
  const dragBefore=async(from,to)=>{await expect(target(from)).toHaveAttribute('draggable','true');await target(from).dragTo(target(to),{targetPosition:{x:8,y:20}});};
  await expect(links).toHaveCount(8);await expect(target('Mail')).toHaveAttribute('draggable','true');await fixedAdd();
  const initial=await names();assert.deepEqual(initial,['Mail','YouTube','GitHub','ChatGPT','Drive','Notion','X','Figma']);
  await dragBefore('Figma','Mail');await expect.poll(names).toEqual(['Figma',...initial.slice(0,-1)]);await fixedAdd();
  assert.equal(readShortcutOrder(db,1)[0],'https://figma.com/');assert.deepEqual(await page.evaluate(()=>window.navigations),[],'dragging must not navigate');
  await dragBefore('GitHub','YouTube');await expect.poll(names).toEqual(['Figma','Mail','GitHub','YouTube','ChatGPT','Drive','Notion','X']);
  const saved=await names();await page.reload();await expect.poll(names).toEqual(saved);await fixedAdd();
  const second=await context.newPage();await second.goto(base);await expect.poll(()=>second.locator('[data-shortcut-url]').allTextContents()).toEqual(saved);
  await target('X').focus();await page.keyboard.press('Alt+Shift+ArrowLeft');
  await expect.poll(names).toEqual(['Figma','Mail','GitHub','YouTube','ChatGPT','Drive','X','Notion']);
  await expect.poll(()=>second.locator('[data-shortcut-url]').allTextContents()).toEqual(await names());
  const stable=await names();failSave=true;await dragBefore('Mail','Drive');await expect(page.getByRole('alert')).toContainText('shortcut order');
  await expect.poll(names).toEqual(stable);failSave=false;await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(target('Mail')).toHaveAttribute('draggable','true');
  // Dropping on Add does not reorder it or accidentally open the editor.
  await target('Mail').dragTo(add);await expect.poll(names).toEqual(stable);await fixedAdd();await expect(page.locator('dialog')).not.toBeVisible();
  await page.setViewportSize({width:375,height:812});await fixedAdd();await expect(links).toHaveCount(8);
  await dragBefore('Notion','Figma');await expect.poll(names).toEqual(['Notion',...stable.slice(0,-1)]);await fixedAdd();
  if(process.env.BREADBOARD_SHORTCUT_SCREENSHOTS){fs.mkdirSync(process.env.BREADBOARD_SHORTCUT_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.BREADBOARD_SHORTCUT_SCREENSHOTS,'shortcuts-narrow.png')});}
  await page.setViewportSize({width:1440,height:900});await fixedAdd();
  if(process.env.BREADBOARD_SHORTCUT_SCREENSHOTS)await page.screenshot({path:path.join(process.env.BREADBOARD_SHORTCUT_SCREENSHOTS,'shortcuts-wide.png')});
  await add.click();await page.getByLabel('Name',{exact:true}).fill('Example');await page.getByLabel('Website',{exact:true}).fill('example.org');
  await page.locator('dialog').getByRole('button',{name:'Add shortcut',exact:true}).click();await expect(links).toHaveCount(9);await fixedAdd();
  await page.waitForTimeout(300);await target('GitHub').click();assert.equal((await page.evaluate(()=>window.navigations)).at(-1),'https://github.com');
  const beforeRestart=await names();const restarted=http.createServer(handler);await new Promise(r=>restarted.listen(0,'127.0.0.1',r));t.after(()=>{restarted.closeAllConnections();restarted.close()});
  await page.goto(`http://127.0.0.1:${restarted.address().port}`);await expect.poll(names).toEqual(beforeRestart);
  await page.goto(base+'/?owner=two@test.local');await expect.poll(names).toEqual([...initial,'Example']);assert.deepEqual(readShortcutOrder(db,2),[]);
  await page.goto(base);await expect.poll(names).toEqual(beforeRestart);
  const menu=async(name)=>{await target(name).click({button:'right'});await expect(page.getByRole('menu')).toBeVisible();};
  const action=label=>page.getByRole('menuitem',{name:label,exact:true});

  await menu('Mail');await action('Copy link').click();
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe('https://mail.google.com');
  await menu('Mail');await action('Delete shortcut').click();await expect(target('Mail')).toHaveCount(0);
  await expect.poll(()=>second.locator('[data-shortcut-url]').allTextContents()).toEqual(await names());
  await page.reload();await expect(target('Mail')).toHaveCount(0);await expect(target('GitHub')).toHaveAttribute('draggable','true');
  const originalIndex=(await names()).indexOf('GitHub');
  await menu('GitHub');await action('Edit shortcut').click();
  await expect(page.getByLabel('Name',{exact:true})).toHaveValue('GitHub');
  await page.getByLabel('Name',{exact:true}).fill('Code');await page.getByLabel('Website',{exact:true}).fill('https://github.com/explore');
  await page.locator('dialog').getByRole('button',{name:'Save changes'}).click();
  await expect(target('Code')).toBeVisible();assert.equal((await names()).indexOf('Code'),originalIndex);
  assert.equal(await target('Code').getAttribute('data-shortcut-url'),'https://github.com/explore');
  await dragBefore('Code','Notion');await expect.poll(()=>names().then(values=>values[0])).toBe('Code');
  await page.reload();await expect.poll(names).toEqual(['Code',...beforeRestart.filter(name=>!['Mail','GitHub'].includes(name))]);
  await menu('Figma');await action('Delete shortcut').click();await expect(target('Figma')).toHaveCount(0);
  // Failed saves leave the shortcut in place and show an actionable error.
  failSave=true;await menu('YouTube');await action('Delete shortcut').click();
  await expect(page.getByRole('alert')).toContainText('shortcut changes');await expect(target('YouTube')).toBeVisible();
  failSave=false;await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(target('YouTube')).toHaveAttribute('draggable','true');
  assert.equal(await page.evaluate(()=>window.navigations.length),0,'menu actions must not navigate');
  // Desktop new-tab uses the browser command, not the app-only 'open' route.
  await page.evaluate(()=>{
    window.desktopCommands=[];
    window.breadboardDesktop.getTabsState=async()=>({enabled:true,tabs:[],activeId:0,selfId:0,revision:1});
    window.breadboardDesktop.onTabsState=()=>()=>{};
    window.breadboardDesktop.tabs=async command=>{window.desktopCommands.push(command);return true;};
  });
  await menu('Code');await action('Open in new tab').click();
  assert.deepEqual((await page.evaluate(()=>window.desktopCommands)).at(-1),{type:'browser',url:'https://github.com/explore'});
  await menu('Code');await action('Open').click();assert.equal((await page.evaluate(()=>window.navigations)).at(-1),'https://github.com/explore');
  await menu('Code');await page.keyboard.press('Escape');await expect(page.getByRole('menu')).toHaveCount(0);
  // Deleted built-ins can be restored with Add shortcut.
  await add.click();await page.getByLabel('Name',{exact:true}).fill('Inbox');await page.getByLabel('Website',{exact:true}).fill('mail.google.com');
  await page.locator('dialog').getByRole('button',{name:'Add shortcut',exact:true}).click();await expect(target('Inbox')).toBeVisible();await fixedAdd();
  const changed=await names();await page.goto(`http://127.0.0.1:${restarted.address().port}`);await expect.poll(names).toEqual(changed);
  await page.goto(base+'/?owner=two@test.local');await expect.poll(names).toEqual([...initial,'Example']);
  assert.deepEqual(readShortcutEdits(db,2),[]);
  custom=Array.from({length:8},(_,i)=>({title:'Custom '+i,url:'https://custom'+i+'.example/'}));
  await page.reload();await expect(target('Custom 7')).toHaveAttribute('draggable','true');
  await menu('Custom 0');await action('Delete shortcut').click();await expect(target('Custom 0')).toHaveCount(0);
  await add.click();await page.getByLabel('Name',{exact:true}).fill('Replacement');await page.getByLabel('Website',{exact:true}).fill('replacement.example');
  await page.locator('dialog').getByRole('button',{name:'Add shortcut',exact:true}).click();await expect(target('Replacement')).toBeVisible();
  assert.equal(custom.length,8,'deleting a custom shortcut frees a slot');await fixedAdd();
  assert.deepEqual(errors,[]);
});
