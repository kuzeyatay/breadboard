// Dated weather as a native chat resource: a grounded read tool, a fenced
// display contract, and one responsive card per requested day.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import { fetchWeatherForecast, weatherCondition } from "../src/lib/weather/forecast.ts";
import {
  parseWeatherChatIntent,
  weatherResultsMessage,
} from "../src/lib/weather/chat-intent.ts";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(dashboardRoot, "..");

fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), { recursive: true });
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-weather-widget-"),
);
after(() => fs.rmSync(outDirectory, { recursive: true, force: true }));

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  [
    `export { default as ChatMarkdown } from "@/app/components/chat-markdown";`,
    `export { parseWeatherResults } from "@/app/components/chat-weather-results";`,
    "",
  ].join("\n"),
  "utf8",
);
const bundle = path.join(outDirectory, "bundle.cjs");
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  outfile: bundle,
  format: "cjs",
  platform: "node",
  target: "node20",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  alias: { "@": path.join(dashboardRoot, "src") },
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
  logLevel: "silent",
});

const require = module.createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { ChatMarkdown, parseWeatherResults } = require(bundle);

const DISPLAY = {
  location: "Eindhoven, North Brabant",
  country: "Netherlands",
  timezone: "Europe/Amsterdam",
  days: [
    {
      date: "2026-08-31",
      temperatureC: 18.2,
      minC: 15.1,
      maxC: 20.4,
      code: 0,
      condition: "Clear",
      isDay: false,
    },
    {
      date: "2026-09-01",
      temperatureC: 17.5,
      minC: 13.2,
      maxC: 21.8,
      code: 61,
      condition: "Rain",
      isDay: true,
    },
  ],
};

function render(content) {
  return renderToStaticMarkup(React.createElement(ChatMarkdown, { content }));
}

test("one weather-results payload renders one stacked card per requested day", () => {
  const html = render(`\`\`\`weather-results\n${JSON.stringify(DISPLAY)}\n\`\`\``);
  assert.ok(html.includes('class="chat-weather-results"'));
  assert.equal((html.match(/class="chat-weather-card"/g) ?? []).length, 2);
  assert.ok(html.includes(">Eindhoven, North Brabant<"));
  assert.ok(html.includes("Eindhoven, North Brabant, Netherlands, Monday, Aug 31"));
  assert.ok(html.includes("Monday, Aug 31"));
  assert.ok(html.includes("Tuesday, Sep 1"));
  assert.ok(html.includes('data-weather-kind="clear" data-daylight="night"'));
  assert.ok(html.includes('data-weather-kind="rain" data-daylight="day"'));
  assert.ok(!html.includes("chat-code-block"), "the structured payload replaces code chrome");
  assert.ok(html.includes("data-selection-exclude"));
});

test("weather cards coexist with ordinary assistant prose", () => {
  const html = render(`Rain is likely, so take a light jacket.\n\n\`\`\`weather-results\n${JSON.stringify(DISPLAY)}\n\`\`\``);
  assert.ok(html.includes("Rain is likely, so take a light jacket."));
  assert.ok(html.includes('class="chat-weather-results"'));
  assert.ok(html.indexOf("Rain is likely") < html.indexOf("chat-weather-results"));
});

test("half-streamed or invalid weather JSON stays invisible", () => {
  const partial = render(`\`\`\`weather-results\n${JSON.stringify(DISPLAY).slice(0, 70)}\n\`\`\``);
  assert.ok(!partial.includes("chat-weather-results"));
  assert.ok(!partial.includes("chat-code-block"));
  assert.equal(parseWeatherResults('{"location":"Eindhoven","days":[]}'), null);
});

test("the parser caps days and drops malformed entries", () => {
  const payload = {
    ...DISPLAY,
    days: [
      { date: "bad", temperatureC: 99, minC: 0, maxC: 1, code: 0, condition: "No" },
      ...Array.from({ length: 15 }, (_, index) => ({
        ...DISPLAY.days[0],
        date: `2026-09-${String(index + 1).padStart(2, "0")}`,
      })),
    ],
  };
  assert.equal(parseWeatherResults(JSON.stringify(payload)).days.length, 10);
});

test("the forecast read resolves a place and preserves each requested date", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("geocoding-api")) {
      return Response.json({
        results: [{
          name: "Eindhoven",
          admin1: "North Brabant",
          country: "Netherlands",
          latitude: 51.44,
          longitude: 5.48,
          timezone: "Europe/Amsterdam",
        }],
      });
    }
    return Response.json({
      timezone: "Europe/Amsterdam",
      current: { time: "2026-08-31T21:30", temperature_2m: 18.2, weather_code: 0, is_day: 0 },
      daily: {
        time: ["2026-08-31", "2026-09-01"],
        weather_code: [1, 61],
        temperature_2m_max: [20.4, 21.8],
        temperature_2m_min: [15.1, 13.2],
      },
    });
  };
  const result = await fetchWeatherForecast(
    { location: "Eindhoven", dates: ["2026-08-31", "2026-09-01"] },
    { fetchImpl, now: new Date("2026-08-31T19:31:00Z") },
  );

  assert.equal(calls.length, 2);
  assert.match(calls[1], /start_date=2026-08-31/);
  assert.match(calls[1], /end_date=2026-09-01/);
  assert.equal(result.display.location, "Eindhoven");
  assert.deepEqual(result.display.days.map((day) => day.date), ["2026-08-31", "2026-09-01"]);
  assert.equal(result.display.days[0].temperatureC, 18.2, "today uses the current reading");
  assert.equal(result.display.days[0].isDay, false);
  assert.equal(result.display.days[1].temperatureC, 17.5, "future cards use the daily midpoint");
  assert.equal(result.display.days[1].condition, "Rain");
  assert.equal(result.source.name, "Open-Meteo");
});

test("weather arguments and WMO conditions fail closed", async () => {
  await assert.rejects(
    () => fetchWeatherForecast({ location: "", dates: [] }),
    /city, region, or named place/,
  );
  await assert.rejects(
    () => fetchWeatherForecast({ location: "Eindhoven", dates: ["tomorrow"] }),
    /YYYY-MM-DD/,
  );
  assert.equal(weatherCondition(0), "Clear");
  assert.equal(weatherCondition(86), "Snow showers");
  assert.equal(weatherCondition(99), "Thunderstorms with hail");
});

test("ordinary named-place questions route to weather data before the general agent", () => {
  const now = new Date("2026-09-01T07:29:00Z");
  assert.deepEqual(
    parseWeatherChatIntent("whats the weather like in london", { now }),
    { location: "london", dates: undefined },
  );
  assert.deepEqual(
    parseWeatherChatIntent("Forecast for Paris for the next 3 days", { now }),
    {
      location: "Paris",
      dates: ["2026-09-01", "2026-09-02", "2026-09-03"],
    },
  );
  assert.deepEqual(
    parseWeatherChatIntent("current weather London for the next three days", { now }),
    {
      location: "London",
      dates: ["2026-09-01", "2026-09-02", "2026-09-03"],
    },
  );
  assert.deepEqual(
    parseWeatherChatIntent("Will it rain in Tokyo today and tomorrow?", { now }),
    { location: "Tokyo", dates: ["2026-09-01", "2026-09-02"] },
  );
  assert.equal(
    parseWeatherChatIntent("Implement a weather widget for London", { now }),
    null,
  );
  assert.equal(parseWeatherChatIntent("Explain London's climate", { now }), null);
});

test("the direct-mode weather response combines prose with the native resource", () => {
  const message = weatherResultsMessage(DISPLAY);
  assert.match(message, /^Here’s the 2-day forecast for Eindhoven, North Brabant\.\n\n```weather-results\n/);
  assert.match(message, /"location":"Eindhoven, North Brabant"/);
  assert.match(message, /\n```$/);

  const agentTurn = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "conversations", "turn-service.ts"),
    "utf8",
  );
  const directTurn = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "conversations", "direct-turn-service.ts"),
    "utf8",
  );
  assert.doesNotMatch(agentTurn, /parseWeatherChatIntent|weatherResultsMessage/);
  assert.match(directTurn, /parseWeatherChatIntent[\s\S]+fetchWeatherForecast\(weatherIntent\)/);
});

test("the display contract and accessible material treatment ship with the tool", () => {
  const prompt = fs.readFileSync(
    path.join(repoRoot, "hermes-config", "system", "weather-results.md"),
    "utf8",
  );
  const composer = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "hermes", "system-prompts.ts"),
    "utf8",
  );
  const css = fs.readFileSync(path.join(dashboardRoot, "src", "app", "globals.css"), "utf8");
  assert.match(prompt, /```weather-results/);
  assert.match(prompt, /all the dates/);
  assert.match(prompt, /alongside ordinary prose/);
  assert.match(prompt, /widget-only response/);
  assert.match(
    composer,
    /allowedTools\.includes\("weather_forecast"\)[\s\S]{0,140}readSystemPrompt\("weather-results"\)/,
  );
  assert.match(css, /prefers-reduced-motion[\s\S]+chat-weather-card/);
  assert.match(css, /prefers-reduced-transparency/);
  assert.match(css, /prefers-contrast/);
  assert.match(css, /\.chat-weather-results\s*\{[\s\S]{0,120}width:\s*100%/);
  assert.doesNotMatch(css, /\.chat-weather-results\s*\{[\s\S]{0,120}35rem/);
});
