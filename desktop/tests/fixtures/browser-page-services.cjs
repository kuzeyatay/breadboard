const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, webContents } = require("electron");
const { TabManager } = require("../../dist/main/tab-manager.js");
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
  const frameServer = http.createServer((_req, res) => res.end('<!doctype html><body><p id="frame-text">Un marco</p></body>'));
  const frameOrigin = await listen(frameServer);
  const external = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'nonce-fixture'; style-src 'unsafe-inline'; img-src data:; frame-src http://127.0.0.1:*");
    if (req.url === "/next") return res.end('<!doctype html><body><p id="new-document">Nueva pagina</p></body>');
    res.end(`<!doctype html><html lang="es"><head><title>Fixture page</title><script nonce="fixture">window.notificationAtStart = Notification.name;</script></head><body style="background:#eee;font-family:Arial">
      <h1 id="heading">Hola mundo</h1><p id="paragraph">Visita <a id="link" href="/next">nuestro sitio</a> ahora.</p>
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
    res.end('<!doctype html><title>Browser chrome</title><body>Trusted browser chrome</body>');
  });
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
  let prompts = 0;
  dialog.showMessageBox = async () => { prompts++; return { response: 0 }; };
  console.log("Checking notification permission request");
  await page.executeJavaScript("window.requestedPermission=null; void Notification.requestPermission().then(value=>window.requestedPermission=value,error=>window.requestedPermission='ERROR:'+error.message); true", true);
  await until(async () => {
    const result = await page.executeJavaScript("window.requestedPermission");
    if (result) assert.equal(result, "granted");
    return result;
  }, "notification permission granted");
  assert.equal(prompts, 1);
  const notices = [];
  manager.publishNotificationToast = (_contents, notice) => { notices.push(notice); return true; };
  await page.executeJavaScript("window.events=[]; window.notice=new Notification('Inbox', {body:'New message',tag:'inbox'}); for(const type of ['show','click','close']) notice.addEventListener(type,()=>events.push(type)); notice.onclick=()=>events.push('onclick'); true");
  await until(() => notices.some(notice => notice.website && !notice.dismissed), "website enters Breadboard notification overlay");
  await until(() => page.executeJavaScript("events.includes('show')"), "show callback delivered");
  assert.equal(notices[0].website.origin, web);
  const overlay = webContents.getAllWebContents().find(c => c.getURL() === origin + "/notification-overlay");
  assert.ok(overlay);
  assert.equal(manager.handleCommand(chrome, { type: "browser-notification-action", id: notices[0].website.id, action: "click" }), false);
  assert.equal(manager.handleCommand(overlay, { type: "browser-notification-action", id: notices[0].website.id, action: "click" }), true);
  await until(() => page.executeJavaScript("events.includes('onclick') && events.includes('close')"), "click and close reach source notification");
  window.hide();
  assert.equal(manager.handleCommand(chrome, { type: "browser-notifications-enabled", enabled: false }), true);
  assert.equal(await page.executeJavaScript("Notification.permission"), "denied");
  assert.equal(await page.executeJavaScript("Notification.requestPermission()", true), "denied");
  assert.equal(prompts, 1);
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
  for (const value of ["Personal unsent text", "private-value", "Private draft", "Private edit", "doNotTranslate", "Conservar"]) assert.ok(!translatedInput.includes(value), `${value} is not sent to translation`);
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
  await page.loadURL(web + "/next");
  assert.equal(state().status, "original");
  assert.equal(await page.executeJavaScript("document.querySelector('#new-document').textContent"), "Nueva pagina");
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
