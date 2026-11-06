import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('Quartz image URLs use canonical assets across paths, deferred sections and changing ports', async () => {
  const bundle = await build({ entryPoints: [path.resolve(import.meta.dirname, '../src/lib/quartz-image-sources.ts')],
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'Images' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const sources = await page.evaluate(() => {
      const input = `<img src="/course/assets/image.png"><img src="../../course/assets/a%20b.png?version=2#view">
        <template><img src="/course/assets/later.webp"></template>
        <img src="https://external.test/course/assets/image.png"><img src="data:image/png;base64,AAAA">
        <img src="/static/logo.svg"><img src="http://quartz.test:6000/course/assets/direct.png">`;
      return [7000, 8000].map(port => {
        const output = Images.quartzImageSources(input, 'course/notes/lesson', 'http://quartz.test:6000', `http://app.test:${port}`);
        const template = document.createElement('template'); template.innerHTML = output;
        return [...template.content.querySelectorAll('img'), ...template.content.querySelector('template').content.querySelectorAll('img')]
          .map(image => image.getAttribute('src'));
      });
    });
    for (const [index, port] of [7000, 8000].entries()) assert.deepEqual(sources[index], [
      `http://app.test:${port}/course/assets/image.png`, `http://app.test:${port}/course/assets/a%20b.png?version=2#view`,
      'https://external.test/course/assets/image.png', 'data:image/png;base64,AAAA', '/static/logo.svg',
      `http://app.test:${port}/course/assets/direct.png`, `http://app.test:${port}/course/assets/later.webp`,
    ]);
  } finally { await browser.close(); }
});
