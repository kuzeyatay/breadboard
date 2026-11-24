import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, expect } from '@playwright/test';

test('home shows the Recall suggestion only inline and accepts it as an editable query', { timeout: 90_000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..');
  const bundle = await build({
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', outdir: 'fixture',
    alias: { '@': path.join(root, 'src') }, define: { 'process.env': '{}' },
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
      import Search from '@/app/new-tab/new-tab-search';
      createRoot(document.getElementById('root')).render(<AppRouterContext.Provider value={{}}>
        <Search ownerKey="reader" gardens={[]} initialHistory={[{ query: 'Encoder resolution', scope: 'web' }]}>Shortcuts</Search>
      </AppRouterContext.Provider>);
    ` },
  });
  const stylesheet = path.join(root, 'src/app/globals.css');
  const css = await postcss([tailwind({ base: root })]).process(await readFile(stylesheet, 'utf8'), { from: stylesheet });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 600 }, reducedMotion: 'no-preference' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack));
  t.after(() => assert.deepEqual(errors, []));
  const prompts = ['How does circuit damping affect settling time?', 'Encoder calibration methods'];
  let release;
  let showPrompts = true;
  await page.route('**/api/**', route => route.fulfill({ json: { items: [], results: [], unavailable: [], limited: [] } }));
  await page.route('**/api/recommendations', async route => {
    assert.equal(route.request().postDataJSON().surface, 'web-search');
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({ json: { recommendations: showPrompts ? prompts.map(prompt => ({
      prompt, sourceLabel: 'Recall', reason: 'Recall suggested this because you recently viewed “Circuit damping”.',
    })) : [] } });
  });
  await page.route('http://home.test/', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><meta name="viewport" content="width=device-width"><main id="root"></main>' }));
  await page.goto('http://home.test/');
  await page.addStyleTag({ content: css.css + bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addStyleTag({ content: '.bb-composer-suggestion-text { animation-play-state: paused !important }' });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  const field = page.getByRole('combobox');
  const ghost = page.locator('[data-prompt-suggestion]');
  await expect(field).toHaveAttribute('placeholder', 'Search');
  await expect.poll(() => Boolean(release)).toBe(true);
  release();
  await expect(ghost).toHaveAttribute('data-suggestion-phase', 'erase');
  await expect(ghost).toContainText('Search');
  const finishPhase = () => ghost.locator('.bb-composer-suggestion-text').evaluate(el => el.getAnimations()[0].finish());
  await finishPhase();
  await expect(ghost).toHaveAttribute('data-suggestion-phase', 'type');
  await expect(ghost).toContainText(prompts[0]);
  await finishPhase();
  await expect(ghost).toHaveAttribute('data-suggestion-phase', 'ready');
  for (const prompt of prompts) {
    await expect(page.getByRole('button', { name: prompt, exact: true })).toHaveCount(0);
  }
  await expect(page.getByLabel('Suggested next steps')).toHaveCount(0);
  const info = page.getByRole('button', { name: 'Why this suggestion?' });
  const panel = page.getByRole('dialog', { name: 'Why this suggestion?' });
  await field.focus();
  const bounds = await field.boundingBox();
  await info.click();
  await expect(panel).toContainText('recently viewed “Circuit damping”');
  await expect(field).toBeFocused();
  assert.deepEqual(await field.boundingBox(), bounds);
  await panel.getByText(/recently viewed/).click();
  await expect(panel).toBeVisible();
  await field.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(ghost).toBeVisible();
  await field.press('Alt+i');
  await expect(panel).toBeVisible();
  await field.click();
  await expect(panel).toHaveCount(0);
  await expect(field).toHaveValue('');
  await field.press('Enter');
  await expect(field).toHaveValue('');
  await field.press('Tab');
  await expect(field).toHaveValue(prompts[0]);
  await expect(ghost).toHaveCount(0);
  await expect(field).toBeFocused();
  assert.equal(page.url(), 'http://home.test/');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  release = undefined;
  await page.reload();
  await page.addStyleTag({ content: css.css });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await expect.poll(() => Boolean(release)).toBe(true);
  release();
  await expect(ghost).toContainText(prompts[0]);
  await expect(ghost).not.toHaveAttribute('data-suggestion-phase', 'erase');
  await field.press('Escape');
  await expect(ghost).toHaveCount(0);
  await expect(field).toHaveAttribute('placeholder', 'Search');
  showPrompts = false;
  release = undefined;
  await page.evaluate(() => window.dispatchEvent(new Event('breadboard:recommendations:refresh')));
  await expect.poll(() => Boolean(release)).toBe(true);
  await field.fill('My own search');
  release();
  await expect(field).toHaveValue('My own search');
  await field.fill('');
  await expect(field).toHaveAttribute('placeholder', 'Search');
  await field.fill('Enc');
  await info.click();
  await expect(panel).toContainText('one of your recent web searches');
  await expect(field).toBeFocused();
  assert.equal(await field.evaluate(node => node.selectionStart), 3);
  await field.press('Tab');
  await expect(field).toHaveValue('Encoder resolution');
  await expect(panel).toHaveCount(0);
});
