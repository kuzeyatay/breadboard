import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const root = fileURLToPath(new URL('../', import.meta.url));

test('plus menu: attachments, cross-garden chats, drawing and PNG export', { timeout: 120000 }, async (t) => {
  const bundle = await build({ bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': path.join(root, 'src') }, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"development"' },
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React, {useRef, useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import ComposerAddMenu from '@/app/components/composer-add-menu';
      function App() {
        const [value, setValue] = useState('Design my garden'), [chat, setChat] = useState('conv_a');
        const anchorRef = useRef(null);
        return <div ref={anchorRef} data-composer style={{position:'fixed',left:24,bottom:24,width:'calc(100% - 48px)',maxWidth:700,padding:8,borderRadius:30,background:'var(--paper-raised)',display:'flex',alignItems:'flex-end',gap:6}}>
          <button aria-label="Commands" style={{width:44,height:44,flexShrink:0}}>/</button>
          <ComposerAddMenu anchorRef={anchorRef} onAddDocuments={()=>window.filesOpened=true}
            onAddFiles={async files=>{if(window.failAttach) throw Error('upload failed'); window.attached = await Promise.all(files.map(async file=>({name:file.name,type:file.type,size:file.size,data:Array.from(new Uint8Array(await file.arrayBuffer()))})));}}
            sessionId={chat} onOpenGardenChat={id=>{setChat(id);window.selectedChat=id;}}/>
          <textarea aria-label="Draft" value={value} onChange={e=>setValue(e.target.value)} style={{background:'transparent',flex:1,minWidth:0}}/>
        </div>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` } });
  const stylesheet = path.join(root, 'src/app/globals.css');
  const css = (await postcss([tailwindcss({ base: root })]).process(fs.readFileSync(stylesheet, 'utf8'), { from: stylesheet })).css;
  const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1120, height: 1000 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let historyError = false;
  await page.route('http://composer.test/', route => route.fulfill({ contentType: 'text/html', body: '<html data-theme="dark"><body style="background:var(--paper-bg);color:var(--ink)"><div id="root"></div></body></html>' }));
  await page.route('**/api/clusters', route => route.fulfill({ json: { clusters: [{ slug: 'physics', name: 'Physics' }, { slug: 'biology', name: 'Biology' }] } }));
  await page.route('**/api/hermes/sessions?*', route => route.fulfill({ status: historyError ? 500 : 200, json: { sessions: [
    { id: 'conv_a', title: 'Waves', gardenId: 'physics', updatedAt: '2026-10-04' },
    { id: 'conv_b', title: 'Leaves', gardenId: 'biology', updatedAt: '2026-10-03' },
    { id: 'conv_c', title: 'Private terminal chat', gardenId: null, updatedAt: '2026-10-04' },
  ] } }));
  await page.goto('http://composer.test/');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const plus = page.getByRole('button', { name: 'Add to chat', exact: true });
  await plus.click();
  const assertMenuAnchored = async () => {
    await page.waitForFunction(() => {
      const menu = document.querySelector('[role="menu"]')?.getBoundingClientRect();
      const composer = document.querySelector('[data-composer]')?.getBoundingClientRect();
      return menu && composer && Math.abs(menu.left - composer.left) < 1 && Math.abs(menu.bottom + 8 - composer.top) < 1 && menu.width <= composer.width;
    });
  };
  await assertMenuAnchored();
  await page.getByRole('textbox', { name: 'Draft' }).evaluate(input => input.style.height = '140px');
  await assertMenuAnchored();
  await page.getByRole('textbox', { name: 'Draft' }).evaluate(input => input.style.height = '44px');
  await assertMenuAnchored();
  if (process.env.COMPOSER_QA_DIR) {
    fs.mkdirSync(process.env.COMPOSER_QA_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.COMPOSER_QA_DIR, 'plus-menu.png') });
    await page.evaluate(() => document.documentElement.dataset.theme = 'light');
    await page.screenshot({ path: path.join(process.env.COMPOSER_QA_DIR, 'plus-menu-light.png') });
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  }
  assert.equal(await page.getByRole('menuitemcheckbox').count(), 0);
  await page.getByRole('menuitem', { name: 'Files and folders' }).hover();
  await page.getByRole('menuitem', { name: 'Choose files', exact: true }).waitFor();
  if (process.env.COMPOSER_QA_DIR) await page.screenshot({ path: path.join(process.env.COMPOSER_QA_DIR, 'plus-menu-files.png') });
  await page.getByRole('menuitem', { name: 'Choose files', exact: true }).click();
  assert.equal(await page.evaluate(() => window.filesOpened), true);
  await plus.click();
  await page.getByRole('menuitem', { name: 'Files and folders' }).hover();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Choose folder' }).click();
  const folderChooser = await chooser;
  assert.equal(await folderChooser.element().getAttribute('webkitdirectory'), '');
  // The OS picker is outside browser automation; dispatch the FileList it returns.
  await page.getByLabel('Attach folder').evaluate(input => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['first'], 'one.txt', { type: 'text/plain' }));
    transfer.items.add(new File(['second'], 'two.txt', { type: 'text/plain' }));
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => window.attached?.length === 2);

  await plus.click();
  await page.getByRole('menuitem', { name: /Work in a garden/ }).click();
  await page.getByRole('button', { name: 'Leaves' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Private terminal chat' }).count(), 0);
  await page.getByRole('textbox', { name: 'Search gardens and chats' }).fill('biology');
  assert.equal(await page.getByRole('button', { name: 'Waves' }).count(), 0);
  await page.getByRole('button', { name: 'Leaves' }).click();
  assert.equal(await page.evaluate(() => window.selectedChat), 'conv_b');
  historyError = true;
  await plus.click();
  await page.getByRole('menuitem', { name: /Work in a garden/ }).click();
  await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  historyError = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('button', { name: 'Waves' }).waitFor();
  await page.keyboard.press('Escape');

  await plus.click();
  await page.getByRole('menuitem', { name: /Sketch/ }).click();
  const canvas = page.getByLabel('Sketch canvas');
  await canvas.waitFor();
  assert.equal(await page.getByRole('button', { name: 'Pen', exact: true }).evaluate(button => getComputedStyle(button).color), 'rgb(255, 255, 255)');
  assert.equal(await page.getByRole('button', { name: 'Attach sketch' }).isDisabled(), true);
  const rect = await canvas.boundingBox();
  const draw = async (x, y, dx, dy) => {
    await page.mouse.move(rect.x + rect.width * x, rect.y + rect.height * y);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * (x + dx), rect.y + rect.height * (y + dy), { steps: 12 });
    await page.mouse.up();
  };
  await draw(.2, .3, .3, .1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Attach sketch' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByRole('button', { name: 'Blue', exact: true }).click();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await draw(.55, .45, .2, .2);
  await page.getByRole('button', { name: 'Select and move' }).click();
  await draw(.6, .5, -.1, -.1);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await canvas.click({ position: { x: rect.width * .3, y: rect.height * .6 } });
  await page.getByRole('textbox', { name: 'Sketch text' }).fill('A garden idea');
  await page.getByRole('textbox', { name: 'Sketch text' }).press('Enter');
  if (process.env.COMPOSER_QA_DIR) await page.screenshot({ path: path.join(process.env.COMPOSER_QA_DIR, 'sketch.png') });
  await page.evaluate(() => window.failAttach = true);
  await page.getByRole('button', { name: 'Attach sketch' }).click();
  await page.getByRole('alert').filter({ hasText: 'Your sketch could not be attached' }).waitFor();
  await page.evaluate(() => window.failAttach = false);
  await page.getByRole('button', { name: 'Attach sketch' }).click();
  await page.getByRole('dialog', { name: 'Sketch', exact: true }).waitFor({ state: 'hidden' });
  const attached = await page.evaluate(() => window.attached[0]);
  assert.match(attached.name, /^sketch-\d+\.png$/);
  assert.equal(attached.type, 'image/png');
  assert.deepEqual(attached.data.slice(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(attached.size > 4000);

  await page.setViewportSize({ width: 390, height: 700 });
  await plus.focus();
  await page.keyboard.press('Enter');
  await assertMenuAnchored();
  if (process.env.COMPOSER_QA_DIR) await page.screenshot({ path: path.join(process.env.COMPOSER_QA_DIR, 'plus-menu-mobile.png') });
  const menu = page.getByRole('menu').first();
  const menuBox = await menu.boundingBox();
  assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= 390);
  await page.getByRole('menuitem', { name: /Sketch/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Sketch', exact: true });
  await dialog.waitFor();
  const dialogBox = await dialog.boundingBox();
  assert.ok(dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= 390);
  assert.equal(await page.getByRole('button', { name: 'Pen', exact: true }).isVisible(), true);
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
});
