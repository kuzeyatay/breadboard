const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { app, BrowserWindow, desktopCapturer, nativeImage, screen } = require("electron");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
app.setPath("userData", path.join(config.fixtureRoot, "profile"));
app.on("window-all-closed", () => {});
const { ClickyCompanion } = require(path.join(config.desktopRoot, "dist", "main", "clicky-companion.js"));
const { hardenSession } = require(path.join(config.desktopRoot, "dist", "main", "security.js"));
let companion;
let server;
let captureCount = 0;
let chatCount = 0;
let transcriptionCount = 0;

async function until(check, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error(message);
}

app.whenReady().then(async () => {
  server = http.createServer(async (request, response) => {
    if (request.url === "/clicky") {
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><html><head><link rel="stylesheet" href="/ui.css"><style>body{margin:0}*{box-sizing:border-box}h1,h2,p{margin:0}</style></head><body><div id="root"></div><script src="/ui.js"></script></body></html>');
      return;
    }
    if (request.url === "/ui.js" || request.url === "/ui.css") {
      response.setHeader("Content-Type", request.url.endsWith(".css") ? "text/css" : "text/javascript");
      response.end(fs.readFileSync(path.join(config.fixtureRoot, request.url.slice(1))));
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/clicky/chat") {
      const input = JSON.parse(body.toString());
      chatCount++;
      assert.equal(input.snapshots.length, chatCount === 1 ? 1 : 0);
      response.end(JSON.stringify({ text: "That is the settings button. Open it to choose your preferences.",
        point: input.snapshots[0] ? { displayId: input.snapshots[0].displayId, x: 250, y: 300 } : null }));
    } else if (request.url === "/api/speech/prepare") {
      response.end("{}");
    } else if (request.url === "/api/speech/transcribe") {
      assert.ok(body.includes(Buffer.from("RIFF")) && body.includes(Buffer.from("WAVE")), "microphone must upload WAV");
      transcriptionCount++;
      response.statusCode = transcriptionCount === 1 ? 202 : 200;
      response.end(JSON.stringify(transcriptionCount === 1 ? { downloading: true } : { text: "What is this setting?" }));
    } else {
      response.statusCode = 404;
      response.end("{}");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const allowed = { origins: new Set([origin]), localFiles: new Set() };
  let dashboardUrl = null;
  companion = new ClickyCompanion({ dashboardUrl: () => dashboardUrl, allowed });
  await assert.rejects(companion.launch(), /still starting/);
  dashboardUrl = origin;
  const png = nativeImage.createFromBuffer(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZfcAAAAASUVORK5CYII=", "base64"));
  desktopCapturer.getSources = async () => {
    captureCount++;
    return [{ display_id: String(screen.getPrimaryDisplay().id), thumbnail: png }];
  };
  await Promise.all([companion.launch(), companion.launch()]);
  assert.equal(BrowserWindow.getAllWindows().length, 1, "concurrent launch must reuse one window");
  const window = BrowserWindow.getAllWindows()[0];
  hardenSession(window.webContents.session, allowed);
  const run = (code) => window.webContents.executeJavaScript(code, true);
  await until(() => run("!!document.querySelector('textarea') && !document.querySelector('textarea').disabled"), "UI did not become interactive");
  assert.equal(await run("typeof window.require"), "undefined");
  assert.deepEqual(await run("Object.keys(window.clickyCompanion).sort()"), ["capture", "onShortcut", "onToggleVoice", "point"]);
  assert.equal(captureCount, 0, "opening Clicky must not capture the desktop");
  assert.equal(await run("window.clickyCompanion.point({displayId:'0',x:0,y:0})"), false);
  // Disable playback for this test; no real microphone, screen, or model is used.
  await run("document.querySelectorAll('input[type=checkbox]')[1].click()");
  await run("Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(document.querySelector('textarea'),'Explain this screen'); document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}))");
  await until(() => run("!document.querySelector('button[type=submit]').disabled"), "send not enabled");
  await run("document.querySelector('form').requestSubmit()");
  await until(() => run("document.querySelectorAll('article').length === 2 && document.querySelector('[role=status]').textContent === 'Ready'"), "screen question did not finish");
  assert.equal(captureCount, 1);
  const marker = BrowserWindow.getAllWindows().find((candidate) => candidate !== window);
  assert.ok(marker, "answer should show a pointer");
  const bounds = screen.getPrimaryDisplay().bounds;
  assert.equal(marker.getBounds().x, bounds.x + Math.round(.25 * (bounds.width - 1)));
  assert.equal(marker.getBounds().y, bounds.y + Math.round(.30 * (bounds.height - 1)));
  assert.equal(await run(`window.clickyCompanion.point({displayId:${JSON.stringify(String(screen.getPrimaryDisplay().id))},x:1001,y:0})`), false);
  fs.writeFileSync(config.previewPath, (await window.webContents.capturePage()).toPNG());
  await companion.launch();
  assert.equal(BrowserWindow.getAllWindows().filter((candidate) => candidate.getTitle() === "Clicky").length, 1);
  await run("document.querySelectorAll('input[type=checkbox]')[0].click()");
  await run("navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied','NotAllowedError') }; [...document.querySelectorAll('button')].find(b => b.textContent === 'Speak').click()");
  await until(() => run("document.querySelector('[role=alert]')?.textContent.includes('Windows Settings')"), "microphone denial missing");
  await run("window.testAudio = new AudioContext(); window.testStream = window.testAudio.createMediaStreamDestination().stream; navigator.mediaDevices.getUserMedia = async () => window.testStream; [...document.querySelectorAll('button')].find(b => b.textContent === 'Speak').click()");
  await until(() => run("document.querySelector('[role=status]').textContent.startsWith('Listening')"), "microphone did not start");
  await new Promise((resolve) => setTimeout(resolve, 200));
  window.webContents.send("breadboard:clicky-toggle-voice");
  await until(() => run("document.querySelectorAll('article').length === 4 && document.querySelector('[role=status]').textContent === 'Ready'"), "voice question did not finish");
  assert.equal(transcriptionCount, 2, "preparing speech should retry the same recording");
  assert.equal(captureCount, 1, "screen sharing off must not take another snapshot");
  assert.equal(await run("window.testStream.getTracks().every(track => track.readyState === 'ended')"), true);
  await run("window.testAudio.close()");
  const outsider = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true,
    preload: path.join(config.desktopRoot, "dist", "preload", "clicky-preload.js") } });
  await outsider.loadURL(`${origin}/clicky`);
  assert.equal(await outsider.webContents.executeJavaScript("window.clickyCompanion.capture().then(() => false, () => true)"), true, "other windows cannot capture");
  outsider.destroy();
  companion.stop();
  assert.equal(BrowserWindow.getAllWindows().length, 0, "close must remove companion and pointer");
  fs.writeFileSync(config.resultPath, JSON.stringify({ ok: true, captureCount, chatCount, transcriptionCount }));
  server.close();
  app.exit(0);
}).catch(async (error) => {
  const diagnostics = await Promise.all(BrowserWindow.getAllWindows().map(async (window) => ({
    url: window.webContents.getURL(),
    text: await window.webContents.executeJavaScript("document.body.innerText").catch(() => "unavailable"),
  })));
  fs.writeFileSync(config.resultPath, JSON.stringify({ ok: false, error: error.stack, diagnostics, captureCount, chatCount }));
  companion?.stop();
  server?.close();
  app.exit(1);
});
