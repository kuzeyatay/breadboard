import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { chromium } from "playwright";
import { tabSplitDropTarget } from "../src/lib/desktop-tab-drag.ts";

test("split hit testing requires a different compatible tab inside the content area", () => {
  const tabs = [{ id: 1 }, { id: 2 }, { id: 3, browser: { private: true } }];
  assert.equal(tabSplitDropTarget(tabs, 2, 1, 200, 200, 1000, 700, 32), "left");
  assert.equal(tabSplitDropTarget(tabs, 2, 1, 700, 200, 1000, 700, 32), "right");
  for (const [id, target, x, y] of [[1, 1, 100, 200], [2, null, 100, 200], [3, 1, 100, 200], [2, 1, -1, 200], [2, 1, 1001, 200], [2, 1, 100, 710], [2, 1, 100, 60]]) {
    assert.equal(tabSplitDropTarget(tabs, id, target, x, y, 1000, 700, 32), null);
  }
});

test("pointer splits, cancellation and shared browser pane containment", { timeout: 60_000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await esbuild.build({ stdin: { resolveDir: root, loader: "tsx", contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import TitleBar from './src/app/components/desktop-title-bar';
    import BrowserTabPanes from './src/app/browser/browser-tab-panes';
    import {useDesktopTabs} from './src/app/components/use-desktop-tabs';
    import {splitTabs} from '../desktop/src/main/tab-split';
    const listeners=new Set();window.commands=[];
    window.publish=()=>{window.state=structuredClone(window.state);for(const fn of listeners)fn(window.state)};
    window.reset=()=>{window.state={enabled:true,persistentShell:true,contentHeight:700,activeId:1,selfId:1,extensions:[],groups:[],tabs:[1,2,3].map(id=>({id,title:['Documentation','Notes','New tab'][id-1],url:'http://test/'+id,loading:false,browser:{uiVisited:true,address:'http://test/'+id}}))};window.publish()};
    window.reset();
    window.breadboardDesktop={getTabsState:async()=>window.state,onTabsState:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},tabs:async command=>{
      window.commands.push(command);
      if(command.type==='activate')window.state.activeId=command.id;
      if(command.type==='split-tabs')splitTabs(window.state,command.id,command.targetId,command.side,{id:'pair',name:'Reading',color:'green',collapsed:false});
      window.publish();return true;
    }};
    function Content({tab}){const [count,setCount]=useState(0);return <><div style={{height:103,flexShrink:0}}/><main style={{flex:1,padding:'42px 56px',background:tab.id===1?'#edf2e8':'#f4ede2'}}><small>WORKSPACE</small><h1>{tab.title}</h1><p>Two pages, side by side.</p><input aria-label={'Draft '+tab.id} defaultValue={'Draft '+tab.id}/><button onClick={()=>setCount(count+1)}>Clicked {count}</button><aside className='pane-rail' style={{position:'absolute',left:0,top:103,bottom:0,width:40,background:'#dce4d6'}}>◈</aside></main></>}
    function App(){const s=useDesktopTabs();return <><TitleBar shell/><div style={{height:103,background:'#f7f5ec',padding:28,borderBottom:'1px solid #d8dacd'}}>Address and search</div><div className='browser-shell' style={{position:'absolute',top:32,bottom:0,left:0,right:0,overflow:'hidden',zIndex:-1}}>{s&&<BrowserTabPanes state={s}>{tab=><Content tab={tab}/>}</BrowserTabPanes>}</div></>}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NEXT_PUBLIC_BREADBOARD_PERF_TRACE": '"0"' } });
  const globals = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const css = globals.slice(globals.indexOf(".desktop-title-bar {"), globals.indexOf(".browser-extensions-menu {"));
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", req.url === "/bundle.js" ? "text/javascript" : "text/html");
    res.end(req.url === "/bundle.js" ? bundle.outputFiles[0].text : `<!doctype html><html><head><style>
      :root{--paper:#f7f5ec;--paper-bg:#f7f5ec;--paper-surface:#f7f5ec;--paper-raised:#eceee4;--ink:#263a2c;--ink-heading:#263a2c;--ink-muted:#657262;--line:#d7dece;--botanical:#477663}
      body{margin:0;font:14px Arial;color:var(--ink);isolation:isolate}button,input{font:inherit;color:inherit}button{background:transparent;border:0;padding:0}*{box-sizing:border-box}h1{font-size:32px}main input,main button{display:block;margin:24px 0;padding:12px;border:1px solid #aaba9c;border-radius:8px}small{letter-spacing:.12em}main .pane-rail{padding:14px}
      ${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('[data-tab-id="2"]').waitFor();
    // A cold Terminal is selected while the native website is still in front.
    // Its side rail must survive until the same handoff as the website.
    await page.evaluate(() => {
      window.state.tabs.push({ id: 4, title: 'Terminal', url: '/new-tab', loading: true });
      Object.assign(window.state, { activeId: 4, presentedId: 1, visibleId: 1, presentationStatus: 'pending' });
      window.publish();
    });
    await page.locator('[data-tab-id="4"][aria-selected="true"]').waitFor();
    assert.equal(await page.locator('[data-browser-content-id="1"] .pane-rail').isVisible(), true, 'outgoing browser rail covers the green background');
    await page.evaluate(() => { window.state.visibleId = 4; window.publish(); });
    await page.locator('[data-browser-content-id="1"]').waitFor({ state: 'hidden' });
    // Ordinary native browser selection is immediate even before first paint.
    await page.evaluate(() => { Object.assign(window.state, { activeId: 2, visibleId: 2 }); window.publish(); });
    await page.locator('[data-browser-content-id="2"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-browser-content-id="1"]').isVisible(), false);
    await page.evaluate(() => window.reset());
    const drag = async (id, x, y) => {
      const from = await page.locator(`[data-tab-id="${id}"]`).boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + 10);
      await page.mouse.down();
      await page.mouse.move(x ?? from.x + from.width / 2, y, { steps: 8 });
    };
    await drag(2, 850, 380);
    await page.locator('.bb-tab-split-preview[data-side="right"]').waitFor();
    if (process.env.BB_TAB_SPLIT_PREVIEW_SCREENSHOT) await page.screenshot({ path: process.env.BB_TAB_SPLIT_PREVIEW_SCREENSHOT });
    await page.mouse.up();
    await page.locator('[data-group-marker="pair"]').waitFor();
    assert.equal(await page.locator('[data-group-marker="pair"]').textContent(), "Reading", "split groups show only their name without an icon");
    assert.deepEqual(await page.evaluate(() => window.state.tabs.filter(tab => tab.groupId === "pair").map(tab => tab.id)), [1, 2]);
    assert.equal(await page.evaluate(() => window.commands.findLast(c => c.type === "split-tabs").targetId), 1, "drop retains the page selected before press");
    const left = await page.locator('[data-browser-content-id="1"]').boundingBox();
    const right = await page.locator('[data-browser-content-id="2"]').boundingBox();
    assert.equal(left.x + left.width + 8, right.x);
    assert.equal(right.x + right.width, 1100);
    assert.equal((await page.locator('[data-browser-content-id="2"] .pane-rail').boundingBox()).x, right.x);
    await page.getByRole("textbox", { name: "Draft 1", exact: true }).fill("Preserved note");
    await page.locator('[data-browser-content-id="1"]').getByRole("button", { name: "Clicked 0" }).click();
    assert.equal(await page.evaluate(() => window.state.activeId), 1);
    await page.locator('[data-tab-id="3"]').click();
    await page.locator('[data-tab-id="2"]').click();
    assert.equal(await page.getByRole("textbox", { name: "Draft 1", exact: true }).inputValue(), "Preserved note");
    assert.equal(await page.locator('[data-browser-content-id="1"]').getByRole("button", { name: "Clicked 1" }).count(), 1);
    if (process.env.BB_TAB_SPLIT_SCREENSHOT) await page.screenshot({ path: process.env.BB_TAB_SPLIT_SCREENSHOT });
    await page.evaluate(() => window.reset());
    await drag(2, null, 380);
    await page.locator('.bb-tab-split-preview[data-side="left"]').waitFor();
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal(await page.locator('.bb-tab-split-preview').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.state.groups), []);
    assert.deepEqual(await page.evaluate(() => window.commands.at(-1)), { type: "tab-drag", active: false });
    await drag(2, 200, 380);
    await page.mouse.up();
    await page.locator('[data-group-marker="pair"]').waitFor();
    assert.deepEqual(await page.evaluate(() => window.state.tabs.filter(tab => tab.groupId).map(tab => tab.id)), [2, 1]);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
