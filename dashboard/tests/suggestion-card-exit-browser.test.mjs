import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';

test('suggestion exits release the transcript, survive interruption and clear on scope changes', async t => {
  const root = path.resolve(import.meta.dirname, '..');
  const bundle = await build({
    bundle: true, write: false, platform: 'browser', jsx: 'automatic', alias: { '@': path.join(root, 'src') },
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import { ChatSuggestionCards } from '@/app/components/hermes/chat-greeting-empty-state';
      import { SuggestionEmptyStatePresence } from '@/app/components/hermes/suggestion-presence';
      const root = createRoot(document.querySelector('main'));
      window.show = (visible, prompts, scope = 'garden') => flushSync(() => root.render(<>
        <SuggestionEmptyStatePresence visible={visible}>
          <ChatSuggestionCards suggestions={prompts} suggestionScopeKey={scope} onSelectSuggestion={() => {}} />
        </SuggestionEmptyStatePresence>
        {!visible && <p>First message</p>}
      </>));
    ` },
  });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  t.after(() => browser.close());
  const css = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8').replace(/^@import .*;$/gm, '');

  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ reducedMotion });
    await page.setContent('<main style="position:relative"></main>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => window.show(true, ['One', 'Two']));
    const buttons = page.getByRole('button');
    await expect(buttons).toHaveCount(2);

    // Inspect the real opacity transition at its midpoint and reverse it.
    const sample = await page.evaluate(async () => {
      window.show(true, ['One']);
      const outgoing = document.querySelector('[inert]');
      let animation;
      for (let i = 0; i < 10 && !animation; i++) {
        await new Promise(requestAnimationFrame);
        animation = outgoing.getAnimations()[0];
      }
      if (!animation) throw new Error('Missing card exit animation');
      const duration = animation.effect.getTiming().duration;
      animation.pause();
      animation.currentTime = duration / 2;
      const opacity = Number(getComputedStyle(outgoing).opacity);
      window.show(true, ['One', 'Two']);
      return { opacity, duration };
    });
    assert.ok(sample.opacity > 0 && sample.opacity < 1);
    assert.equal(sample.duration, reducedMotion === 'reduce' ? 100 : 160);
    await expect(buttons).toHaveCount(2);
    await expect(buttons.last().locator('xpath=../..')).toHaveCSS('opacity', '1');

    const exiting = await page.evaluate(() => {
      window.show(false, ['One', 'Two']);
      const panel = document.querySelector('main > [inert]');
      return { positioned: getComputedStyle(panel).position, transcript: document.querySelector('main > p').textContent };
    });
    assert.deepEqual(exiting, { positioned: 'absolute', transcript: 'First message' });
    await expect(page.locator('.bb-terminal-suggestion')).toHaveCount(0);

    await page.evaluate(() => {
      window.show(true, ['Private prompt']);
      window.show(false, ['Private prompt']);
      window.show(false, [], 'private browsing');
    });
    assert.equal(await page.locator('.bb-terminal-suggestion').count(), 0);
    await page.close();
  }
});
