import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("the dock seeks with pointer and keyboard and keeps time between provider samples", {timeout: 60_000}, async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    stdin: {resolveDir: root, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {BrowserSpotifyDock,useSpotifyDock} from './src/app/browser/browser-home-widgets';
      function App() {
        const [open,setOpen]=React.useState(true);
        return <BrowserSpotifyDock {...useSpotifyDock()} openConnections={()=>{}} open={open} setOpen={setOpen}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    `}, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    outfile: "spotify-dock.js", define: {"process.env.NODE_ENV": '"test"'},
    plugins: [{name: "dock-exports", setup(builder) {
      builder.onLoad({filter: /browser-home-widgets\.tsx$/}, ({path: filename}) => ({
        loader: "tsx", contents: fs.readFileSync(filename, "utf8")
          .replace("function BrowserSpotifyDock(", "export function BrowserSpotifyDock(")
          .replace("function useSpotifyDock(", "export function useSpotifyDock("),
      }));
    }}],
  });
  // Use the actual stylesheet for pointer hit testing and the rendered slider.
  const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8")
    .replace(/^@(?:import|source).*$/gm, "");
  const track = {id: "0123456789abcdefghijAB", uri: "spotify:track:0123456789abcdefghijAB", name: "Snap", artist: "manifest", album: "Snap", imageUrl: null, durationMs: 149000};
  const engine = {ready: true, deviceId: "breadboard", status: "ready", error: null};
  let playback = {track, isPlaying: true, positionMs: 55000, deviceId: "breadboard", deviceName: "Breadboard"};
  let playbackError;
  const state = () => ({connected: true, status: "connected", engine, playback, savedTrack: false, history: [track], playbackError});
  const requests = [];
  let holdStatus = false;
  let pendingStatus = null;
  let failSeek = false;
  let holdControl = false;
  let pendingControl = null;
  let failTransport = false;
  let localReplies = false;
  let acceptPlayOnly = false;
  let stalePlayback = null;
  const executablePath = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
  const browser = await chromium.launch({headless: true, ...(executablePath ? {executablePath} : {})});
  try {
    const page = await browser.newPage({viewport: {width: 900, height: 850}});
    await page.addInitScript(() => {
      window.EventSource = class {
        constructor(url) { window.spotifyEvents = this; window.spotifyEventUrl = url; }
        close() { window.spotifyEventsClosed = true; }
      };
    });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://spotify.test/**", async route => {
      const url = new URL(route.request().url());
      const body = route.request().postDataJSON();
      if (url.pathname === "/app.js") return route.fulfill({contentType: "text/javascript", body: bundle.outputFiles[0].text});
      if (url.pathname === "/style.css") return route.fulfill({contentType: "text/css", body: css});
      if (!url.pathname.startsWith("/api/")) return route.fulfill({contentType: "text/html", body: `<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body style="background:#e6efe7;font-family:Arial"><main id="root" style="position:fixed;right:100px;bottom:45px;width:430px;--browser-widget-font:Arial"></main><script src="/app.js"></script></body></html>`});
      requests.push({path: url.pathname, search: url.search, method: route.request().method(), body});
      if (url.pathname.endsWith("/engine")) return route.fulfill({json: engine});
      if (body && holdControl) {
        await new Promise(resolve => { pendingControl = resolve; });
        pendingControl = null;
      }
      if (body && failTransport) return route.fulfill({status:503,json:{message:"Spotify could not apply playback."}});
      if (body?.action === "seek") {
        if (failSeek) return route.fulfill({status: 503, json: {message: "Spotify could not seek."}});
        playback = {...playback, positionMs: body.positionMs};
      }
      if (body?.action === "pause") playback = {...playback, isPlaying: false};
      if (body?.action === "resume") playback = {...playback, isPlaying: true};
      if (body?.action === "play-track") playback = {track,isPlaying:true,positionMs:0,deviceId:engine.deviceId,deviceName:"Breadboard"};
      if (body?.action === "play-track" && acceptPlayOnly) return route.fulfill({json:{ok:true,engine,refreshPlayback:true}});
      if (body?.local && localReplies) return route.fulfill({json:{ok:true,localPlayback:{trackUri:playback.track.uri,isPlaying:playback.isPlaying,positionMs:playback.positionMs}}});
      const snapshot = JSON.stringify({...state(),...(!body && stalePlayback ? {playback:stalePlayback} : {})});
      if (!body && !url.search && holdStatus) {
        await new Promise(resolve => { pendingStatus = resolve; });
        pendingStatus = null;
      }
      await route.fulfill({contentType: "application/json", body: snapshot});
    });
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await page.goto("https://spotify.test");
    await page.clock.runFor(100);
    assert.deepEqual(errors, []);
    const slider = page.getByRole("slider", {name: "Seek playback"});
    const times = page.locator(".browser-spotify-times > span").first();
    const dialog = page.getByRole("dialog", {name: "Spotify player and library"});
    const seekRequests = () => requests.filter(request => request.body?.action === "seek");
    const refresh = async () => {
      await page.evaluate(() => window.dispatchEvent(new Event("breadboard:spotify-playback-changed")));
    };
    await expect(slider).toBeEnabled();
    await expect(times).toHaveText("0:55");
    const statusReads = requests.filter(request => request.method === "GET").length;
    await page.clock.runFor(3100);
    await expect(times).toHaveText("0:58");
    assert.equal(requests.filter(request => request.method === "GET").length, statusReads, "time advances without extra Spotify requests");

    await dialog.getByRole("button", {name: "Pause Spotify", exact: true}).click();
    await expect(dialog.getByRole("button", {name: "Play Spotify in Breadboard", exact: true})).toBeEnabled();
    const pausedValue = await slider.inputValue();
    await page.clock.runFor(2000);
    assert.equal(await slider.inputValue(), pausedValue, "paused playback must not tick");

    // The native range gets a real pointer click, well beyond the old position.
    const bounds = await slider.boundingBox();
    await slider.click({position: {x: bounds.width * 0.75, y: bounds.height / 2}});
    await expect(slider).toBeEnabled();
    assert.equal(seekRequests().length, 1);
    assert.ok(playback.positionMs > 105000 && playback.positionMs < 118000);
    assert.equal(playback.isPlaying, false, "seeking a paused song must stay paused");
    assert.equal(Number(await slider.inputValue()), playback.positionMs);

    await slider.press("ArrowRight");
    await expect(slider).toBeEnabled();
    assert.equal(seekRequests().length, 2);
    assert.equal(seekRequests()[1].body.positionMs - seekRequests()[0].body.positionMs, 5000);
    await slider.press("Home");
    await expect(slider).toBeEnabled();
    assert.equal(playback.positionMs, 0);

    // Dragging previews locally and submits only once on release, including
    // when an unrelated provider sample arrives during the gesture.
    const beforeDrag = seekRequests().length;
    await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height / 2, {steps: 8});
    const preview = await slider.inputValue();
    assert.equal(seekRequests().length, beforeDrag);
    playback = {...playback, positionMs: 10000};
    await refresh();
    await expect.poll(() => requests.filter(request => request.method === "GET").length).toBeGreaterThan(statusReads);
    assert.equal(await slider.inputValue(), preview);
    await page.mouse.up();
    await expect(slider).toBeEnabled();
    assert.equal(seekRequests().length, beforeDrag + 1);
    assert.equal(playback.positionMs, Number(preview));

    // A delayed GET taken before a seek cannot move the newly accepted seek back.
    holdStatus = true;
    await refresh();
    await expect.poll(() => pendingStatus !== null).toBe(true);
    await slider.press("ArrowRight");
    await expect(slider).toBeEnabled();
    const accepted = await slider.inputValue();
    holdStatus = false;
    const oldStatusResponse = page.waitForResponse(response => response.url().endsWith("/api/browser/spotify") && response.request().method() === "GET");
    pendingStatus();
    await oldStatusResponse;
    await page.clock.runFor(300);
    assert.equal(await slider.inputValue(), accepted);

    failSeek = true;
    await slider.press("ArrowLeft");
    await expect(dialog.getByRole("alert")).toContainText("Spotify could not seek.");
    await expect(slider).toBeEnabled();
    assert.equal(await slider.inputValue(), accepted, "a rejected seek returns to confirmed playback");
    failSeek = false;

    // Fresh external state, track changes and an empty player replace the anchor.
    playback = {...playback, positionMs: 20000, isPlaying: true};
    await refresh();
    await expect(times).toHaveText("0:20");
    await page.clock.runFor(2100);
    await expect(times).toHaveText("0:22");
    holdStatus = true;
    await page.getByRole("button", {name: "Close Spotify", exact: true}).click();
    await page.clock.fastForward(2000);
    await page.getByRole("button", {name: "Open Spotify player", exact: true}).click();
    await page.clock.runFor(300);
    await expect(times).toHaveText("0:24");
    // Let the intentionally static provider sample finish before the next case.
    holdStatus = false;
    if (pendingStatus) {
      pendingStatus();
      await expect(times).toHaveText("0:20");
    }
    playback = {...playback, track: {...track, uri: "spotify:track:another0123456789AB", name: "Next song", durationMs: 24000}, positionMs: 23000};
    await refresh();
    await expect(dialog.getByText("Next song", {exact: true})).toBeVisible();
    await page.clock.runFor(2100);
    await expect(times).toHaveText("0:24");
    assert.equal(Number(await slider.inputValue()), 24000, "the clock is bounded by the song duration");

    const artifacts = path.join(root, ".tmp-spotify-seek-qa");
    fs.mkdirSync(artifacts, {recursive: true});
    await page.screenshot({path: path.join(artifacts, "dock-seek.png")});

    // The UI responds before a delayed SDK acknowledgement, then rolls back
    // failures; a successful SDK response requires no cloud status read.
    holdControl = true;
    localReplies = true;
    const beforeLocal = requests.filter(request => request.method === "GET").length;
    await dialog.getByRole("button", {name:"Pause Spotify",exact:true}).click();
    await expect(dialog.getByRole("button", {name:"Play Spotify in Breadboard",exact:true})).toBeDisabled();
    await expect.poll(() => pendingControl !== null).toBe(true);
    pendingControl();
    await expect(dialog.getByRole("button", {name:"Play Spotify in Breadboard",exact:true})).toBeEnabled();
    assert.equal(requests.filter(request => request.method === "GET").length,beforeLocal);
    assert.equal(requests.filter(request => request.body?.action === "pause").at(-1).body.local,true);
    failTransport = true;
    await dialog.getByRole("button", {name:"Play Spotify in Breadboard",exact:true}).click();
    await expect(dialog.getByRole("button", {name:"Pause Spotify",exact:true})).toBeDisabled();
    await expect.poll(() => pendingControl !== null).toBe(true);
    pendingControl();
    await expect(dialog.getByRole("button", {name:"Play Spotify in Breadboard",exact:true})).toBeEnabled();
    await expect(dialog.getByRole("alert")).toContainText("Spotify could not apply playback.");
    holdControl = false;
    failTransport = false;

    // A new song updates immediately and unlocks controls after acceptance,
    // while a delayed/stale provider read reconciles separately.
    stalePlayback = playback;
    acceptPlayOnly = true;
    holdStatus = true;
    await dialog.getByRole("button", {name:"Play Snap by manifest",exact:true}).click();
    await expect(dialog.locator(".browser-spotify-now-copy > strong")).toHaveText("Snap");
    await expect(dialog.getByRole("button", {name:"Pause Spotify",exact:true})).toBeEnabled();
    await expect.poll(() => pendingStatus !== null).toBe(true);
    assert.equal(requests.filter(request => request.body?.action === "play-track").at(-1).body.previewTrack,undefined,"UI preview metadata is never submitted to Spotify");
    holdStatus = false;
    pendingStatus();
    await page.clock.runFor(100);
    await expect(dialog.locator(".browser-spotify-now-copy > strong")).toHaveText("Snap");
    stalePlayback = null;
    await page.clock.runFor(400);
    await expect.poll(() => pendingStatus === null).toBe(true);
    await page.clock.runFor(300);
    playback = null;
    await refresh();
    await expect(slider).toBeDisabled();
    await expect(times).toHaveText("0:00");

    // Actual dock subscription: an SDK event renders without waiting for a
    // cloud poll, even if a request for the previous track is already in flight.
    assert.equal(await page.evaluate(() => window.spotifyEventUrl), '/api/browser/spotify/events');
    playback = {track,isPlaying:true,positionMs:1000,deviceId:engine.deviceId,deviceName:'Breadboard'};
    await refresh();
    await expect(slider).toBeEnabled();
    holdStatus = true;
    await refresh();
    await expect.poll(() => pendingStatus !== null).toBe(true);
    const liveTrack = {...track,id:'live0123456789abcdefgh',uri:'spotify:track:live0123456789abcdefgh',name:'Live song',artist:'New artist'};
    const livePlayback = {track:liveTrack,isPlaying:true,positionMs:0,deviceId:engine.deviceId,deviceName:'Breadboard'};
    const readsBeforeEvent = requests.filter(request => request.method === 'GET' && !request.search).length;
    await page.evaluate(playback => window.spotifyEvents.onmessage({data:JSON.stringify({playback})}), livePlayback);
    await expect(dialog.locator('.browser-spotify-now-copy > strong')).toHaveText('Live song', {timeout:500});
    assert.equal(requests.filter(request => request.method === 'GET' && !request.search).length, readsBeforeEvent);
    holdStatus = false;
    pendingStatus();
    await page.clock.runFor(200);
    await expect(dialog.locator('.browser-spotify-now-copy > strong')).toHaveText('Live song');
    await refresh();
    await page.clock.runFor(200);
    await expect(dialog.locator('.browser-spotify-now-copy > strong')).toHaveText('Live song');
    holdControl = true;
    localReplies = false;
    await dialog.getByRole('button', {name:'Next track',exact:true}).click();
    await expect.poll(() => pendingControl !== null).toBe(true);
    const newestPlayback = {...livePlayback,track:{...liveTrack,name:'Newest song'}};
    await page.evaluate(playback => window.spotifyEvents.onmessage({data:JSON.stringify({playback})}), newestPlayback);
    await expect(dialog.locator('.browser-spotify-now-copy > strong')).toHaveText('Newest song', {timeout:500});
    holdControl = false;
    pendingControl();
    await expect(dialog.getByRole('button', {name:'Next track',exact:true})).toBeEnabled();
    await expect(dialog.locator('.browser-spotify-now-copy > strong')).toHaveText('Newest song');
    const readsBeforeEmptySamples = requests.filter(request => request.method === 'GET' && !request.search).length;
    await page.evaluate(() => {
      for (let index = 0; index < 5; index++) window.spotifyEvents.onmessage({data:JSON.stringify({playback:null})});
    });
    await page.clock.runFor(100);
    assert.equal(requests.filter(request => request.method === 'GET' && !request.search).length, readsBeforeEmptySamples, 'empty SDK heartbeats must not flood the Spotify API');
    await refresh();
    await expect(dialog.locator('.browser-spotify-now-copy > strong')).toHaveText('Snap');
    playbackError = 'Spotify is receiving too many requests. Try again in 2 minutes.';
    await refresh();
    await expect(dialog.getByRole('alert')).toContainText(playbackError);
    assert.deepEqual(errors, []);
  } finally {
    pendingStatus?.();
    pendingControl?.();
    await browser.close();
  }
});
