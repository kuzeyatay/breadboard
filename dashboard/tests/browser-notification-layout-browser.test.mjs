import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));

test('browser controls stay separate and long notifications remain readable', { timeout: 60_000 }, async t => {
  const stubs = {
    'next/navigation': 'export const useRouter=()=>({push(){}});export const usePathname=()=>"/";export const useSearchParams=()=>new URLSearchParams();',
    'next/dynamic': 'export default ()=>()=>null;',
    './navigation-progress': 'export const startNavigationProgress=()=>{};',
    './chat-markdown': 'export default ()=>null;',
    '@/lib/notification-sound': 'export const chimeForNotifications=()=>()=>{};export const getNotificationSoundEnabled=()=>true;export const notificationDeliveryReceipts=()=>new Set();export const recordNotificationDelivery=()=>{};export const subscribeNotificationSound=()=>()=>{};',
    '@/app/components/use-desktop-tabs': 'export const useDesktopTabs=()=>window.tabState;',
    './use-browser-saved-items': 'const items=[];export const useBrowserSavedItems=()=>({items,ready:true,saving:false,save:async()=>true});',
    './use-browser-recent-searches': 'const items=[];export const useBrowserRecentSearches=()=>({items,remember:async()=>true,remove:async()=>true});',
    './use-browser-downloads': 'const snapshot={items:[],error:null};export const useBrowserDownloads=()=>({snapshot,ready:true});',
  };
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import BrowserNavigation from './src/app/browser/browser-navigation';
      import {Toaster} from './src/app/components/toast';
      window.commands=[];
      window.tabState={enabled:true,activeId:1,selfId:1,extensions:[],tabs:[{id:1,title:'Example',browser:{address:'https://example.test/',canGoBack:true,canGoForward:true}}]};
      window.breadboardDesktop={getTabsState:async()=>window.tabState,onTabsState:()=>()=>{},tabs:async command=>{window.commands.push(command);return true;}};
      function App(){
        const [data,setData]=useState({kind:'toolbar'});
        window.showLayout=setData;
        return data.kind==='toolbar' ? <BrowserNavigation showFlowers={false} restoreOwnerKey="fixture" onPanel={()=>{}}/>
          : <main className="bb-notification-overlay-page"><Toaster mode="desktop-overlay" toasts={data.toasts}
              onDismiss={id=>{window.dismissed=id;setData({kind:'toast',toasts:[]})}}
              onSizeChange={(width,height)=>{window.overlaySize={width,height}}}/></main>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, metafile: true, outfile: 'layout.js', platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': path.join(root, 'src') }, define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'layout-services', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: 'stub' } : null);
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], resolveDir: root }));
    } }],
  });
  const sources = Object.keys(bundle.metafile.inputs)
    .filter(file => !file.startsWith('stub:') && !file.includes('node_modules') && /\.[jt]sx?$/.test(file))
    .map(file => `@source "${path.resolve(file).replaceAll('\\', '/')}";`).join('\n');
  const cssPath = path.join(root, 'src/app/globals.css');
  const css = (await postcss([tailwind({ base: root })]).process(
    fs.readFileSync(cssPath, 'utf8').replace(/^@source[^;]+;/gm, sources), { from: cssPath })).css;
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><html data-theme="dark"><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css + bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n') });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  const capture = async name => {
    if (!process.env.BREADBOARD_LAYOUT_QA_DIR) return;
    fs.mkdirSync(process.env.BREADBOARD_LAYOUT_QA_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.BREADBOARD_LAYOUT_QA_DIR, `${name}.png`) });
  };

  for (const width of [600, 933, 1280, 1920]) {
    await page.setViewportSize({ width, height: 650 });
    for (const privateBrowsing of [false, true]) {
      await page.evaluate(value => {
        window.tabState.tabs[0].browser.private = value;
        window.showLayout({ kind: 'toolbar' });
      }, privateBrowsing);
      await expect(page.getByRole('combobox')).toBeVisible();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const bounds = await page.evaluate(() => {
        const controls = document.querySelector('.browser-navigation-controls').getBoundingClientRect();
        const address = document.querySelector('.browser-address-form').getBoundingClientRect();
        const reload = document.querySelector('[aria-label="Reload"]');
        const box = reload.getBoundingClientRect();
        const downloads = document.querySelector('[aria-label="Downloads"]').getBoundingClientRect();
        const menu = document.querySelector('[aria-label="Browser menu"]').getBoundingClientRect();
        return { controlsRight: controls.right, addressLeft: address.left, addressRight: address.right,
          downloadsLeft: downloads.left, menuRight: menu.right,
          reloadHit: reload.contains(document.elementFromPoint(box.right - 2, box.y + box.height / 2)) };
      });
      assert.ok(bounds.controlsRight < bounds.addressLeft, JSON.stringify({ width, privateBrowsing, bounds }));
      assert.ok(bounds.reloadHit, 'the right edge of Reload receives pointer input');
      assert.ok(bounds.addressRight < bounds.downloadsLeft, 'Downloads remains outside the address field');
      assert.ok(bounds.menuRight <= width, 'toolbar controls fit the viewport: ' + JSON.stringify({ width, privateBrowsing, bounds }));
      await page.getByRole('button', { name: 'Reload', exact: true }).click();
      assert.equal(await page.evaluate(() => window.commands.at(-1).type), 'reload');
    }
    if (width === 933) await capture('toolbar');
  }

  const message = 'Değerli Takım Kaptanlarımız, atölyede, sahada ve her adımda gençlerimize yol gösteren öğretmenlerimize teşekkür ederiz. '.repeat(20)
    + 'https://example.test/' + 'a'.repeat(500) + '\nMessage end.';
  for (const width of [608, 390]) {
    await page.setViewportSize({ width, height: 529 });
    await page.evaluate(message => window.showLayout({ kind: 'toast', toasts: [{ id: 'long', type: 'success',
      title: 'FRC 2026 Takım Kaptanları', message, website: { id: 'site', origin: 'https://example.test' } }] }), message);
    const body = page.getByLabel('Notification message', { exact: true });
    await expect(body).toHaveText(message);
    const layout = await body.evaluate(element => {
      const card = element.closest('.bb-toast-card').getBoundingClientRect();
      const dismiss = document.querySelector('[aria-label="Dismiss message"]').getBoundingClientRect();
      return { card: card.toJSON(), dismiss: dismiss.toJSON(), bodyTop: element.getBoundingClientRect().top,
        scrollable: element.scrollHeight > element.clientHeight, overflow: element.scrollWidth - element.clientWidth };
    });
    assert.ok(layout.card.x >= 0 && layout.card.y >= 0 && layout.card.right <= width && layout.card.bottom <= 529, JSON.stringify(layout));
    assert.ok(layout.scrollable, 'long website messages scroll inside the card');
    assert.ok(layout.overflow <= 1, 'even unbroken links fit the message width');
    assert.ok(layout.dismiss.bottom <= layout.bodyTop, 'dismiss remains above the scrolling message');
    await body.focus();
    await page.keyboard.press('Control+End');
    await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);
    await body.evaluate(element => { element.scrollTop = 0; });
    await capture(`notification-${width}`);
    await page.getByRole('button', { name: 'Dismiss message' }).click();
    await expect(page.locator('.bb-toast-card')).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.dismissed), 'long');
  }
  assert.deepEqual(errors, []);
});
