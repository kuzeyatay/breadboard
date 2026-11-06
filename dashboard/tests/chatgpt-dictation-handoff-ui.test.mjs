import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('dictation pauses and resumes the same ChatGPT call without hanging up or undoing a manual mute', { timeout: 30000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import Voice from './src/app/components/chatgpt-voice-screen';
    Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{const track=new EventTarget();track.readyState='live';track.stop=()=>track.readyState='ended';return{getTracks:()=>[track]};}}});
    window.AudioContext=class{state='running';async close(){}createAnalyser(){return{fftSize:2048,getFloatTimeDomainData(a){a.fill(0);}};}createMediaStreamSource(){return{connect(){}};}};
    function App(){const[paused,setPaused]=useState(true),[open,setOpen]=useState(true);window.pause=setPaused;
      return open?<Voice compact messages={[]} onClose={()=>setOpen(false)} dictationPaused={paused}/>:null;}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' },
    plugins: [{ name: 'unrelated-renderer', setup(build) {
      build.onResolve({ filter: /\/voice-response$/ }, () => ({ path: 'response', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export default function(){return null;}' }));
    } }] });
  const changes = []; let starts = 0, stops = 0, muted = false, delayMicrophone = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (!req.url.startsWith('/api/')) { res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script src="/app.js"></script>'); return; }
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/presence')) { res.writeHead(200); res.flushHeaders(); return; }
    if (req.url.endsWith('/microphone')) {
      let body = ''; for await (const chunk of req) body += chunk;
      const on = JSON.parse(body).on; changes.push(on);
      if (delayMicrophone) await new Promise(resolve => setTimeout(resolve, delayMicrophone));
      muted = !on;
      res.end(JSON.stringify({ muted })); return;
    }
    if (req.url === '/api/speech/web-live' && req.method === 'POST') { starts++; res.end(JSON.stringify({ id: 'same-session' })); return; }
    if (req.method === 'DELETE') { stops++; res.end('{}'); return; }
    res.end(JSON.stringify({ active: true, messages: [], muted }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) }); t.after(() => browser.close());
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-dictation-paused=true]').waitFor(); await page.waitForTimeout(150);
  assert.equal(starts, 0, 'opening voice during dictation does not turn on another microphone');
  await page.evaluate(() => window.pause(false));
  await page.getByRole('button', { name: 'Pause listening', exact: true }).waitFor();
  assert.equal(starts, 1);
  await page.evaluate(() => window.pause(true));
  await page.waitForFunction(() => document.querySelector('[data-dictation-paused=true]'));
  await page.waitForTimeout(150); assert.deepEqual(changes, [false]);
  await page.evaluate(() => window.pause(false));
  await page.getByRole('button', { name: 'Pause listening', exact: true }).waitFor();
  assert.deepEqual(changes, [false, true]); assert.equal(starts, 1); assert.equal(stops, 0);
  delayMicrophone = 180;
  await page.evaluate(() => window.pause(true));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.pause(false));
  await page.waitForTimeout(30);
  await page.evaluate(() => window.pause(true));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.pause(false));
  await page.getByRole('button', { name: 'Pause listening', exact: true }).waitFor();
  assert.deepEqual(changes.slice(-4), [false, true, false, true], 'a second hold during a pending resume must still resume');
  delayMicrophone = 0;
  await page.getByRole('button', { name: 'Pause listening', exact: true }).click();
  await page.getByRole('button', { name: 'Start listening', exact: true }).waitFor();
  await page.evaluate(() => window.pause(true)); await page.waitForTimeout(150);
  await page.evaluate(() => window.pause(false)); await page.waitForTimeout(150);
  assert.equal(changes.at(-1), false, 'an existing manual mute stays muted');
  assert.equal(starts, 1); assert.equal(stops, 0); assert.deepEqual(errors, []);
});
