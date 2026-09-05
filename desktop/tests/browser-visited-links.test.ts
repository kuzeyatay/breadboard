import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { BROWSER_VISITED_LINKS_FILE, BrowserVisitedLinkStore, isGoogleSearchResultsPage, normalizedVisitedLink } from "../src/main/browser-visited-links";

test("visited destinations normalize fragments and Google redirects without merging distinct pages", () => {
  assert.equal(normalizedVisitedLink("/page?q=one#part", "https://example.com/results"), "https://example.com/page?q=one");
  assert.equal(normalizedVisitedLink("https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fone&sa=U"), "https://example.com/one");
  assert.equal(normalizedVisitedLink("https://www.google.co.uk/url?url=https%3A%2F%2Fexample.com%2Ftwo"), "https://example.com/two");
  for (const input of ["javascript:alert(1)", "file:///C:/secret", "https://name:password@example.com/", "https://www.google.com/url?q=javascript:alert(1)"]) {
    assert.equal(normalizedVisitedLink(input), null);
  }
});

test("visited-result styling is limited to Google searches with a query", () => {
  for (const url of [
    "https://www.google.com/search?q=one",
    "https://google.nl/search?q=one&start=10",
    "https://www.google.co.uk/search?q=one",
    "https://www.google.com.au/search?q=one",
  ]) assert.equal(isGoogleSearchResultsPage(url), true, url);
  for (const url of [
    "https://chatgpt.com/", "https://github.com/",
    "https://www.google.com/", "https://www.google.com/about?q=one",
    "https://www.google.com/search", "https://www.google.com/search?q=%20",
    "https://accounts.google.com/search?q=one",
    "https://google.com.example.org/search?q=one",
    "https://wwwXgoogleYcom/search?q=one",
    "file:///search?q=one", "not a URL",
  ]) assert.equal(isGoogleSearchResultsPage(url), false, url);
});

test("visited links persist across processes and stay scoped to the referring site", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-visited-links-"));
  try {
    const store = new BrowserVisitedLinkStore(fixture);
    assert.equal(store.remember("https://www.google.com/search?q=one", "https://example.com/page#part"), true);
    assert.equal(store.remember("https://www.google.com/search?q=two", "https://example.com/page"), false);
    store.remember("https://another.example/results", "https://elsewhere.example/");
    const result = spawnSync(process.execPath, ["-e", `
      const { BrowserVisitedLinkStore } = require(${JSON.stringify(require.resolve("../src/main/browser-visited-links"))});
      const store = new BrowserVisitedLinkStore(process.argv[1]);
      console.log(JSON.stringify([
        store.linksFor("https://www.google.com/search?q=different"),
        store.linksFor("https://another.example/"),
        store.linksFor("https://unrelated.example/")
      ]));
    `, fixture], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [["https://example.com/page"], ["https://elsewhere.example/"], []]);
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("an invalid visited-links file cannot be silently replaced", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-visited-links-corrupt-"));
  try {
    const file = path.join(fixture, BROWSER_VISITED_LINKS_FILE);
    fs.writeFileSync(file, '{"version":1,"entries":');
    assert.throws(() => new BrowserVisitedLinkStore(fixture));
    assert.equal(fs.readFileSync(file, "utf8"), '{"version":1,"entries":');
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("Electron colors visited Google result titles while preserving other websites and navigation", { skip: process.platform !== "win32" }, () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-visited-links-render-"));
  const electron = path.resolve(__dirname, "../../node_modules/electron/dist/electron.exe");
  const modulePath = require.resolve("../src/main/browser-visited-links");
  const resultFile = path.join(fixture, "result.json");
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ main: "main.cjs" }));
  fs.writeFileSync(path.join(fixture, "main.cjs"), `
    const { app, BrowserWindow, session } = require('electron');
    const fs = require('node:fs');
    const path = require('node:path');
    const assert = require('node:assert/strict');
    const { BrowserVisitedLinks, BrowserVisitedLinkStore } = require(${JSON.stringify(modulePath)});
    const configDir = ${JSON.stringify(fixture)};
    app.setPath('userData', path.join(configDir, 'profile'));
    let diagnostics = async () => '';
    const until = async (probe) => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (await probe()) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('Timed out waiting for visited-link rendering: ' + await diagnostics());
    };
    app.whenReady().then(async () => {
      const origin = 'https://www.google.com';
      const article = 'https://example.com/article';
      const searchUrl = origin + '/search?q=one';
      const partition = 'persist:visited-links-test';
      // Serve local fixture content at realistic origins; no network is used.
      session.fromPartition(partition).protocol.handle('https', () => new Response(
        '<!doctype html><html><head><style>body{background:white}a{color:rgb(18,52,86)}h3{color:inherit}</style></head><body>' +
        '<nav><a id="logo" href="/"><svg width="10" height="10" fill="currentColor"><path d="M0 0H10V10H0Z"/></svg>Home</a>' +
        '<a id="sidebar" href="' + article + '"><h3>Sidebar link</h3></a></nav>' +
        '<main id="search"><div id="rso">' +
        '<a id="visited" href="' + article + '"><span id="site-name">Example</span><h3>Article</h3></a>' +
        '<a id="fresh" href="https://example.com/other"><h3>Unvisited</h3></a>' +
        '<a id="newtab" href="https://example.com/newtab" target="_blank"><h3>New tab</h3></a>' +
        '<a id="internal" href="/"><h3>Google navigation</h3></a>' +
        '</div></main></body></html>',
        { headers: { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'" } }
      ));
      // Old all-site visit records must not recolor logos or sidebars.
      const legacyStore = new BrowserVisitedLinkStore(configDir);
      for (const source of ['https://github.com/', 'https://chatgpt.com/']) {
        legacyStore.remember(source, source);
        legacyStore.remember(source, article);
      }
      const windows = [];
      const open = (tracker) => {
        const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, partition } });
        windows.push(window);
        tracker.attach(window.webContents);
        return window.webContents;
      };
      const tracker = new BrowserVisitedLinks(configDir);
      const contents = open(tracker);
      diagnostics = () => contents.executeJavaScript("JSON.stringify({url:location.href,theme:document.documentElement.dataset.breadboardVisitedTheme,links:[...document.querySelectorAll('a')].map(a=>({href:a.href,marked:a.hasAttribute('data-breadboard-visited'),color:getComputedStyle(a).color}))})");
      const color = (contents, selector) => contents.executeJavaScript('getComputedStyle(document.querySelector(' + JSON.stringify(selector) + ')).color');
      const unchanged = async (page) => {
        for (const selector of ['#logo', '#logo svg', '#sidebar h3', '#visited', '#site-name', '#internal h3']) {
          assert.equal(await color(page, selector), 'rgb(18, 52, 86)', selector + ' at ' + page.getURL());
        }
      };
      const noStyling = async (page) => {
        await unchanged(page);
        assert.equal(await color(page, '#visited h3'), 'rgb(18, 52, 86)');
        assert.equal(await page.executeJavaScript("document.querySelectorAll('[data-breadboard-visited]').length"), 0);
        assert.equal(await page.executeJavaScriptInIsolatedWorld(1001, [{code: 'typeof globalThis.__breadboardVisitedLinks'}]), 'undefined');
      };
      tracker.remember(searchUrl, origin + '/');
      await contents.loadURL(searchUrl);
      await until(async () => (await color(contents, '#visited')) === 'rgb(18, 52, 86)');
      await contents.executeJavaScript("document.getElementById('visited').click()", true);
      await until(() => contents.getURL() === article && !contents.isLoading());
      await noStyling(contents);
      // Breadboard's Back command selects an explicit entry, avoiding Chromium's
      // history-abuse skip heuristic for a page entered by a scripted fixture.
      assert.equal(contents.navigationHistory.canGoBack(), true);
      contents.navigationHistory.goToIndex(0);
      await until(async () => contents.getURL() === searchUrl && (await color(contents, '#visited h3')) === 'rgb(104, 29, 168)');
      assert.equal(await color(contents, '#fresh h3'), 'rgb(18, 52, 86)');
      await unchanged(contents);
      contents.reload();
      await until(async () => !contents.isLoading() && (await color(contents, '#visited h3')) === 'rgb(104, 29, 168)');
      contents.setWindowOpenHandler(({ url }) => {
        tracker.remember(contents.getURL(), url);
        void open(tracker).loadURL(url);
        return { action: 'deny' };
      });
      await contents.executeJavaScript("document.getElementById('newtab').click()", true);
      await until(async () => (await color(contents, '#newtab h3')) === 'rgb(104, 29, 168)');
      await contents.executeJavaScript("const a=document.createElement('a');a.id='dynamic';a.href='https://example.com/article#part';const h=document.createElement('h3');h.textContent='Dynamic result';a.appendChild(h);document.getElementById('rso').appendChild(a)");
      await until(async () => (await color(contents, '#dynamic h3')) === 'rgb(104, 29, 168)');
      await contents.executeJavaScript("document.getElementById('dynamic').href='/never-visited'");
      await until(async () => (await color(contents, '#dynamic h3')) === 'rgb(18, 52, 86)');
      const restored = open(new BrowserVisitedLinks(configDir));
      await restored.loadURL(origin + '/search?q=different-query');
      await until(async () => (await color(restored, '#visited h3')) === 'rgb(104, 29, 168)');
      await restored.executeJavaScript("document.body.style.backgroundColor='rgb(25,25,25)'");
      await until(async () => (await color(restored, '#visited h3')) === 'rgb(197, 138, 249)');
      await unchanged(restored);
      await restored.executeJavaScript("history.pushState({}, '', '/about')");
      await until(async () => (await color(restored, '#visited h3')) === 'rgb(18, 52, 86)');
      assert.equal(await restored.executeJavaScript("document.querySelectorAll('[data-breadboard-visited]').length"), 0);
      await restored.executeJavaScript("history.pushState({}, '', '/search?q=again')");
      await until(async () => (await color(restored, '#visited h3')) === 'rgb(197, 138, 249)');
      for (const url of ['https://github.com/', 'https://chatgpt.com/', origin + '/', origin + '/about', origin + '/search']) {
        const page = open(tracker);
        await page.loadURL(url);
        await noStyling(page);
      }
      const home = open(tracker);
      await home.loadURL(origin + '/');
      await home.executeJavaScript("history.pushState({}, '', '/search?q=spa')");
      await until(async () => (await color(home, '#visited h3')) === 'rgb(104, 29, 168)');
      assert.equal(await restored.executeJavaScript("typeof window.__breadboardVisitedLinks"), 'undefined');
      assert.equal(await restored.executeJavaScript("typeof window.breadboardDesktop"), 'undefined');
      fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ ok: true }));
      for (const window of windows) window.destroy();
      session.fromPartition(partition).protocol.unhandle('https');
      app.exit(0);
    }).catch(error => {
      fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ error: String(error), stack: error.stack }));
      app.exit(1);
    });
  `);
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(electron, [fixture, "--disable-gpu", "--no-sandbox"], { env, encoding: "utf8", windowsHide: true, timeout: 45_000 });
    const receipt = fs.existsSync(resultFile) ? fs.readFileSync(resultFile, "utf8") : result.stderr;
    assert.equal(result.status, 0, receipt);
    assert.deepEqual(JSON.parse(receipt), { ok: true });
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
