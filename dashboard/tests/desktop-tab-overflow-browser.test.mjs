import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = process.env.BREADBOARD_DASHBOARD_ROOT ?? fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = process.env.BREADBOARD_TAB_SOURCE_ROOT ?? root;
const require = createRequire(path.join(root, 'package.json'));
const { build } = require('esbuild');
const { chromium, expect } = require('@playwright/test');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');

test('crowded tabs stay reachable by arrows, wheel and keyboard, with New tab always visible', { timeout: 90_000 }, async t => {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import TitleBar from './src/app/components/desktop-title-bar';
      const listeners = new Set();
      window.commands = [];
      window.publish = update => {
        window.state = {...window.state, ...update};
        for (const listener of listeners) listener(window.state);
      };
      window.reset = (count = 80, grouped = false) => window.publish({
        enabled:true, persistentShell:true, selfId:1, activeId:1, extensions:[],
        groups: grouped ? [{id:'lessons', name:'Lessons', color:'cyan', collapsed:false}] : [],
        tabs:Array.from({length:count}, (_,index) => ({id:index+1, title:'Lesson '+(index+1),
          url:'/lesson/'+(index+1), loading:false, ...(grouped ? {groupId:'lessons'} : {})}))
      });
      window.reset();
      window.breadboardDesktop = {
        getTabsState:async()=>window.state,
        onTabsState:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},
        tabs:async command=>{
          window.commands.push(command);
          if(command.type==='activate') window.publish({activeId:command.id});
          if(command.type==='group-update') window.publish({groups:window.state.groups.map(group=>
            group.id===command.groupId ? {...group, collapsed:command.collapsed} : group)});
          if(command.type==='new') {
            const id=Math.max(0,...window.state.tabs.map(tab=>tab.id))+1;
            window.publish({activeId:id,tabs:[...window.state.tabs,{id,title:'New tab '+id,url:'/new-tab',loading:false}]});
          }
          if(command.type==='close') {
            const tabs=window.state.tabs.filter(tab=>tab.id!==command.id);
            window.publish({tabs, activeId:command.id===window.state.activeId ? tabs.at(-1)?.id : window.state.activeId});
          }
          return true;
        }
      };
      createRoot(document.getElementById('root')).render(<TitleBar shell/>);
    ` },
    bundle: true, write: false, metafile: true, outfile: 'tabs.js', platform: 'browser', format: 'iife', jsx: 'automatic',
    tsconfig: path.join(root, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_BREADBOARD_PERF_TRACE': '"0"' },
    plugins: [{ name: 'tab-source', setup(builder) {
      builder.onLoad({ filter: /[\\/]desktop-title-bar\.tsx$/ }, () => ({
        contents: fs.readFileSync(path.join(sourceRoot, 'src/app/components/desktop-title-bar.tsx'), 'utf8'),
        loader: 'tsx', resolveDir: path.join(root, 'src/app/components'),
      }));
    } }],
  });
  const sourceFiles = Object.keys(bundle.metafile.inputs).filter(file => !file.includes('node_modules') && /\.[jt]sx?$/.test(file))
    .map(file => `@source "${path.resolve(file).replaceAll('\\', '/')}";`).join('\n');
  const cssPath = path.join(root, 'src/app/globals.css');
  const css = (await postcss([tailwind({base:root})]).process(
    fs.readFileSync(path.join(sourceRoot, 'src/app/globals.css'), 'utf8').replace(/^@source[^;]+;/gm, sourceFiles), {from:cssPath})).css;
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({headless:true, ...(executablePath ? {executablePath} : {})});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport:{width:1100,height:300}, reducedMotion:'reduce', deviceScaleFactor:1.25});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><html data-breadboard-desktop="true"><body><div id="root"></div></body></html>');
  await page.addStyleTag({content:css});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const previous = page.getByRole('button', {name:'Scroll tabs left', exact:true});
  const next = page.getByRole('button', {name:'Scroll tabs right', exact:true});
  const strip = page.getByRole('tablist', {name:'Browser tabs'});
  const newTab = page.getByRole('button', {name:'New tab', exact:true});
  const position = () => strip.evaluate(node => node.scrollLeft);
  const visibleTabs = () => strip.evaluate(node => {
    const viewport = node.getBoundingClientRect();
    return [...node.querySelectorAll('[data-tab-id]')].filter(tab => {
      const box = tab.getBoundingClientRect();
      return box.left >= viewport.left - 1 && box.right <= viewport.right + 1;
    }).map(tab => Number(tab.dataset.tabId));
  });
  const assertNewTabReachable = async width => {
    const bounds = await newTab.evaluate(node => {
      const box = node.getBoundingClientRect();
      return {left:box.left,right:box.right,hit:node.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)),region:getComputedStyle(node).webkitAppRegion};
    });
    assert.ok(bounds.left >= 0 && bounds.right <= width - 140 && bounds.hit, JSON.stringify(bounds));
    assert.equal(bounds.region, 'no-drag');
  };

  const geometry = () => page.evaluate(() => {
    const strip = document.querySelector('[role="tablist"]');
    return {
      stripWidth: strip.getBoundingClientRect().width,
      tabs: [...strip.querySelectorAll('[data-tab-id]')].map(tab => ({id:tab.dataset.tabId,width:tab.getBoundingClientRect().width})),
      newTabLeft: document.querySelector('.bb-tab-new').getBoundingClientRect().left,
    };
  });
  const settleLayout = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (const [width,count,grouped] of [[1600,3,false],[1100,5,true],[600,6,false],[600,80,false]]) {
    await page.setViewportSize({width,height:300});
    await page.mouse.move(10,120);
    await page.evaluate(({count,grouped}) => {
      document.activeElement?.blur();
      window.reset(count,grouped);
      const names=['Plan','Health','Settings','EM 1','Terminal'];
      window.publish({tabs:window.state.tabs.map((tab,index)=>({...tab,title:names[index]??tab.title,anchored:index===2}))});
    },{count,grouped});
    await settleLayout();
    const before=await geometry();
    const target=page.locator('[data-tab-id="2"]');
    await target.hover();
    await settleLayout();
    assert.deepEqual(await geometry(),before,`hover must preserve all tab widths and New tab position (${width}px, ${count} tabs)`);
    await expect(target.getByRole('button',{name:'Anchor Health',exact:true})).toBeVisible();
    await expect(target.getByRole('button',{name:'Close Health',exact:true})).toBeVisible();
    await page.mouse.move(10,120);
    await target.focus();
    await settleLayout();
    assert.deepEqual(await geometry(),before,'keyboard focus must preserve tab widths too');
    await page.evaluate(() => document.activeElement?.blur());
  }

  for (const width of [600, 1100, 1920]) {
    await page.setViewportSize({width,height:300});
    await page.evaluate(() => window.reset());
    await expect(next).toBeVisible();
    await expect(previous).toBeDisabled();
    await assertNewTabReachable(width);
    const seen = new Set(await visibleTabs());
    for (let clicks = 0; await next.isEnabled(); clicks++) {
      assert.ok(clicks < 60, 'arrows eventually reach the end of the tab strip');
      const before = await position();
      await next.click();
      await expect.poll(position).toBeGreaterThan(before);
      await expect.poll(() => next.isDisabled()).toBe(await strip.evaluate(node => node.scrollLeft >= node.scrollWidth - node.clientWidth - 1));
      for (const id of await visibleTabs()) seen.add(id);
      await assertNewTabReachable(width);
    }
    assert.equal(seen.size, 80, `every tab was fully reachable at width ${width}`);
    assert.equal(await page.evaluate(() => window.state.activeId), 1, 'scrolling does not switch tabs');
    // Use a real pointer coordinate; Locator.click would auto-scroll and hide the bug.
    const last = await page.locator('[data-tab-id="80"]').boundingBox();
    await page.mouse.click(last.x + 25, last.y + 12);
    await expect(page.locator('[data-tab-id="80"]')).toHaveAttribute('aria-selected', 'true');
    await newTab.click();
    await expect.poll(visibleTabs).toContain(81);
    await page.getByRole('button', {name:'Close New tab 81', exact:true}).click();
    await expect.poll(visibleTabs).toContain(80);
    if (width === 1100 && process.env.BREADBOARD_TAB_QA_DIR) {
      fs.mkdirSync(process.env.BREADBOARD_TAB_QA_DIR,{recursive:true});
      await page.screenshot({path:path.join(process.env.BREADBOARD_TAB_QA_DIR,'many-tabs.png')});
    }
  }

  await page.setViewportSize({width:900,height:300});
  await expect.poll(visibleTabs).toContain(80);
  const viewport = await strip.boundingBox();
  await page.mouse.move(viewport.x + viewport.width/2, viewport.y + 12);
  const atEnd = await position();
  await page.mouse.wheel(0, -500);
  await expect.poll(position).toBeLessThan(atEnd);
  const afterVerticalWheel = await position();
  await page.mouse.wheel(-300, 0);
  await expect.poll(position).toBeLessThan(afterVerticalWheel);
  const manuallyScrolled = await position();
  await page.evaluate(() => window.publish({tabs:window.state.tabs.map(tab=>({...tab,title:tab.title+' updated'}))}));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await position(), manuallyScrolled, 'background state updates preserve manual scrolling');

  await page.evaluate(() => window.publish({activeId:1}));
  await expect.poll(visibleTabs).toContain(1);
  await page.locator('[data-tab-id="1"]').focus();
  await page.keyboard.press('End');
  await expect.poll(visibleTabs).toContain(80);
  await expect(page.locator('[data-tab-id="80"]')).toBeFocused();
  await page.keyboard.press('Home');
  await expect.poll(visibleTabs).toContain(1);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(visibleTabs).toContain(80);
  await page.setViewportSize({width:600,height:300});
  await expect.poll(visibleTabs).toContain(80);

  await page.evaluate(() => { window.reset(40,true); window.publish({activeId:40}); });
  await expect.poll(visibleTabs).toContain(40);
  await page.evaluate(() => window.publish({groups:window.state.groups.map(group=>({...group,collapsed:true}))}));
  await expect(next).toBeHidden();
  await expect(previous).toBeHidden();
  await assertNewTabReachable(600);
  await page.getByRole('button', {name:'Expand Lessons, 40 tabs'}).click();
  await expect(next).toBeVisible();
  await expect.poll(visibleTabs).toContain(40);
  await page.evaluate(() => window.reset(2));
  await expect(next).toBeHidden();
  await expect(previous).toBeHidden();
  await assertNewTabReachable(600);

  await page.setViewportSize({width:650,height:300});
  await page.evaluate(() => window.reset(6));
  await expect(next).toBeVisible();
  await page.evaluate(() => window.publish({tabs:window.state.tabs.slice(0,4)}));
  await expect(next).toBeHidden();
  assert.equal((await visibleTabs()).length,4,'arrows disappear when tabs fit without reserving arrow space');
  await page.setViewportSize({width:600,height:300});

  // The strip also overflows when all the tabs are inside collapsed groups.
  await page.evaluate(() => {
    window.reset(40);
    window.publish({groups:window.state.tabs.map(tab=>({id:'group'+tab.id,name:'Group '+tab.id,color:'cyan',collapsed:true})),
      tabs:window.state.tabs.map(tab=>({...tab,groupId:'group'+tab.id}))});
  });
  await expect(next).toBeVisible();
  for (let clicks=0; await next.isEnabled(); clicks++) {
    assert.ok(clicks<40);
    const before=await position();
    await next.click();
    await expect.poll(position).toBeGreaterThan(before);
    await expect.poll(() => next.isDisabled()).toBe(await strip.evaluate(node => node.scrollLeft >= node.scrollWidth - node.clientWidth - 1));
  }
  const lastGroup=await page.locator('[data-group-marker="group40"]').boundingBox();
  await page.mouse.click(lastGroup.x+lastGroup.width/2,lastGroup.y+lastGroup.height/2);
  await expect(page.locator('[data-tab-id="40"]')).toHaveCount(1);
  await page.evaluate(() => window.publish({activeId:40}));
  await expect.poll(visibleTabs).toContain(40);

  if (process.env.BREADBOARD_TAB_QA_DIR) {
    fs.mkdirSync(process.env.BREADBOARD_TAB_QA_DIR,{recursive:true});
    await page.screenshot({path:path.join(process.env.BREADBOARD_TAB_QA_DIR,'crowded-tabs.png')});
  }
  await page.evaluate(() => { document.documentElement.dataset.voiceStage='open'; });
  await expect(newTab).toBeHidden();
  await expect(next).toBeHidden();
  assert.deepEqual(errors, []);
});
