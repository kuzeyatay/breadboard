import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { installCanonicalQuartzReader } from '../../quartz/quartz/components/scripts/canonicalReader.mjs';

test('the current page is recovered when the host missed navigation, including an existing reader and later SPA moves', { timeout: 30_000 }, async () => {
  const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser=await chromium.launch({headless:true,...(fs.existsSync(edge)?{executablePath:edge}:{})});
  try {
    const page=await browser.newPage();
    await page.route('http://localhost:53152/**',route=>route.fulfill({contentType:'text/html',body:
      new URL(route.request().url()).pathname==='/frame'
      ? `<html><head><title>LTI systems</title><script>window.__canonicalQuartzReaderMetadata=true;(${installCanonicalQuartzReader.toString()})();</script></head><body data-slug="ec-2/notes/lti"><article>Saved note</article></body></html>`
      : '<html><body><iframe src="/frame"></iframe></body></html>'}));
    await page.goto('http://localhost:53152/');
    await page.frameLocator('iframe').locator('article').waitFor();
    // The first announcement is already gone before the host listener starts.
    await page.evaluate(()=>{window.messages=[];window.addEventListener('message',e=>window.messages.push(e.data));document.querySelector('iframe').contentWindow.postMessage({type:'second-brain:request-navigation'},location.origin)});
    await page.waitForFunction(()=>window.messages.some(m=>m.slug==='ec-2/notes/lti'));
    assert.equal(await page.evaluate(()=>window.messages.at(-1).title),'LTI systems');
    const frame=page.frames().find(f=>f.url().endsWith('/frame'));
    await frame.evaluate(()=>{document.body.dataset.slug='ec-2/notes/filters';document.title='Filters';document.dispatchEvent(new Event('nav'))});
    await page.waitForFunction(()=>window.messages.at(-1)?.slug==='ec-2/notes/filters');
    const count=await page.evaluate(()=>window.messages.length);
    await frame.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:{type:'second-brain:request-navigation'}})));
    assert.equal(await page.evaluate(()=>window.messages.length),count,'Only the embedding host can request a page announcement');
    await page.locator('iframe').evaluate(f=>f.contentWindow.location.reload());
    await page.waitForFunction(()=>window.messages.at(-1)?.slug==='ec-2/notes/lti');
  } finally {await browser.close()}
});
