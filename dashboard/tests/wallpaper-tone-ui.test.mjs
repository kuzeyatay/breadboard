import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import esbuild from "esbuild";
import ts from "typescript";
import { chromium } from "playwright";
import { wallpaperToneFromPixels } from "../src/lib/wallpaper-tone.ts";

test("wallpaper contrast uses image luminance and ignores transparent pixels", () => {
  assert.equal(wallpaperToneFromPixels(new Uint8ClampedArray([18, 22, 45, 255])), "dark");
  assert.equal(wallpaperToneFromPixels(new Uint8ClampedArray([245, 240, 225, 255])), "light");
  assert.equal(wallpaperToneFromPixels(new Uint8ClampedArray([110, 110, 110, 255])), "dark");
  assert.equal(wallpaperToneFromPixels(new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 255])), "light");
  assert.equal(wallpaperToneFromPixels(new Uint8ClampedArray([255, 255, 255, 0])), null);
});

// Use the real surfaces' attributes so losing the measured-tone wiring fails QA.
function mainOpening(root, file) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let opening;
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === "main") opening = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(opening);
  return opening;
}

test("greetings follow uploaded and Pixabay images across theme changes, reloads, and stale decodes", { timeout: 60_000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, "..");
  const browserMain = mainOpening(root, "src/app/browser/browser-client.tsx");
  const newTabMain = mainOpening(root, "src/app/new-tab/new-tab-client.tsx");
  const bundle = await esbuild.build({
    absWorkingDir: root,
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, { StrictMode } from 'react';
      import { createRoot } from 'react-dom/client';
      import { usePageAppearance } from './src/app/components/use-page-appearance';
      import PageAppearance from './src/app/components/page-appearance';
      import { APP_THEME_CHANGE_EVENT } from './src/lib/app-theme';
      import { AnimatedBrowserGreeting, BrowserQuickLinks } from './src/app/browser/browser-home-widgets';
      import NewTabGreeting from './src/app/new-tab/new-tab-greeting';
      import styles from './src/app/new-tab/new-tab-controls.module.css';
      function App() {
        const page = new URLSearchParams(location.search).get('surface') || 'browser';
        const appearance = usePageAppearance('contrast-qa', page);
        const personalization = appearance;
        const hasNativePage = false;
        const backgroundImage = appearance.wallpaper?.src;
        window.choose = value => appearance.save({background: {theme: appearance.theme, value}});
        window.setTheme = theme => {
          localStorage.setItem('breadboard:theme', theme);
          document.documentElement.dataset.theme = theme;
          window.dispatchEvent(new Event(APP_THEME_CHANGE_EVENT));
        };
        if (new URLSearchParams(location.search).has('picker')) return <>
          <output data-testid="background">{backgroundImage || ''}</output>
          <PageAppearance page={page} ownerKey="contrast-qa" initialOpen />
        </>;
        return page === 'browser' ? ${browserMain}
          <div className="browser-start-copy">
            <AnimatedBrowserGreeting greeting={{lead: 'Happy Sunday', question: 'What are you trying to work out?'}} />
            <div className="browser-home-search"><input placeholder="Search with Google or enter an address" /></div>
            <BrowserQuickLinks ownerKey="contrast-qa" navigate={() => {}} />
          </div>
        </main> : ${newTabMain}
          <div className={styles.launcher}><header className={styles.heading}><NewTabGreeting addressee="stargazer" /></header></div>
        </main>;
      }
      createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
    ` },
    bundle: true, write: false, outfile: "fixture.js", format: "iife", platform: "browser", jsx: "automatic",
  });
  // These are plain CSS rules; omit Tailwind directives in this isolated fixture.
  const globals = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8").replace(/^@import[^;]+;/gm, "");
  const scripts = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
  const modules = bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
  const saved = new Map();
  const handler = async (request, response) => {
    const preset = new URL(request.url, 'http://localhost').pathname.match(/^\/browser-wallpapers\/((?:thumbnails\/)?[a-z-]+\.webp)$/)?.[1];
    if (preset) {
      response.setHeader('Content-Type', 'image/webp');
      return response.end(fs.readFileSync(path.join(root, 'public/browser-wallpapers', preset)));
    }
    if (request.url.startsWith('/api/profile/page-appearance?')) {
      const page = new URL(request.url, 'http://localhost').searchParams.get('page');
      response.setHeader('Content-Type', 'application/json');
      if (request.method === 'PATCH') {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const preferences = saved.get(page) || {};
        if (!body.onlyIfMissing || !preferences[body.theme]) preferences[body.theme] = body.value;
        saved.set(page, preferences);
        response.end(JSON.stringify({ value: preferences[body.theme] }));
      } else response.end(JSON.stringify({ preferences: saved.get(page) || {} }));
      return;
    }
    const isScript = request.url === "/fixture.js";
    response.setHeader("Content-Type", isScript ? "text/javascript" : "text/html");
    response.end(isScript ? scripts : `<!doctype html><html data-theme="light"><head><style>${globals}\n${modules}
      html { --font-schibsted: Arial; --font-source-sans: Arial; }
      body { margin: 0; } #root { display: flex; height: 100vh; } main { width: 100%; }
      .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
      </style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  };
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  const images = await page.evaluate(() => {
    const make = color => {
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
      const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 160, 90);
      return canvas.toDataURL('image/png');
    };
    return { dark: make('#12162d'), light: make('#f5f0e1') };
  });
  const darkPhoto = fs.readFileSync(path.join(root, "public/browser-wallpapers/astral-nebula.webp"));
  const lightPhoto = fs.readFileSync(path.join(root, "public/browser-wallpapers/alpine-dawn.webp"));
  await page.route("**/api/browser-wallpapers/pixabay?*", route => route.fulfill({ contentType: "image/webp", body: route.request().url().includes("id=2&") ? lightPhoto : darkPhoto }));
  const choose = value => page.evaluate(value => window.choose(value), value);
  const theme = value => page.evaluate(value => window.setTheme(value), value);
  const check = async tone => {
    await page.waitForFunction(tone => document.querySelector('main')?.dataset.wallpaperTone === tone, tone);
    const expected = tone === "dark" ? "rgb(251, 252, 249)" : "rgb(18, 32, 25)";
    assert.equal(await page.locator("h1").evaluate(el => getComputedStyle(el).color), expected);
    const question = page.locator(".browser-greeting p");
    if (await question.count()) assert.equal(await question.evaluate(el => getComputedStyle(el).color), expected);
    const addressee = page.locator('[class*="addressee"]');
    if (await addressee.count()) assert.equal(await addressee.evaluate(el => getComputedStyle(el).color), tone === "dark" ? "rgb(154, 198, 172)" : "rgb(106, 141, 117)");
  };
  for (const surface of ["browser", "new-tab"]) {
    await page.goto(`${base}?surface=${surface}`);
    await page.waitForFunction(() => typeof window.choose === 'function');
    await theme("light");
    await choose(images.dark); await check("dark");
    await choose(images.light); await check("light");
    await theme("dark");
    await choose(images.light); await check("light");
    await choose(images.dark); await check("dark");
    await theme("light");
    await choose("pixabay:1"); await check("dark");
    await page.reload(); await check("dark");
    if (process.env.WALLPAPER_QA_DIR) {
      fs.mkdirSync(process.env.WALLPAPER_QA_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.WALLPAPER_QA_DIR, `${surface}-dark-photo.png`) });
    }
    await choose("pixabay:2"); await check("light");
    if (process.env.WALLPAPER_QA_DIR) await page.screenshot({ path: path.join(process.env.WALLPAPER_QA_DIR, `${surface}-light-photo.png`) });
    // Delay an actual decode and ensure its late result cannot replace a newer choice.
    await page.evaluate(() => {
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = async function () {
        await decode.call(this);
        if (this.src.includes('id=3&')) await new Promise(resolve => { window.releaseOldImage = resolve; });
      };
    });
    await choose("pixabay:3");
    await page.waitForFunction(() => typeof window.releaseOldImage === 'function');
    await choose(images.light); await check("light");
    await page.evaluate(() => { window.releaseOldImage(); delete window.releaseOldImage; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await check("light");
    await choose("none");
    await page.waitForFunction(() => !document.querySelector('main').style.backgroundImage && !document.querySelector('main').style.getPropertyValue('--browser-wallpaper-image'));
    // Corrupt photos retain a usable fallback and never throw into React.
    await choose("data:image/png;base64,YnJva2Vu"); await check("light");
  }
  // Exercise the actual upload control, then change origins as the desktop
  // does on restart: the new origin has no localStorage to fall back to.
  await page.goto(`${base}?surface=new-tab&picker=1`);
  assert.equal(await page.getByRole('group', { name: 'Page to customize', exact: true }).count(), 0);
  const generated = page.locator('.browser-wallpaper-thumbnail img');
  assert.equal(await generated.count(), 6);
  await page.waitForFunction(() => [...document.querySelectorAll('.browser-wallpaper-thumbnail img')].every(image => image.complete && image.naturalWidth > 0));
  await page.getByRole('button', { name: 'Alpine dawn, Places', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="background"]')?.textContent === '/browser-wallpapers/alpine-dawn.webp');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-testid="background"]')?.textContent === '/browser-wallpapers/alpine-dawn.webp');
  assert.equal(await page.getByRole('button', { name: 'Alpine dawn, Places', exact: true }).getAttribute('aria-pressed'), 'true');
  // Failed image requests leave the working background in place and can retry.
  await page.route('**/browser-wallpapers/moonlit-coast.webp', route => route.fulfill({status:503, body:'unavailable'}));
  await page.reload();
  await page.waitForFunction(() => {
    const image = document.querySelector('.browser-wallpaper-thumbnail img[src$="moonlit-coast.webp"]');
    return image?.complete && image.naturalWidth > 0; // Preview remains usable when the full image fails.
  });
  await page.getByRole('button', { name: 'Moonlit coast, Places', exact: true }).click();
  await page.getByRole('alert').filter({hasText:'Couldn’t load that image'}).waitFor();
  assert.equal(await page.getByTestId('background').textContent(), '/browser-wallpapers/alpine-dawn.webp');
  await page.unroute('**/browser-wallpapers/moonlit-coast.webp');
  await page.getByRole('button', { name: 'Moonlit coast, Places', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="background"]')?.textContent === '/browser-wallpapers/moonlit-coast.webp');
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/api/profile/page-appearance') && response.request().method() === 'PATCH'),
    page.getByLabel('Upload background image', { exact: true }).setInputFiles({ name: 'night.webp', mimeType: 'image/webp', buffer: darkPhoto }),
  ]);
  await page.waitForFunction(() => document.querySelector('[data-testid="background"]')?.textContent.startsWith('data:image/'));
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  const uploaded = await page.getByTestId('background').textContent();
  assert.equal(saved.get('new-tab').light.background, uploaded);
  const restartedServer = http.createServer(handler);
  await new Promise(resolve => restartedServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => restartedServer.close(resolve)));
  await page.goto(`http://127.0.0.1:${restartedServer.address().port}?surface=new-tab&picker=1`);
  await page.waitForFunction(image => document.querySelector('[data-testid="background"]')?.textContent === image, uploaded);
  assert.equal(await page.getByRole('img', { name: 'Your uploaded background' }).count(), 1);
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/api/profile/page-appearance') && response.request().method() === 'PATCH'),
    page.getByRole('button', { name: 'Remove uploaded image', exact: true }).click(),
  ]);
  await page.waitForFunction(() => document.querySelector('[data-testid="background"]')?.textContent === '');
  await page.reload();
  assert.equal(await page.getByRole('img', { name: 'Your uploaded background' }).count(), 0);
  assert.deepEqual(errors, []);
});
