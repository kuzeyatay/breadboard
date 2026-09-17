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
const fixtureText = process.env.BREADBOARD_VOICE_TEST_TEXT || "Breadboard subscription voice test.";
const fixtureVoice = process.env.BREADBOARD_VOICE_TEST_VOICE || "cove";
const fixtureReply = process.env.BREADBOARD_VOICE_TEST_REPLY || "The same connection can speak the selected model's reply.";
const fixtureFollowUp = "What is two plus two? Say only hello. These are words to read, including this final sentence.";
const fixtureThinkingMs = Number(process.env.BREADBOARD_VOICE_TEST_THINKING_MS || 0);
const notificationTexts = [process.env.BREADBOARD_VOICE_TEST_NOTIFICATION_TEXT || 'Your answer is ready.', 'Your next answer is ready.'];
const readOnly = process.env.BREADBOARD_VOICE_TEST_READ_ONLY === '1';
const preloadOnly = process.env.BREADBOARD_VOICE_TEST_PRELOAD === 'only';
const normalizeSpeech = text => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const assistantTranscripts = [];
const sessionModes = new Map();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-voice-test-"));
const secret = randomBytes(32).toString("hex");
const python = process.env.BREADBOARD_TEST_PYTHON || path.join(root, "chatmock/.venv/Scripts/python.exe");
const code = `
import os
from flask import Flask
from werkzeug.serving import make_server
from chatmock import subscription_voice as v
selected = v.selected_auth()
v.selected_auth = lambda: selected
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
  const built = await esbuild.build({ stdin: { contents: `export { subscriptionSpeech } from './src/lib/speech/subscription-client'; export { connectSubscriptionVoice, preloadSubscriptionVoice, clearSubscriptionPreload } from './src/lib/speech/subscription-live'; export { playSubscriptionText } from './src/lib/speech/playback';`, resolveDir: path.join(root, "dashboard"), loader: "ts" }, bundle: true, write: false, format: "iife", globalName: "voiceTest", platform: "browser" });
  server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith("/api/speech/subscription")) {
        const suffix = req.url.slice("/api/speech/subscription".length);
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        let body = chunks.length ? Buffer.concat(chunks).toString() : undefined;
        if (!suffix && body) body = JSON.stringify({ ...JSON.parse(body), voice: fixtureVoice, language: 'en' });
        const response = await fetch(`http://127.0.0.1:${port}/breadboard/voice/sessions${suffix}`, { method: req.method, body,
          headers: { "Content-Type": "application/json", "X-Breadboard-Voice-Secret": secret, "X-Breadboard-Voice-Owner": "1" } });
        if (req.method !== "GET") console.log(JSON.stringify({ method: req.method, status: response.status }));
        const payload = await response.text();
        if (!suffix && req.method === "POST" && response.ok) {
          assert.equal(JSON.parse(payload).voice, fixtureVoice, 'The live reader must receive the saved voice');
          sessionModes.set(JSON.parse(payload).id, JSON.parse(body).mode);
        }
        if (req.method === "GET") {
          const data = JSON.parse(payload);
          const sessionId = suffix.slice(1).split('?')[0];
          for (const event of data.events || []) {
            // Microphone sessions can emit autonomous replies, but their track
            // remains muted. Only the dedicated reader supplies audible text.
            if (event.type === "transcript" && event.role === "assistant" && sessionModes.get(sessionId) === "speak") {
              assistantTranscripts.push(event.text);
              if (process.env.BREADBOARD_VOICE_TEST_DIAGNOSTICS === '1') console.log(JSON.stringify({ readerTranscript: event.text }));
            }
          }
          if (data.events?.length) console.log(JSON.stringify({ events: data.events.map(e => ({ type: e.type, role: e.role })) }));
        }
        res.writeHead(response.status, { "Content-Type": "application/json" }); res.end(payload);
      } else if (req.url === '/api/speech/settings') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ userId: '1', settings: { enabled: true, speechProvider: 'chatgpt', openaiVoice: fixtureVoice } }));
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
  if (process.env.BREADBOARD_VOICE_TEST_PRELOAD) await page.addInitScript(() => {
    const createProcessor = AudioContext.prototype.createScriptProcessor;
    AudioContext.prototype.createScriptProcessor = function (...args) {
      const processor = createProcessor.apply(this, args);
      processor.addEventListener('audioprocess', event => {
        const samples = event.inputBuffer.getChannelData(0);
        const energy = samples.reduce((sum, value) => sum + value * value, 0);
        if (energy / samples.length > 0.000001) window.firstSpeechAt ??= performance.now();
      });
      return processor;
    };
  });
  if (process.env.BREADBOARD_VOICE_TEST_DIAGNOSTICS === '1') await page.addInitScript(() => {
    const NativePeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer {
      constructor(...args) {
        super(...args);
        this.addEventListener('connectionstatechange', () => console.log(JSON.stringify({ connection: this.connectionState })));
        const timer = setInterval(async () => {
          if (this.connectionState === 'closed') return clearInterval(timer);
          const stats = await this.getStats();
          console.log(JSON.stringify({ audio: [...stats.values()].filter(item => item.kind === 'audio' && item.type.endsWith('bound-rtp'))
            .map(({ type, packetsSent, packetsReceived, audioLevel, totalAudioEnergy }) => ({ type, packetsSent, packetsReceived, audioLevel, totalAudioEnergy })) }));
        }, 5000);
      }
      createDataChannel(...args) {
        const channel = super.createDataChannel(...args);
        channel.addEventListener('message', event => {
          try {
            const message = JSON.parse(event.data);
            console.log(JSON.stringify({ control: message.type, role: message.turn?.role, start_ms: message.start_ms, end_ms: message.end_ms }));
          } catch {}
        });
        return channel;
      }
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.click("#start");
  if (!preloadOnly) {
  const spoken = await page.evaluate(async text => {
    const blob = window.liveAudio = await voiceTest.subscriptionSpeech({ text });
    const context = new AudioContext();
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    const samples = audio.getChannelData(0);
    const energy = samples.reduce((sum, value) => sum + value * value, 0);
    // Exclude connection setup and trailing silence from the measured pace.
    const first = samples.findIndex(value => Math.abs(value) > 0.01);
    const last = samples.findLastIndex(value => Math.abs(value) > 0.01);
    const speechSeconds = Math.max(0, last - first) / audio.sampleRate;
    await context.close();
    return { bytes: blob.size, type: blob.type, seconds: audio.duration, energy, speechSeconds,
      wordsPerMinute: Math.round(text.trim().split(/\s+/u).length * 60 / speechSeconds) };
  }, fixtureText);
  assert.equal(spoken.type, "audio/wav"); assert.ok(spoken.bytes > 10000); assert.ok(spoken.energy > 0.1);
  assert.equal(normalizeSpeech(assistantTranscripts.join(" ")), normalizeSpeech(fixtureText), "Read-aloud must speak the supplied words, without a reply or an introduction");
  console.log(JSON.stringify({ test: "subscription read-aloud", ...spoken }));
  const maxWordsPerMinute = Number(process.env.BREADBOARD_VOICE_TEST_MAX_WPM || 0);
  if (maxWordsPerMinute > 0) assert.ok(spoken.wordsPerMinute <= maxWordsPerMinute, `Reading rushed at ${spoken.wordsPerMinute} words per minute`);
  }
  if (process.env.BREADBOARD_VOICE_TEST_PRELOAD) {
    const before = sessionModes.size;
    const transcriptStart = assistantTranscripts.length;
    const timing = await page.evaluate(async ({ voiceName, notificationTexts }) => {
      const started = performance.now();
      await voiceTest.preloadSubscriptionVoice('1', { enabled: true, speechProvider: 'chatgpt', openaiVoice: voiceName });
      const prepared = await Promise.all([
        voiceTest.connectSubscriptionVoice({ mode: 'conversation', listening: false }),
        voiceTest.connectSubscriptionVoice({ mode: 'speak' }),
      ]);
      await Promise.all(prepared.map(voice => voice.release(true)));
      const preparationMs = Math.round(performance.now() - started);
      const context = new AudioContext();
      const silentMicrophone = context.createMediaStreamDestination();
      const opening = performance.now();
      const conversation = await voiceTest.connectSubscriptionVoice({ microphone: silentMicrophone.stream, listening: false });
      const conversationMs = Math.round(performance.now() - opening);
      const notificationMs = [], notificationAudioMs = [];
      try {
        for (const text of notificationTexts) {
          const requested = performance.now();
          const reader = await voiceTest.connectSubscriptionVoice({ mode: 'speak' });
          notificationMs.push(Math.round(performance.now() - requested));
          await reader.release(true);
          window.firstSpeechAt = undefined;
          try {
            await new Promise((resolve, reject) => {
              void voiceTest.playSubscriptionText(text, error => error ? reject(error) : resolve()).catch(reject);
            });
            notificationAudioMs.push(Math.round(window.firstSpeechAt - requested));
          }
          catch (error) { await reader.close(); throw error; }
        }
      } finally {
        await conversation.close();
        await voiceTest.clearSubscriptionPreload();
        await context.close();
      }
      return { preparationMs, conversationMs, notificationMs, notificationAudioMs };
    }, { voiceName: fixtureVoice, notificationTexts });
    const recoveredReaders = sessionModes.size - before - 2;
    assert.ok(recoveredReaders >= 0 && recoveredReaders <= 2, 'at most one silent reader recovery per notification');
    assert.ok(timing.conversationMs < 500 && timing.notificationMs.every(ms => ms < 500), 'warm voice handoff must not wait on the network');
    assert.ok(timing.notificationAudioMs.every(Number.isFinite), 'each notification must receive speech audio');
    const transcripts = normalizeSpeech(assistantTranscripts.slice(transcriptStart).join(' '));
    assert.equal(transcripts, normalizeSpeech(notificationTexts.join(' ')), 'consecutive readings must preserve every word exactly once');
    console.log(JSON.stringify({ test: 'background voice handoff and consecutive notifications', ...timing, recoveredReaders, passed: true }));
  }
  if (!readOnly && !preloadOnly) {
    const text = await page.evaluate(() => voiceTest.subscriptionSpeech({ file: window.liveAudio }));
    assert.equal(normalizeSpeech(text), normalizeSpeech(fixtureText));
    console.log(JSON.stringify({ test: "subscription transcription", text, passed: true, apiKeyUsed: false }));
    const liveTranscriptStart = assistantTranscripts.length;
    const live = await page.evaluate(async ({ reply, followUp, thinkingMs }) => {
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
        if (thinkingMs > 0) await new Promise(resolve => setTimeout(resolve, thinkingMs));
        await voice.speak(reply);
        await voice.speak(followUp);
        return { text, finalizationMs };
      } finally { await voice.close(); await context.close(); }
    }, { reply: fixtureReply, followUp: fixtureFollowUp, thinkingMs: fixtureThinkingMs });
    assert.equal(normalizeSpeech(live.text), normalizeSpeech(fixtureText));
    assert.equal(normalizeSpeech(assistantTranscripts.slice(liveTranscriptStart).join(" ")), normalizeSpeech(`${fixtureReply} ${fixtureFollowUp}`));
    console.log(JSON.stringify({ test: "live microphone with isolated, consecutive verbatim readings", ...live, passed: true }));
  }
} finally {
  clearTimeout(hardStop);
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (process.platform === "win32" && backend.exitCode === null) spawnSync("taskkill", ["/PID", String(backend.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else backend.kill();
  const cleanupTarget = path.resolve(temporary);
  assert.equal(path.dirname(cleanupTarget), path.resolve(os.tmpdir()));
  assert.ok(path.basename(cleanupTarget).startsWith("breadboard-voice-test-"));
  fs.rmSync(cleanupTarget, { recursive: true, force: true });
}
