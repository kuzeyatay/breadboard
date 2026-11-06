import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('Enter submits forms and explicitly-bound saves once; newline, composition, validation and local handlers remain correct', async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `import {handleEnterSubmit} from './src/lib/enter-submit';document.addEventListener('keydown',handleEnterSubmit);` }, bundle: true, write: false, platform: 'browser' });
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage();
    await page.setContent(`<form id="form"><input id="title" required><textarea id="body"></textarea><button id="send">Send</button><button type="submit" id="secondary">Other action</button></form>
      <div data-enter-submit-scope><textarea id="edit"></textarea><button type="button" id="save" data-enter-submit>Save</button></div>
      <textarea id="note"></textarea><div contenteditable id="code"></div>
      <form><input id="combo" role="combobox"><button>Save</button></form>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      window.sends = 0; window.saves = 0;
      document.querySelector('#form').onsubmit = event => { event.preventDefault(); window.sends++; };
      document.querySelector('#save').onclick = () => window.saves++;
    });
    await page.locator('#body').fill('Hello'); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.sends), 0, 'HTML validation preserved');
    await page.locator('#title').fill('Subject'); await page.locator('#body').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.sends), 1);
    await page.keyboard.press('Shift+Enter'); assert.match(await page.locator('#body').inputValue(), /\n/);
    await page.evaluate(() => document.querySelector('#send').disabled = true); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.sends), 1, 'disabled primary never falls through to a different action');
    await page.locator('#edit').fill('Saved'); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.saves), 1);
    await page.locator('#edit').dispatchEvent('keydown', { key: 'Enter', repeat: true });
    await page.locator('#edit').dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    assert.equal(await page.evaluate(() => window.saves), 1, 'repeat and IME never save');
    await page.evaluate(() => document.querySelector('#edit').onkeydown = event => event.preventDefault());
    await page.keyboard.press('Enter'); assert.equal(await page.evaluate(() => window.saves), 1, 'local handlers win');
    await page.locator('#note').fill('Line'); await page.keyboard.press('Enter'); assert.match(await page.locator('#note').inputValue(), /\n/);
    assert.equal(await page.evaluate(() => window.saves), 1);
  } finally { await browser.close(); }
});
