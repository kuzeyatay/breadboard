import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const bundle = await build({
  entryPoints: [path.join(root, "src/app/api/browser/weather/route.ts")],
  bundle: true, write: false, platform: "node", format: "cjs", external: ["next/server"],
  plugins: [{ name: "authenticated-weather-request", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/server-auth$/ }, () => ({ path: "auth", namespace: "weather-test" }));
    builder.onLoad({ filter: /.*/, namespace: "weather-test" }, () => ({ contents: `
      export async function requireUserId() { return 'weather-test-user'; }
      export function routeErrorResponse(error) { return Response.json({error: error.message}, {status: 500}); }
    ` }));
  } }],
});
const routeModule = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(routeModule, routeModule.exports, createRequire(import.meta.url));
const { GET } = routeModule.exports;
const request = (query = "latitude=52.3741&longitude=4.8952&forecast=7") => new Request(`https://weather.test/api/browser/weather?${query}`);
const daily = () => ({
  time: Array.from({ length: 7 }, (_, index) => `2026-09-${13 + index}`),
  weather_code: [3, 61, 2, 0, 1, 95, 71],
  temperature_2m_min: [12.4, 13, 14, 15, 16, 17, 18],
  temperature_2m_max: [19.6, 20, 21, 22, 23, 24, 25],
  precipitation_probability_max: [0, 70.3, null, 10, 0, 90, 40],
});

test("forecast mode requests seven local calendar days and preserves daily weather", async context => {
  const calls = [];
  context.mock.method(globalThis, "fetch", async url => {
    calls.push(new URL(url));
    return Response.json({ timezone: "Europe/Amsterdam", daily: daily() });
  });
  const response = await GET(request());
  assert.equal(response.status, 200);
  const forecast = await response.json();
  assert.equal(forecast.timezone, "Europe/Amsterdam");
  assert.deepEqual(forecast.days.map(day => day.date), daily().time);
  assert.equal(forecast.days[0].minC, 12);
  assert.equal(forecast.days[0].maxC, 20);
  assert.equal(forecast.days[1].condition, "Rain");
  assert.equal(forecast.days[1].precipitationChance, 70);
  assert.equal(forecast.days[2].precipitationChance, null, "missing precipitation is not shown as zero");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get("latitude"), "52.37");
  assert.equal(calls[0].searchParams.get("longitude"), "4.9");
  assert.equal(calls[0].searchParams.get("forecast_days"), "7");
  assert.equal(calls[0].searchParams.get("timezone"), "auto");
  assert.equal(calls[0].searchParams.has("current"), false);
  assert.match(calls[0].searchParams.get("daily"), /precipitation_probability_max/);
});

test("current readings retain the coordinates used by the local forecast trigger", async context => {
  context.mock.method(globalThis, "fetch", async url => {
    assert.equal(new URL(url).searchParams.get("forecast_days"), "1");
    assert.equal(new URL(url).searchParams.has("daily"), false);
    return Response.json({ current: { temperature_2m: 17.3, apparent_temperature: 16.2, weather_code: 3, is_day: 0 }, timezone: "Europe/Amsterdam" });
  });
  const response = await GET(request("latitude=51.441&longitude=5.479"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    latitude: 51.44, longitude: 5.48, temperatureC: 17, apparentC: 16,
    code: 3, condition: "Overcast", isDay: false, timezone: "Europe/Amsterdam",
  });
});

test("invalid coordinates never reach the provider", async context => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected fetch"); });
  for (const query of ["forecast=7", "latitude=91&longitude=4&forecast=7", "latitude=52&longitude=invalid&forecast=7"]) {
    assert.equal((await GET(request(query))).status, 400);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("incomplete forecasts and provider failures return a retryable error", async context => {
  let payload = { daily: { ...daily(), temperature_2m_max: [null, 20, 21, 22, 23, 24, 25] } };
  const fetchMock = context.mock.method(globalThis, "fetch", async () => Response.json(payload));
  assert.equal((await GET(request())).status, 502);
  payload = { daily: { ...daily(), time: daily().time.slice(0, 6) } };
  assert.equal((await GET(request())).status, 502);
  payload = {};
  assert.equal((await GET(request())).status, 502);
  fetchMock.mock.mockImplementation(async () => Response.json({ error: "Try later" }, { status: 503 }));
  assert.equal((await GET(request())).status, 502);
});
