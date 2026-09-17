import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

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
