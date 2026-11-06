import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("cross-tab highlight and notification writes cannot flood weather or block saves", { timeout: 60_000 }, async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useEffect} from 'react'; import {createRoot} from 'react-dom/client';
      import {useDockWeather} from './src/app/browser/browser-home-widgets';
      import {useWorldCities} from './src/app/browser/browser-dock-popovers';
      function App() {
        const {weather, status, retry} = useDockWeather(true); const {cities} = useWorldCities();
        useEffect(() => { window.cityChanges = (window.cityChanges || 0) + 1; }, [cities]);
        return <><output id="status">{status}</output><output id="temperature">{weather?.temperatureC}</output><button onClick={retry}>Retry local weather</button></>;
      }
      const root = createRoot(document.getElementById('root'));
      window.unmountWeather = () => root.unmount(); root.render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", outfile: "weather.js",
    plugins: [{ name: "weather-hook", setup(builder) {
      builder.onLoad({ filter: /browser-home-widgets\.tsx$/ }, ({ path: filename }) => ({
        loader: "tsx", contents: fs.readFileSync(filename, "utf8").replace("function useDockWeather(", "export function useDockWeather("),
      }));
    } }],
  });
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const requests = [];
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.clock.install();
    await context.route("https://weather-storage.test/**", route => {
      if (route.request().url().includes('/api/browser/weather')) { requests.push(route); return; }
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
    });
    await page.goto('https://weather-storage.test/');
    const peer = await context.newPage();
    await peer.goto('https://weather-storage.test/');
    const setLocation = latitude => peer.evaluate(latitude => {
      localStorage.setItem('breadboard:current-location', JSON.stringify({useForAnswers: true, snapshot: {
        latitude, longitude: 5, accuracyMeters: 100, timeZone: 'Europe/Amsterdam', capturedAt: new Date().toISOString(),
      }}));
    }, latitude);
    await setLocation(52);
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
    await expect.poll(() => requests.length).toBe(1);
    const citiesBefore = await page.evaluate(() => window.cityChanges);
    await peer.evaluate(() => {
      for (let index = 0; index < 40; index++) {
        localStorage.setItem('breadboard:notification-view:v1:test', String(index));
        localStorage.setItem('breadboard:highlight-outbox:test', String(index));
      }
    });
    // Even genuine location events must coalesce when only the fix timestamp changes.
    await setLocation(52);
    await page.evaluate(() => window.dispatchEvent(new Event('breadboard:current-location-change')));
    await page.clock.runFor(100);
    assert.equal(requests.length, 1, 'storage heartbeats must leave the network queue free for saves');
    assert.equal(await page.evaluate(() => window.cityChanges), citiesBefore, 'unrelated storage cannot restart world-weather effects');
    await requests[0].fulfill({ json: { temperatureC: 18, code: 0 } });
    await expect(page.locator('#status')).toHaveText('ready');
    await setLocation(52);
    await page.clock.runFor(100);
    assert.equal(requests.length, 1, 'an unchanged location also reuses completed weather');

    await setLocation(53);
    await expect.poll(() => requests.length).toBe(2);
    const cancelled = page.waitForEvent('requestfailed', request => request.url().includes('latitude=53'));
    await setLocation(54);
    await expect.poll(() => requests.length).toBe(3);
    await cancelled;
    assert.ok(requests[2].request().url().includes('latitude=54'));
    await requests[2].fulfill({ json: { temperatureC: 21, code: 0 } });
    await expect(page.locator('#temperature')).toHaveText('21');

    await setLocation(55);
    await expect.poll(() => requests.length).toBe(4);
    await expect(page.locator('#temperature')).toHaveText('');
    await page.clock.runFor(12_001);
    await expect(page.locator('#status')).toHaveText('unavailable');
    await page.clock.runFor(5_001);
    await expect.poll(() => requests.length).toBe(5);
    await page.getByRole('button', {name: 'Retry local weather'}).click();
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    assert.equal(requests.length, 5, 'retries must coalesce with an in-flight request');
    await requests[4].fulfill({json: {temperatureC: null, code: 0}});
    await expect(page.locator('#status')).toHaveText('unavailable');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => requests.length).toBe(6);
    await requests[5].fulfill({json: {temperatureC: 19, code: 0}});
    await expect(page.locator('#status')).toHaveText('ready');
    await expect(page.locator('#temperature')).toHaveText('19');

    // Background refreshes keep the last reading visible through transient
    // failures, then recover without interaction or the 15-minute interval.
    await page.getByRole('button', {name: 'Retry local weather'}).click();
    await expect.poll(() => requests.length).toBe(7);
    await expect(page.locator('#temperature')).toHaveText('19');
    await expect(page.locator('#status')).toHaveText('ready');
    for (const delay of [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]) {
      const count = requests.length;
      await requests.at(-1).fulfill({status: 502, json: {error: 'Unavailable'}});
      await expect(page.locator('#status')).toHaveText('stale');
      await expect(page.locator('#temperature')).toHaveText('19');
      await page.clock.runFor(delay - 500);
      assert.equal(requests.length, count, 'automatic retries back off, capped at one minute');
      await page.clock.runFor(501);
      await expect.poll(() => requests.length).toBe(count + 1);
      await expect(page.locator('#temperature')).toHaveText('19');
    }
    await requests.at(-1).fulfill({json: {temperatureC: 20, code: 0}});
    await expect(page.locator('#status')).toHaveText('ready');
    await expect(page.locator('#temperature')).toHaveText('20');

    // Recent readings are bounded, and stale data is never silently kept
    // forever. Returning to the window refreshes an expired reading.
    await page.clock.setSystemTime(await page.evaluate(() => Date.now() + 31 * 60_000));
    const beforeResume = requests.length;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => requests.length).toBe(beforeResume + 1);
    await expect(page.locator('#temperature')).toHaveText('');
    await requests.at(-1).fulfill({status: 502, json: {error: 'Unavailable'}});
    await expect(page.locator('#status')).toHaveText('unavailable');
    await peer.evaluate(() => localStorage.clear());
    await expect(page.locator('#status')).toHaveText('off');
    await expect(page.locator('#temperature')).toHaveText('');
    const beforeOptOut = requests.length;
    await page.clock.runFor(61_000);
    assert.equal(requests.length, beforeOptOut, 'opting out cancels scheduled retries');
    await setLocation(56);
    await expect.poll(() => requests.length).toBe(beforeOptOut + 1);
    const unmounted = page.waitForEvent('requestfailed', request => request.url().includes('latitude=56'));
    await page.evaluate(() => window.unmountWeather());
    await unmounted;
    await page.clock.runFor(61_000);
    assert.equal(requests.length, beforeOptOut + 1, 'unmounting cannot schedule another request');
  } finally {
    await browser.close();
  }
});

test("world weather settles during cross-tab writes and retries unavailable local and city readings", { timeout: 60_000 }, async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {WorldWeather, useWorldCities} from './src/app/browser/browser-dock-popovers';
      function App() {
        const {cities, save} = useWorldCities();
        const [localFailed, setLocalFailed] = React.useState(true);
        return <WorldWeather cities={cities} save={save} localWeather={null}
          localWeatherUnavailable={localFailed} onRetryLocalWeather={() => setLocalFailed(false)} />;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", outfile: "weather.js",
  });
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const requests = [];
    await page.clock.install();
    await context.route('https://world-weather.test/**', route => {
      if (route.request().url().includes('/api/browser/weather')) { requests.push(route); return; }
      return route.fulfill({contentType: 'text/html', body: '<div id="root"></div>'});
    });
    await page.goto('https://world-weather.test/');
    const peer = await context.newPage();
    await peer.goto('https://world-weather.test/');
    await page.addScriptTag({content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text});
    await expect.poll(() => requests.length).toBe(5);
    await peer.evaluate(() => {
      for (let index = 0; index < 20; index++) localStorage.setItem('breadboard:highlight-outbox:test', String(index));
    });
    await page.clock.runFor(100);
    assert.equal(requests.length, 5, 'cross-tab writes must not cancel and restart city requests');
    const reading = {temperatureC: 18, apparentC: 17, code: 3, condition: 'Overcast', isDay: true, timezone: 'Europe/Amsterdam'};
    await requests[0].fulfill({json: reading});
    await requests[1].fulfill({status: 502, json: {error: 'Unavailable'}});
    await page.clock.runFor(12_001);
    await expect(page.getByText('Getting weather…', {exact: true})).toHaveCount(0);
    await expect(page.getByText('Unavailable right now', {exact: true})).toHaveCount(4);
    await page.getByRole('button', {name: 'Retry unavailable weather'}).click();
    await expect(page.getByText('Local weather is unavailable right now.')).toHaveCount(0);
    await expect.poll(() => requests.length).toBe(9);
    await Promise.all(requests.slice(5, 8).map(route => route.fulfill({json: reading})));
    await requests[8].fulfill({status: 502, json: {error: 'Unavailable'}});
    await expect(page.getByText('Unavailable right now', {exact: true})).toHaveCount(1);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => requests.length).toBe(10);
    await requests[9].fulfill({json: reading});
    await expect(page.getByText('Overcast', {exact: true})).toHaveCount(5);
    await expect(page.getByRole('button', {name: 'Retry unavailable weather'})).toHaveCount(0);
  } finally {
    await browser.close();
  }
});

test("weather locations open an independent seven-day popup beside the city list", { timeout: 60_000 }, async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {DockPopover, WorldWeather} from './src/app/browser/browser-dock-popovers';
      import {WORLD_CITIES, DEFAULT_CITY_IDS} from './src/app/browser/browser-dock-data';
      function App() {
        const [open, setOpen] = React.useState(false);
        const [ids, setIds] = React.useState(DEFAULT_CITY_IDS);
        const cities = React.useMemo(() => ids.map(id => WORLD_CITIES.find(city => city.id === id)), [ids]);
        return <DockPopover panel="weather" open={open} onOpenChange={setOpen} trigger={<button>Open world weather</button>}>
          <WorldWeather cities={cities} save={setIds} localWeather={{latitude:51.44,longitude:5.48,temperatureC:17,apparentC:16,code:3,condition:'Overcast',isDay:true,timezone:'Europe/Amsterdam'}} />
        </DockPopover>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    outfile: "weather.js", define: { "process.env.NODE_ENV": '"test"' },
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
  const days = Array.from({ length: 7 }, (_, index) => ({
    date: `2026-09-${13 + index}`, code: index % 2 ? 61 : 2,
    condition: index % 2 ? "Rain" : "Partly cloudy", minC: 12 + index, maxC: 19 + index,
    precipitationChance: index * 10,
  }));
  const executablePath = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1496, height: 840 } });
    const errors = [];
    const forecastRequests = [];
    let failForecast = false;
    let releaseForecast = null;
    let delayForecast = false;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://weather.test/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/app.js") return route.fulfill({ contentType: "text/javascript", body: js });
      if (url.pathname === "/style.css") return route.fulfill({ contentType: "text/css", body: css });
      if (url.pathname === "/api/browser/weather") {
        if (url.searchParams.has("forecast")) {
          forecastRequests.push(Object.fromEntries(url.searchParams));
          if (delayForecast) await new Promise(resolve => { releaseForecast = resolve; });
          if (failForecast) return route.fulfill({ status: 502, json: { error: "Unavailable" } });
          return route.fulfill({ json: { timezone: "Europe/Amsterdam", days } });
        }
        return route.fulfill({ json: { temperatureC: 18, apparentC: 17, code: 3, condition: "Overcast", isDay: true, timezone: "Europe/Amsterdam" } });
      }
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body style="margin:0;background:#e6efe7;font-family:Arial"><main id="root" style="position:fixed;left:260px;bottom:45px"></main><script src="/app.js"></script></body></html>` });
    });
    await page.goto("https://weather.test");
    await page.getByRole("button", { name: "Open world weather", exact: true }).click();
    const world = page.getByRole("dialog", { name: "World weather", exact: true });
    const location = name => page.getByRole("button", { name: `Show seven-day forecast for ${name}`, exact: true });
    const popup = () => page.locator("[data-weather-forecast]");
    await location("Amsterdam").click();
    await expect(popup().getByRole("listitem")).toHaveCount(7);
    await expect(popup().getByRole("heading")).toHaveText("Amsterdam");
    await expect(popup().getByText("Partly cloudy", { exact: true }).first()).toBeVisible();
    await expect(popup().getByLabel("High 19°C, low 12°C")).toBeVisible();
    await expect(popup().getByLabel("0% chance of precipitation", { exact: true })).toBeVisible();
    const parentBounds = await world.boundingBox();
    const forecastBounds = await popup().boundingBox();
    assert.ok(forecastBounds.x >= parentBounds.x + parentBounds.width, "the forecast is to the right of the existing popup");
    assert.ok(forecastBounds.y >= 48 && forecastBounds.y + forecastBounds.height <= 824);
    assert.deepEqual(forecastRequests[0], { latitude: "52.37", longitude: "4.9", forecast: "7" });

    const output = path.join(root, "output", "weather-forecast-qa");
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, "desktop.png") });
    await location("London").click();
    await expect(popup()).toHaveCount(1);
    await expect(popup().getByRole("heading")).toHaveText("London");
    await expect(popup().getByRole("listitem")).toHaveCount(7);
    await expect(world).toBeVisible();
    assert.equal(forecastRequests.at(-1).latitude, "51.51");
    await page.getByRole("button", { name: "Close forecast for London" }).click();
    await expect(popup()).toHaveCount(0);
    await expect(world).toBeVisible();
    await expect(location("London")).toBeFocused();

    await location("Amsterdam").focus();
    await location("Amsterdam").press("Enter");
    await expect(page.getByRole("button", { name: "Close forecast for Amsterdam" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(popup()).toHaveCount(0);
    await expect(world).toBeVisible();
    await expect(location("Amsterdam")).toBeFocused();
    assert.equal(forecastRequests.length, 2, "reopening a city reuses its fresh forecast");

    await location("Your location").click();
    await expect(popup().getByRole("listitem")).toHaveCount(7);
    assert.deepEqual(forecastRequests.at(-1), { latitude: "51.44", longitude: "5.48", forecast: "7" });
    await page.getByRole("button", { name: "Close forecast for Your location" }).click();
    const beforeRemove = forecastRequests.length;
    await page.getByRole("button", { name: "Remove London", exact: true }).click();
    await expect(location("London")).toHaveCount(0);
    assert.equal(forecastRequests.length, beforeRemove, "removing a city never opens a forecast");

    failForecast = true;
    await location("Tokyo").click();
    await expect(popup().getByRole("alert")).toContainText("unavailable");
    failForecast = false;
    await popup().getByRole("button", { name: "Retry forecast" }).click();
    await expect(popup().getByRole("listitem")).toHaveCount(7);
    await page.getByRole("button", { name: "Close forecast for Tokyo" }).click();

    // A late result for one city must not replace the newly selected city.
    delayForecast = true;
    await location("New York").click();
    await expect(popup().getByRole("status")).toContainText("Getting");
    await expect.poll(() => releaseForecast !== null).toBe(true);
    await location("Amsterdam").click();
    delayForecast = false;
    releaseForecast();
    await expect(popup().getByRole("heading")).toHaveText("Amsterdam");
    await expect(popup().getByRole("listitem")).toHaveCount(7);
    await page.getByRole("button", { name: "Close World weather" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.setViewportSize({ width: 1000, height: 800 });
    await page.getByRole("button", { name: "Open world weather", exact: true }).click();
    await location("Amsterdam").click();
    await expect(popup().getByRole("listitem")).toHaveCount(7);
    const medium = await popup().boundingBox();
    assert.ok(medium.x >= 0 && medium.x + medium.width <= 1000, "use a compact popup when neither side has enough room");
    await page.getByRole("button", { name: "Close forecast for Amsterdam" }).click();
    await page.getByRole("button", { name: "Close World weather" }).click();

    await page.setViewportSize({ width: 390, height: 740 });
    await page.getByRole("button", { name: "Open world weather", exact: true }).click();
    await location("Amsterdam").click();
    await expect(popup().getByRole("listitem")).toHaveCount(7);
    const narrow = await popup().boundingBox();
    assert.ok(narrow.x >= 0 && narrow.x + narrow.width <= 390, "the forecast stays inside a narrow viewport");
    assert.ok(narrow.y >= 0 && narrow.y + narrow.height <= 740);
    await page.screenshot({ path: path.join(output, "narrow.png") });
    await page.getByRole("button", { name: "Close forecast for Amsterdam" }).click();
    await expect(world).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
