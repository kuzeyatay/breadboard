const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, ipcMain } = require('electron');
const { WindowManager } = require('../../dist/main/window-manager.js');
const { IPC_CHANNELS } = require('../../dist/shared/ipc-contract.js');
const { readBrowserRecentSearches, writeBrowserRecentSearches } = require('../../dist/main/browser-recent-searches.js');
const esbuild = require('../../../dashboard/node_modules/esbuild');
const dir = process.argv.at(-1);
app.setPath('userData', path.join(dir, 'profile'));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => {});
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (_event, level, message) => { if (level >= 3) console.error(message); });
});
const until = async (probe, label) => {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out: ' + label);
};

app.whenReady().then(async () => {
  const dashboard = path.resolve(__dirname, '../../../dashboard');
  const stubs = {
    'next/navigation': `export const useRouter=()=>({push:()=>{}}); export const usePathname=()=>'/new-tab'; export const useSearchParams=()=>new URLSearchParams();`,
    '@/app/components/navigation-link': `export default ({children})=>children;`,
    'next/link': `export default ({children})=>children;`,
    '@/app/components/page-appearance': `export default ()=>null;`,
    '@/app/components/use-page-appearance': `export const usePageAppearance=()=>({ready:true,hasWallpaper:false});`,
    '@/app/components/hermes/use-chat-greeting': `export const useChatGreeting=()=>({greeting:{}});`,
    '@/app/components/hermes/dashboard-agent-terminal': `export default ()=>null;`,
    './browser-navigation': `export default ()=>null;`,
    './browser-home-accessories': `export default ()=>null;`,
    '@/app/browser/browser-home-widgets': `
      export const BrowserSketchOutline=()=>null;
      export const AnimatedBrowserGreeting=()=>null;
      export const BrowserQuickLinks=()=>null;
      export const BrowserSiteIcon=()=>null;
      export const GoogleGlyph=()=>null;
      export const SearchGlyph=()=>null;
      export const websiteIconUrl=()=>'';`,
  };
  stubs['./browser-home-widgets'] = stubs['@/app/browser/browser-home-widgets'];
  const bundle = await esbuild.build({
    stdin: { resolveDir: dashboard, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import NewTabSearch from '@/app/new-tab/new-tab-search';
      import BrowserClient from '@/app/browser/browser-client';
      import NavigationProgress from '@/app/components/navigation-progress';
      const home = <section data-fixture-home><NewTabSearch ownerKey="fixture-id" browserOwnerKey="fixture@example.test" gardens={[]} initialHistory={[]}><p>Home shortcuts</p></NewTabSearch></section>;
      createRoot(document.getElementById('root')).render(<><NavigationProgress/>
        {location.pathname === '/browser' ? <BrowserClient showFlowers={false} restoreOwnerKey="fixture@example.test" home={home}/> : home}</>);
    ` },
    bundle: true, write: false, outdir: path.join(dir, 'bundle'), format: 'iife', platform: 'browser', jsx: 'automatic',
    alias: { '@': path.join(dashboard, 'src') }, define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'account-services', setup(build) {
      build.onResolve({filter: /.*/}, ({path: name}) => name in stubs ? {path:name, namespace:'stub'} : undefined);
      build.onLoad({filter: /.*/, namespace:'stub'}, ({path:name}) => ({contents:stubs[name], loader:'js'}));
    } }],
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  let releaseImage;
  const server = http.createServer((req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('content-type', 'text/javascript'); return res.end(js); }
    if (req.url === '/held-image') {
      releaseImage = () => { res.setHeader('content-type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg"/>'); };
      return;
    }
    if (req.url.startsWith('/api/')) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({results:[], unavailable:[], limited:[], items:[]}));
    }
    res.setHeader('content-type', 'text/html');
    if (req.url.startsWith('/website')) {
      const respond = () => res.end('<!doctype html><title>' + (req.url.includes('streaming') ? 'Streaming page' : 'Saved website') + '</title><body>Destination loaded' +
        (req.url.includes('streaming') ? '<img src="/held-image">' : '') + '</body>');
      if (req.url.includes('slow')) setTimeout(respond, 700);
      else respond();
      return;
    }
    res.end('<!doctype html><body><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scene = path.join(dir, 'scene.html');
  fs.writeFileSync(scene, '<!doctype html>');
  const manager = new WindowManager({
    allowed: {origins:new Set([origin]), localFiles:new Set([pathToFileURL(scene).href])},
    startupHtmlPath:scene, recoveryHtmlPath:scene, loadingHtmlPath:scene,
    preloadPath:path.resolve(__dirname, '../../dist/preload/preload.js'), minimumStartupVisibleMs:0,
    browserHistoryConfigDir:dir,
  });
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.tabs.stateFor(event.sender));
  const commands = [];
  const navigateBrowser = manager.tabs.navigateBrowser.bind(manager.tabs);
  manager.tabs.navigateBrowser = (host, tab, input) => {
    if (input === 'fixture toolbar search') {
      commands.push({type:'browser-navigate', input, source:'toolbar'});
      return true;
    }
    return navigateBrowser(host, tab, input);
  };
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => {
    commands.push(command);
    // A repeated search must submit its clean query, not reopen a visited page.
    // Route only this fixture query locally so the test doesn't contact Google.
    if (command.type === 'browser-navigate' && command.input === 'https://www.google.com/search?q=Existing%20profile%20search') {
      return manager.tabs.handleCommand(event.sender, {...command,input:origin + '/website?from=home#saved'});
    }
    // Verify the real search handoff without sending test queries to Google.
    if ((command.type === 'browser' || command.type === 'browser-navigate') &&
        (command.url || command.input)?.startsWith('https://www.google.com/search?q=fixture%20web')) return true;
    return manager.tabs.handleCommand(event.sender, command);
  });
  ipcMain.handle(IPC_CHANNELS.getBrowserBookmarks, () => []);
  ipcMain.handle(IPC_CHANNELS.getBrowserDownloads, () => ({items:[],error:null}));
  ipcMain.handle(IPC_CHANNELS.getBrowserHistory, () => manager.tabs.browserHistory.snapshot());
  ipcMain.handle(IPC_CHANNELS.browserHistoryCommand, (_event, command) => manager.tabs.browserHistory.command(command));
  ipcMain.handle(IPC_CHANNELS.getBrowserRecentSearches, (_event, owner) => readBrowserRecentSearches(dir, owner));
  let holdHistorySave = false, releaseHistorySave;
  ipcMain.handle(IPC_CHANNELS.setBrowserRecentSearches, async (_event, owner, entries) => {
    if (holdHistorySave) await new Promise(resolve => { releaseHistorySave = resolve; });
    writeBrowserRecentSearches(dir, owner, entries); return true;
  });
  writeBrowserRecentSearches(dir, 'fixture@example.test', ['Existing profile search']);
  const window = manager.createMainWindow();
  window.setOpacity(0);
  window.showInactive();
  const base = manager.page(window);
  await base.loadURL(origin + '/new-tab');
  manager.tabs.setBrowserUrl(origin + '/browser');
  const host = manager.tabs.hosts.get(window.id);
  const search = async (contents, value) => {
    await until(() => contents.executeJavaScript(`!!document.querySelector('[role=combobox]')`), 'home search ready');
    await contents.executeJavaScript(`(() => {
      const input=document.querySelector('[role=combobox]'); input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
  };
  await search(base, 'Existing profile');
  await until(() => base.executeJavaScript(`document.querySelector('[role=listbox]')?.textContent.includes('Existing profile search')`), 'existing account search restored');
  // The app home creates a browser in the current slot and releases page loading.
  await search(base, origin + '/website?from=home#saved');
  await until(() => base.executeJavaScript(`!!document.querySelector('[data-source=web] button')`), 'web destination option');
  await base.executeJavaScript(`document.querySelector('[role=combobox]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await until(() => host.tabs.find(tab => tab.id === host.activeId)?.browser?.contents?.getURL() === origin + '/website?from=home#saved' && !host.pending, 'website revealed from app home');
  const browserTab = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => !browserTab.loading && !browserTab.pageLoading, 'loading finishes');
  assert.equal(commands.filter(command => command.type === 'browser').length, 1);
  assert.ok(manager.tabs.browserHistory.snapshot().items.some(page => page.url === origin + '/website?from=home#saved'));
  // A page must be usable while slow images are still downloading.
  const started = Date.now();
  assert.equal(manager.tabs.handleCommand(host.browserChrome.contents, {type:'browser-navigate', input:origin + '/website?streaming=1'}), true);
  await until(() => releaseImage && browserTab.browser.ready, 'page paints before a delayed image finishes');
  assert.equal(browserTab.browser.contents.isLoading(), true);
  assert.equal(browserTab.browser.attached, true);
  assert.ok(browserTab.browser.view.getBounds().y >= 0);
  console.log(`Website visible with an unfinished image: ${Date.now() - started}ms`);
  releaseImage(); releaseImage = null;
  await until(() => !browserTab.loading, 'image loading finishes');
  // A fresh native home reuses its browser and keeps back-to-home navigation.
  assert.equal(manager.tabs.handleCommand(host.browserChrome.contents, {type:'browser'}), true);
  await until(() => !host.pending, 'native home visible');
  const home = host.tabs.find(tab => tab.id === host.activeId);
  const chrome = home.contents;
  await search(chrome, 'Saved website');
  await until(() => chrome.executeJavaScript(`!!document.querySelector('[role=listbox]')`), 'search suggestions ready');
  assert.equal(await chrome.executeJavaScript(`document.querySelectorAll('[data-source=history]').length`), 0, 'visited page titles do not appear as previous searches');
  await search(chrome, 'Existing profile');
  await until(() => chrome.executeJavaScript(`document.querySelector('[data-source=history]')?.textContent.includes('Existing profile search')`), 'existing search appears on native home');
  await chrome.executeJavaScript(`document.querySelector('[data-source=history] .browser-suggestion-select').click()`);
  await until(() => home.browser.contents?.getURL() === origin + '/website?from=home#saved' && !home.loading && home.browser.attached, 'previous search rerun');
  assert.ok(commands.some(command => command.type === 'browser-navigate' && command.input === 'https://www.google.com/search?q=Existing%20profile%20search'));
  assert.equal(host.activeId, home.id, 'native home is not replaced with another browser tab');
  assert.ok(commands.some(command => command.type === 'browser-navigate'));
  await until(() => chrome.executeJavaScript(`!!document.querySelector('.browser-side-rail')`), 'browser sidebar visible');
  await chrome.executeJavaScript(`(() => {
    const pane = document.querySelector('[data-browser-content-id="${home.id}"]') || document.getElementById('root');
    const rail = pane.querySelector('.browser-side-rail');
    window.sidebarFlashes = [];
    window.sidebarObserver = new MutationObserver(() => {
      if (!rail.isConnected || pane.querySelector('[data-fixture-home]')) window.sidebarFlashes.push('home replaced sidebar');
    });
    window.sidebarObserver.observe(pane, {childList:true, subtree:true});
  })()`);
  // A real cross-document load clears pageReady, but must keep the same rail.
  assert.equal(manager.tabs.handleCommand(chrome, {type:'browser-navigate', input:origin + '/website?slow=1'}), true);
  await until(() => home.loading && !home.browser.ready, 'next website loading');
  await until(() => !home.loading && home.browser.ready, 'next website painted');
  assert.deepEqual(await chrome.executeJavaScript('window.sidebarFlashes'), [], 'navigation must not flash the new-tab wallpaper through the sidebar');
  assert.equal(manager.tabs.handleCommand(chrome, {type:'reload'}), true);
  await until(() => home.loading && !home.browser.ready, 'reload in progress');
  await until(() => !home.loading && home.browser.ready, 'reload painted');
  assert.deepEqual(await chrome.executeJavaScript('window.sidebarFlashes'), [], 'reload must preserve the sidebar');
  await chrome.executeJavaScript('window.sidebarObserver.disconnect()');
  assert.equal(manager.tabs.handleCommand(chrome, {type:'back'}), true);
  await until(() => home.browser.contents.getURL() === origin + '/website?from=home#saved' && !home.loading && home.browser.ready, 'Back restores first website');
  assert.equal(manager.tabs.handleCommand(chrome, {type:'back'}), true);
  await until(() => home.browser.showingHome, 'Back restores home');
  await until(() => chrome.executeJavaScript(`(() => {
    const pane = document.querySelector('[data-browser-content-id="${home.id}"]') || document.getElementById('root');
    return !!pane.querySelector('[data-fixture-home]') && !pane.querySelector('.browser-side-rail');
  })()`), 'home renders only after explicit Back');
  assert.deepEqual(readBrowserRecentSearches(dir, 'fixture@example.test'), ['Existing profile search']);
  const webQuery = 'fixture web search & π';
  holdHistorySave = true;
  await search(chrome, webQuery);
  await chrome.executeJavaScript(`document.querySelector('[role=combobox]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await until(() => commands.some(command => command.type === 'browser-navigate' && command.input === 'https://www.google.com/search?q=' + encodeURIComponent(webQuery)), 'Enter starts a web search');
  await until(() => releaseHistorySave, 'history write is held independently of navigation');
  assert.ok(!readBrowserRecentSearches(dir, 'fixture@example.test').includes(webQuery), 'navigation starts before a slow history write completes');
  holdHistorySave = false; releaseHistorySave(); releaseHistorySave = null;
  assert.equal(await chrome.executeJavaScript(`!!document.querySelector('[aria-label="Breadboard search results"]')`), false);
  await until(() => readBrowserRecentSearches(dir, 'fixture@example.test').includes(webQuery), 'web search is still saved after navigation');
  await search(chrome, 'fixture web button');
  await chrome.executeJavaScript(`document.querySelector('button[aria-label="Search the web"]').click()`);
  await until(() => commands.some(command => command.input === 'https://www.google.com/search?q=fixture%20web%20button'), 'search arrow also searches the web');
  await search(chrome, 'fixture internal search');
  await until(() => chrome.executeJavaScript(`!!document.querySelector('[data-source=breadboard] button')`), 'Breadboard suggestion available');
  await chrome.executeJavaScript(`document.querySelector('[data-source=breadboard] button').click()`);
  await until(() => chrome.executeJavaScript(`!!document.querySelector('[aria-label="Breadboard search results"]')`), 'explicit Breadboard search still works');
  // The persistent address bar uses its own renderer and navigation handler.
  // It too must send the request while a history write is blocked.
  holdHistorySave = true;
  const toolbar = host.shell.contents;
  assert.equal(host.browserOwnerKey, 'fixture@example.test', 'shared browser publishes the account to the persistent toolbar');
  await until(() => toolbar.executeJavaScript(`!!document.querySelector('[aria-label="Address and search"]')`), 'persistent address bar ready');
  await toolbar.executeJavaScript(`(() => {
    const input=document.querySelector('[aria-label="Address and search"]'); input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'fixture toolbar search');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await toolbar.executeJavaScript(`document.querySelector('.browser-address-form').requestSubmit()`);
  await until(() => commands.some(command => command.source === 'toolbar'), 'address bar navigates before history finishes');
  await until(() => releaseHistorySave, 'address bar history write remains pending');
  holdHistorySave = false; releaseHistorySave(); releaseHistorySave = null;
  await until(() => readBrowserRecentSearches(dir, 'fixture@example.test').includes('fixture toolbar search'), 'address bar search still persists');
  console.log('Combined home: previous search terms restored without visited pages; Enter and arrow search the web; explicit Breadboard search works; sidebar persisted through navigation and reload; Back restored home.');
  window.destroy(); server.close(); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
