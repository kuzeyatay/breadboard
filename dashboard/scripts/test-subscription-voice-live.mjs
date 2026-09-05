// Explicit, opt-in live acceptance test. Uses the selected ChatGPT account,
// never an API key or the microphone. Tests production browser + bridge code.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import esbuild from "esbuild";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../", import.meta.url));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-voice-test-"));
const secret = randomBytes(32).toString("hex");
const python = process.env.BREADBOARD_TEST_PYTHON || path.join(root, "chatmock/.venv/Scripts/python.exe");
const code = `
import os
from flask import Flask
from werkzeug.serving import make_server
from chatmock import subscription_voice as v
from chatmock.utils import _read_auth_file_with_path, get_effective_chatgpt_auth
selected = _read_auth_file_with_path()
v.get_effective_chatgpt_auth = lambda: get_effective_chatgpt_auth(selected=selected)
os.environ['CODEX_HOME'] = os.environ['BREADBOARD_TEST_HOME']
v.secret_path().write_text(os.environ['BREADBOARD_TEST_SECRET'], encoding='utf-8')
app = Flask(__name__)
app.register_blueprint(v.voice_bp)
server = make_server('127.0.0.1', 0, app, threaded=True)
print(server.server_port, flush=True)
server.serve_forever()
`;
const backend = spawn(python, ["-c", code], { cwd: path.join(root, "chatmock"), windowsHide: true,
  env: { ...process.env, OPENAI_API_KEY: "", CODEX_API_KEY: "", BREADBOARD_TEST_HOME: temporary, BREADBOARD_TEST_SECRET: secret }, stdio: ["pipe", "pipe", "pipe"] });
let browser, server;
const hardStop = setTimeout(() => {
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(backend.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else backend.kill();
  process.exit(1);
}, 180_000);
try {
  const port = await new Promise((resolve, reject) => {
    backend.once("error", reject);
    backend.once("exit", (code) => reject(new Error(`Voice test gateway exited ${code}`)));
    backend.stdout.once("data", data => resolve(Number(String(data).trim())));
    backend.stderr.on("data", data => { if (String(data).includes("Traceback")) process.stderr.write(data); });
  });
  assert.ok(port > 0);
  console.log("Voice test gateway ready");
  const built = await esbuild.build({ stdin: { contents: `export { subscriptionSpeech } from './src/lib/speech/subscription-client'; export { connectSubscriptionVoice } from './src/lib/speech/subscription-live';`, resolveDir: path.join(root, "dashboard"), loader: "ts" }, bundle: true, write: false, format: "iife", globalName: "voiceTest", platform: "browser" });
  server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith("/api/speech/subscription")) {
        const suffix = req.url.slice("/api/speech/subscription".length);
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        let body = chunks.length ? Buffer.concat(chunks).toString() : undefined;
        if (!suffix && body) body = JSON.stringify({ ...JSON.parse(body), voice: "cove", language: null });
        const response = await fetch(`http://127.0.0.1:${port}/breadboard/voice/sessions${suffix}`, { method: req.method, body,
          headers: { "Content-Type": "application/json", "X-Breadboard-Voice-Secret": secret, "X-Breadboard-Voice-Owner": "1" } });
        if (req.method !== "GET") console.log(JSON.stringify({ method: req.method, status: response.status }));
        const payload = await response.text();
        if (req.method === "GET") {
          const data = JSON.parse(payload);
          if (data.events?.length) console.log(JSON.stringify({ events: data.events.map(e => ({ type: e.type, role: e.role })) }));
        }
        res.writeHead(response.status, { "Content-Type": "application/json" }); res.end(payload);
      } else if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(built.outputFiles[0].text); }
      else res.end('<!doctype html><button id="start">Test</button><script src="/app.js"></script>');
    } catch { res.writeHead(500); res.end('{"error":"Test gateway failed"}'); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(p => fs.existsSync(p));
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage();
  page.on("console", message => console.log(message.text()));
  page.on("pageerror", error => process.stderr.write(error.message + "\n"));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.click("#start");
  const spoken = await page.evaluate(async () => {
    const blob = window.liveAudio = await voiceTest.subscriptionSpeech({ text: "Breadboard subscription voice test." });
    const context = new AudioContext();
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    const samples = audio.getChannelData(0);
    const energy = samples.reduce((sum, value) => sum + value * value, 0);
    await context.close();
    return { bytes: blob.size, type: blob.type, seconds: audio.duration, energy };
  });
  assert.equal(spoken.type, "audio/wav"); assert.ok(spoken.bytes > 10000); assert.ok(spoken.energy > 0.1);
  console.log(JSON.stringify({ test: "subscription read-aloud", ...spoken }));
  const text = await page.evaluate(() => voiceTest.subscriptionSpeech({ file: window.liveAudio }));
  assert.match(text.replace(/[^\p{L}\p{N}]+/gu, " "), /breadboard subscription voice test/i);
  console.log(JSON.stringify({ test: "subscription transcription", text, passed: true, apiKeyUsed: false }));
  const live = await page.evaluate(async () => {
    const context = new AudioContext();
    const microphone = context.createMediaStreamDestination();
    const source = context.createBufferSource();
    source.buffer = await context.decodeAudioData(await window.liveAudio.arrayBuffer());
    source.connect(microphone);
    const voice = await voiceTest.connectSubscriptionVoice({ microphone: microphone.stream });
    try {
      await context.resume();
      const ended = new Promise(resolve => { source.onended = resolve; });
      source.start();
      await ended;
      const endedAt = performance.now();
      const text = await voice.finishTranscript();
      const finalizationMs = Math.round(performance.now() - endedAt);
      await voice.speak("The same connection can speak the selected model's reply.");
      return { text, finalizationMs };
    } finally { await voice.close(); await context.close(); }
  });
  assert.match(live.text.replace(/[^\p{L}\p{N}]+/gu, " "), /breadboard subscription voice test/i);
  console.log(JSON.stringify({ test: "live microphone and reply on one connection", ...live, passed: true }));
} finally {
  clearTimeout(hardStop);
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (process.platform === "win32" && backend.exitCode === null) spawnSync("taskkill", ["/PID", String(backend.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else backend.kill();
  fs.rmSync(temporary, { recursive: true, force: true });
}
