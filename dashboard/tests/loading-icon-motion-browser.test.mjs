import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';

test('loading glyphs fade from their current frame when a busy row is replaced', async t => {
  const root = path.resolve(import.meta.dirname, '..');
  const bundle = await build({
    bundle: true, write: false, platform: 'browser', jsx: 'automatic', alias: { '@': path.join(root, 'src') },
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { StrictMode } from 'react';
      import { flushSync } from 'react-dom';
      import { createRoot } from 'react-dom/client';
      import BreadboardLoader from '@/app/components/breadboard-loader';
      import AssistantResponseMeta from '@/app/components/assistant-response-meta';
      import { ReplyText } from '@/app/components/loading-text-reveal';
      import { ArtifactLoadingMark } from '@/app/components/hermes/artifact-preview-loading';
      const root = createRoot(document.querySelector('main'));
      window.show = kind => flushSync(() => root.render(<StrictMode>{kind
        ? <section role="status" style={{ padding: 32 }}>{kind === 'orb'
          ? <BreadboardLoader className="orb" /> : <ArtifactLoadingMark />}</section>
        : <button>Ready</button>}</StrictMode>));
      window.reply = (text, active) => flushSync(() => root.render(<StrictMode>
        <AssistantResponseMeta active={active} />
        <ReplyText>{text && <p>{text}</p>}</ReplyText>
      </StrictMode>));
    ` },
  });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  t.after(() => browser.close());
  const css = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8').replace(/^@import .*;$/gm, '');
  const page = await browser.newPage();
  await page.setContent('<main style="position:relative"></main>');
  await page.addStyleTag({ content: css + '\n.orb {width:20px;height:20px}' });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion });
    for (const kind of ['orb', 'triangle']) {
      const frame = await page.evaluate(async kind => {
        window.show(kind);
        const icon = document.querySelector('[data-loading-icon]');
        const enter = icon.getAnimations().find(a => a.transitionProperty === 'opacity');
        const duration = enter.effect.getTiming().duration;
        enter.pause();
        enter.currentTime = duration / 2;
        const opacity = getComputedStyle(icon).opacity;
        const rect = icon.getBoundingClientRect();
        const canvas = icon.querySelector('canvas');
        if (canvas) canvas.getContext('2d').fillRect(0, 0, 1, 1);
        const sourcePixel = canvas?.getContext('2d').getImageData(0, 0, 1, 1).data[3];
        window.show(null);
        await Promise.resolve();
        const layer = document.querySelector('[data-loading-icon-exit]');
        const exit = layer.getAnimations()[0];
        exit.pause();
        exit.currentTime = duration / 2;
        const glyph = layer.firstElementChild;
        const position = glyph.getBoundingClientRect();
        const result = {
          duration, exitDuration: exit.effect.getTiming().duration, opacity, copyOpacity: getComputedStyle(glyph).opacity,
          fading: Number(getComputedStyle(layer).opacity), inert: layer.inert && layer.ariaHidden === 'true',
          displacement: Math.hypot(position.x - rect.x, position.y - rect.y),
          sourcePixel,
          canvasPixel: layer.querySelector('canvas')?.getContext('2d').getImageData(0, 0, 1, 1).data[3],
        };
        exit.play();
        return result;
      }, kind);
      assert.equal(frame.duration, reducedMotion === 'reduce' ? 90 : 150);
      assert.equal(frame.exitDuration, frame.duration);
      assert.ok(Number(frame.opacity) > 0 && Number(frame.opacity) < 1);
      assert.equal(frame.copyOpacity, frame.opacity);
      assert.ok(frame.fading > 0 && frame.fading < 1);
      assert.ok(frame.inert && frame.displacement < 1);
      if (kind === 'orb') {
        assert.ok(frame.sourcePixel > 0);
        assert.equal(frame.canvasPixel, frame.sourcePixel);
      }
      await expect(page.getByRole('button', { name: 'Ready' })).toBeEnabled();
      await expect(page.getByRole('status')).toHaveCount(0);
      await expect(page.locator('[data-loading-icon-exit]')).toHaveCount(0);
    }

    const result = await page.evaluate(async () => {
      window.reply('', true);
      window.reply('First words', false);
      await Promise.resolve();
      const text = document.querySelector('main p').parentElement;
      const label = document.querySelector('.assistant-response-label');
      const fade = text.getAnimations().find(a => a.animationName === 'bb-loading-text-in');
      const { delay, duration } = fade.effect.getTiming();
      fade.pause();
      fade.currentTime = delay / 2;
      const duringExit = getComputedStyle(text).opacity;
      fade.currentTime = delay + duration / 2;
      const duringEntry = Number(getComputedStyle(text).opacity);
      window.reply('First words and more', false);
      const sameAnimation = text.getAnimations().includes(fade);
      const labelFades = label.getAnimations().some(a => a.animationName === 'bb-loading-text-in');
      fade.finish();
      const readable = getComputedStyle(text).opacity;
      window.show(null);
      window.reply('Saved reply', false);
      const cachedAnimations = document.querySelector('main p').parentElement.getAnimations().length;
      return { duringExit, duringEntry, delay, duration, sameAnimation, labelFades, readable, cachedAnimations };
    });
    assert.equal(result.delay, reducedMotion === 'reduce' ? 90 : 150);
    assert.equal(result.duration, result.delay);
    assert.equal(result.duringExit, '0');
    assert.ok(result.duringEntry > 0 && result.duringEntry < 1);
    assert.ok(result.sameAnimation && result.labelFades);
    assert.equal(result.readable, '1');
    assert.equal(result.cachedAnimations, 0);
  }
});
