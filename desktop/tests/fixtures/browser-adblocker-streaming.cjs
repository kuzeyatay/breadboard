const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { app, BrowserWindow, session } = require("electron");
const { BrowserAdBlocker } = require("../../dist/main/browser-adblocker.js");
const { FiltersEngine } = require("../../dist/main/browser-adblocker-engine.js");
const [dir] = process.argv.slice(2);
app.setPath("userData", path.join(dir, "profile"));
app.commandLine.appendSwitch("host-resolver-rules", "MAP *.fixture.test 127.0.0.1, MAP www.youtube.com 127.0.0.1, MAP www.primevideo.com 127.0.0.1");
app.commandLine.appendSwitch("no-proxy-server");
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  const end = Date.now() + 10_000;
  while (Date.now() < end) { if (await probe()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error(`Timed out: ${label}`);
};
const youtube = { adPlacements: [{ ad: true }], adSlots: [{ ad: true }], videoDetails: { videoId: "content" }, streamingData: { adaptiveFormats: [{ url: "/content.mp4" }] } };
const prime = { cuepointPlaylist: [{ ad: true }], ads: [{ ad: true }], vodPlaybackUrls: { result: { playbackUrls: { cuepoints: [{ ad: true }], url: "/movie.mpd" } } }, subtitles: [{ language: "en" }], licenseUrl: "/license" };
const mpd = `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT60S"><Period id="ad" start="PT0S"><SupplementalProperty value="Ad"/><AdaptationSet><BaseURL>/ad.mp4</BaseURL></AdaptationSet></Period><Period id="content" start="PT10S"><AdaptationSet><ContentProtection schemeIdUri="urn:uuid:fixture-drm"/><BaseURL>/movie.mp4</BaseURL></AdaptationSet><AdaptationSet contentType="text"><BaseURL>/subtitles.vtt</BaseURL></AdaptationSet></Period></MPD>`;

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    res.setHeader("cache-control", "no-store");
    if (url.pathname.endsWith("/player")) { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(youtube)); }
    if (url.pathname === "/movie.mpd") { res.setHeader("content-type", "application/dash+xml"); return res.end(mpd); }
    if (url.pathname === "/echo") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ query: url.search })); }
    if (url.pathname === "/noop.js") { res.setHeader("content-type", "text/javascript"); return res.end("window.adSdkExecuted = true"); }
    if (url.pathname === "/app.js") {
      res.setHeader("content-type", "text/javascript");
      return res.end(`window.initialRuleValue = window.adSystemEnabled;
        window.primeResult = JSON.parse(${JSON.stringify(JSON.stringify(prime))});
        window.fetchPlayer = () => fetch('/youtubei/v1/player?key=fixture').then(r => r.json());
        window.xhrPlayer = () => new Promise((resolve, reject) => { const r = new XMLHttpRequest(); r.open('GET', '/youtubei/v1/player?key=fixture'); r.responseType = 'json'; r.onload = () => resolve(r.response); r.onerror = reject; r.send(); });
        window.readManifest = () => fetch('/movie.mpd').then(r => r.text());
        window.pageReady = true;`);
    }
    res.setHeader("content-type", "text/html");
    // Page-world scriptlets must work without weakening CSP or relying on a
    // script element the site's policy would refuse.
    res.setHeader("content-security-policy", "default-src 'self'; script-src 'self' 'nonce-fixture' breadboard-adblock:; style-src 'none'");
    res.end(`<!doctype html><script nonce="fixture">
      window.ytInitialPlayerResponse = ${JSON.stringify(youtube)};
      window.ytcfg = { data_: { EXPERIMENT_FLAGS: {
        all_web_enable_network_machine: true, all_web_network_machine_raw_request: true
      } } };
      window.inlinePlayer = JSON.parse(JSON.stringify(window.ytInitialPlayerResponse));
      window.inlineFlags = JSON.parse(JSON.stringify(window.ytcfg.data_.EXPERIMENT_FLAGS));
    </script><title>Streaming fixture</title><div id="content">Movie</div><div id="ad-slot">Advertisement</div><div class="sponsor-card">Sponsored</div><div class="promo-card">Promotion</div><script src="/app.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const engine = FiltersEngine.deserialize(fs.readFileSync(path.join(__dirname, "../../dist/main/adblocker.bin")));
  engine.updateFromDiff({ added: [
    "fixture.test##+js(set, adSystemEnabled, false)",
    "fixture.test###ad-slot", "fixture.test##.dynamic-ad", "fixture.test##.allowed-ad", "fixture.test#@#.allowed-ad",
    "fixture.test##.sponsor-card:has-text(Sponsored)", "fixture.test##.promo-card:has-text(Promotion)",
    "||sdk.fixture.test^*/noop.js$script,redirect=noopjs", "/echo?$xhr,removeparam=tracking,domain=rules.fixture.test",
    ...Array.from({ length: 6 }, (_, index) =>
      `performance.fixture.test##+js(trusted-edit-inbound-object, JSON.stringify, 0, ${encodeURIComponent(`[?.missing==true].probe${index}=1`)})`),
  ] });
  const blocker = new BrowserAdBlocker(dir, () => {}, console.log, engine);
  const profile = session.fromPartition("adblock-streaming-fixture", { cache: false });
  const window = new BrowserWindow({ show: false, webPreferences: { session: profile, sandbox: true, contextIsolation: true } });
  const page = window.webContents;
  page.on("console-message", (_e, level, message) => { if (level >= 2) console.log("Renderer:", message.slice(0,250)); });
  blocker.attachPage(page);
  const load = async host => { await page.loadURL(`http://${host}:${port}/watch`); await until(() => page.executeJavaScript("window.pageReady === true"), "page ready"); };
  await load("rules.fixture.test");
  assert.equal(await page.executeJavaScript("window.initialRuleValue"), false, "scriptlet runs before first page script, under CSP");
  await until(() => page.executeJavaScript("['#ad-slot','.sponsor-card','.promo-card'].every(s => getComputedStyle(document.querySelector(s)).display === 'none')"), "CSS and both extended selectors");
  await page.executeJavaScript("document.querySelector('.sponsor-card').textContent = 'Organic'; const d = document.createElement('div'); d.className = 'dynamic-ad'; document.body.append(d); const a = document.createElement('div'); a.className = 'allowed-ad'; document.body.append(a);");
  await until(() => page.executeJavaScript("getComputedStyle(document.querySelector('.dynamic-ad')).display === 'none' && getComputedStyle(document.querySelector('.sponsor-card')).display !== 'none' && getComputedStyle(document.querySelector('.promo-card')).display === 'none'"), "dynamic selectors and extended unhide");
  assert.equal(await page.executeJavaScript("getComputedStyle(document.querySelector('.allowed-ad')).display !== 'none'"), true, "cosmetic exceptions win");
  assert.equal(await page.executeJavaScript(`new Promise(resolve => { const s = document.createElement('script'); s.src = 'http://sdk.fixture.test:${port}/noop.js'; s.onload = () => resolve(true); s.onerror = () => resolve(false); document.head.append(s); })`), false, "CSP stays enforced for unrelated origins");
  // Same-origin replacement is permitted by CSP, fulfills load, and does not
  // execute the server's response (which would be HTML).
  engine.updateFromDiff({ added: ["||rules.fixture.test^*/noop.js$script,redirect=noopjs"] });
  assert.equal(await page.executeJavaScript("new Promise(resolve => { const s = document.createElement('script'); s.src = '/noop.js'; s.onload = () => resolve(true); s.onerror = () => resolve(false); document.head.append(s); })"), true);
  assert.equal(await page.executeJavaScript("typeof window.adSdkExecuted"), "undefined", "replacement loads without executing the advertising SDK");
  assert.deepEqual(await page.executeJavaScript("fetch('/echo?tracking=secret&keep=yes').then(r => r.json())"), { query: "?keep=yes" });
  blocker.setSiteEnabled(`http://rules.fixture.test:${port}`, false, profile);
  await until(() => page.executeJavaScript("['#ad-slot','.dynamic-ad','.promo-card'].every(s => getComputedStyle(document.querySelector(s)).display !== 'none')"), "pause removes all cosmetic effects");
  await load("rules.fixture.test");
  assert.equal(await page.executeJavaScript("typeof window.initialRuleValue"), "undefined", "paused site gets no scriptlets after reload");
  blocker.setSiteEnabled(`http://rules.fixture.test:${port}`, true, profile);

  await load("www.youtube.com");
  const inline = await page.executeJavaScript("({ player: window.inlinePlayer, flags: window.inlineFlags })");
  assert.equal(inline.player.adPlacements, undefined, "initial inline player is filtered before the first page script consumes it");
  assert.equal(inline.player.adSlots, undefined);
  assert.deepEqual(inline.player.streamingData, youtube.streamingData);
  assert.deepEqual(inline.flags, { all_web_enable_network_machine: false, all_web_network_machine_raw_request: false }, "YouTube transport compatibility flags apply before inline startup");
  for (const method of ["fetchPlayer", "xhrPlayer"]) {
    const response = await page.executeJavaScript(`window.${method}()`);
    assert.equal(response.adPlacements, undefined, `YouTube ${method} ad placements removed`);
    assert.equal(response.adSlots, undefined, `YouTube ${method} ad slots removed`);
    assert.deepEqual(response.streamingData, youtube.streamingData, "video URLs preserved");
  }
  // Repeated player fetches model same-document navigation to the next video.
  assert.equal((await page.executeJavaScript("window.fetchPlayer()")).videoDetails.videoId, "content");
  await load("performance.fixture.test");
  const serialization = await page.executeJavaScript(`(() => {
    let reads = 0;
    const result = JSON.stringify({ get marker() { reads++; return 'content'; } });
    return { reads, result };
  })()`);
  assert.equal(serialization.result, '{"marker":"content"}');
  assert.equal(serialization.reads, 7, "six player-request scriptlets share native JSON functions instead of doing 64 serializations");
  assert.equal(await page.executeJavaScript("['scriptletGlobals', 'safeSelf', 'proxyApplyFn', 'JSONPath'].every(key => !(key in window))"), true, "scriptlet helpers and saved native functions remain private");
  blocker.setSiteEnabled(`http://performance.fixture.test:${port}`, false, profile);
  blocker.setSiteEnabled(`http://performance.fixture.test:${port}`, true, profile);
  await until(() => page.executeJavaScript("getComputedStyle(document.querySelector('#ad-slot')).display === 'none'"), "reenabled cosmetics");
  assert.equal(await page.executeJavaScript(`(() => {
    let reads = 0;
    JSON.stringify({ get marker() { reads++; return 'content'; } });
    return reads;
  })()`), 7, "refreshing settings does not stack the scriptlets again");
  await load("www.primevideo.com");
  const pr = await page.executeJavaScript("window.primeResult");
  assert.equal(pr.ads, undefined);
  assert.equal(pr.cuepointPlaylist, undefined);
  assert.equal(pr.vodPlaybackUrls.result.playbackUrls.cuepoints, undefined);
  assert.deepEqual(pr.subtitles, prime.subtitles);
  assert.equal(pr.licenseUrl, "/license");
  const manifest = await page.executeJavaScript("window.readManifest()");
  assert.equal(manifest.includes('id="ad"'), false, "Prime DASH ad period removed");
  assert.equal(manifest.includes('id="content"'), true);
  assert.equal(manifest.includes("fixture-drm"), true, "DRM metadata preserved");
  assert.equal(manifest.includes("subtitles.vtt"), true);
  assert.equal(await page.executeJavaScript("typeof window.breadboardDesktop"), "undefined", "no product bridge exposed");
  blocker.setEnabled(false, profile);
  await load("www.youtube.com");
  assert.deepEqual(await page.executeJavaScript("window.fetchPlayer()"), youtube, "global pause disables streaming scripts after reload");
  assert.deepEqual(await page.executeJavaScript("window.inlinePlayer"), youtube, "global pause also leaves inline startup data untouched");

  const beforePrivate = fs.readFileSync(path.join(dir, "browser-adblocker.json"), "utf8");
  const privateProfile = session.fromPartition("adblock-streaming-private", { cache: false });
  const privateWindow = new BrowserWindow({ show: false, webPreferences: { session: privateProfile, sandbox: true, contextIsolation: true } });
  blocker.attachPage(privateWindow.webContents, true);
  blocker.setEnabled(true, privateProfile);
  const primeUrl = `http://www.primevideo.com:${port}/watch`;
  await privateWindow.loadURL(primeUrl);
  assert.equal(await privateWindow.webContents.executeJavaScript("window.primeResult.ads"), undefined, "private streaming protection works independently");
  assert.deepEqual(await page.executeJavaScript("window.fetchPlayer()"), youtube, "private enable does not enable regular pages");
  blocker.setSiteEnabled(primeUrl, false, privateProfile);
  await privateWindow.loadURL(primeUrl);
  assert.deepEqual(await privateWindow.webContents.executeJavaScript("window.primeResult"), prime, "private site pause disables scriptlets");
  assert.equal(fs.readFileSync(path.join(dir, "browser-adblocker.json"), "utf8"), beforePrivate, "private choices are never persisted");
  privateWindow.destroy();

  const unregistered = new BrowserWindow({ show: false, webPreferences: { session: profile, sandbox: true } });
  await unregistered.loadURL(`http://rules.fixture.test:${port}/watch`);
  assert.equal(await unregistered.webContents.executeJavaScript("typeof window.initialRuleValue"), "undefined", "unregistered background pages receive a safe startup reply");
  unregistered.destroy();
  window.destroy(); server.close();
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
