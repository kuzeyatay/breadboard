const assert = require("node:assert/strict");
const { createHash, createPublicKey, verify } = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { app, BrowserWindow, Menu, ipcMain, session, webContents } = require("electron");
const { TabManager } = require("../../dist/main/tab-manager.js");
const { browserUserAgent } = require("../../dist/main/browser-user-agent.js");
const { installGlobalSecurity } = require("../../dist/main/security.js");
const { IPC_CHANNELS } = require("../../dist/shared/ipc-contract.js");
const [dir] = process.argv.slice(2);
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, userAgent: req.headers["user-agent"] });
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/login" });
      return res.end();
    }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><title>Passkey fixture</title><body>
      <script>window.initialUserAgent = navigator.userAgent;</script>
    </body>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://localhost:${server.address().port}`;
  const allowed = { origins: new Set([origin]) };
  installGlobalSecurity(allowed);
  const productUserAgent = session.defaultSession.getUserAgent();
  const expectedUserAgent = browserUserAgent(productUserAgent);
  assert.match(productUserAgent, /Electron\//);
  const scene = path.join(dir, "scene.html");
  fs.writeFileSync(scene, "<!doctype html><body>fixture</body>");
  const manager = new TabManager({
    allowed, preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"),
    loadingHtmlPath: () => scene, recoveryHtmlPath: () => scene,
    theme: () => "light", openWindow: () => assert.fail("unexpected native popup"),
  });
  manager.setEnabled(true);
  manager.setBrowserUrl(origin + "/browser");
  const window = new BrowserWindow({ show: false, width: 1000, height: 750, webPreferences: {
    preload: path.resolve(__dirname, "../../dist/preload/preload.js"),
    contextIsolation: true, sandbox: true, nodeIntegration: false,
  } });
  manager.attach(window);
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => manager.handleCommand(event.sender, command));
  await window.loadURL(origin + "/dashboard");
  const command = value => manager.handleCommand(window.webContents, value);
  const state = () => manager.stateFor(window.webContents);
  const pageAt = url => until(() => webContents.getAllWebContents().find(contents =>
    contents.getURL() === url && !contents.isLoading()), url);
  const activeChrome = () => until(() => webContents.getAllWebContents().find(contents =>
    contents.getURL() === origin + "/browser" && !contents.isLoading() &&
    manager.stateFor(contents)?.selfId === state().activeId), "active browser chrome");
  const checkIdentity = async (page, requestPath) => {
    assert.equal(page.getUserAgent(), expectedUserAgent);
    assert.equal(page.session.getUserAgent(), expectedUserAgent);
    assert.equal(await page.executeJavaScript("initialUserAgent"), expectedUserAgent,
      "page sees Chromium identity from its first script");
    const navigation = requests.filter(request => request.url === requestPath);
    assert.ok(navigation.length > 0);
    assert.ok(navigation.every(request => request.userAgent === expectedUserAgent),
      "the first navigation request must use Chromium identity too");
    assert.equal(await page.executeJavaScript("typeof breadboardDesktop + ':' + typeof require"), "undefined:undefined");
    assert.equal(page.getLastWebPreferences().sandbox, true);
    assert.equal(page.getLastWebPreferences().contextIsolation, true);
    assert.match(await page.executeJavaScript("navigator.credentials.get.toString()"), /\[native code\]/,
      "passkeys use Chromium's security checks, never a page-injected credential bridge");
  };

  await command({ type: "browser", url: origin + "/redirect" });
  const opener = await pageAt(origin + "/login");
  await checkIdentity(opener, "/redirect");
  await checkIdentity(opener, "/login");
  // Capability detection never creates a passkey or opens Windows Hello. Its
  // value depends on the host's enrollment and is not an automated-test assertion.
  const platformAvailable = await opener.executeJavaScript("PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()");
  assert.equal(typeof platformAvailable, "boolean");
  console.log("Native platform authenticator available:", platformAvailable);

  await opener.executeJavaScript(`window.authPopup = window.open(${JSON.stringify(origin + "/auth")}, 'passkey-login'); true;`, true);
  const popup = await pageAt(origin + "/auth");
  await checkIdentity(popup, "/auth");
  assert.equal(popup.session, opener.session);
  assert.equal(await popup.executeJavaScript("window.opener !== null"), true);

  // Virtual authenticators are test-only: exercise the actual Chromium API,
  // including resident credentials, user verification and server-side proof.
  popup.debugger.attach("1.3");
  const cdp = (method, params) => popup.debugger.sendCommand(method, params);
  await cdp("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  assert.equal(await popup.executeJavaScript("PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()"), true);
  const credential = await popup.executeJavaScript(`(async () => {
    const result = await navigator.credentials.create({ publicKey: {
      challenge: new Uint8Array([1, 2, 3, 4]), rp: { id: 'localhost', name: 'Fixture' },
      user: { id: new Uint8Array([7, 8, 9]), name: 'fixture@example.test', displayName: 'Test account' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
      attestation: 'none',
    } });
    return { id: result.id, publicKey: [...new Uint8Array(result.response.getPublicKey())],
      clientData: [...new Uint8Array(result.response.clientDataJSON)] };
  })()`, true);
  const registrationData = JSON.parse(Buffer.from(credential.clientData).toString());
  assert.equal(registrationData.type, "webauthn.create");
  assert.equal(registrationData.origin, origin);
  assert.equal(registrationData.challenge, "AQIDBA");
  const assertion = await popup.executeJavaScript(`(async () => {
    const result = await navigator.credentials.get({ publicKey: {
      challenge: new Uint8Array([5, 6, 7, 8]), rpId: 'localhost', userVerification: 'required',
    } });
    return { id: result.id, authenticatorData: [...new Uint8Array(result.response.authenticatorData)],
      clientData: [...new Uint8Array(result.response.clientDataJSON)],
      signature: [...new Uint8Array(result.response.signature)], userHandle: [...new Uint8Array(result.response.userHandle)] };
  })()`, true);
  assert.equal(assertion.id, credential.id, "discoverable sign-in finds the registered passkey");
  assert.deepEqual(assertion.userHandle, [7, 8, 9]);
  const clientData = Buffer.from(assertion.clientData);
  const parsed = JSON.parse(clientData.toString());
  assert.equal(parsed.type, "webauthn.get");
  assert.equal(parsed.origin, origin);
  assert.equal(parsed.challenge, "BQYHCA");
  const authenticatorData = Buffer.from(assertion.authenticatorData);
  assert.deepEqual(authenticatorData.subarray(0, 32), createHash("sha256").update("localhost").digest());
  assert.equal(authenticatorData[32] & 5, 5, "authenticator proves user presence and verification");
  assert.equal(verify("sha256", Buffer.concat([authenticatorData, createHash("sha256").update(clientData).digest()]),
    createPublicKey({ key: Buffer.from(credential.publicKey), format: "der", type: "spki" }),
    Buffer.from(assertion.signature)), true, "assertion signature verifies against the registered public key");

  assert.equal(await popup.executeJavaScript(`navigator.credentials.get({ publicKey: {
    challenge: new Uint8Array([1]), rpId: 'unrelated.example', userVerification: 'required',
  } }).then(() => 'unexpected success', error => error.name)`, true), "SecurityError",
  "a site cannot use a different site's passkey");
  await cdp("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: false });
  assert.equal(await popup.executeJavaScript(`(async () => {
    const controller = new AbortController();
    const pending = navigator.credentials.get({ signal: controller.signal, publicKey: {
      challenge: new Uint8Array([1]), rpId: 'localhost', userVerification: 'required',
    } }).then(() => 'unexpected success', error => error.name);
    setTimeout(() => controller.abort(), 100);
    return pending;
  })()`, true), "AbortError", "a request without user presence remains cancellable");
  await cdp("WebAuthn.disable");
  popup.debugger.detach();
  await command({ type: "close", id: state().activeId });
  await until(() => popup.isDestroyed(), "popup cleanup");

  let menu;
  Menu.prototype.popup = function(options) { menu = this; options.callback?.(); };
  const chrome = await activeChrome();
  await manager.handleCommand(chrome, { type: "browser-menu", x: 100, y: 60, profileLabel: "Fixture" });
  const privateItem = menu.getMenuItemById("new-private-tab");
  assert.ok(privateItem?.enabled);
  privateItem.click(privateItem, window, {});
  await new Promise(resolve => setImmediate(resolve));
  const privateChrome = await activeChrome();
  await manager.handleCommand(privateChrome, { type: "browser-navigate", input: origin + "/private" });
  const privatePage = await pageAt(origin + "/private");
  await checkIdentity(privatePage, "/private");
  assert.notEqual(privatePage.session, opener.session);
  assert.equal(privatePage.session.isPersistent(), false);
  await privatePage.executeJavaScript(`window.open(${JSON.stringify(origin + "/private-auth")}, 'private-passkey-login'); true;`, true);
  const privatePopup = await pageAt(origin + "/private-auth");
  await checkIdentity(privatePopup, "/private-auth");
  assert.equal(privatePopup.session, privatePage.session);
  assert.equal(session.defaultSession.getUserAgent(), productUserAgent, "product session identity stays unchanged");
  assert.equal(await window.webContents.executeJavaScript("navigator.userAgent"), productUserAgent);
  console.log("Browser identity, native WebAuthn, popup and private profile checks passed");
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
  window.destroy();
  server.close();
  server.closeAllConnections();
}).catch(error => { console.error(error.stack); app.exit(1); });
