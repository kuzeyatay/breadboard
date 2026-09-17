import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("startup restores dark mode before account hydration can publish a default theme", { timeout: 30_000 }, async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import {StrictMode} from 'react'; import {createRoot} from 'react-dom/client';
      import Gate from './src/app/components/interaction-hydration-gate';
      import Theme from './src/app/components/app-theme-runtime';
      createRoot(document.getElementById('root')).render(<StrictMode><Gate><Theme /></Gate></StrictMode>);
    ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  });
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      window.process = { env: {} };
      window.themeWrites = [];
      const restored = new Promise(resolve => { window.restoreTheme = resolve; });
      window.breadboardDesktop = {
        getThemeState: () => restored,
        setTheme: async (theme, schedule) => { window.themeWrites.push({ theme, schedule }); return true; },
      };
      localStorage.setItem('breadboard:theme', 'light');
    });
    await page.route("https://theme-startup.test/**", route => {
      if (route.request().url().includes('/api/')) return route.fulfill({ json: { switches: { sunTheme: true } } });
      return route.fulfill({ contentType: "text/html", body: '<html data-breadboard-startup="loading"><div id="root"></div></html>' });
    });
    await page.goto("https://theme-startup.test");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForTimeout(300);
    await expect(page.locator('html')).toHaveAttribute('data-breadboard-startup', 'loading');
    assert.deepEqual(await page.evaluate(() => window.themeWrites), []);
    const until = Date.now() + 3_600_000;
    await page.evaluate(overrideUntil => window.restoreTheme({ theme: 'dark', schedule: { mode: 'sun', sunriseMinutes: 420, sunsetMinutes: 1200, overrideUntil } }), until);
    await expect(page.locator('html')).toHaveAttribute('data-breadboard-startup', 'ready');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const writes = await page.evaluate(() => window.themeWrites);
    assert.ok(writes.length > 0);
    assert.ok(writes.every(write => write.theme === 'dark' && write.schedule.overrideUntil === until));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("startup waits for hidden calendar, weather, Spotify engine, to-dos, and provider reads", { timeout: 60_000 }, async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import {StrictMode} from 'react'; import {createRoot} from 'react-dom/client';
      import Gate from './src/app/components/interaction-hydration-gate';
      import Calendar from './src/app/browser/browser-home-calendar';
      import {useDockWeather, useSpotifyDock} from './src/app/browser/browser-home-widgets';
      import {useNotepadTasks} from './src/app/new-tab/use-notepad-tasks';
      import {useProviderUsage} from './src/app/new-tab/use-provider-usage';
      function Widgets() {
        const weather = useDockWeather(); const spotify = useSpotifyDock();
        const tasks = useNotepadTasks('startup-test'); const usage = useProviderUsage();
        return <><span id="weather">{weather.status}</span><span id="spotify">{String(spotify.initializing)}</span>
          <span id="tasks">{String(tasks.loading)}</span><span id="usage">{String(usage.catalogReady)}</span>
          <Calendar open={false} onOpenChange={()=>{}} /></>;
      }
      const root = createRoot(document.getElementById('root'));
      window.unmountWidgets = () => root.unmount();
      root.render(<StrictMode><Gate><Widgets /></Gate></StrictMode>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", outfile: "startup.js",
    plugins: [{ name: "widget-hooks", setup(builder) {
      builder.onLoad({ filter: /browser-home-widgets\.tsx$/ }, ({ path: filename }) => ({
        loader: "tsx", contents: fs.readFileSync(filename, "utf8")
          .replace("function useDockWeather(", "export function useDockWeather(")
          .replace("function useSpotifyDock(", "export function useSpotifyDock("),
      }));
    } }],
  });
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const held = new Map();
  const released = new Set();
  const errors = [];
  const engine = { ready: true, status: "ready", deviceId: "test", error: null };
  let engineReady = false;
  try {
    const page = await browser.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      window.process = { env: {} };
      Object.defineProperty(document, "hidden", { get: () => true });
      Object.defineProperty(document, "visibilityState", { get: () => "hidden" });
      window.EventSource = class { close() {} };
      localStorage.setItem("breadboard:current-location", JSON.stringify({ useForAnswers: true, snapshot: {
        latitude: 52, longitude: 5, capturedAt: new Date().toISOString(), accuracyMeters: 100, timeZone: "Europe/Amsterdam",
      } }));
    });
    await page.route("https://startup.test/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/startup.js") return route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles.find(file => file.path.endsWith(".js")).text });
      if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<!doctype html><html data-breadboard-startup="loading"><body><div id="root"></div><script src="/startup.js"></script></body></html>' });
      if (!released.has(url.pathname)) await new Promise(resolve => {
        held.set(url.pathname, [...(held.get(url.pathname) ?? []), resolve]);
      });
      const payloads = {
        "/api/calendar/calendars": { calendars: [{ id: 1, visible: true }] },
        "/api/calendar/events": { occurrences: [] },
        "/api/browser/weather": { temperatureC: 20, code: 0, isDay: true },
        "/api/browser/spotify": { connected: true, status: "connected", history: [], playback: null, engine },
        "/api/hermes/connections/spotify/engine": engineReady ? engine : { ...engine, ready: false, status: "starting" },
        "/api/plan/projects": { projects: [] },
        "/api/models": { data: [{ id: "gpt-test" }] },
        "/api/cliproxy/status": { models: [] },
        "/api/usage-limits": { available: false, error: "Provider unavailable" },
      };
      // A failed provider settles startup with the widget's own error state.
      await route.fulfill({ status: url.pathname === "/api/usage-limits" ? 503 : 200, json: payloads[url.pathname] ?? {} });
    });
    await page.goto("https://startup.test");
    const marker = page.locator("html");
    const release = async pathname => {
      await expect.poll(() => held.has(pathname), { message: `${pathname} must start; errors: ${errors.join('; ')}; requests: ${[...held.keys()].join(', ')}` }).toBe(true);
      released.add(pathname);
      for (const resolve of held.get(pathname)) resolve();
    };
    await expect(marker).toHaveAttribute("data-breadboard-startup", "loading");
    for (const pathname of ["/api/calendar/calendars", "/api/models", "/api/cliproxy/status", "/api/plan/projects", "/api/browser/spotify"]) {
      await release(pathname);
    }
    await expect(page.locator("#spotify")).toHaveText("false");
    for (const pathname of ["/api/calendar/events", "/api/browser/weather", "/api/usage-limits"]) {
      await release(pathname);
      await expect(marker).toHaveAttribute("data-breadboard-startup", "loading");
    }
    await release("/api/hermes/connections/spotify/engine");
    await page.waitForTimeout(350);
    await expect(marker).toHaveAttribute("data-breadboard-startup", "loading");
    engineReady = true;
    await expect(marker).toHaveAttribute("data-breadboard-startup", "ready");
    await expect(page.locator("#weather")).toHaveText("ready");
    await expect(page.locator("#tasks")).toHaveText("false");
    await expect(page.getByText("No upcoming events")).toBeVisible();
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.unmountWidgets());
    await expect(marker).toHaveAttribute("data-breadboard-startup", "loading");
  } finally {
    for (const waiters of held.values()) for (const resolve of waiters) resolve();
    await browser.close();
  }
});
