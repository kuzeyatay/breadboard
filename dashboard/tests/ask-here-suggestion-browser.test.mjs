import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const root = path.resolve(import.meta.dirname, '..');

test('Ask here suggestions wrap, accept, dismiss and ignore stale selection/model responses without overwriting drafts', { timeout: 90_000 }, async t => {
  const bundle = await build({ bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': path.join(root, 'src') }, stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {InlineSelectionAnswerPopover} from '@/app/components/chat-text-selection-ui';
      function App(){
        const [state,setState]=useState({id:'first',quote:'electric flux',model:'selection/model',disabled:false,pending:false,question:'',temporary:false});
        const [open,setOpen]=useState(true);
        window.configure=patch=>{setState(current=>({...current,...patch}));setOpen(true);};
        return <>{open&&<InlineSelectionAnswerPopover key={state.id} draftId={state.id}
          anchor={{left:40,right:240,top:60,bottom:80,width:200,height:20}}
          suggestionSelection={{quote:state.quote,prefix:'Gauss law relates ',suffix:' to enclosed charge.'}}
          suggestionModel={state.model} questionDisabled={state.disabled} question={state.question}
          persistDraft={!state.temporary}
          pending={state.pending} onClose={()=>setOpen(false)} onDelete={()=>setOpen(false)}
          onAskAgain={question=>{window.sent.push(question);setState(current=>({...current,question,pending:true}));}}/>}</>;
      }
      window.sent=[];createRoot(document.getElementById('root')).render(<App/>);
    ` } });
  const stylesheet = path.join(root, 'src/app/globals.css');
  const css = (await postcss([tailwindcss({ base: root })]).process(fs.readFileSync(stylesheet, 'utf8'), { from: stylesheet })).css;
  const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, executablePath });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  const question = 'Why does electric flux through a closed surface depend only on enclosed charge?';
  const requests = [];
  let defer = false, release;
  await page.route('http://inline.test/', route => route.fulfill({ contentType: 'text/html', body: '<html data-theme="light"><body><div id="root"></div></body></html>' }));
  await page.route('**/api/chat-prompt-suggestion', async route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    const wait = defer;
    if (wait) await new Promise(resolve => { release = resolve; });
    await route.fulfill({ json: { suggestion: wait ? 'Stale question to discard?' : question } }).catch(() => {});
  });
  await page.goto('http://inline.test/');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const card = page.getByRole('dialog', { name: 'Answer about highlighted text' });
  const editor = card.getByRole('textbox');
  const ghost = card.locator('[data-prompt-suggestion]');
  await expect(ghost).toContainText(question);
  await expect(editor).toHaveValue('');
  await expect(editor).toHaveAttribute('aria-keyshortcuts', 'Tab Escape');
  await expect(card.locator('.sr-only')).toContainText(`Suggested question: ${question}`);
  await expect(card.getByRole('button', { name: 'Ask', exact: true })).toBeDisabled();
  await editor.press('Enter');
  assert.deepEqual(await page.evaluate(() => sent), []);
  await editor.press('Shift+Tab');
  await expect(editor).not.toBeFocused();
  await expect(ghost).toBeVisible();
  await editor.focus();
  await editor.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, isComposing: true })));
  await expect(editor).toHaveValue('');

  const artifacts = process.env.BREADBOARD_INLINE_SUGGESTION_QA_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'breadboard-ask-here-suggestion-'));
  fs.mkdirSync(artifacts, { recursive: true });
  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate((el, theme) => { el.dataset.theme = theme; }, theme);
    await page.setViewportSize({ width: theme === 'dark' ? 390 : 1000, height: 720 });
    await expect.poll(async () => {
      const input = await editor.boundingBox(), overlay = await ghost.boundingBox();
      return input.y + input.height >= overlay.y + overlay.height - 1;
    }).toBe(true);
    assert.equal(await ghost.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await card.screenshot({ path: path.join(artifacts, `${theme}.png`) });
  }
  await editor.press('Escape');
  await expect(ghost).toHaveCount(0);
  await expect(card).toBeVisible();
  await expect(editor).toBeFocused();
  await editor.press('Escape');
  await expect(card).toHaveCount(0);

  await page.evaluate(() => configure({ id: 'accept' }));
  await expect(ghost).toContainText(question);
  await editor.press('Tab');
  await expect(editor).toHaveValue(question);
  await expect(editor).toBeFocused();
  assert.deepEqual(await page.evaluate(() => sent), []);
  await editor.press('Enter');
  assert.deepEqual(await page.evaluate(() => sent), [question]);
  await expect(ghost).toHaveCount(0);

  await page.evaluate(() => configure({ id: 'own-draft', question: '', pending: false }));
  await expect(ghost).toBeVisible();
  await editor.fill('My own question');
  await expect(ghost).toHaveCount(0);
  await editor.press('Escape');
  await page.evaluate(() => configure({}));
  await expect(editor).toHaveValue('My own question');

  defer = true; release = undefined;
  await page.evaluate(() => configure({ id: 'selection-race', quote: 'old excerpt' }));
  await expect.poll(() => Boolean(release)).toBe(true);
  defer = false;
  await page.evaluate(() => configure({ quote: 'new excerpt' }));
  release();
  await expect(ghost).toContainText(question);
  assert.equal(requests.at(-1).selection.quote, 'new excerpt');

  defer = true; release = undefined;
  await page.evaluate(() => configure({ model: 'old/model' }));
  await expect.poll(() => Boolean(release)).toBe(true);
  defer = false;
  await page.evaluate(() => configure({ model: 'new/model' }));
  release();
  await expect(ghost).toContainText(question);
  assert.equal(requests.at(-1).model, 'new/model');

  defer = true; release = undefined;
  await page.evaluate(() => configure({ id: 'typing-race' }));
  await expect.poll(() => Boolean(release)).toBe(true);
  await editor.fill('Keep this draft');
  release(); defer = false;
  await expect(editor).toHaveValue('Keep this draft');
  await expect(ghost).toHaveCount(0);

  const before = requests.length;
  await page.evaluate(() => configure({ id: 'disabled', disabled: true }));
  await page.waitForTimeout(850);
  assert.equal(requests.length, before);
  await page.evaluate(() => configure({ disabled: false, model: 'none' }));
  await page.waitForTimeout(850);
  assert.equal(requests.length, before);
  await page.evaluate(() => configure({ model: 'selected/model', temporary: true }));
  await expect(ghost).toBeVisible();
  assert.equal(requests.at(-1).temporary, true);
});
