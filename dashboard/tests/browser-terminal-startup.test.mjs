import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = path.resolve(import.meta.dirname, "..");
const clientPath = path.join(root, "src/app/browser/browser-client.tsx");

async function browserFixture(t, initialState, { storedWidth } = {}) {
  // Exercise the real browser shell; replace unrelated widgets and the chat
  // transport. Splitting stays enabled so a click-time import remains observable.
  const source = fs.readFileSync(clientPath, "utf8");
  const tree = ts.createSourceFile(clientPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const mocks = new Map();
  for (const node of tree.statements) {
    if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly || !node.importClause) continue;
    const name = node.moduleSpecifier.text;
    if (name === "react" || name === "next/dynamic" || name === "./browser-tab-panes") continue;
    const clause = node.importClause;
    const exports = clause.namedBindings && ts.isNamedImports(clause.namedBindings)
      ? clause.namedBindings.elements.filter(e => !e.isTypeOnly).map(e => (e.propertyName ?? e.name).text) : [];
    mocks.set(name, `${clause.name ? 'export default () => null;' : ''}\n${exports.map(e => `export const ${e} = () => null;`).join('\n')}`);
  }
  mocks.set("@/app/components/use-desktop-tabs", `
    import {createContext, useContext, useSyncExternalStore} from 'react';
    export const DesktopTabIdentityContext = createContext(undefined);
    export const useDesktopTabs = () => {
      const identity = useContext(DesktopTabIdentityContext);
      const state = useSyncExternalStore(window.tabs.subscribe, window.tabs.snapshot);
      return state && identity !== undefined ? {...state, selfId:identity} : state;
    };
  `);
  mocks.set("@/lib/desktop-browser-tabs", `
    export const browserBookmarksControl = () => null;
    export const openBrowserInDesktop = async () => true;
    export const refreshDesktopTabsState = async () => {};
    export const sendDesktopTabsCommand = async command => {
      if (command.type === 'browser-terminal') window.tabs.open(command.open, command.width);
    };
  `);
  mocks.set("@/app/components/hermes/dashboard-agent-terminal", `
    import {useEffect, useState} from 'react';
    export default function Terminal({initialDraft}) {
      const [draft, setDraft] = useState(initialDraft ?? '');
      useEffect(() => { window.terminalMounts = (window.terminalMounts ?? 0) + 1; }, []);
      return <textarea aria-label="Terminal message" value={draft} onChange={e => setDraft(e.target.value)} />;
    }
  `);
  mocks.set("./use-browser-saved-items", "export const useBrowserSavedItems = () => ({items: [], ready: true});");
  mocks.set("./use-browser-recent-searches", "export const useBrowserRecentSearches = () => ({items: []});");
  mocks.set("./browser-recent-searches", "export const searchSuggestions = () => []; export const looksLikeBrowserAddress = () => false;");
  mocks.set("@/app/components/use-page-appearance", "export const usePageAppearance = () => ({ready: true});");
  mocks.set("@/app/components/hermes/use-chat-greeting", "export const useChatGreeting = () => ({greeting: '', suggestionSources: {}});");
  mocks.set("@/lib/speech/clap/targets", "export const registerClapDock = () => () => {};");
  const bundle = await build({
    absWorkingDir: root, bundle: true, write: false, splitting: true, format: "esm",
    platform: "browser", jsx: "automatic", outdir: "terminal-startup-test", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import {createRoot} from 'react-dom/client';
      import BrowserClient from './src/app/browser/browser-client';
      const listeners = new Set();
      let state = ${JSON.stringify(initialState)};
      window.tabs = {
        snapshot: () => state,
        subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
        publish: next => { state = next; listeners.forEach(fn => fn()); },
        open: (open, width) => {
          if (!state) return;
          state = {...state,tabs:state.tabs.map(tab => tab.id === state.activeId
            ? {...tab,browser:{...tab.browser,terminalOpen:open,...(width === undefined ? {} : {terminalWidth:width})}} : tab)};
          listeners.forEach(fn => fn());
        }
      };
      createRoot(document.getElementById('root')).render(<BrowserClient restoreOwnerKey="test" showFlowers={false} initialGreetingSignals={{}} home={<section data-testid="terminal-home">Terminal home</section>}/>);
    ` },
    plugins: [{ name: "browser-shell-dependencies", setup(build) {
      build.onResolve({ filter: /.*/ }, args => mocks.has(args.path) ? { path: args.path, namespace: "mock" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks.get(args.path), loader: "tsx", resolveDir: root }));
    } }],
  });
  const files = new Map(bundle.outputFiles.map(file => [path.basename(file.path), file.text]));
  const executablePath = [chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(fs.existsSync);
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const lateScripts = [];
  let shellReady = false;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://terminal.test/**", async route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (files.has(name)) {
      if (shellReady) { lateScripts.push(name); await route.abort(); return; }
      await route.fulfill({ contentType: "text/javascript", body: files.get(name) });
    } else {
      await route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script type="module" src="/stdin.js"></script>' });
    }
  });
  if (storedWidth !== undefined) await page.addInitScript(width => {
    localStorage.setItem('breadboard:browser-terminal-width:test', String(width));
  }, storedWidth);
  await page.goto("http://terminal.test/");
  return { page, errors, lateScripts, markShellReady: () => { shellReady = true; } };
}

test("browser Terminal opens without another script request and preserves its draft", { timeout: 30_000 }, async t => {
  const { page, errors, lateScripts, markShellReady } = await browserFixture(t, {
    enabled: true, activeId: 1, selfId: 1,
    tabs: [{ id: 1, title: "Example", url: "http://terminal.test/browser", browser: { address: "https://example.com", pageReady: true, terminalOpen: false } }],
  });
  const launcher = page.getByRole("button", { name: "Open Terminal", exact: true });
  await launcher.waitFor();
  assert.equal(await page.evaluate(() => window.terminalMounts ?? 0), 0, "unopened tabs must not mount chat runtimes");
  markShellReady();
  await launcher.click();
  const composer = page.getByRole("textbox", { name: "Terminal message" });
  await composer.waitFor({ timeout: 2_000 });
  await composer.fill("Keep this unsent draft");
  await page.locator(".browser-terminal-drawer > .browser-terminal-close").click();
  await launcher.click();
  assert.equal(await composer.inputValue(), "Keep this unsent draft");
  assert.equal(await page.evaluate(() => window.terminalMounts), 1);
  assert.deepEqual(lateScripts, [], "opening Terminal must not need another JavaScript download");
  assert.deepEqual(errors, []);
});

test("restoring a Terminal width reserves the same space in the native browser", { timeout: 30_000 }, async t => {
  const { page, errors } = await browserFixture(t, {
    enabled: true, activeId: 1, selfId: 1,
    tabs: [{ id: 1, title: "Example", url: "http://terminal.test/browser",
      browser: { address: "https://example.com", pageReady: true, terminalOpen: true, terminalWidth: 640 } }],
  }, { storedWidth: 700 });
  await page.getByRole('textbox', { name: 'Terminal message' }).waitFor();
  await page.waitForFunction(() => {
    const width = window.tabs.snapshot().tabs[0].browser.terminalWidth;
    return width === 700 && document.querySelector('.browser-terminal-drawer').style.getPropertyValue('--browser-terminal-width') === `${width}px`;
  });
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForFunction(() => window.tabs.snapshot().tabs[0].browser.terminalWidth === 500
    && document.querySelector('.browser-terminal-drawer').style.getPropertyValue('--browser-terminal-width') === '500px');
  await page.setViewportSize({ width: 640, height: 700 });
  await page.waitForFunction(() => document.querySelector('.browser-terminal-drawer').style.getPropertyValue('--browser-terminal-width') === '320px');
  assert.deepEqual(errors, []);
});

test("terminal home gives way to the selected website rail before its first frame", { timeout: 30_000 }, async t => {
  const { page, errors } = await browserFixture(t, null);
  const home = page.getByTestId("terminal-home");
  await page.locator("#root > *").first().waitFor({ state: "attached" });
  assert.equal(await home.count(), 0, "unknown native state cannot briefly mount the terminal home");
  const makeTab = (id, address = "") => ({ id, title: "Browser", url: address, loading: Boolean(address),
    browser: { uiKey: String(id), uiVisited: true, address, pageReady: false, terminalOpen: false } });
  let state = { enabled: true, persistentShell: true, activeId: 1, selfId: 1, presentedId: 1,
    presentationStatus: "presented", tabs: [makeTab(1)] };
  const publish = async () => {
    await page.evaluate(next => window.tabs.publish(next), state);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  await publish();
  await home.waitFor();
  // Address-bar navigation from home: the first response has not arrived.
  state = { ...state, presentationStatus: "pending", tabs: [makeTab(1, "https://example.com")] };
  await publish();
  await page.getByRole("navigation", { name: "Browser tools" }).waitFor();
  assert.equal(await home.count(), 0, "loading a website must remove the terminal home immediately");
  // Back restores home, then opening a different website tab must select its
  // rail even while the previous home remains the last presented native page.
  state = { ...state, presentationStatus: "presented", tabs: [makeTab(1)] };
  await publish();
  await home.waitFor();
  state = { ...state, activeId: 2, selfId: 2, presentationStatus: "pending", tabs: [makeTab(1), makeTab(2, "https://example.org")] };
  await publish();
  const target = page.locator('[data-browser-content-id="2"]');
  assert.equal(await target.isVisible(), true, "the native web view and its rail must belong to the same selected tab");
  assert.equal(await page.locator('[data-browser-content-id="1"]').isVisible(), false);
  await target.getByRole("button", { name: "Open Terminal", exact: true }).waitFor();
  // A completed page going back through pageReady=false must keep the rail.
  for (const ready of [true, false]) {
    state = { ...state, tabs: state.tabs.map(tab => tab.id === 2 ? { ...tab, browser: { ...tab.browser, pageReady: ready } } : tab) };
    await publish();
    assert.equal(await target.getByRole("navigation", { name: "Browser tools" }).isVisible(), true);
    assert.equal(await target.getByTestId("terminal-home").count(), 0);
  }
  assert.deepEqual(errors, []);
});
