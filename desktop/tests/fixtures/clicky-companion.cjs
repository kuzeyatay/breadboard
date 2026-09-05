const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { app, BrowserWindow, desktopCapturer, nativeImage, screen } = require("electron");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
app.setPath("userData", path.join(config.fixtureRoot, "profile"));
app.on("window-all-closed", () => {});
const { ClickyCompanion } = require(path.join(config.desktopRoot, "dist", "main", "clicky-companion.js"));
const { createWindowsInput } = require(path.join(config.desktopRoot, "dist", "main", "windows-click.js"));
const { hardenSession } = require(path.join(config.desktopRoot, "dist", "main", "security.js"));
let companion;
let server;
let captureCount = 0;
let chatCount = 0;
let transcriptionCount = 0;
let synthesisCount = 0;
let expectedYoloMode = false;
let clickCount = 0;
let typeCount = 0;
let failNextClick = false;
let releaseChat = null;

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
    if (request.url === "/click-target") {
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><body style="margin:0"><button style="width:100vw;height:100vh" onclick="window.clicks=(window.clicks||0)+1">Test click target</button></body>');
      return;
    }
    if (request.url === "/type-target") {
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><body style="margin:0"><input aria-label="Type target" style="width:100vw;height:100vh;font-size:20px" onkeydown="if(event.key===\'Enter\')document.body.dataset.submitted=\'true\'"></body>');
      return;
    }
    if (request.url === "/clicky") {
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><html><head><title>breadboard</title><link rel="stylesheet" href="/ui.css"><style>body{margin:0}*{box-sizing:border-box}h1,h2,p{margin:0}</style></head><body><div id="root"></div><script src="/ui.js"></script></body></html>');
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
    if (request.url === "/api/clicky/sessions") {
      response.end(JSON.stringify({ conversationId: "clicky-test-conversation" }));
    } else if (request.url === "/api/clicky/chat") {
      const input = JSON.parse(body.toString());
      chatCount++;
      assert.equal(input.yoloMode, expectedYoloMode);
      if (chatCount <= 5) assert.equal(input.snapshots.length, chatCount === 1 || chatCount === 4 || chatCount === 5 ? 1 : 0);
      const typing = input.messages.at(-1)?.content === "Type x.com and press Enter";
      if (input.messages.at(-1)?.content === "Cancel automatic click") {
        await new Promise((resolve) => { releaseChat = resolve; });
      }
      response.end(JSON.stringify({ text: "That is the **settings button**.\n\n- Open it to choose your preferences.\n- Choose `Profile` next.",
        point: input.snapshots[0] ? { displayId: input.snapshots[0].displayId, x: 250, y: 300,
          ...(typing ? { inputText: "x.com", pressEnter: true } : {}) } : null,
        conversationId: "clicky-test-conversation" }));
    } else if (request.url === "/api/speech/prepare") {
      response.end("{}");
    } else if (request.url === "/api/speech/transcribe") {
      assert.ok(body.includes(Buffer.from("RIFF")) && body.includes(Buffer.from("WAVE")), "microphone must upload WAV");
      transcriptionCount++;
      response.statusCode = transcriptionCount === 1 ? 202 : 200;
      response.end(JSON.stringify(transcriptionCount === 1 ? { downloading: true } : { text: "What is this setting?" }));
    } else if (request.url === "/api/speech/synthesize") {
      assert.match(JSON.parse(body.toString()).text, /settings button/);
      synthesisCount++;
      if (synthesisCount === 2) {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: "Profile not found" }));
        return;
      }
      // Silent PCM exercises real browser playback without making test audio audible.
      const wav = Buffer.alloc(44 + 3200);
      wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(3200, 40);
      response.setHeader("Content-Type", "audio/wav");
      response.end(wav);
    } else {
      response.statusCode = 404;
      response.end("{}");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const allowed = { origins: new Set([origin]), localFiles: new Set() };
  let dashboardUrl = null;
  const nativeInput = createWindowsInput(path.resolve(config.desktopRoot, ".."));
  // Keep mode coverage independent of OS foreground/keyboard restrictions.
  // All input still travels through the real sandboxed bridge to our owned target.
  let controlledTarget = null;
  const controlledInput = {
    click: async (x, y) => {
      controlledTarget = BrowserWindow.getAllWindows().find((candidate) =>
        [`${origin}/click-target`, `${origin}/type-target`].includes(candidate.webContents.getURL()));
      assert.ok(controlledTarget, "controlled input must only reach a disposable target");
      const position = screen.screenToDipPoint({ x, y });
      const targetBounds = controlledTarget.getContentBounds();
      const point = { x: position.x - targetBounds.x, y: position.y - targetBounds.y };
      assert.ok(point.x >= 0 && point.x < targetBounds.width && point.y >= 0 && point.y < targetBounds.height);
      await controlledTarget.webContents.executeJavaScript(`{
        const target = document.elementFromPoint(${point.x}, ${point.y});
        target.focus(); target.click();
      }`);
    },
    typeText: async (text, pressEnter) => {
      assert.ok(controlledTarget && !controlledTarget.isDestroyed());
      await controlledTarget.webContents.executeJavaScript(`{
        const target = document.activeElement;
        if (target.tagName !== 'INPUT') throw new Error('The click did not focus the input');
        target.value += ${JSON.stringify(text)};
        target.dispatchEvent(new Event('input', { bubbles: true }));
        if (${pressEnter}) target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }`);
    },
  };
  const input = config.simulateInput ? controlledInput : nativeInput;
  companion = new ClickyCompanion({ dashboardUrl: () => dashboardUrl, allowed,
    clickAt: async (...args) => {
      clickCount++;
      if (failNextClick) { failNextClick = false; throw new Error("Test click failed"); }
      await input.click(...args);
    },
    typeText: async (...args) => { typeCount++; await input.typeText(...args); } });
  assert.equal(BrowserWindow.getAllWindows().length, 0, "constructing the launcher must not open Clicky on startup");
  await assert.rejects(companion.launch(), /still starting/);
  dashboardUrl = origin;
  const png = nativeImage.createFromBitmap(Buffer.from([255, 128, 64, 255]), { width: 1, height: 1 });
  desktopCapturer.getSources = async () => {
    captureCount++;
    return [{ display_id: String(screen.getPrimaryDisplay().id), thumbnail: png }];
  };
  const bounds = screen.getPrimaryDisplay().bounds;
  let cursor = { x: bounds.x + 100, y: bounds.y + 100 };
  // Exercise the real desktop-following timer without moving the user's mouse.
  screen.getCursorScreenPoint = () => ({ ...cursor });
  await Promise.all([companion.launch(), companion.launch()]);
  assert.equal(BrowserWindow.getAllWindows().length, 2, "concurrent launch must reuse one conversation and one pointer");
  const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === `${origin}/clicky`);
  const marker = BrowserWindow.getAllWindows().find((candidate) => candidate !== window);
  assert.ok(marker.isVisible(), "the pointer must appear immediately on launch");
  assert.equal(marker.isFocusable(), false, "the follower must not steal keyboard focus");
  function nearCursor() {
    const actual = marker.getBounds();
    return Math.abs(actual.x - (cursor.x + 18)) <= 1 && Math.abs(actual.y - (cursor.y + 18)) <= 1;
  }
  assert.ok(nearCursor(), "pointer must appear beside the mouse before any question");
  cursor = { x: bounds.x + 250, y: bounds.y + 200 };
  await until(nearCursor, "pointer did not follow mouse movement");
  window.minimize();
  cursor = { x: bounds.x + 300, y: bounds.y + 250 };
  await until(nearCursor, "pointer must follow while the conversation is minimized");
  assert.ok(marker.isVisible());
  window.restore();
  cursor = { x: bounds.x + bounds.width - 1, y: bounds.y + bounds.height - 1 };
  await until(() => {
    const actual = marker.getBounds();
    return actual.x > bounds.x + bounds.width / 2 && actual.y > bounds.y + bounds.height / 2
      && actual.x + actual.width <= bounds.x + bounds.width
      && actual.y + actual.height <= bounds.y + bounds.height;
  }, "pointer must stay visible at the bottom-right screen edge");
  cursor = { x: bounds.x + 300, y: bounds.y + 250 };
  await until(nearCursor, "pointer did not leave the screen edge");
  hardenSession(window.webContents.session, allowed);
  const run = (code) => window.webContents.executeJavaScript(code, true);
  await until(() => run("!!document.querySelector('textarea') && !document.querySelector('textarea').disabled"), "UI did not become interactive");
  assert.equal(window.getTitle(), "Clicky", "the shared dashboard title must not rename Clicky");
  assert.equal(await run("navigator.windowControlsOverlay.visible"), true, "use native caption controls without the branded OS title bar");
  assert.ok(await run("document.querySelector('header').getBoundingClientRect().top >= 32"), "content must clear the native caption controls");
  assert.equal(await run("getComputedStyle(document.querySelector('main > div')).getPropertyValue('-webkit-app-region')"), "drag");
  assert.equal(await run("typeof window.require"), "undefined");
  assert.deepEqual(await run("Object.keys(window.clickyCompanion).sort()"), ["capture", "click", "onShortcut", "onToggleVoice", "point", "resetTarget"]);
  assert.equal(await run("window.clickyCompanion.click().then(() => false, () => true)"), true, "there is no click target on startup");
  assert.equal(captureCount, 0, "opening Clicky must not capture the desktop");
  assert.equal(await run("document.querySelector('[role=switch]').checked"), false, "YOLO starts off");
  assert.equal(await run("window.clickyCompanion.point({displayId:'0',x:0,y:0})"), false);
  // Disable playback for this test; no real microphone, screen, or model is used.
  await run("document.querySelectorAll('input[type=checkbox]')[1].click()");
  await run("Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(document.querySelector('textarea'),'Explain this screen'); document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}))");
  await until(() => run("!document.querySelector('button[type=submit]').disabled"), "send not enabled");
  await run("document.querySelector('form').requestSubmit()");
  await until(() => run("document.querySelectorAll('article').length === 2 && document.querySelector('[role=status]').textContent === 'Ready'"), "screen question did not finish");
  assert.equal(captureCount, 1);
  assert.equal(await run("document.querySelector('article strong')?.textContent"), "settings button");
  assert.equal(await run("document.querySelectorAll('article li').length"), 2, "reply Markdown must render as a real list");
  assert.ok(marker.isVisible(), "answer should reuse the visible pointer");
  assert.equal(BrowserWindow.getAllWindows().length, 2, "pointing must not create a duplicate pointer");
  assert.equal(marker.getBounds().x, bounds.x + Math.round(.25 * (bounds.width - 1)));
  assert.equal(marker.getBounds().y, bounds.y + Math.round(.30 * (bounds.height - 1)));
  assert.equal(await run(`window.clickyCompanion.point({displayId:${JSON.stringify(String(screen.getPrimaryDisplay().id))},x:1001,y:0})`), false);
  fs.writeFileSync(config.previewPath, (await window.webContents.capturePage()).toPNG());
  fs.writeFileSync(config.previewPath.replace(/\.png$/, "-pointer.png"), (await marker.webContents.capturePage()).toPNG());
  cursor = { x: bounds.x + 350, y: bounds.y + 300 };
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(marker.getBounds().x, bounds.x + Math.round(.25 * (bounds.width - 1)), "pointing must temporarily hold its target");
  await run("document.querySelector('[aria-label=\"Dismiss target\"]').click()");
  await until(nearCursor, "pointer must resume following when the suggested target is dismissed");
  assert.ok(marker.isVisible(), "the follower must persist after a target is dismissed");
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
  await run("document.querySelectorAll('input[type=checkbox]')[1].click()");
  await run("Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(document.querySelector('textarea'),'Read the answer aloud'); document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}))");
  await until(() => run("!document.querySelector('button[type=submit]').disabled"), "read-aloud question not enabled");
  await run("document.querySelector('form').requestSubmit()");
  await until(() => run("document.querySelectorAll('article').length === 6 && document.querySelector('[role=status]').textContent === 'Ready'"), "speech playback did not complete");
  assert.equal(synthesisCount, 1);
  assert.equal(await run("document.querySelector('[role=alert]')?.textContent || ''"), "");
  // A missing Voicebox profile falls back without making the answer an error.
  await run("window.fallbackReads = 0; Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [{ localService: true, lang: 'en-US' }], cancel: () => {}, speak: utterance => { window.fallbackReads++; setTimeout(() => utterance.onend?.(), 0); } } }); window.SpeechSynthesisUtterance = function(text) { this.text = text }; document.querySelectorAll('input[type=checkbox]')[0].click()");
  await run("Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(document.querySelector('textarea'),'Click the test button'); document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}))");
  await until(() => run("!document.querySelector('button[type=submit]').disabled"), "click question not enabled");
  await run("document.querySelector('form').requestSubmit()");
  await until(() => run("document.querySelectorAll('article').length === 8 && document.querySelector('[role=status]').textContent === 'Ready'"), "voice fallback did not complete");
  assert.equal(await run("window.fallbackReads"), 1);
  assert.equal(await run("document.querySelector('[role=alert]')?.textContent || ''"), "");
  assert.ok(await run("document.body.textContent.includes('Windows voice')"));
  // Deliver a real Windows click to a disposable window we own, not to any
  // user's app. The model's normalized coordinates land inside this button.
  const targetWindow = new BrowserWindow({ x: bounds.x + Math.round(.25 * (bounds.width - 1)) - 40,
    y: bounds.y + Math.round(.30 * (bounds.height - 1)) - 40, width: 180, height: 100,
    frame: false, show: false, webPreferences: { sandbox: true } });
  targetWindow.setAlwaysOnTop(true, "screen-saver");
  await targetWindow.loadURL(`${origin}/click-target`);
  targetWindow.showInactive();
  await run("[...document.querySelectorAll('button')].find(button => button.textContent === 'Click target').click()");
  await until(() => run("document.querySelector('[role=status]').textContent === 'Click sent'"), "click completion missing");
  await until(() => targetWindow.webContents.executeJavaScript("window.clicks === 1"), "the target did not receive the real Windows click");
  assert.equal(await run("window.clickyCompanion.click().then(() => false, () => true)"), true, "a target can only be clicked once");
  targetWindow.destroy();
  const typeWindow = new BrowserWindow({ x: bounds.x + Math.round(.25 * (bounds.width - 1)) - 40,
    y: bounds.y + Math.round(.30 * (bounds.height - 1)) - 40, width: 180, height: 100,
    frame: false, show: false, webPreferences: { sandbox: true } });
  typeWindow.setAlwaysOnTop(true, "screen-saver");
  await typeWindow.loadURL(`${origin}/type-target`);
  typeWindow.showInactive();
  await run("Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(document.querySelector('textarea'),'Type x.com and press Enter'); document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}))");
  await until(() => run("!document.querySelector('button[type=submit]').disabled"), "typing question not enabled");
  await run("document.querySelector('form').requestSubmit()");
  await until(() => run("document.querySelectorAll('article').length === 10 && document.querySelector('[role=status]').textContent === 'Ready'"), "typing question did not finish");
  await run("[...document.querySelectorAll('button')].find(button => button.textContent === 'Click & type').click()");
  await until(() => typeWindow.webContents.executeJavaScript("document.querySelector('input').value === 'x.com' && document.body.dataset.submitted === 'true'"), "the confirmed text and Enter key did not reach the target field");
  await until(() => run("document.querySelector('[role=status]').textContent === 'Text entered'"), "typing completion missing");
  assert.equal(clickCount, 2);
  assert.equal(typeCount, 1);

  // YOLO uses the same native bridge and disposable targets, without an action-button click.
  await run("document.querySelectorAll('input[type=checkbox]')[1].click(); document.querySelector('[role=switch]').click()");
  expectedYoloMode = true;
  assert.equal(await run("document.querySelector('[role=switch]').checked"), true);
  assert.ok(await run("document.body.textContent.includes('without approval')"));
  async function askQuestion(text) {
    await run(`Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(document.querySelector('textarea'),${JSON.stringify(text)}); document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}))`);
    await until(() => run("!document.querySelector('button[type=submit]').disabled"), "YOLO question not enabled");
    const previousChatCount = chatCount;
    await run("document.querySelector('form').requestSubmit()");
    await until(() => chatCount > previousChatCount, "YOLO question did not reach the server");
    await until(() => run("document.querySelector('[role=status]').textContent === 'Ready'"), "YOLO question did not finish");
  }
  await typeWindow.loadURL(`${origin}/type-target`);
  await askQuestion("Type x.com and press Enter");
  assert.equal(clickCount, 3, "YOLO should click exactly once");
  assert.equal(typeCount, 2, "YOLO should type exactly once");
  assert.equal(await typeWindow.webContents.executeJavaScript("document.querySelector('input').value"), "x.com");
  assert.equal(await typeWindow.webContents.executeJavaScript("document.body.dataset.submitted"), "true");
  assert.equal(await run("!!document.querySelector('[aria-label=\"Dismiss target\"]')"), false, "automatic actions must not leave a confirmation button");
  assert.equal(await run("window.clickyCompanion.click().then(() => false, () => true)"), true, "automatic targets remain single-use");
  await typeWindow.loadURL(`${origin}/click-target`);
  await askQuestion("Click the test button");
  assert.equal(clickCount, 4);
  assert.equal(await typeWindow.webContents.executeJavaScript("window.clicks"), 1);

  failNextClick = true;
  await askQuestion("Click the test button");
  assert.equal(clickCount, 5, "failed automatic clicks must not retry");
  assert.match(await run("document.querySelector('[role=alert]')?.textContent || ''"), /Test click failed/);
  await run("document.querySelectorAll('input[type=checkbox]')[0].click()");
  await askQuestion("Explain without a screen");
  assert.equal(clickCount, 5, "text-only YOLO answers must not click");

  await run("document.querySelectorAll('input[type=checkbox]')[0].click()");
  await run("Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(document.querySelector('textarea'),'Cancel automatic click'); document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}))");
  await until(() => run("!document.querySelector('button[type=submit]').disabled"), "cancel question not enabled");
  await run("document.querySelector('form').requestSubmit()");
  await until(() => releaseChat !== null, "cancel question did not reach the server");
  await run("document.querySelector('[aria-label=Cancel]').click()");
  releaseChat();
  await until(() => run("document.querySelector('[role=status]').textContent === 'Ready'"), "cancel did not return to Ready");

  await run("document.querySelector('[role=switch]').click()");
  expectedYoloMode = false;
  await askQuestion("Click the test button");
  assert.equal(clickCount, 5, "cancelled requests and YOLO-off answers must not click");
  assert.ok(await run("[...document.querySelectorAll('button')].some(button => button.textContent === 'Click target')"), "switching off must restore manual confirmation");
  await run("document.querySelector('[role=switch]').click()");
  expectedYoloMode = true;
  assert.equal(await run("!!document.querySelector('[aria-label=\"Dismiss target\"]')"), false, "enabling YOLO must dismiss a previously suggested target");
  assert.equal(clickCount, 5, "enabling YOLO must not execute an old target");
  typeWindow.destroy();
  window.setSize(320, 360);
  assert.ok(await run("document.querySelector('footer').getBoundingClientRect().bottom <= innerHeight + 1"), "controls must fit a small companion window");
  assert.ok(await run("document.querySelector('header').getBoundingClientRect().top >= 32"), "scrolling must not move the window header");
  window.setSize(420, 620);
  fs.writeFileSync(config.previewPath, (await window.webContents.capturePage()).toPNG());
  const outsider = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true,
    preload: path.join(config.desktopRoot, "dist", "preload", "clicky-preload.js") } });
  await outsider.loadURL(`${origin}/clicky`);
  assert.equal(await outsider.webContents.executeJavaScript("window.clickyCompanion.capture().then(() => false, () => true)"), true, "other windows cannot capture");
  assert.equal(await outsider.webContents.executeJavaScript("window.clickyCompanion.click().then(() => false, () => true)"), true, "other windows cannot click");
  outsider.destroy();
  window.close();
  await until(() => window.isDestroyed(), "the conversation did not close");
  assert.equal(BrowserWindow.getAllWindows().length, 0, "closing Clicky must also remove the follower");
  await companion.launch();
  assert.equal(BrowserWindow.getAllWindows().length, 2, "reopening must restore exactly one follower");
  const reopened = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === `${origin}/clicky`);
  await until(() => reopened.webContents.executeJavaScript("document.querySelector('[role=switch]')?.checked === true"), "YOLO preference must survive reopening");
  await reopened.webContents.executeJavaScript("document.querySelector('[role=switch]').click()", true);
  reopened.webContents.reload();
  await until(() => reopened.webContents.executeJavaScript("!!document.querySelector('textarea') && !document.querySelector('textarea').disabled && document.querySelector('[role=switch]')?.checked === false").catch(() => false), "turning YOLO off must also persist");
  companion.stop();
  assert.equal(BrowserWindow.getAllWindows().length, 0, "close must remove companion and pointer");
  fs.writeFileSync(config.resultPath, JSON.stringify({ ok: true, captureCount, chatCount, transcriptionCount, synthesisCount }));
  server.close();
  app.exit(0);
}).catch(async (error) => {
  fs.writeFileSync(config.resultPath, JSON.stringify({ ok: false, error: error.stack, captureCount, chatCount }));
  const diagnostics = await Promise.all(BrowserWindow.getAllWindows().map(async (window) => ({
    url: window.webContents.getURL(),
    text: await window.webContents.executeJavaScript("document.body.innerText").catch(() => "unavailable"),
  })));
  fs.writeFileSync(config.resultPath, JSON.stringify({ ok: false, error: error.stack, diagnostics, captureCount, chatCount }));
  companion?.stop();
  server?.close();
  app.exit(1);
});
