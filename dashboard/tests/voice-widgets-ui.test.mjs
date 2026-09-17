import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const weather = '```weather-results\n' + JSON.stringify({ location: 'Eindhoven', country: 'Netherlands', days: [
  { date: '2026-09-07', temperatureC: 20, minC: 15, maxC: 22, code: 0, condition: 'Clear', isDay: true },
] }) + '\n```';
const imageResults = '```image-results\n' + JSON.stringify({ query: 'Bread', items: [
  { title: 'Fresh bread', image: 'https://example.com/bread.png', thumb: 'https://example.com/bread.png', page: 'https://example.com/bread', site: 'example.com' },
] }) + '\n```';
const products = {
  schemaVersion: 1, kind: 'product-search', renderer: 'product-carousel', id: 'products-1', title: 'Headphones', createdAt: '2026-09-07T10:00:00Z',
  actions: ['open-details', 'find-similar', 'compare', 'visit'], data: { query: 'Headphones', sources: [], products: [
    { id: 'headphones', title: 'Studio headphones', merchant: 'Audio shop', url: 'https://example.com/headphones', sourceIds: [], description: 'Comfortable studio headphones.' },
  ] },
};
const search = {
  schemaVersion: 1, kind: 'chat-search', renderer: 'chat-search-results', id: 'chats-1', title: 'Your chats', createdAt: '2026-09-07T10:00:00Z', actions: ['open-chat'],
  data: { query: 'Fitness', surface: 'dashboard_terminal', chats: [
    { id: 'fitness', title: 'Fitness plan', updatedAt: '2026-09-07T10:00:00Z', pinned: false, matchedOn: 'title', snippet: 'Your workout plan' },
  ] },
};
const garden = {
  schemaVersion: 1, kind: 'garden-search', renderer: 'garden-navigator', id: 'gardens-1', title: 'Your gardens', createdAt: '2026-09-07T10:00:00Z', actions: ['open-garden', 'open-page'],
  data: { query: 'Fitness', gardens: [{ slug: 'fitness', name: 'Fitness', results: [{ pageSlug: 'workouts', title: 'Workouts' }] }] },
};

test('voice shows chat widgets, supports their controls, and keeps display payloads out of speech', { timeout: 60000 }, async () => {
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useState} from 'react';import{createRoot}from'react-dom/client';
      import Voice from './src/app/components/voice-conversation-overlay';
      window.played=[];window.sent=[];
      navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[{stop(){}}]});
      window.AudioContext=class { sampleRate=16000;destination={};async close(){}async resume(){}
        createMediaStreamSource(){return{connect(){},disconnect(){}};}createGain(){return{gain:{value:0},connect(){},disconnect(){}};}
        createScriptProcessor(){return window.processor={connect(){},disconnect(){},onaudioprocess:null};}
      };
      window.Audio=class extends EventTarget {constructor(url){super();this.src=url;}
        async play(){window.played.push(await fetch(this.src).then(r=>r.text()));window.finishSpeech=()=>this.dispatchEvent(new Event('ended'));}
        pause(){}load(){}removeAttribute(){}
      };
      window.say=()=>{for(const level of [.2,.2,.2,...Array(16).fill(.001)])window.processor.onaudioprocess?.({inputBuffer:{getChannelData:()=>new Float32Array(4096).fill(level)}});};
      function App(){const[open,setOpen]=useState(true),[messages,setMessages]=useState([]),[busy,setBusy]=useState(false);
        window.answer=(content,uiResources=[],busy=false)=>{setMessages(m=>[...m.slice(0,-1),{role:'assistant',content,uiResources}]);setBusy(busy);};
        return <Voice compact={location.search.includes('compact')} open={open} onClose={()=>setOpen(false)} messages={messages} busy={busy}
          onSend={text=>{window.sent.push(text);setMessages(m=>[...m,{role:'user',content:text},{role:'assistant',content:''}]);setBusy(true);}}/>;
      }createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'speech-fixture', setup(build) {
      const stubs = {
        '@/lib/speech/clap/audio-focus': 'export const requestForegroundMicrophone=()=>navigator.mediaDevices.getUserMedia();export function stopForegroundStream(s){s?.getTracks().forEach(t=>t.stop());}export const holdForegroundAudio=()=>()=>{};',
        '@/lib/speech/clap-wake': 'export const holdClapWake=()=>()=>{};',
        '@/lib/speech/subscription-live': 'export const subscriptionSelected=async()=>false;export async function connectSubscriptionVoice(){}',
        '@/lib/speech/prepare-client': 'export async function prepareLocalSpeech(){}export const speechErrorMessage=(e,f)=>e?.message||f;',
        '@/lib/speech/request-client': `export async function speechRequest(url,options){return url.endsWith('/transcribe')?Response.json({text:'Show me the results'}):new Response(JSON.parse(options.body).text);}`,
      };
      build.onResolve({ filter: /.*/ }, args => stubs[args.path] ? { path: args.path, namespace: 'fixture' } : null);
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  const cssInput = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8')
    .replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";', '@source "./components/voice*.tsx"; @source "./components/chat*.tsx"; @source "./components/hermes/product*.tsx"; @source "./components/hermes/garden-navigator.tsx"; @source "./components/hermes/chat-search-results.tsx";');
  const css = (await postcss([tailwind({ base: root })]).process(cssInput, { from: path.join(root, 'src/app/globals.css') })).css;
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
    else if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><main id="root"></main><script src="/app.js"></script></body></html>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const artifacts = path.join(root, '.tmp-voice-widgets-qa'); fs.mkdirSync(artifacts, { recursive: true });
  try {
    for (const compact of [true, false]) {
      const page = await browser.newPage({ viewport: { width: 800, height: 480 }, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('https://example.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="tan"/></svg>' }));
      await page.goto(`http://127.0.0.1:${server.address().port}/?${compact ? 'compact' : ''}`);
      const stage = state => page.locator(`.voice-stage[data-stage="${state}"]`).waitFor();
      const response = () => page.locator(compact ? '.voice-widget-message-assistant' : '.voice-caption-text').last();
      await stage('listening');
      await page.evaluate(() => window.say());
      await stage('thinking');
      // A half-streamed fence must not leak its JSON into the voice UI.
      await page.evaluate(content => window.answer(content, [], true), weather.slice(0, 75));
      assert.doesNotMatch(await response().innerText(), /temperatureC|country|```/);
      await page.evaluate(content => window.answer('Clear skies today.\n\n' + content), weather);
      await stage('speaking');
      await response().locator('.chat-weather-card').waitFor();
      assert.equal(await page.evaluate(() => window.played.at(-1)), 'Clear skies today.');
      await page.evaluate(() => window.finishSpeech());
      await stage('listening');
      await response().locator('.chat-weather-card').evaluate(async node => {
        await Promise.all(node.getAnimations().map(animation => animation.finished));
      });
      await page.screenshot({ path: path.join(artifacts, `weather-${compact ? 'compact' : 'full'}.png`) });

      await page.evaluate(() => window.say());
      await stage('thinking');
      const speechCount = await page.evaluate(() => window.played.length);
      await page.evaluate(({ search, garden, products }) => window.answer('', [search, garden, products]), { search, garden, products });
      await stage('listening');
      assert.equal(await page.evaluate(() => window.played.length), speechCount, 'resource-only answer should not synthesize empty speech');
      for (const renderer of ['chat-search-results', 'garden-navigator', 'product-carousel']) await response().locator(`[data-generative-ui="${renderer}"]`).waitFor();
      assert.match(await response().getByRole('link', { name: /Fitness plan/ }).getAttribute('href'), /terminalChat=fitness/);
      await response().getByRole('button', { name: 'Open details for Studio headphones', exact: true }).click();
      await response().getByText('Comfortable studio headphones.', { exact: true }).waitFor();
      await response().getByRole('button', { name: 'Similar', exact: true }).first().click();
      await stage('thinking');
      assert.equal(await page.evaluate(() => window.sent.at(-1)), 'Find products similar to Studio headphones from Audio shop.');
      await page.evaluate(content => window.answer('Here is an image.\n\n' + content), imageResults);
      await stage('speaking');
      assert.equal(await page.evaluate(() => window.played.at(-1)), 'Here is an image.');
      await page.evaluate(() => window.finishSpeech());
      await stage('listening');
      await response().locator('.chat-image-results button').first().click();
      await page.getByRole('dialog', { name: 'Fresh bread', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'Fresh bread', exact: true }).waitFor({ state: 'detached' });
      await page.getByRole('dialog', { name: 'Voice conversation', exact: true }).waitFor();
      await page.setViewportSize({ width: 400, height: 300 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const viewport = page.locator(compact ? '.voice-widget-transcript' : '.voice-caption-text');
      await response().locator('.chat-image-results').scrollIntoViewIfNeeded();
      const closeBounds = await page.getByRole('button', { name: 'Close voice mode', exact: true }).boundingBox();
      assert.ok(closeBounds.y >= 0 && closeBounds.y + closeBounds.height <= 300, 'widget focus must not scroll the voice controls out of the window');
      assert.equal(await viewport.evaluate(node => node.scrollWidth > node.clientWidth), false);
      await page.screenshot({ path: path.join(artifacts, `image-small-${compact ? 'compact' : 'full'}.png`) });

      await page.evaluate(() => window.say());
      await stage('thinking');
      const beforeWidget = await page.evaluate(() => window.played.length);
      await page.evaluate(content => window.answer(content), weather);
      await stage('listening');
      await response().locator('.chat-weather-card').waitFor();
      assert.equal(await page.evaluate(() => window.played.length), beforeWidget, 'a display-only fence stays visible without narration');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
