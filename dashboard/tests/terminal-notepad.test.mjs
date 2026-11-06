import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import Database from 'better-sqlite3';
import esbuild from 'esbuild';
import {chromium, expect} from '@playwright/test';
import {readTerminalNote, writeTerminalNote, listTerminalNotes, createTerminalNote, deleteTerminalNote} from '../src/lib/terminal-note-store.ts';
import {NOTE_BODY_LIMIT} from '../src/lib/terminal-note.ts';

const database=()=>{
  const db=new Database(':memory:');
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2)');
  return db;
};
test('notes are durable, account-scoped and reject stale writes without losing either draft',()=>{
  const db=database();
  try {
    assert.equal(readTerminalNote(db,1).revision,0);
    const first=writeTerminalNote(db,1,{title:'Ideas',body:'First line\nSecond line'},0);
    assert(first.ok);assert.equal(first.note.revision,1);
    assert.equal(writeTerminalNote(db,1,{title:'Ideas',body:'First line\nSecond line'},0).note.revision,1,'replayed successful writes are idempotent');
    const stale=writeTerminalNote(db,1,{title:'Another tab',body:'Keep me'},0);
    assert.equal(stale.ok,false);assert.equal(stale.note.body,'First line\nSecond line');
    assert.equal(readTerminalNote(db,2).body,'');
    assert.equal(writeTerminalNote(db,1,{title:'Ideas',body:'New text'},1).note.revision,2);
    assert.throws(()=>writeTerminalNote(db,1,{title:'Too much',body:'x'.repeat(NOTE_BODY_LIMIT+1)},2));
    assert.equal(readTerminalNote(db,1).body,'New text');
  } finally {db.close();}
});

test('existing notes migrate once; multiple notes are isolated, idempotent and cannot be resurrected',()=>{
  const db=database();
  try {
    db.exec(`CREATE TABLE terminal_notepad(user_id INTEGER PRIMARY KEY,title TEXT,body TEXT,revision INTEGER,updated_at TEXT);
      INSERT INTO terminal_notepad VALUES(1,'Existing note','Keep my original writing',7,'2026-11-06T09:00:00Z');`);
    assert.equal(readTerminalNote(db,1).body,'Keep my original writing');
    assert.equal(readTerminalNote(db,1).revision,7);
    assert.equal(listTerminalNotes(db,1).length,1);
    createTerminalNote(db,1,'second-note',{title:'Separate',body:'Second text'});
    createTerminalNote(db,1,'second-note',{title:'Duplicate request',body:'Must not replace text'});
    assert.equal(listTerminalNotes(db,1).length,2);
    assert.equal(readTerminalNote(db,1,'second-note').body,'Second text');
    assert.equal(readTerminalNote(db,2,'second-note'),null);
    assert.equal(writeTerminalNote(db,2,{title:'Wrong owner',body:'No'},0,'second-note').ok,false);
    assert.equal(deleteTerminalNote(db,1,'default',6),false,'stale delete preserves concurrent edits');
    assert.equal(deleteTerminalNote(db,1,'default',7),true);
    assert.equal(readTerminalNote(db,1,'default'),null);
    assert.equal(writeTerminalNote(db,1,{title:'Late save',body:'Should stay deleted'},7).ok,false);
    assert.equal(deleteTerminalNote(db,1,'second-note',0),true);
    assert.deepEqual(listTerminalNotes(db,1),[]);
    assert.equal(createTerminalNote(db,1,'second-note'),null,'replayed creation does not resurrect deleted notes');
    assert.equal(listTerminalNotes(db,2).length,1,'another account keeps its own note');
  } finally {db.close();}
});

test('Terminal notepad edits, autosaves, drags, expands and survives reloads and competing tabs', {timeout:90_000},async t=>{
  const root=path.resolve(import.meta.dirname,'..');
  const bundle=await esbuild.build({stdin:{loader:'tsx',resolveDir:root,contents:`
    import React,{useRef} from 'react';import{createRoot}from'react-dom/client';
    import Notepad from './src/app/new-tab/new-tab-notepad';
    function App(){const top=useRef(null);return <>
      <header ref={top} className="top">breadboard <span>Terminal</span></header>
      <main><h1>Where to, stargazer?</h1><p>A quiet place to think.</p></main>
      <Notepad key={location.search} ownerKey={new URLSearchParams(location.search).get('owner')||'notes@test.local'} topAnchorRef={top}/>
      <footer className="terminal">Terminal</footer></>}
    createRoot(document.getElementById('root')).render(<App/>);
  `},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',outfile:'note.js'});
  const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
  const globals=fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8').replace(/^@import[^;]+;/gm,'');
  const db=database();t.after(()=>db.close());
  let failSave=false,holdWrites=false;const pending=[];const requests=[];
  const handler=async(req,res)=>{
    const url=new URL(req.url,'http://local');requests.push(url.pathname);
    if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(js)}
    if(url.pathname==='/api/profile/terminal-note'){
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      const owner=url.searchParams.get('ownerKey'),id=owner==='notes@test.local'?1:owner==='other@test.local'?2:0;
      if(!id){res.statusCode=403;return res.end('{}')}
      const noteId=url.searchParams.get('id')||'default';
      if(req.method==='GET'){
        if(url.searchParams.get('list')==='1')return res.end(JSON.stringify({notes:listTerminalNotes(db,id)}));
        const note=readTerminalNote(db,id,noteId);res.statusCode=note?200:404;return res.end(JSON.stringify({note}));
      }
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=JSON.parse(Buffer.concat(chunks).toString());
      if(req.method==='POST')return res.end(JSON.stringify({note:createTerminalNote(db,id,body.id,body)}));
      if(req.method==='DELETE'){const ok=deleteTerminalNote(db,id,noteId,body.revision);res.statusCode=ok?200:409;return res.end(JSON.stringify({ok}));}
      const finish=()=>{if(failSave){res.statusCode=503;return res.end('{}')}
        const result=writeTerminalNote(db,id,body,body.revision,noteId);res.statusCode=result.ok?200:409;res.end(JSON.stringify(result));};
      if(holdWrites){pending.push({body,finish});return}return finish();
    }
    res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html data-theme="light"><head><style>${globals}\n${css}
      html{--font-source-sans:Arial;--font-schibsted:Arial;--bb-dock-height:42px}body{margin:0;background:radial-gradient(at 30% 20%,#dce7d3,#b0c6bb)}
      .top{position:fixed;inset:0 0 auto;height:140px;box-sizing:border-box;padding:32px;background:var(--paper-surface);color:var(--ink);font:22px Arial;z-index:30}.top span{float:right;font-size:14px}
      main{height:1600px;padding-top:220px;text-align:center;color:var(--ink);font:18px Arial}h1{font-size:36px}
      .terminal{position:fixed;inset:auto 0 0;height:42px;background:var(--terminal-bar);z-index:70;text-align:center;padding-top:10px;box-sizing:border-box;color:var(--terminal-bar-ink)}
    </style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
  };
  const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
  const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,channel:'msedge'});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1440,height:960}});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const panel=page.locator('[data-terminal-notepad]'),title=page.getByRole('textbox',{name:'Note title'}),editor=page.getByRole('textbox',{name:'Note text'});
  const screenshot=async name=>{if(process.env.BREADBOARD_NOTEPAD_SCREENSHOT_DIR){fs.mkdirSync(process.env.BREADBOARD_NOTEPAD_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.BREADBOARD_NOTEPAD_SCREENSHOT_DIR,name+'.png')})}};
  await page.goto(base);await expect(panel).toHaveAttribute('data-ready','true');
  await expect(panel).toHaveAttribute('data-collapsed','true');await expect(editor).toBeHidden();
  assert.equal((await panel.boundingBox()).width,220);await screenshot('minimal-startup');
  await page.getByRole('button',{name:'Open notepad'}).click();await expect(page.getByRole('status')).toHaveText('All changes saved');
  const initial=await panel.boundingBox();assert.equal(initial.x,24);assert.equal(initial.width,304);assert(initial.y>=148&&initial.y<190);
  await title.fill('A few things to remember');await editor.fill('Leave room for a good idea.\n\nThe small details make the whole day better.');
  await expect.poll(()=>readTerminalNote(db,1).body).toContain('small details');await expect(editor).toBeFocused();
  await screenshot('compact-light');
  const savedText=await editor.inputValue();await page.keyboard.press('Control+End');await page.keyboard.insertText(' Added text');await page.keyboard.press('Control+z');await expect(editor).toHaveValue(savedText);
  await page.getByRole('button',{name:'Enlarge notepad'}).click();await expect(panel).toHaveAttribute('data-enlarged','true');
  await expect.poll(async()=>(await panel.boundingBox()).width).toBe(560);await expect(editor).toHaveValue(savedText);await screenshot('enlarged-light');
  const handle=page.getByRole('button',{name:'Move notepad'}),box=await handle.boundingBox();
  await page.mouse.move(box.x+80,box.y+16);await page.mouse.down();await page.mouse.move(box.x+280,box.y+96,{steps:8});await page.mouse.up();
  const moved=await panel.boundingBox();assert(Math.abs(moved.x-initial.x-200)<2);assert(Math.abs(moved.y-initial.y-80)<2);
  await page.evaluate(()=>window.scrollTo(0,600));const scrolled=await panel.boundingBox();assert.equal(scrolled.y,moved.y,'notepad remains usable while the Terminal page scrolls');
  await handle.focus();await page.keyboard.press('Shift+ArrowLeft');assert.equal((await panel.boundingBox()).x,moved.x-32);
  await page.getByRole('button',{name:'Minimize notepad'}).click();await expect(editor).toBeHidden();await expect.poll(async()=>(await panel.boundingBox()).height).toBeLessThan(70);
  await page.reload();await expect(panel).toHaveAttribute('data-collapsed','true');await page.getByRole('button',{name:'Open notepad'}).click();await expect(editor).toHaveValue(savedText);await expect(panel).toHaveAttribute('data-enlarged','true');
  await page.getByRole('button',{name:'Make notepad compact'}).click();await expect.poll(async()=>(await panel.boundingBox()).width).toBe(304);
  await page.getByRole('button',{name:'Enlarge notepad'}).click();
  await page.setViewportSize({width:375,height:700});await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await expect.poll(async()=>{const b=await panel.boundingBox();return b.x>=12&&b.x+b.width<=363&&b.y+b.height<=646}).toBe(true);
  await screenshot('enlarged-dark-narrow');
  await page.setViewportSize({width:1440,height:960});
  failSave=true;await editor.fill('An offline draft must not disappear');await expect(page.getByRole('alert')).toContainText('Couldn’t sync');
  await page.reload();await expect(panel).toHaveAttribute('data-collapsed','true');await page.getByRole('button',{name:'Open notepad'}).click();await expect(editor).toHaveValue('An offline draft must not disappear');await expect(page.getByRole('alert')).toContainText('Couldn’t sync');
  failSave=false;await page.getByRole('button',{name:'Retry',exact:true}).click();await expect.poll(()=>readTerminalNote(db,1).body).toBe('An offline draft must not disappear');
  const second=await context.newPage();await second.goto(base);await second.getByRole('button',{name:'Open notepad'}).click();const editor2=second.getByRole('textbox',{name:'Note text'});await expect(editor2).toHaveValue('An offline draft must not disappear');
  await editor.fill('Shared across Terminal tabs');await expect(editor2).toHaveValue('Shared across Terminal tabs');
  holdWrites=true;await editor.fill('First tab draft');await editor2.fill('Second tab draft');
  await expect.poll(()=>pending.length).toBe(2);holdWrites=false;
  pending.find(p=>p.body.body==='First tab draft').finish();pending.find(p=>p.body.body==='Second tab draft').finish();
  await expect(second.getByRole('alert')).toContainText('changed in another tab');await expect(editor2).toHaveValue('Second tab draft');
  await second.getByRole('button',{name:'Keep my version'}).click();await expect.poll(()=>readTerminalNote(db,1).body).toBe('Second tab draft');await expect(editor).toHaveValue('Second tab draft');
  await page.getByRole('button',{name:'Notes menu'}).click();await page.getByRole('menuitem',{name:'New note',exact:true}).click();
  await expect(title).toHaveValue('');await expect(title).toBeFocused();
  await title.fill('Second note');await editor.fill('A different thought');
  await expect.poll(()=>listTerminalNotes(db,1).length).toBe(2);
  await expect(page.getByRole('status')).toHaveText('All changes saved');
  const secondId=listTerminalNotes(db,1).find(n=>n.title==='Second note').id;
  await page.getByRole('button',{name:'Notes menu'}).click();await screenshot('notes-menu');
  await page.keyboard.press('Escape');await expect(page.getByRole('menu')).toBeHidden();
  await expect(page.getByRole('button',{name:'Notes menu'})).toBeFocused();
  holdWrites=true;await editor.fill('First save in flight');await expect.poll(()=>pending.length).toBe(3);
  await editor.fill('Latest text typed during the save');
  await page.getByRole('button',{name:'Notes menu'}).click();
  await page.getByRole('menuitem').filter({hasText:'A few things to remember'}).click();
  await expect(editor).toHaveValue('Second tab draft');
  holdWrites=false;pending[2].finish();
  await expect.poll(()=>readTerminalNote(db,1,secondId).body).toBe('Latest text typed during the save');
  await page.getByRole('button',{name:'Notes menu'}).click();await page.getByRole('menuitem').filter({hasText:'Second note'}).click();
  await expect(editor).toHaveValue('Latest text typed during the save');
  await page.reload();await expect(panel).toHaveAttribute('data-collapsed','true');await expect(editor).toBeHidden();
  await page.getByRole('button',{name:'Open notepad'}).click();await expect(editor).toHaveValue('Latest text typed during the save');
  // Return to a note before its previous save completes, then keep editing offline.
  holdWrites=true;await editor.fill('Older save still in flight');await expect.poll(()=>pending.length).toBe(4);
  await page.getByRole('button',{name:'Notes menu'}).click();await page.getByRole('menuitem').filter({hasText:'A few things to remember'}).click();
  await expect(editor).toHaveValue('Second tab draft');
  await page.getByRole('button',{name:'Notes menu'}).click();await page.getByRole('menuitem').filter({hasText:'Second note'}).click();
  await expect(editor).toHaveValue('Older save still in flight');
  await editor.fill('Newer draft after returning');await expect.poll(()=>pending.length).toBe(5);
  failSave=true;pending[4].finish();await expect(page.getByRole('alert')).toContainText('Couldn’t sync');
  failSave=false;holdWrites=false;pending[3].finish();
  await expect(page.getByRole('alert')).toContainText('changed in another tab');
  await expect(editor).toHaveValue('Newer draft after returning');
  assert.equal(await page.evaluate(id=>{
    const tab=sessionStorage.getItem('breadboard:terminal-note-tab');
    return JSON.parse(localStorage.getItem('breadboard:terminal-note:v1:notes@test.local:'+id+':draft:'+tab)).note.body;
  },secondId),'Newer draft after returning','late saves cannot erase a newer offline backup');
  await page.getByRole('button',{name:'Keep my version'}).click();await expect(page.getByRole('status')).toHaveText('All changes saved');
  await second.getByRole('button',{name:'Notes menu'}).click();await second.getByRole('menuitem').filter({hasText:'Second note'}).click();
  await expect(editor2).toHaveValue('Newer draft after returning');
  await page.getByRole('button',{name:'Notes menu'}).click();await page.getByRole('menuitem',{name:'Delete current note'}).click();
  await expect(page.getByText('Delete this note? This cannot be undone.')).toBeVisible();
  await page.getByRole('menuitem',{name:'Cancel',exact:true}).click();assert(readTerminalNote(db,1,secondId));
  await page.getByRole('menuitem',{name:'Delete current note'}).click();await page.getByRole('menuitem',{name:'Confirm delete',exact:true}).click();
  await expect.poll(()=>listTerminalNotes(db,1).length).toBe(1);await expect(editor).toHaveValue('Second tab draft');
  assert.equal(readTerminalNote(db,1,secondId),null);
  await expect(second.getByRole('alert')).toContainText('deleted in another tab');
  await expect(editor2).toHaveValue('Newer draft after returning');
  await second.goto(base+'/?owner=other@test.local');await second.getByRole('button',{name:'Open notepad'}).click();await expect(second.getByRole('textbox',{name:'Note text'})).toHaveValue('');
  const restarted=http.createServer(handler);await new Promise(resolve=>restarted.listen(0,'127.0.0.1',resolve));
  t.after(()=>{restarted.closeAllConnections();return new Promise(resolve=>restarted.close(resolve))});
  await page.goto(`http://127.0.0.1:${restarted.address().port}`);await page.getByRole('button',{name:'Open notepad'}).click();await expect(editor).toHaveValue('Second tab draft');
  assert(!requests.some(url=>url.startsWith('/api/plan')),'the notepad no longer loads or mutates tasks');
  assert.deepEqual(errors,[]);
});
