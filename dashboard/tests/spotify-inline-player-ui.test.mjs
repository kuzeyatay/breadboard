import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import test from "node:test";
import { createSpotifyHistoryStore } from "../src/lib/spotify/history-store.ts";
import { ensureSpotifySchema } from "../src/lib/spotify/schema.ts";
import Database from "better-sqlite3";
import { createHermesEventNormalizationState, normalizeHermesEvent } from "../src/lib/agent-runtime/hermes-events.ts";
import {
  generativeUiResourcesFromVerification,
  normalizeGenerativeUiResources,
  spotifyPlaybackFromVerification,
} from "../src/lib/generative-ui/contracts.ts";
import { spotifyPlayerAssistantIndex } from "../src/lib/hermes/spotify-intent.ts";

const executablePath = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);

test("a saved playlist keeps its link when the reply settles and when an older chat reopens", async () => {
  const playlist = {
    id: "0123456789abcdefghijAB", uri: "spotify:playlist:0123456789abcdefghijAB",
    name: "Laid-back Guitar Rock", trackCount: 29, isPublic: false,
  };
  const [event] = normalizeHermesEvent({
    type: "tool.complete", session_id: "live",
    payload: { name: "spotify_create_playlist", tool_id: "save", result: { playlist, status: "created" } },
  }, "live", "chat", createHermesEventNormalizationState());
  const live = event.payload.uiResources;
  assert.equal(live.length, 1);
  assert.equal(event.payload.spotifyPlaybackPrepared, false);
  const verification = { evidence: [event.payload] };
  const restored = generativeUiResourcesFromVerification(verification);
  assert.deepEqual(restored, live);
  assert.deepEqual(normalizeGenerativeUiResources(JSON.parse(JSON.stringify(live))), live);
  assert.equal(spotifyPlaybackFromVerification(verification).get("save"), false);
  const messages = [
    { role: "assistant", tools: [{toolName: "spotify_play", status: "completed", spotifyPlaybackPrepared: true}] },
    { role: "user", content: "Save the playlist to Spotify" },
    { role: "assistant", tools: [{ ...event.payload, status: "completed" }] },
  ];
  assert.equal(spotifyPlayerAssistantIndex(messages), 0);

  const bundle = await build({
    stdin: { resolveDir: path.resolve(import.meta.dirname, ".."), loader: "tsx", contents: `
      import { createRoot } from "react-dom/client";
      import Renderer from "./src/app/components/hermes/generative-ui-renderer";
      const root = createRoot(document.getElementById("root"));
      window.showReply = (resources, text) => root.render(<><Renderer resources={resources} /><p>{text}</p></>);
      window.showReply(JSON.parse(sessionStorage.getItem("resources") ?? "[]"), "");
    ` },
    outfile: "test.js", bundle: true, write: false, platform: "browser", format: "iife",
    jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' },
  });
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage();
    const requests = [];
    await page.route("https://widget.test/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/") {
        return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/test.js"></script>' });
      }
      if (url.pathname === "/test.js") return route.fulfill({ contentType: "text/javascript", body: script });
      requests.push(url.pathname);
      return route.abort();
    });
    await page.goto("https://widget.test/");
    await page.evaluate(resources => window.showReply(resources, ""), live);
    const link = page.getByRole("link", { name: /Laid-back Guitar Rock.*29 tracks.*Open in Spotify/ });
    await link.waitFor();
    await page.evaluate(resources => window.showReply(resources, "Added to Spotify."), live);
    assert.equal(await link.getAttribute("href"), `https://open.spotify.com/playlist/${playlist.id}`);
    await page.evaluate(resources => sessionStorage.setItem("resources", JSON.stringify(resources)), restored);
    await page.reload();
    await link.waitFor();
    assert.deepEqual(requests, [], "the saved link works without a playback session");
  } finally {
    await browser.close();
  }
});

test("inline player reflects provider playback, retains its lease, and does not restart on reload", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    stdin: {resolveDir:root,loader:"tsx",contents:`
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import Player from './src/app/components/hermes/inline-spotify-player';
      const root=createRoot(document.getElementById('root'));
      window.unmountPlayer=()=>root.unmount();
      root.render(<Player conversationPublicId="spotify-test"/>);
    `}, bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",
    define:{"process.env.NODE_ENV":'"test"'},
  });
  const requests = [];
  const track = {id:'0123456789abcdefghijAB',uri:'spotify:track:0123456789abcdefghijAB',name:'Shoot to Thrill',artist:'AC/DC',album:'Back In Black',durationMs:317000,imageUrl:'/cover.jpg'};
  let playing = true;
  let engineError = null;
  let target = "inline";
  const server = http.createServer(async (req,res) => {
    if (req.url === '/app.js') {res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
    if (!req.url.startsWith('/api/')) {res.setHeader('Content-Type','text/html');res.end('<html><body><div id="root"></div><script src="/app.js"></script></body></html>');return;}
    let body = ''; for await (const chunk of req) body += chunk;
    body = body ? JSON.parse(body) : null;
    requests.push({method:req.method,url:req.url,body});
    res.setHeader('Content-Type','application/json');
    if (req.url.endsWith('/engine')) {
      if (engineError && req.method === 'POST') {res.statusCode=503;res.end(JSON.stringify({message:engineError}));return;}
      res.end(JSON.stringify({ready:true,deviceId:'breadboard-device-001',status:'ready',error:null}));return;
    }
    if (req.method === 'POST') {
      if (body.action === 'pause') playing = false;
      if (body.action === 'resume' || body.action === 'play') playing = true;
      res.end('{"ok":true}');return;
    }
    res.end(JSON.stringify({connected:true,configured:true,status:'connected',
      intent:{target,revision:'intent-1',track,queueUris:[track.uri],requestedAt:'2026-09-06T08:04:00Z'},
      device:{name:target==='phone'?'My phone':'Breadboard',type:target==='phone'?'smartphone':'computer'},
      playback:{track,isPlaying:playing,positionMs:12000,shuffle:false,deviceId:'breadboard-device-001'},library:null,
    }));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
    const page = await browser.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const cover = Promise.withResolvers();
    await page.route("**/cover.jpg", async route => {
      await cover.promise;
      await route.abort();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "domcontentloaded" });
    try {
      await page.getByRole('region',{name:'Spotify player'}).waitFor({ timeout: 5_000 });
    } finally {
      cover.resolve();
    }
    await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
    assert.match(await page.locator('body').innerText(),/Shoot to Thrill/);
    assert.doesNotMatch(await page.locator('body').innerText(),/phone/);
    await page.getByRole('button',{name:'Pause',exact:true}).click();
    await page.getByRole('button',{name:'Play',exact:true}).waitFor();
    assert.equal(requests.filter(r=>r.body?.action==='pause').length,1);
    await page.getByRole('button',{name:'Play',exact:true}).click();
    await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
    assert.equal(requests.filter(r=>r.body?.action==='resume').length,1);
    assert.equal(requests.filter(r=>r.body?.action==='play').length,0,'mounting must not replay an already-started song');
    playing=false;
    await page.getByRole('button',{name:'Play',exact:true}).waitFor();
    playing=true;
    await page.reload();
    await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
    assert.equal(requests.filter(r=>r.body?.action==='play').length,0,'reload must not restart playback');
    await page.evaluate(()=>window.unmountPlayer());
    await page.waitForFunction(()=>document.querySelector('section')===null);
    // DELETE is keepalive and may finish just after React cleanup.
    const deadline=Date.now()+3000;
    while(!requests.some(r=>r.method==='DELETE') && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,20));
    const released=requests.filter(r=>r.method==='DELETE');
    assert.ok(released.length>0);
    assert.ok(released.every(r=>requests.some(start=>start.method==='POST' && start.body?.viewId===r.body.viewId)));

    engineError='Breadboard could not start protected audio.';
    await page.reload();
    await page.getByText(engineError,{exact:true}).waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(),/phone/);
    engineError=null;target='phone';
    const starts=requests.filter(r=>r.method==='POST' && r.url.endsWith('/engine')).length;
    await page.reload();
    await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
    assert.equal(requests.filter(r=>r.method==='POST' && r.url.endsWith('/engine')).length,starts,'explicit phone remotes must not launch local audio');
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
});

test("the dock migrates saved songs and replays all 20 after reload with browser storage disabled", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    stdin: {resolveDir:root,loader:"tsx",contents:`
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {BrowserSpotifyDock,useSpotifyDock} from './src/app/browser/browser-home-widgets';
      function App() {
        const [open,setOpen]=React.useState(true);
        const spotify=useSpotifyDock(true);
        return <BrowserSpotifyDock {...spotify} open={open} setOpen={setOpen}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    `}, bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",
    outfile:"spotify-dock-test.js",
    define:{"process.env.NODE_ENV":'"test"'},
    // Expose only the real Spotify component and hook to this isolated harness.
    plugins:[{name:'spotify-dock-exports',setup(builder){
      builder.onLoad({filter:/browser-home-widgets\.tsx$/},({path:filename})=>({
        loader:'tsx',contents:fs.readFileSync(filename,'utf8')
          .replace('function BrowserSpotifyDock(', 'export function BrowserSpotifyDock(')
          .replace('function useSpotifyDock(', 'export function useSpotifyDock('),
      }));
    }}],
  });
  const database = new Database(':memory:');
  database.exec('CREATE TABLE users (id INTEGER PRIMARY KEY); CREATE TABLE conversations (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (7);');
  ensureSpotifySchema(database);
  const history = createSpotifyHistoryStore(database);
  const tracks = Array.from({length: 20}, (_, index) => ({
    id:String(index).padStart(22,'0'),uri:`spotify:track:${String(index).padStart(22,'0')}`,
    name:`Song ${index}`,artist:'Artist',album:'Album',imageUrl:null,durationMs:180000,
  }));
  for (const track of tracks.slice(0, 8).toReversed()) history.record(7, track);
  const engine = {ready:true,deviceId:'breadboard',status:'ready',error:null};
  let playback = null;
  let imports = 0;
  let failImport = true;
  const played = [];
  const server = http.createServer(async (req,res) => {
    if (req.url === '/app.js') {res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
    if (!req.url.startsWith('/api/')) {res.setHeader('Content-Type','text/html');res.end('<html><head><style>svg{width:20px;height:20px}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');return;}
    let body = ''; for await (const chunk of req) body += chunk;
    body = body ? JSON.parse(body) : null;
    res.setHeader('Content-Type','application/json');
    if (req.url.endsWith('/engine')) {res.end(JSON.stringify(engine));return;}
    if (req.url !== '/api/browser/spotify') {res.end('{}');return;}
    if (body?.action === 'import-history') {
      imports++;
      if (failImport) {res.statusCode=503;res.end('{}');return;}
      res.end(JSON.stringify({history:history.importLegacy(7,body.tracks)}));return;
    }
    if (body?.action === 'play-track') {
      const track=tracks.find(track=>track.uri===body.trackUri);
      played.push(track.uri);
      history.record(7,track);
      playback={track,isPlaying:true,positionMs:0,deviceId:'breadboard',deviceName:'Breadboard'};
    }
    res.end(JSON.stringify({connected:true,status:'connected',engine,playback,savedTrack:false,history:history.read(7)}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const origin=`http://127.0.0.1:${server.address().port}`;
    await page.route('**/seed',route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));
    await page.goto(`${origin}/seed`);
    await page.evaluate(legacy=>localStorage.setItem('breadboard:spotify-listening-history:v1',JSON.stringify(legacy)),tracks.slice(8));
    await page.goto(origin);
    await page.waitForFunction(()=>document.querySelectorAll('.browser-spotify-result').length===8);
    assert.ok(await page.evaluate(()=>localStorage.getItem('breadboard:spotify-listening-history:v1')),'a failed migration preserves old songs');
    failImport=false;
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(()=>document.querySelectorAll('.browser-spotify-result').length===20);
    assert.equal(await page.evaluate(()=>localStorage.getItem('breadboard:spotify-listening-history:v1')),null);
    assert.deepEqual(await page.locator('.browser-spotify-result strong').allTextContents(),tracks.map(track=>track.name));
    const migrations=imports;
    await page.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Disabled','SecurityError');}}));
    await page.reload();
    await page.waitForFunction(()=>document.querySelectorAll('.browser-spotify-result').length===20);
    assert.equal(imports,migrations,'restoration does not depend on browser storage');
    await page.getByRole('button',{name:'Play Song 19 by Artist',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.browser-spotify-result strong')?.textContent==='Song 19');
    assert.deepEqual(played,[tracks[19].uri]);
    assert.equal(await page.locator('.browser-spotify-result').count(),20);
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('.browser-spotify-result strong')?.textContent==='Song 19');
    assert.equal(await page.locator('.browser-spotify-result').count(),20);
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    database.close();
  }
});
