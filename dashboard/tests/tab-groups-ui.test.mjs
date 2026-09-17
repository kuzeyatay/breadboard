import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { chromium } from "playwright";
import { tabDropTarget, tabGroupDropTarget } from "../src/lib/desktop-tab-drag.ts";

const tab = (id, groupId) => ({ id, groupId, title: `Tab ${id}`, url: `/tab${id}`, loading: false });
test("drag hit targets distinguish tab centers, edges and collapsed groups", () => {
  const tabs = [tab(1), tab(2, "g"), tab(3, "g"), tab(4)];
  const rects = [{ id: 1, left: 0, width: 100 }, { groupId: "g", left: 100, width: 26 }, { id: 2, left: 126, width: 100 }, { id: 3, left: 226, width: 100 }, { id: 4, left: 326, width: 100 }];
  assert.equal(tabDropTarget(tabs, rects, 4, 175).groupTargetId, 2);
  assert.equal(tabDropTarget(tabs, rects, 4, 220).groupId, "g");
  assert.equal(tabDropTarget(tabs, rects, 4, 220).groupTargetId, undefined);
  assert.equal(tabDropTarget(tabs, rects, 4, 130).groupId, null);
  assert.equal(tabDropTarget(tabs, rects.filter(rect => ![2, 3].includes(rect.id)), 4, 112).groupTargetId, 2);
  assert.equal(tabDropTarget(tabs, rects, 2, 450).index, 3);
});

test("whole-group hit targets only land between complete groups and individual tabs", () => {
  const tabs = [tab(1), tab(2, "g"), tab(3, "g"), tab(4, "h"), tab(5, "h"), tab(6)];
  const rects = [{ id: 1, left: 0, width: 100 }, { groupId: "g", left: 100, width: 26 },
    { id: 2, left: 126, width: 100 }, { id: 3, left: 226, width: 100 },
    { groupId: "h", left: 326, width: 26 }, { id: 4, left: 352, width: 100 },
    { id: 5, left: 452, width: 100 }, { id: 6, left: 552, width: 100 }];
  assert.deepEqual(tabGroupDropTarget(tabs, rects, "g", 20), { index: 0, groupId: null, markerX: 0 });
  assert.deepEqual(tabGroupDropTarget(tabs, rects, "g", 400), { index: 1, groupId: null, markerX: 326 });
  assert.deepEqual(tabGroupDropTarget(tabs, rects, "g", 460), { index: 3, groupId: null, markerX: 552 });
  assert.equal(tabGroupDropTarget(tabs, rects, "g", 700).index, 4);
  const collapsed = rects.filter(rect => ![4, 5].includes(rect.id));
  assert.deepEqual(tabGroupDropTarget(tabs, collapsed, "g", 346), { index: 3, groupId: null, markerX: 352 });
});

test("real pointer gestures group, reorder, cancel, collapse and edit groups", { timeout: 60_000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await esbuild.build({ stdin: { resolveDir: root, loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import TitleBar from './src/app/components/desktop-title-bar';
    import GroupMenu from './src/app/browser/tab-group-popover/tab-group-popover';
    import {groupTabs,moveGroupedTab,moveTabGroup} from '../desktop/src/main/tab-groups';
    const listeners=new Set();let seq=0;
    window.commands=[];
    window.reset=()=>{window.state={enabled:true,activeId:1,selfId:1,extensions:[],groups:[],savedGroups:[],tabs:[1,2,3,4].map(id=>({id,title:'Tab '+id,url:'http://test/tab'+id,loading:false}))};window.publish();};
    window.publish=()=>{window.state=structuredClone(window.state);for(const fn of listeners)fn(window.state);};
    window.reset();
    window.breadboardDesktop={getTabsState:async()=>window.state,onTabsState:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},tabs:async command=>{
      window.commands.push(command); const s=window.state;
      if(command.type==='activate')s.activeId=command.id;
      if(command.type==='group-tabs')groupTabs(s,command.id,command.targetId,{id:'g'+(++seq),name:'',color:'blue',collapsed:false});
      if(command.type==='move')moveGroupedTab(s,command.id,command.index,command.groupId);
      if(command.type==='group-move')moveTabGroup(s,command.groupId,command.index);
      if(command.type==='group-update'){const g=s.groups.find(g=>g.id===command.groupId);Object.assign(g,Object.fromEntries(Object.entries(command).filter(([k])=>['name','color','collapsed'].includes(k))));if(g.collapsed&&s.tabs.find(t=>t.id===s.activeId)?.groupId===g.id)s.activeId=s.tabs.find(t=>t.groupId!==g.id)?.id;}
      window.publish();return true;
    }};
    if(location.pathname==='/menu'){window.state.groups=[{id:'g',name:'Research',color:'blue',collapsed:false}];window.state.tabs[0].groupId='g';window.state.tabs[1].groupId='g';}
    createRoot(document.getElementById('root')).render(location.pathname==='/menu'?<GroupMenu/>:<TitleBar/>);
  ` }, bundle: true, write: false, outfile: "bundle.js", format: "iife", platform: "browser", jsx: "automatic" });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
  const globals = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const tabCss = globals.slice(globals.indexOf(".desktop-title-bar {"), globals.indexOf(".browser-extensions-menu {"));
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", req.url === "/bundle.js" ? "text/javascript" : "text/html");
    res.end(req.url === "/bundle.js" ? js : `<!doctype html><html><head><style>
      :root{--paper:#17191d;--paper-surface:#17191d;--paper-raised:#25282e;--paper-strong:#30343c;--ink:#e4e8ee;--ink-heading:#fff;--ink-muted:#9ba3ae;--line:#444952;--botanical:#85c5ff}
      body{margin:0;background:var(--paper);color:var(--ink);font:13px Arial}button,input{font:inherit;border:0;color:inherit;background:transparent;box-sizing:border-box}button{padding:0}*{box-sizing:border-box}
      ${tabCss}\n${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin);
    await page.locator('[data-tab-id="4"]').waitFor();
    const backgroundTab = page.locator('[data-tab-id="3"]');
    await backgroundTab.click({ button: "right" });
    assert.equal(await page.evaluate(() => window.commands.at(-1).type), "tab-menu");
    assert.equal(await page.evaluate(() => window.commands.at(-1).id), 3);
    assert.equal(await page.evaluate(() => window.state.activeId), 1, "right-click does not switch tabs");
    assert.equal(await page.locator('[data-dragging="true"]').count(), 0);
    await backgroundTab.focus();
    const menuCount = await page.evaluate(() => window.commands.filter(c => c.type === "tab-menu").length);
    await page.keyboard.press("Shift+F10");
    assert.equal(await page.evaluate(() => window.commands.filter(c => c.type === "tab-menu").length), menuCount + 1);
    assert.equal(await page.evaluate(() => window.commands.at(-1).id), 3);
    await backgroundTab.getByRole("button", { name: "Close Tab 3", exact: true }).focus();
    await page.keyboard.press("Shift+F10");
    assert.equal(await page.evaluate(() => window.commands.at(-1).id), 3, "tab controls expose the same menu by keyboard");
    assert.equal(await page.evaluate(() => window.state.activeId), 1);
    async function start(id, target, fraction = .5) {
      const from = await page.locator(`[data-tab-id="${id}"]`).boundingBox();
      const to = await page.locator(`[data-tab-id="${target}"]`).boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + 10);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width * fraction, to.y + 10, { steps: 12 });
    }
    await start(4, 2);
    await page.waitForFunction(() => document.querySelector('[data-group-target="true"]'));
    assert.match(await page.locator('[role="status"]').textContent(), /Release to create group/);
    await page.mouse.up();
    await page.locator('[data-group-marker]').waitFor();
    assert.deepEqual(await page.evaluate(() => window.state.tabs.filter(t => t.groupId).map(t => t.id)), [2, 4]);
    if (process.env.BB_TAB_GROUP_STRIP_SCREENSHOT) await page.screenshot({ path: process.env.BB_TAB_GROUP_STRIP_SCREENSHOT });
    await page.locator('[data-group-marker]').click();
    assert.equal(await page.locator('[data-tab-id]').count(), 2);
    await page.locator('[data-group-marker]').click();
    assert.equal(await page.locator('[data-tab-id]').count(), 4);
    await page.locator('[data-group-marker]').click({ button: "right" });
    assert.equal(await page.evaluate(() => window.commands.at(-1).type), "group-menu");
    async function startGroup(targetSelector, fraction = .5) {
      const from = await page.locator('[data-group-marker]').first().boundingBox();
      const to = await page.locator(targetSelector).boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + 10);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width * fraction, to.y + 10, { steps: 12 });
    }
    const activeId = await page.evaluate(() => window.state.activeId);
    await startGroup('[data-tab-id="3"]', .96);
    assert.equal(await page.locator('[data-dragging="true"]').count(), 3, "label and both members move together");
    assert.match(await page.locator('[role="status"]').textContent(), /Release to move group/);
    await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => window.state.tabs.map(t => t.id)), [1, 3, 2, 4]);
    assert.equal(await page.evaluate(() => window.state.groups[0].collapsed), false, "drag must not collapse the group");
    assert.equal(await page.evaluate(() => window.state.activeId), activeId);
    await page.locator('[data-group-marker]').click();
    await startGroup('[data-tab-id="1"]', .04);
    assert.equal(await page.locator('[data-dragging="true"]').count(), 1);
    await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => window.state.tabs.map(t => t.id)), [2, 4, 1, 3]);
    assert.equal(await page.evaluate(() => window.state.groups[0].collapsed), true, "drag must not expand the group");
    const commandCount = await page.evaluate(() => window.commands.length);
    await startGroup('[data-tab-id="3"]', .96);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.commands.length), commandCount, "cancel must not move or toggle a group");
    await page.locator('[data-group-marker]').focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => window.state.groups[0].collapsed), false, "keyboard activation still expands");
    await start(4, 2, .04);
    await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => window.state.tabs.filter(t => t.groupId).map(t => t.id)), [4, 2], "individual members still reorder");
    await page.evaluate(() => window.reset());
    await start(1, 3, .96);
    assert.equal(await page.locator('.bb-tab-drop-line').count(), 1);
    await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => window.state.tabs.map(t => t.id)), [2, 3, 1, 4]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await start(4, 1, .98);
    assert.equal(await page.locator('[data-tab-id="1"]').evaluate(node => getComputedStyle(node).transitionDuration), "0s");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await start(4, 2);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal(await page.locator('.bb-tab-drop-hint').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.state.groups), []);
    await page.evaluate(() => {
      window.state.tabs = [1, 2, 3, 4, 5].map(id => ({ id, title: 'Tab ' + id, url: 'http://test/tab' + id, loading: false,
        ...(id < 5 ? { groupId: id < 3 ? 'a' : 'b' } : {}) }));
      window.state.groups = [{ id: 'a', name: 'Research', color: 'blue', collapsed: false },
        { id: 'b', name: 'Shopping', color: 'purple', collapsed: false }];
      window.publish();
    });
    await startGroup('[data-tab-id="4"]', .96);
    assert.notEqual(await page.locator('[data-group-marker="b"]').evaluate(node => node.style.transform), 'translateX(0px)', "neighboring group labels move with their members");
    assert.equal(await page.locator('[data-group-marker="b"]').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
    await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => window.state.tabs.map(t => t.id)), [3, 4, 1, 2, 5]);
    assert.deepEqual(await page.evaluate(() => window.state.groups.map(g => g.name)), ['Research', 'Shopping']);
    await page.locator('[data-group-marker="b"]').click();
    await startGroup('[data-tab-id="5"]', .96);
    await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => window.state.tabs.map(t => t.id)), [1, 2, 5, 3, 4]);
    await startGroup('[data-group-marker="b"]', .9);
    await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => window.state.tabs.map(t => t.id)), [5, 3, 4, 1, 2], "expanded group moves past all hidden members of a collapsed group");
    assert.equal(await page.evaluate(() => window.state.groups.length), 2, "groups never merge during a reorder");
    const beforeOutsideDrop = await page.evaluate(() => window.commands.length);
    await startGroup('[data-tab-id="5"]', .04);
    await page.mouse.move(100, 200);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.commands.length), beforeOutsideDrop, "dropping outside the strip does not move or toggle a group");
    await page.setViewportSize({ width: 280, height: 480 });
    await page.goto(origin + "/menu?group=g");
    await page.getByRole("textbox", { name: "Name" }).fill("Shopping");
    await page.getByRole("button", { name: "Purple", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Purple", exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal(await page.evaluate(() => window.state.groups[0].name), "Shopping");
    assert.equal(await page.getByRole("button", { name: "Move group to new window" }).count(), 1);
    assert.ok(await page.locator('[role="dialog"]').evaluate(node => node.scrollWidth <= node.clientWidth));
    await page.getByRole("button", { name: "New tab in group", exact: true }).click();
    assert.ok(await page.evaluate(() => window.commands.some(c => c.type === "group-action" && c.action === "new-tab")));
    assert.deepEqual(errors, []);
    if (process.env.BB_TAB_GROUP_SCREENSHOT) await page.screenshot({ path: process.env.BB_TAB_GROUP_SCREENSHOT });
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
