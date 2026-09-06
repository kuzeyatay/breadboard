const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, ipcMain, webContents } = require("electron");
const { TabManager } = require("../../dist/main/tab-manager.js");
const { IPC_CHANNELS, isTabsCommand } = require("../../dist/shared/ipc-contract.js");
const [dir] = process.argv.slice(2);
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  console.log("Checking:", label);
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
};
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));

app.whenReady().then(async () => {
  const dashboard = path.resolve(__dirname, "../../../dashboard");
  const requireDashboard = createRequire(path.join(dashboard, "package.json"));
  const jsx = `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {useDesktopTabs} from './src/app/components/use-desktop-tabs';
    import BrowserTranslationControls from './src/app/browser/browser-translation-controls';
    import BrowserNotificationSettings from './src/app/browser/settings/notification-settings';
    import NotificationOverlayClient from './src/app/notification-overlay/notification-overlay-client';
    function App() {
      const tabs=useDesktopTabs(); const browser=tabs?.tabs.find(tab=>tab.id===tabs.selfId)?.browser;
      if(location.pathname==='/notification-overlay') return <NotificationOverlayClient/>;
      if(location.pathname==='/browser/settings') return <main className="mx-auto max-w-3xl px-6 py-12"><h1 className="text-2xl font-semibold">Browser settings</h1><BrowserNotificationSettings/></main>;
      return <div className="browser-toolbar" style={{marginTop:32}}><div className="browser-address-form"><div className="flex w-full items-center gap-2"><span style={{flex:1}}>{browser?.address}</span><div className="browser-address-actions"><BrowserTranslationControls browser={browser}/></div></div></div></div>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `;
  const bundle = await requireDashboard("esbuild").build({
    stdin: { contents: jsx, resolveDir: dashboard, loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "fixture-navigation", setup(build) {
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const useRouter=()=>({push(){}}); export const usePathname=()=>location.pathname; export const useSearchParams=()=>new URLSearchParams(location.search);" }));
    } }],
  });
  requireDashboard("esbuild").stop();
  const compiler = await requireDashboard("@tailwindcss/node").compile(fs.readFileSync(path.join(dashboard, "src/app/globals.css"), "utf8"), { base: path.join(dashboard, "src/app"), onDependency() {} });
  const scanner = new (requireDashboard("@tailwindcss/oxide").Scanner)({});
  const css = compiler.build(scanner.scanFiles([{ content: jsx, extension: "tsx" }, ...[
    "src/app/components/toast.tsx", "src/app/browser/browser-translation-controls.tsx", "src/app/browser/settings/notification-settings.tsx",
  ].map(file => ({ content: fs.readFileSync(path.join(dashboard, file), "utf8"), extension: "tsx" }))]));
  const capture = async (contents, filename) => {
    if (!process.env.BREADBOARD_BROWSER_SERVICES_QA_DIR) return;
    fs.mkdirSync(process.env.BREADBOARD_BROWSER_SERVICES_QA_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.BREADBOARD_BROWSER_SERVICES_QA_DIR, filename), (await contents.capturePage()).toPNG());
  };
  const frameServer = http.createServer((_req, res) => res.end('<!doctype html><body><p id="frame-text">Un marco</p></body>'));
  const frameOrigin = await listen(frameServer);
  let navigationWaiting = false;
  const external = http.createServer((req, res) => {
    if (req.url === "/wait") { navigationWaiting = true; return; }
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'nonce-fixture'; style-src 'unsafe-inline'; img-src data:; frame-src http://127.0.0.1:*");
    if (req.url === "/next") return res.end('<!doctype html><body><p id="new-document">Nueva pagina</p></body>');
    res.end(`<!doctype html><html lang="es"><head><title>Fixture page</title><script nonce="fixture">window.notificationAtStart = Notification.name;</script></head><body style="background:#eee;font-family:Arial">
      <h1 id="heading">Hola mundo</h1><p id="paragraph">Visita <a id="link" href="/next">nuestro sitio</a> ahora.</p><p>Hola<span contenteditable="true">Private nested edit</span></p>
      <button id="button">Continuar</button><img id="image" alt="Un gato" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='green'/%3E%3C/svg%3E">
      <input id="input" placeholder="Tu nombre" value="Personal unsent text"><input type="password" value="private-value"><textarea>Private draft</textarea>
      <div contenteditable="true">Private edit</div><code>doNotTranslate()</code><p translate="no">Conservar</p>
      <div id="shadow"></div><iframe src="${frameOrigin}"></iframe>
      <script nonce="fixture">window.originalLink = document.querySelector('#link'); window.clicks=0;
      document.querySelector('#button').onclick=()=>window.clicks++;
      document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<span>Texto sombra</span>';</script>
      </body></html>`);
  });
  const web = await listen(external);
  const dictionary = { "Hola mundo": "Hello world", "Visita ": "Visit ", "nuestro sitio": "our site", " ahora.": " now.", "Continuar": "Continue", "Un gato": "A cat", "Tu nombre": "Your name", "Un marco": "A frame", "Texto sombra": "Shadow text", "Texto nuevo": "New text", "Actualizado": "Updated" };
  const batches = [];
  let failure = false, hold = false, heldResponse;
  const server = http.createServer(async (req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(bundle.outputFiles[0].text); }
    if (req.url === "/app.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
    if (req.url === "/api/chat-notifications") { res.setHeader("Content-Type", "application/json"); return res.end('{"messages":[]}'); }
    if (req.url === "/api/browser/translate") {
      assert.match(req.headers.cookie || "", /fixture-session=1/, "translation uses the authenticated shell session");
      let body = ""; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body); batches.push(input);
      const reply = () => {
        res.setHeader("Content-Type", "application/json");
        if (failure) { res.statusCode = 502; return res.end(JSON.stringify({ error: "Fixture provider unavailable" })); }
        res.end(JSON.stringify({ segments: input.segments.map(value => ({ id: value.id, text: dictionary[value.text] ?? value.text })) }));
      };
      if (hold) heldResponse = reply; else reply();
      return;
    }
    res.setHeader("Set-Cookie", "fixture-session=1; HttpOnly; SameSite=Lax; Path=/");
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><html data-theme="light"><head><title>Browser chrome</title><link rel="stylesheet" href="/app.css"><style>body{margin:0;font-family:Arial} :root{--font-schibsted:Arial;--font-source-sans:Arial}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => isTabsCommand(command) && manager.handleCommand(event.sender, command));
  const origin = await listen(server);
  const loading = path.join(dir, "loading.html"); fs.writeFileSync(loading, "<!doctype html><body></body>");
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).href]) },
    preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"),
    loadingHtmlPath: () => loading, recoveryHtmlPath: () => loading, theme: () => "light", openWindow: () => {},
    browserPreferencesConfigDir: path.join(dir, "preferences"),
  });
  manager.setBrowserUrl(origin + "/browser");
  const window = new BrowserWindow({ show: false, width: 1000, height: 750, webPreferences: { preload: path.resolve(__dirname, "../../dist/preload/preload.js"), contextIsolation: true, sandbox: true } });
  manager.attach(window); await window.loadURL(origin + "/dashboard");
  manager.setNotificationsVisible(true);
  window.showInactive();
  assert.equal(await manager.handleCommand(window.webContents, { type: "browser", url: web }), true);
  let chrome, page;
  await until(() => {
    chrome = webContents.getAllWebContents().find(c => c.getURL() === origin + "/browser");
    page = webContents.getAllWebContents().find(c => c.getURL() === web + "/");
    return chrome && page && !chrome.isLoading() && !page.isLoading();
  }, "browser documents loaded");
  assert.equal(await page.executeJavaScript("typeof window.breadboardDesktop"), "undefined");
  assert.equal(manager.handleCommand(page, { type: "browser-notifications-enabled", enabled: true }), false);
  assert.equal(await page.executeJavaScript("window.notificationAtStart"), "PageNotification", "notification API is installed before inline page scripts, even with CSP");
  console.log("Checking notification permission getter");
  assert.equal(await page.executeJavaScript("Notification.permission"), "default");
  assert.equal(await page.executeJavaScript("navigator.permissions.query({name:'notifications'}).then(permission=>permission.state)"), "prompt");
  let prompts = 0;
  dialog.showMessageBox = async () => { prompts++; return { response: 0 }; };
  const notices = [];
  const publish = manager.publishNotificationToast.bind(manager);
  manager.publishNotificationToast = (contents, notice) => { notices.push(notice); return publish(contents, notice); };
  const overlay = webContents.getAllWebContents().find(c => c.getURL() === origin + "/notification-overlay");
  assert.ok(overlay);
  const requestPermission = async () => {
    await page.executeJavaScript("window.requestedPermission=null; void Notification.requestPermission().then(value=>window.requestedPermission=value,error=>window.requestedPermission='ERROR:'+error.message); true", true);
    await until(() => overlay.executeJavaScript("Boolean(document.querySelector('[role=dialog]'))"), "custom permission card renders");
  };
  const choosePermission = async (label, permission) => {
    await overlay.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(button => button.textContent === ${JSON.stringify(label)}).click()`);
    await until(() => page.executeJavaScript(`window.requestedPermission === ${JSON.stringify(permission)}`), `${label} resolves permission`);
    await until(() => overlay.executeJavaScript("!document.querySelector('[role=dialog]')"), "permission card dismissed");
  };
  await requestPermission();
  await page.executeJavaScript("window.secondPermission=null; void Notification.requestPermission().then(value=>window.secondPermission=value); true", true);
  assert.equal(await page.executeJavaScript("window.requestedPermission"), null, "website waits for an explicit choice");
  assert.equal(notices.filter(notice => notice.notificationPermission && !notice.dismissed).length, 1, "duplicate requests share one card");
  const requestId = notices.at(-1).notificationPermission.id;
  assert.equal(manager.handleCommand(chrome, { type: "browser-notification-permission-response", id: requestId, permission: "granted" }), false, "only the overlay may answer");
  assert.equal(manager.handleCommand(page, { type: "browser-notification-permission-response", id: requestId, permission: "granted" }), false, "website cannot answer its own request");
  assert.equal(manager.handleCommand(overlay, { type: "browser-notification-permission-response", id: "unknown", permission: "granted" }), false);
  await until(() => {
    const bounds = window.contentView.children.find(view => view.webContents === overlay).getBounds();
    const [width, height] = window.getContentSize();
    return bounds.width > 100 && bounds.height > 100 && bounds.x + bounds.width === width && bounds.y + bounds.height === height;
  }, "permission card sits at bottom right");
  await capture(overlay, "website-permission-light.png");
  await overlay.executeJavaScript("document.documentElement.dataset.theme='dark'; new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  await until(() => overlay.executeJavaScript("getComputedStyle([...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent==='Allow')).color === 'rgb(33, 36, 32)'"), "permission button follows the dark theme");
  await capture(overlay, "website-permission-dark.png");
  window.setSize(340, 750);
  await until(() => overlay.executeJavaScript("innerWidth <= 326"), "permission card fits a narrow window");
  assert.equal(await overlay.executeJavaScript("[...document.querySelectorAll('[role=dialog] button')].every(button=>{const r=button.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})"), true, "all permission actions remain visible");
  await capture(overlay, "website-permission-narrow.png");
  window.setSize(1000, 750);
  await overlay.executeJavaScript("document.documentElement.dataset.theme='light'; new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  await choosePermission("Not now", "default");
  await until(() => page.executeJavaScript("window.secondPermission === 'default'"), "both pending requests resolve");
  assert.equal(manager.stateFor(chrome).browserPreferences.sites[web], undefined, "Not now does not persist a denial");
  assert.equal(manager.handleCommand(overlay, { type: "browser-notification-permission-response", id: requestId, permission: "granted" }), false, "stale answers cannot grant permission");
  await requestPermission();
  await overlay.executeJavaScript("document.querySelector('[aria-label=\"Dismiss notification request\"]').click()");
  await until(() => page.executeJavaScript("window.requestedPermission === 'default'"), "close means Not now");
  await until(() => overlay.executeJavaScript("!document.querySelector('[role=dialog]')"), "closed card removed");
  await requestPermission();
  await choosePermission("Block", "denied");
  assert.equal(manager.stateFor(chrome).browserPreferences.sites[web], "denied");
  assert.equal(await page.executeJavaScript("Notification.requestPermission()", true), "denied");
  assert.equal(manager.handleCommand(chrome, { type: "browser-notification-permission", origin: web, permission: "default" }), true);
  await requestPermission();
  assert.equal(manager.handleCommand(chrome, { type: "browser-notification-permission", origin: web, permission: "denied" }), true);
  await until(() => page.executeJavaScript("window.requestedPermission === 'denied'"), "settings changes resolve an open prompt");
  await until(() => overlay.executeJavaScript("!document.querySelector('[role=dialog]')"), "settings dismiss the obsolete card");
  assert.equal(manager.handleCommand(chrome, { type: "browser-notification-permission", origin: web, permission: "default" }), true);
  await requestPermission();
  await choosePermission("Allow", "granted");
  assert.equal(manager.stateFor(chrome).browserPreferences.sites[web], "granted");
  assert.equal(prompts, 0, "no native permission dialog is shown");
  notices.length = 0;
  await page.executeJavaScript("window.events=[]; window.notice=new Notification('Inbox', {body:'New message',tag:'inbox'}); for(const type of ['show','click','close']) notice.addEventListener(type,()=>events.push(type)); notice.onclick=()=>events.push('onclick'); true");
  await until(() => notices.some(notice => notice.website && !notice.dismissed), "website enters Breadboard notification overlay");
  await until(() => page.executeJavaScript("events.includes('show')"), "show callback delivered");
  assert.equal(notices[0].website.origin, web);
  await until(() => overlay.executeJavaScript("document.body.textContent.includes('New message')"), "website notification card renders");
  await capture(overlay, "website-notification.png");
  assert.equal(manager.handleCommand(chrome, { type: "browser-notification-action", id: notices[0].website.id, action: "click" }), false);
  await overlay.executeJavaScript("document.querySelector('button[title=\"Open website\"]').click()");
  await until(() => page.executeJavaScript("events.includes('onclick') && events.includes('close')"), "click and close reach source notification");
  assert.equal(manager.handleCommand(chrome, { type: "browser-notifications-enabled", enabled: false }), true);
  assert.equal(await page.executeJavaScript("Notification.permission"), "denied");
  assert.equal(await page.executeJavaScript("navigator.permissions.query({name:'notifications'}).then(permission=>permission.state)"), "denied");
  assert.equal(await page.executeJavaScript("Notification.requestPermission()", true), "denied");
  assert.equal(prompts, 0);
  assert.equal(manager.handleCommand(chrome, { type: "browser-notifications-enabled", enabled: true }), true);
  assert.equal(await page.executeJavaScript("Notification.permission"), "granted");
  await page.executeJavaScript("new Notification('One',{tag:'same'}); new Notification('Two',{tag:'same'}); true");
  await until(() => notices.some(notice => notice.title?.endsWith("Two")), "tag replacement shown");
  assert.ok(notices.some(notice => notice.dismissed && notice.website.id !== notices[0].website.id));
  assert.equal(manager.handleCommand(chrome, { type: "browser-notification-permission", origin: web, permission: "denied" }), true);
  assert.equal(await page.executeJavaScript("Notification.permission"), "denied");
  assert.equal(manager.stateFor(chrome).browserPreferences.sites[web], "denied");

  const state = () => manager.stateFor(chrome).tabs.find(tab => tab.browser)?.browser.translation;
  const original = await page.executeJavaScript("({url:location.href,html:document.body.innerHTML,src:document.querySelector('#image').src,href:document.querySelector('#link').href})");
  assert.equal(await manager.handleCommand(chrome, { type: "browser-translate", language: "en" }), true);
  await until(() => state()?.status === "translated", "page translation completes");
  await until(() => chrome.executeJavaScript("Boolean(document.querySelector('[aria-label=\"Show original page\"]'))"), "translated toolbar renders original control");
  await capture(page, "translated-page.png");
  await capture(chrome, "translation-toolbar.png");
  assert.equal(await page.executeJavaScript("document.querySelector('#heading').textContent"), "Hello world");
  assert.equal(await page.executeJavaScript("document.querySelector('#paragraph').textContent"), "Visit our site now.");
  assert.equal(await page.executeJavaScript("document.querySelector('#shadow').shadowRoot.textContent"), "Shadow text");
  const frame = page.mainFrame.framesInSubtree.find(frame => frame.url === frameOrigin + "/");
  assert.equal(await frame.executeJavaScript("document.body.textContent"), "A frame");
  assert.equal(await page.executeJavaScript("document.querySelector('#input').placeholder"), "Your name");
  assert.equal(await page.executeJavaScript("document.querySelector('#image').alt"), "A cat");
  assert.deepEqual(await page.executeJavaScript("({url:location.href,src:document.querySelector('#image').src,href:document.querySelector('#link').href,same:originalLink===document.querySelector('#link'),value:document.querySelector('#input').value})"), { url: original.url, src: original.src, href: original.href, same: true, value: "Personal unsent text" });
  await page.executeJavaScript("document.querySelector('#button').click()");
  assert.equal(await page.executeJavaScript("clicks"), 1);
  const translatedInput = JSON.stringify(batches);
  for (const value of ["Personal unsent text", "private-value", "Private draft", "Private edit", "Private nested edit", "doNotTranslate", "Conservar"]) assert.ok(!translatedInput.includes(value), `${value} is not sent to translation`);
  const batchesAfterTranslation = batches.length;
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal(batches.length, batchesAfterTranslation, "already translated/unchanged text is not resent");
  await page.executeJavaScript("const p=document.createElement('p');p.id='dynamic';p.textContent='Texto nuevo';document.body.append(p);document.querySelector('#heading').textContent='Actualizado'");
  await until(() => page.executeJavaScript("document.querySelector('#dynamic').textContent === 'New text' && document.querySelector('#heading').textContent === 'Updated'"), "dynamic page text translates");
  assert.equal(await manager.handleCommand(chrome, { type: "browser-translation-restore" }), true);
  assert.equal(await page.executeJavaScript("document.querySelector('#heading').textContent"), "Actualizado", "restore preserves live site edits");
  assert.equal(await page.executeJavaScript("document.querySelector('#paragraph').textContent"), "Visita nuestro sitio ahora.");
  assert.equal(await frame.executeJavaScript("document.body.textContent"), "Un marco");
  assert.equal(await page.executeJavaScript("document.querySelector('#input').placeholder"), "Tu nombre");

  failure = true;
  await manager.handleCommand(chrome, { type: "browser-translate", language: "en" });
  await until(() => state()?.status === "error", "provider failure reaches toolbar state");
  assert.match(state().error, /Fixture provider unavailable/);
  failure = false; hold = true;
  await manager.handleCommand(chrome, { type: "browser-translate", language: "en" });
  await until(() => heldResponse, "translation request in flight");
  await manager.handleCommand(chrome, { type: "browser-translation-restore" });
  heldResponse(); heldResponse = undefined; hold = false;
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(state().status, "original");
  assert.equal(await page.executeJavaScript("document.querySelector('#heading').textContent"), "Actualizado");
  await manager.handleCommand(chrome, { type: "browser-translate", language: "en" });
  await until(() => state()?.status === "translated", "translation retries successfully");
  const stoppedNavigation = page.loadURL(web + "/wait").catch(() => {});
  await until(() => navigationWaiting, "navigation starts without replacing the document");
  page.stop();
  await stoppedNavigation;
  await until(() => state()?.status === "error", "cancelled navigation leaves an actionable translation state");
  assert.equal(await page.executeJavaScript("document.querySelector('#heading').textContent"), "Updated");
  await manager.handleCommand(chrome, { type: "browser-translate", language: "en" });
  await until(() => state()?.status === "translated", "translation resumes after cancelled navigation");
  assert.equal(manager.handleCommand(chrome, { type: "browser-notification-permission", origin: web, permission: "default" }), true);
  await requestPermission();
  const navigatedRequestId = notices.at(-1).notificationPermission.id;
  await page.loadURL(web + "/next");
  await until(() => overlay.executeJavaScript("!document.querySelector('[role=dialog]')"), "navigation removes the permission request");
  assert.equal(manager.handleCommand(overlay, { type: "browser-notification-permission-response", id: navigatedRequestId, permission: "granted" }), false);
  assert.equal(await page.executeJavaScript("Notification.permission"), "default");
  assert.equal(state().status, "original");
  assert.equal(await page.executeJavaScript("document.querySelector('#new-document').textContent"), "Nueva pagina");
  await manager.handleCommand(chrome, { type: "open", url: origin + "/browser/settings" });
  let settings;
  await until(() => {
    settings = webContents.getAllWebContents().find(c => c.getURL() === origin + "/browser/settings");
    return settings && !settings.isLoading();
  }, "browser settings loads");
  await until(() => settings.executeJavaScript("Boolean(document.querySelector('input[role=switch]'))"), "notification settings render");
  await capture(settings, "notification-settings.png");
  await settings.executeJavaScript("document.querySelector('input[role=switch]').click()");
  await until(() => manager.stateFor(settings).browserPreferences.notificationsEnabled === false, "settings switch saves");
  assert.equal(manager.handleCommand(settings, { type: "browser-notifications-enabled", enabled: true }), true);
  await requestPermission();
  const closedRequestId = notices.at(-1).notificationPermission.id;
  const browserTabId = manager.stateFor(chrome).selfId;
  assert.equal(manager.handleCommand(settings, { type: "close", id: browserTabId }), true);
  await until(() => overlay.executeJavaScript("!document.querySelector('[role=dialog]')"), "closing the source tab removes its permission card");
  assert.equal(manager.handleCommand(overlay, { type: "browser-notification-permission-response", id: closedRequestId, permission: "granted" }), false);
  // The test parent owns native-process teardown. A receipt is written only
  // after every real page, settings, notification and translation assertion.
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
  console.log("All browser page service checks passed");
}).catch(error => { console.error(error.stack || error); app.exit(1); });
