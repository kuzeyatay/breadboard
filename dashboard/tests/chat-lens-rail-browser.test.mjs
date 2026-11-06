import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("the lens browses independently, preserves message jumps and releases audio", { timeout: 60_000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, "..");
  const profileSource = fs.readFileSync(path.join(root, 'src/app/profile/profile-client.tsx'), 'utf8');
  const profileTree = ts.createSourceFile('profile-client.tsx', profileSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const profileControls = profileTree.statements.filter(node => ts.isFunctionDeclaration(node) &&
    ['Card', 'Switch', 'ChatRailSoundPanel'].includes(node.name?.text)).map(node => node.getText(profileTree)).join('\n');
  assert.match(profileSource, /<ChatRailSoundPanel \/>/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, '../quartz/quartz/components/BreadboardAI.tsx'), 'utf8'), /data-lens-sound/);
  const bundle = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useMemo, useRef, useState, useSyncExternalStore} from 'react';
      import {createRoot} from 'react-dom/client';
      import ChatMessageRail from './src/app/components/chat-message-rail';
      import {getChatRailSoundEnabled, setChatRailSoundEnabled, subscribeChatRailSound} from './src/lib/chat-lens-sound';
      ${profileControls}
      const app = createRoot(document.getElementById('root'));
      window.dispose = () => app.unmount();
      window.jumps = [];
      function App() {
        const ref = useRef(null);
        const [count, setCount] = useState(80), [revision, setRevision] = useState(0);
        window.setCount = setCount;
        window.stream = () => setRevision(r => r + 1);
        const items = useMemo(() => Array.from({length: count}, (_, index) => ({rowIndex: index, label: 'Question ' + (index + 1)})), [count, revision]);
        const bridge = useMemo(() => ({
          activeRef: {current: true}, getRowStart: index => index * 280,
          scrollToIndex(index, behavior) {
            window.jumps.push({index, behavior});
            ref.current.scrollTo({top: index * 280, behavior});
          },
        }), []);
        return <>
          <div id="scroller" ref={ref} style={{height: 600, width: 650, overflowY: 'auto'}}>
            {items.map(item => <article key={item.rowIndex} data-index={item.rowIndex} style={{height: 280}}>{item.label}</article>)}
          </div>
          <ChatMessageRail surface="lens-browser" items={items} bridge={bridge} scrollRef={ref}/>
          <aside style={{position: 'fixed', top: 20, left: 680, width: 230}}><ChatRailSoundPanel/></aside>
        </>;
      }
      app.render(location.pathname === '/profile' ? <ChatRailSoundPanel/> : <App/>);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const executablePath = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/chromium",
  ].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext({viewport: {width: 1000, height: 800}});
  await context.route('https://chat-lens.test/**', route => route.fulfill({contentType: 'text/html', body: '<html><body><div id="root"></div></body></html>'}));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto('https://chat-lens.test/chat');
  await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'src/lib/chat-lens-rail.css'), 'utf8') + `
    body {margin: 20px; --ink-muted: #50615a; --ink: #13201b; --surface-raised: white}
    [data-chat-message-rail] {position: fixed; top: 180px; right: 20px}
    [data-chat-message-rail] > [aria-hidden] {position: absolute; right: 100%; width: 200px}
  ` });
  await page.evaluate(() => {
    window.audioEvents = {opened: 0, played: 0, closed: 0};
    const NativeAudio = window.AudioContext;
    window.AudioContext = class extends NativeAudio {
      constructor(options) { super(options); window.audioEvents.opened++; }
      createBufferSource() {
        const source = super.createBufferSource(), start = source.start.bind(source);
        source.start = (...args) => { window.audioEvents.played++; return start(...args); };
        return source;
      }
      close() { window.audioEvents.closed++; return super.close(); }
    };
  });
  await page.addScriptTag({content: bundle.outputFiles[0].text});
  const rail = page.locator('[data-chat-message-rail]');
  const track = rail.locator('[role=toolbar]');
  const ticks = rail.locator('.bb-chat-lens-item');
  await expect(rail).toHaveAttribute('data-lens-ready', 'true');
  await expect(rail.locator('[data-lens-sound]')).toHaveCount(0);
  assert.equal(await ticks.count(), 80);
  assert.equal(await page.evaluate(() => window.audioEvents.opened), 0, 'audio eagerly opened before interaction');
  const profileSwitch = page.getByRole('switch', {name: 'Play scroll clicks'});
  await expect(profileSwitch).toHaveAttribute('aria-checked', 'true');
  const position = () => rail.evaluate(el => Number(el.dataset.lensPosition));
  const oldPosition = await position();
  await page.mouse.click(40, 40); // Browser audio activation, outside the rail.
  const box = await track.boundingBox();
  await page.mouse.move(box.x + 29, box.y + box.height / 2);
  await page.mouse.wheel(0, 252);
  await expect.poll(position).toBeGreaterThan(oldPosition + 5.8);
  assert.equal(await page.locator('#scroller').evaluate(el => el.scrollTop), 0, 'browsing the ring scrolled the chat');
  assert.equal(await page.evaluate(() => window.jumps.length), 0);
  await expect.poll(() => page.evaluate(() => window.audioEvents.played)).toBeGreaterThan(0);
  await page.evaluate(() => window.stream());
  await expect.poll(position).toBeGreaterThan(oldPosition + 5.8);

  // A non-active tick grows and changes color, with the original tooltip text.
  await page.mouse.move(400, 100);
  const mark = ticks.nth(6).locator('.bb-chat-lens-mark');
  await expect.poll(() => mark.evaluate(el => el.getBoundingClientRect().width)).toBeLessThan(14.01);
  const idle = await mark.evaluate(el => ({width: el.getBoundingClientRect().width, color: getComputedStyle(el).backgroundColor}));
  await ticks.nth(6).hover();
  await expect(ticks.nth(6)).toHaveAttribute('data-lens-hovered', 'true');
  await expect.poll(() => mark.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(idle.width * 1.35);
  await expect.poll(() => mark.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(80, 97, 90)');
  assert.notEqual(idle.color, 'rgb(80, 97, 90)');
  await expect(rail.locator(':scope > [aria-hidden=true]')).toHaveText('Question 7');
  await ticks.nth(6).click();
  await expect.poll(() => page.evaluate(() => window.jumps.at(-1))).toEqual({index: 6, behavior: 'smooth'});
  await expect.poll(() => page.locator('#scroller').evaluate(el => el.scrollTop)).toBe(1680);

  const beforeDrag = await page.evaluate(() => window.jumps.length);
  await page.mouse.move(box.x + 29, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 29, box.y + box.height / 2 - 85, {steps: 10});
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.jumps.length), beforeDrag, 'drag released into an unwanted message jump');

  await profileSwitch.click();
  await expect(profileSwitch).toHaveAttribute('aria-checked', 'false');
  const mutedCount = await page.evaluate(() => window.audioEvents.played);
  await page.mouse.move(box.x + 29, box.y + box.height / 2);
  await page.mouse.wheel(0, 252);
  await expect.poll(position).toBeGreaterThan(16);
  assert.equal(await page.evaluate(() => window.audioEvents.played), mutedCount);

  // Opening Profile elsewhere keeps the saved value and updates an open chat.
  const profilePage = await context.newPage();
  await profilePage.goto('https://chat-lens.test/profile');
  await profilePage.addScriptTag({content: bundle.outputFiles[0].text});
  const otherSwitch = profilePage.getByRole('switch', {name: 'Play scroll clicks'});
  await expect(otherSwitch).toHaveAttribute('aria-checked', 'false');
  await otherSwitch.click();
  await expect(profileSwitch).toHaveAttribute('aria-checked', 'true');
  await page.bringToFront();
  await page.mouse.move(box.x + 29, box.y + box.height / 2);
  await page.mouse.wheel(0, 252);
  await expect.poll(() => page.evaluate(() => window.audioEvents.played)).toBeGreaterThan(mutedCount);
  await otherSwitch.click();
  await expect(profileSwitch).toHaveAttribute('aria-checked', 'false');
  await profilePage.reload();
  await profilePage.addScriptTag({content: bundle.outputFiles[0].text});
  await expect(otherSwitch).toHaveAttribute('aria-checked', 'false');
  await profilePage.close();

  // A failed persistence write must not claim the setting was saved.
  await page.evaluate(() => { window.restoreStorageSet = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('Storage unavailable'); }; });
  await profileSwitch.click();
  await expect(profileSwitch).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('alert')).toHaveText('Breadboard could not save this preference on this device.');
  await page.evaluate(() => { Storage.prototype.setItem = window.restoreStorageSet; });

  await page.emulateMedia({reducedMotion: 'reduce'});
  await rail.locator('.bb-chat-lens-item[tabindex="0"]').focus();
  await page.keyboard.press('End');
  await expect(ticks.nth(79)).toBeFocused();
  await expect(ticks.nth(79)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.jumps.at(-1))).toEqual({index: 79, behavior: 'auto'});
  await page.keyboard.press('Home');
  await expect(ticks.first()).toBeFocused();

  // A short chat still has a physical ring: wheel input must turn it even when
  // every message fits, without requiring a press or moving the transcript.
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await page.evaluate(() => window.setCount(12));
  await expect(ticks).toHaveCount(12);
  const shortBox = await track.boundingBox();
  await page.mouse.move(shortBox.x + 29, shortBox.y + shortBox.height / 2);
  const shortStart = await position();
  const scrollBeforeWheel = await page.locator('#scroller').evaluate(el => el.scrollTop);
  const jumpsBeforeWheel = await page.evaluate(() => window.jumps.length);
  await page.mouse.wheel(0, 84);
  await expect.poll(position).toBeGreaterThan(shortStart + .8);
  const shortTurned = await position();
  await page.mouse.wheel(0, -84);
  await expect.poll(position).toBeLessThan(shortTurned - .8);
  assert.equal(await page.locator('#scroller').evaluate(el => el.scrollTop), scrollBeforeWheel);
  assert.equal(await page.evaluate(() => window.jumps.length), jumpsBeforeWheel);

  await page.evaluate(() => window.setCount(1));
  await expect(ticks).toHaveCount(1);
  await expect(ticks.first()).toBeVisible();
  await page.evaluate(() => window.dispose());
  await expect.poll(() => page.evaluate(() => window.audioEvents.closed)).toBe(1);
  assert.deepEqual(errors, []);
});
