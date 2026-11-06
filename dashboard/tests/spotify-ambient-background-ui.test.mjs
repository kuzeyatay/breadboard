import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("Spotify lighting keeps paused album colors and returns to the default background with no track", { timeout: 60_000 }, async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {BrowserDock} from './src/app/browser/browser-home-widgets';
      import {SpotifyAmbientProvider} from './src/app/components/spotify-ambient-context';
      import Background from './src/app/components/spotify-ambient-background';
      import PageAppearance from './src/app/components/page-appearance';
      import {usePageAppearance} from './src/app/components/use-page-appearance';
      import {paletteFromCover} from './src/lib/spotify/player-palette';
      import home from './src/app/new-tab/combined-home.module.css';
      window.readPalette = paletteFromCover;
      function App() {
        const appearance = usePageAppearance('ambient-test', 'new-tab');
        const [active,setActive] = React.useState(true);
        window.setActive = setActive;
        return <SpotifyAmbientProvider><div className={home.surface + ' browser-home-widget-surface'} data-wallpaper-ready="true" data-wallpaper-tone={appearance.theme}>
          <div id="backdrop" className={'browser-start-page ' + home.backdrop} data-spotify-ambient={appearance.ambientBackground || undefined}>
            {appearance.ambientBackground && <Background theme={appearance.theme} spotifyColors={appearance.spotifyBackground} randomColors={appearance.randomColorsBackground}/>}
          </div>
          <div id="rings" aria-hidden="true" className={'browser-start-page ' + home.rings}/>
          <div style={{position:'relative',zIndex:2,padding:24}}><BrowserDock active={active} openPanel={null} setPanelOpen={()=>{}} openConnections={()=>{}}/></div>
          <h1 style={{position:'relative',textAlign:'center',fontSize:52,marginTop:100,color:'var(--browser-wallpaper-foreground)'}}>Terminal</h1>
          <PageAppearance page="new-tab" ownerKey="ambient-test" initialOpen/>
        </div></SpotifyAmbientProvider>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", outfile: "ambient.js",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8").replace(/^@(?:import|source).*$/gm, "")
    + "\n" + bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  let heldCover;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(() => {
      localStorage.setItem("breadboard:theme", "dark");
      localStorage.setItem("breadboard:theme-mode", "manual");
      window.EventSource = class { constructor() { window.spotifyEvents = this; } close() {} };
    });
    const engine = { ready: true, deviceId: "breadboard", status: "ready", error: null };
    const track = { id: "0123456789abcdefghijAB", uri: "spotify:track:0123456789abcdefghijAB", name: "Color Study", artist: "Test Artist", album: "Palette", durationMs: 240000, imageUrl: "https://covers.test/first" };
    let playback = { track, isPlaying: true, positionMs: 5000, deviceId: "breadboard", deviceName: "Breadboard" };
    let connected = true;
    const preferences = {};
    const writes = [];
    let statusRequests = 0;
    let coverRequests = 0;
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://covers.test/**", async route => {
      coverRequests++;
      const name = new URL(route.request().url()).pathname;
      if (name === "/slow") await new Promise(resolve => { heldCover = resolve; });
      if (name === "/broken") return route.fulfill({ status: 404 });
      const colors = name === "/first" ? ["#e53e4e", "#17b6cf", "#7850d4"] : name === "/white" ? ["#ffffff", "#ffffff", "#ffffff"] : ["#eab42a", "#2fbd73", "#ce793a"];
      return route.fulfill({ contentType: "image/svg+xml", headers: { "Access-Control-Allow-Origin": "*" }, body: `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="32">${colors.map((color, index) => `<rect x="${index * 32}" width="32" height="32" fill="${color}"/>`).join("")}</svg>` });
    });
    await page.route("https://ambient.test/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/app.js") return route.fulfill({ contentType: "text/javascript", body: script });
      if (url.pathname === "/style.css") return route.fulfill({ contentType: "text/css", body: css });
      if (url.pathname === "/api/profile/page-appearance") {
        if (route.request().method() === "PATCH") {
          const body = route.request().postDataJSON(); preferences[body.theme] = body.value; writes.push(body);
          return route.fulfill({ json: { value: body.value } });
        }
        return route.fulfill({ json: { preferences } });
      }
      if (url.pathname.endsWith("/engine")) return route.fulfill({ json: engine });
      if (url.pathname === "/api/browser/spotify") {
        statusRequests++;
        return route.fulfill({ json: { connected, status: connected ? "connected" : "not_connected", history: [], playback, engine, savedTrack: false } });
      }
      if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html data-theme="dark"><head><link rel="stylesheet" href="/style.css"></head><body style="margin:0;font-family:Arial"><div id="root"></div><script src="/app.js"></script></body></html>' });
    });
    const lights = () => page.locator('#backdrop [data-ambient-layer="spotify"] > span');
    const background = () => page.locator("#backdrop [data-spotify-background]");
    const expectDefaultBackground = async () => {
      await expect(background()).toHaveAttribute("data-active", "false");
      await expect.poll(() => background().evaluate(node => getComputedStyle(node).opacity)).toBe("0");
      assert.match(await page.locator('#backdrop').evaluate(node => getComputedStyle(node).backgroundImage), /radial-gradient/, 'the normal theme background is still underneath the transparent lighting');
    };
    const colors = () => lights().evaluateAll(nodes => nodes.map(node => node.style.backgroundColor));
    const emit = async (patch) => {
      playback = patch === null ? null : { ...playback, ...patch };
      await page.evaluate(sample => window.spotifyEvents.onmessage({ data: JSON.stringify({ playback: sample }) }), playback);
      // An empty SDK event is a heartbeat; the cloud confirms stopped playback.
      if (patch === null) await page.evaluate(() => window.dispatchEvent(new Event('breadboard:spotify-playback-changed')));
    };
    await page.goto("https://ambient.test");
    await expect(page.getByText("Color Study", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: /^Spotify colors/ }).click();
    await expect(page.locator("#backdrop [data-spotify-background]")).toHaveAttribute("data-playing", "true");
    await expect.poll(() => writes.length).toBe(1);
    assert.equal(writes[0].value.background, "spotify-colors");
    assert.equal(writes[0].theme, "dark");
    if (process.env.BREADBOARD_AMBIENT_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.BREADBOARD_AMBIENT_SCREENSHOT_DIR, { recursive: true });
      await expect.poll(() => lights().first().evaluate(node => getComputedStyle(node, '::after').opacity === '1')).toBe(true);
      await page.screenshot({ path: path.join(process.env.BREADBOARD_AMBIENT_SCREENSHOT_DIR, "spotify-styler.png") });
    }
    await page.getByRole("button", { name: "Close appearance" }).click();
    if (process.env.BREADBOARD_AMBIENT_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.BREADBOARD_AMBIENT_SCREENSHOT_DIR, "spotify-background.png") });
    const firstColors = await colors();
    assert.deepEqual(new Set(firstColors), new Set(["rgb(229, 62, 78)", "rgb(23, 182, 207)", "rgb(120, 80, 212)"]));
    await expect.poll(() => lights().first().evaluate(node => getComputedStyle(node).animationPlayState.split(', ').every(state => state === 'running'))).toBe(true);
    assert.equal(await lights().first().evaluate(node => node.getAnimations({subtree: true}).length), 3, 'light drifts, breathes, and blends on shared timelines');
    const initialBackground = await page.locator('#backdrop').evaluate(node => getComputedStyle(node).backgroundImage);
    const coversBeforePause = coverRequests;
    await emit({ isPlaying: false });
    await expect(background()).toHaveAttribute("data-active", "true");
    await expect(background()).toHaveAttribute("data-color-source", "spotify");
    await expect(background()).toHaveCSS("opacity", "1");
    await expect.poll(() => lights().first().evaluate(node => getComputedStyle(node).animationPlayState.split(', ').every(state => state === 'running'))).toBe(true);
    assert.equal(await page.locator('#backdrop').evaluate(node => getComputedStyle(node).backgroundImage), initialBackground);
    assert.deepEqual(await colors(), firstColors);
    assert.equal(coverRequests, coversBeforePause, "pausing reuses the album palette");
    await page.getByRole('button', {name: 'Customize appearance'}).click();
    await expect(page.getByText('Following Color Study · Test Artist · Paused')).toBeVisible();
    await page.getByRole('button', {name: 'Close appearance'}).click();
    if (process.env.BREADBOARD_AMBIENT_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.BREADBOARD_AMBIENT_SCREENSHOT_DIR, "spotify-paused.png") });
    await emit({ isPlaying: true, track: { ...track, imageUrl: "https://covers.test/slow" } });
    await expect.poll(() => Boolean(heldCover)).toBe(true);
    assert.deepEqual(await colors(), firstColors, "slow covers cannot flash a default palette");
    await emit({ track: { ...track, imageUrl: "https://covers.test/second" } });
    await expect.poll(async () => (await colors()).includes("rgb(234, 180, 42)")).toBe(true);
    heldCover(); heldCover = null;
    await expect(page.locator("#backdrop [data-spotify-background]")).toHaveAttribute("data-playing", "true");
    await page.evaluate(() => window.setActive(false));
    await expect(page.locator("#backdrop [data-spotify-background]")).toHaveAttribute("data-playing", "true");
    await page.evaluate(() => window.setActive(true));
    await expect(page.locator("#backdrop [data-spotify-background]")).toHaveAttribute("data-playing", "true");
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await lights().first().evaluate(node => getComputedStyle(node).animationName), "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const before = await page.locator("#backdrop").boundingBox();
    const ringsBefore = await page.locator("#rings").boundingBox();
    for (const pseudo of ['::before', '::after']) {
      const ringStyle = await page.locator('#rings').evaluate((node, pseudo) => {
        const style = getComputedStyle(node, pseudo);
        return {top: style.top, animation: style.animationName, playState: style.animationPlayState};
      }, pseudo);
      assert.equal(ringStyle.top, '260px', 'rings keep their original anchor near the search area');
      assert.match(ringStyle.animation, /browser-orbit-.*clockwise/, 'rings continue rotating');
      assert(ringStyle.playState.split(', ').every(state => state === 'running'));
      assert.equal(await page.locator('#backdrop').evaluate((node, pseudo) => getComputedStyle(node, pseudo).content, pseudo), 'none', 'fixed wallpaper cannot draw another set of rings');
    }
    await page.evaluate(() => { document.querySelector('#root').style.minHeight = '2500px'; window.scrollTo(0, 400); });
    assert.deepEqual(await page.locator("#backdrop").boundingBox(), before, "scrolling or expanding terminal space cannot resize the backdrop");
    const ringsAfter = await page.locator('#rings').boundingBox();
    assert.equal(ringsAfter.y, ringsBefore.y - 400, 'rings scroll with the opening section instead of following the viewport');
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await page.evaluate(async () => (await window.readPalette('https://covers.test/white')).ambientColors[0]), 'rgb(255 255 255)');
    await emit({ track: { ...track, imageUrl: "https://covers.test/broken" } });
    await expectDefaultBackground();
    await emit({ track: { ...track, imageUrl: null } });
    await expect(page.locator("#backdrop [data-spotify-background]")).toHaveAttribute("data-playing", "false");
    await expectDefaultBackground();
    await emit(null);
    await expectDefaultBackground();
    assert(coverRequests < 12, "dock and wallpaper share cover samples");
    assert(statusRequests < 6, "ambient colors do not add another status poller");
    await page.reload();
    await expect(page.locator("#backdrop [data-spotify-background]")).toBeAttached();
    await expectDefaultBackground();
    await expect(page.getByText('Using your default background. Play a track with album artwork to start the lights.')).toBeVisible();
    await expect(page.getByRole("button", { name: /^Spotify colors/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("group", { name: "App theme", exact: true }).getByRole("button", { name: "Light", exact: true }).click();
    await expect(page.locator("#backdrop [data-spotify-background]")).toHaveCount(0);
    await page.getByRole("button", { name: /^Spotify colors/ }).click();
    await expect(page.locator("#backdrop [data-spotify-background]")).toHaveAttribute("data-theme", "light");
    await expectDefaultBackground();
    await emit({ track, isPlaying: true, positionMs: 12000, deviceId: 'breadboard', deviceName: 'Breadboard' });
    await expect(background()).toHaveAttribute('data-active', 'true');
    await expect.poll(() => background().evaluate(node => getComputedStyle(node).opacity)).toBe('1');
    assert.match(await background().locator(':scope > div:not([data-ambient-layer])').evaluate(node => getComputedStyle(node).backgroundImage), /radial-gradient/, 'light theme keeps a soft readable center instead of flattening every color with a white wash');
    if (process.env.BREADBOARD_AMBIENT_SCREENSHOT_DIR) {
      await page.getByRole('button', { name: 'Close appearance' }).click();
      await page.screenshot({ path: path.join(process.env.BREADBOARD_AMBIENT_SCREENSHOT_DIR, 'spotify-light.png') });
      await page.getByRole('button', { name: /appearance/i }).click();
    }
    connected = false;
    await page.evaluate(() => window.dispatchEvent(new Event('breadboard:spotify-playback-changed')));
    await expectDefaultBackground();
    await page.getByRole("button", { name: /^No image/ }).click();
    await expect(page.locator("#backdrop [data-spotify-background]")).toHaveCount(0);
    assert.deepEqual(errors, []);
  } finally {
    heldCover?.();
    await browser.close();
  }
});

test("random lighting combines with Spotify, restores settings, and pauses work when hidden or motion is reduced", { timeout: 60_000 }, async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {SpotifyAmbientProvider, usePublishSpotifyAmbient} from './src/app/components/spotify-ambient-context';
      import Background from './src/app/components/spotify-ambient-background';
      import PageAppearance from './src/app/components/page-appearance';
      import {usePageAppearance} from './src/app/components/use-page-appearance';
      import home from './src/app/new-tab/combined-home.module.css';
      function App() {
        const appearance = usePageAppearance('random-test', 'new-tab');
        const [source, setSource] = React.useState(null);
        window.setSource = setSource;
        usePublishSpotifyAmbient(source);
        return <div className={home.surface} data-wallpaper-tone={appearance.theme}>
          <div id="backdrop" className={'browser-start-page ' + home.backdrop} data-spotify-ambient={appearance.ambientBackground || undefined}>
            {appearance.ambientBackground && <Background theme={appearance.theme} spotifyColors={appearance.spotifyBackground} randomColors={appearance.randomColorsBackground}/>}
          </div>
          <div className={'browser-start-page ' + home.rings}/>
          <h1 style={{position:'relative',textAlign:'center',paddingTop:180,color:'var(--browser-wallpaper-foreground)'}}>Where to, daydreamer?</h1>
          <PageAppearance page="new-tab" ownerKey="random-test" initialOpen/>
        </div>;
      }
      createRoot(document.getElementById('root')).render(<SpotifyAmbientProvider><App/></SpotifyAmbientProvider>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", outfile: "random.js",
  });
  const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8").replace(/^@(?:import|source).*$/gm, "")
    + "\n" + bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const requests = [];
    const preferences = {};
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://random-ambient.test/**', route => {
      const url = new URL(route.request().url());
      requests.push(url.pathname);
      if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: script });
      if (url.pathname === '/style.css') return route.fulfill({ contentType: 'text/css', body: css });
      if (url.pathname === '/cover') return route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="32"><rect width="32" height="32" fill="#e53e4e"/><rect x="32" width="32" height="32" fill="#17b6cf"/><rect x="64" width="32" height="32" fill="#7850d4"/></svg>'});
      if (url.pathname === '/api/profile/page-appearance') {
        if (route.request().method() === 'PATCH') {
          const body = route.request().postDataJSON(); preferences[body.theme] = body.value;
          return route.fulfill({ json: {value: body.value} });
        }
        return route.fulfill({json: {preferences}});
      }
      return route.fulfill({contentType: 'text/html', body: '<!doctype html><html data-theme="light"><head><link rel="stylesheet" href="/style.css"/></head><body style="margin:0;font-family:Arial"><div id="root"></div><script src="/app.js"></script></body></html>'});
    });
    const background = () => page.locator('#backdrop [data-spotify-background]');
    const lights = () => background().locator('[data-ambient-layer][data-active="true"] > span');
    const colors = () => lights().evaluateAll(nodes => nodes.map(node => node.style.backgroundColor));
    const random = () => page.getByRole('button', {name: /^Random colors/});
    const spotify = () => page.getByRole('button', {name: /^Spotify colors/});
    await page.clock.install();
    await page.goto('https://random-ambient.test');
    await random().click();
    await expect(random()).toHaveAttribute('aria-pressed', 'true');
    await expect(spotify()).toHaveAttribute('aria-pressed', 'false');
    await expect(background()).toHaveAttribute('data-active', 'true');
    await expect(background()).toHaveAttribute('data-color-source', 'random');
    await expect(lights()).toHaveCount(3);
    await expect.poll(() => preferences.light?.background).toBe('random-colors');
    const first = await colors();
    await page.clock.runFor(20_100);
    assert.notDeepEqual(await colors(), first, 'random mode changes its palette without playback');
    assert.equal(await lights().first().evaluate(node => getComputedStyle(node, '::after').animationDuration), '20s');
    assert.equal(requests.filter(url => url === '/cover').length, 0, 'random colors need no artwork');

    await spotify().click();
    await expect(random()).toHaveAttribute('aria-pressed', 'true');
    await expect(spotify()).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => preferences.light?.background).toBe('spotify-random-colors');
    const track = {name: 'Color Study', artist: 'Test Artist', imageUrl: 'https://random-ambient.test/cover', playing: true};
    await page.evaluate(track => window.setSource(track), track);
    await expect(background()).toHaveAttribute('data-color-source', 'spotify');
    const albumColors = await colors();
    assert.deepEqual(new Set(albumColors), new Set(['rgb(229, 62, 78)', 'rgb(23, 182, 207)', 'rgb(120, 80, 212)']));
    await page.clock.runFor(40_100);
    assert.deepEqual(await colors(), albumColors, 'random timer cannot overwrite active album colors');
    await random().click();
    await expect(random()).toHaveAttribute('aria-pressed', 'false');
    await expect(spotify()).toHaveAttribute('aria-pressed', 'true');
    await expect(background()).toHaveAttribute('data-color-source', 'spotify');
    await random().click();
    await page.evaluate(track => window.setSource({...track, playing: false}), track);
    await expect(background()).toHaveAttribute('data-color-source', 'spotify');
    await page.clock.runFor(40_100);
    assert.deepEqual(await colors(), albumColors, 'random colors cannot replace a paused track');
    await page.evaluate(() => window.setSource(null));
    await expect(background()).toHaveAttribute('data-color-source', 'random');
    await expect(background()).toHaveAttribute('data-active', 'true');
    assert.notDeepEqual(await colors(), albumColors);
    await spotify().click();
    await expect(random()).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(track => window.setSource(track), track);
    await expect(background()).toHaveAttribute('data-color-source', 'random');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(background()).toHaveAttribute('data-random-cycle', '0');
    const still = await colors();
    await page.clock.runFor(40_100);
    assert.deepEqual(await colors(), still, 'reduced motion stops palette cycling');
    assert.equal(await lights().first().evaluate(node => getComputedStyle(node).animationName), 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // Visible lighting keeps moving even when there has been no input.
    await page.mouse.move(5, 5);
    await expect(background()).toHaveAttribute('data-playing', 'true');
    const idleStartColors = await colors();
    await page.clock.runFor(61_000);
    await expect(background()).toHaveAttribute('data-playing', 'true');
    assert.notDeepEqual(await colors(), idleStartColors, 'visible idle pages keep cycling colors');
    await page.mouse.move(9, 9);
    await expect(background()).toHaveAttribute('data-playing', 'true');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'hidden'});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(background()).toHaveAttribute('data-playing', 'false');
    const hiddenColors = await colors();
    await page.clock.runFor(40_100);
    assert.deepEqual(await colors(), hiddenColors, 'hidden tabs stop palette cycling');
    await page.evaluate(() => {
      delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(background()).toHaveAttribute('data-playing', 'true');
    await page.clock.runFor(20_100);
    assert.notDeepEqual(await colors(), hiddenColors);

    await spotify().click();
    await expect.poll(() => preferences.light?.background).toBe('spotify-random-colors');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(random()).toHaveAttribute('aria-pressed', 'true');
    await expect(spotify()).toHaveAttribute('aria-pressed', 'true');
    await expect(background()).toHaveAttribute('data-color-source', 'random');
    await expect(background()).toHaveAttribute('data-active', 'true');
    if (process.env.BREADBOARD_AMBIENT_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.BREADBOARD_AMBIENT_SCREENSHOT_DIR, {recursive: true});
      await page.clock.runFor(13_000);
      await expect.poll(() => background().evaluate(node => getComputedStyle(node).opacity)).toBe('1');
      await page.screenshot({path: path.join(process.env.BREADBOARD_AMBIENT_SCREENSHOT_DIR, 'random-colors-light.png')});
      await page.getByRole('button', {name: 'Close appearance'}).click();
      await page.screenshot({path: path.join(process.env.BREADBOARD_AMBIENT_SCREENSHOT_DIR, 'random-background-light.png')});
      await page.getByRole('button', {name: /appearance/i}).click();
    }
    await page.getByRole('group', {name: 'App theme', exact: true}).getByRole('button', {name: 'Dark', exact: true}).click();
    await expect(background()).toHaveCount(0);
    await random().click();
    await expect(background()).toHaveAttribute('data-theme', 'dark');
    await expect(background()).toHaveAttribute('data-active', 'true');
    if (process.env.BREADBOARD_AMBIENT_SCREENSHOT_DIR) {
      await page.clock.runFor(13_000);
      await expect.poll(() => background().evaluate(node => getComputedStyle(node).opacity)).toBe('1');
      await page.screenshot({path: path.join(process.env.BREADBOARD_AMBIENT_SCREENSHOT_DIR, 'random-colors-dark.png')});
      await page.getByRole('button', {name: 'Close appearance'}).click();
      await page.screenshot({path: path.join(process.env.BREADBOARD_AMBIENT_SCREENSHOT_DIR, 'random-background-dark.png')});
      await page.getByRole('button', {name: /appearance/i}).click();
    }
    await random().click();
    await expect(background()).toHaveCount(0);
    await page.clock.runFor(40_100);
    assert(!requests.some(url => url.includes('spotify')), 'lighting does not add Spotify requests');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
