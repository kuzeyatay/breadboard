// Current conditions and the wall clock at the hubs on the map.
//
// A monitor that pins a story to Kyiv and cannot say whether it is three in the
// morning there is missing the thing every desk asks first. Open-Meteo answers
// both questions in one request: current conditions for a list of coordinates,
// and — with `timezone=auto` — the UTC offset each of those coordinates is
// actually on today, daylight saving included. No key, no quota, no account.
//
// Only hubs from the shipped catalog are ever looked up. The caller passes hub
// ids, this module resolves them against `GEO_HUBS`, so the route can never be
// talked into fetching arbitrary coordinates.

import { GEO_HUBS, type GeoHubLocation } from "./geo-hubs.ts";
import type { HubWeather, ThreatLevel, WeatherStressKind } from "./types.ts";

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const CACHE_TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;
/** One request, one screen's worth of hubs. Beyond this the URL is the problem. */
export const MAX_WEATHER_HUBS = 24;

const USER_AGENT =
  "Mozilla/5.0 (compatible; breadboard-worldmonitor/1.0; +https://github.com/koala73/worldmonitor)";

// ── Interpretation ──────────────────────────────────────────────────────────

/** WMO 4677 weather interpretation codes, as Open-Meteo emits them. */
const WEATHER_CODES: Record<number, string> = {
  0: "Clear",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Rain showers",
  82: "Violent rain showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm",
};

export function describeWeatherCode(code: number): string {
  return WEATHER_CODES[code] ?? "Unsettled";
}

const LEVEL_RANK: Record<ThreatLevel, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

export interface WeatherStress {
  kind: WeatherStressKind;
  level: ThreatLevel;
  note: string;
}

/**
 * Whether the conditions at a hub are worth flagging, and how hard.
 *
 * The thresholds are the operational ones rather than anything clever: 40 °C
 * apparent is where heat-stroke guidance starts, 118 km/h is hurricane force on
 * the Beaufort scale, 10 mm in an hour is what flash-flood guidance calls
 * intense rainfall. Nothing here tops out at `critical` — on this monitor that
 * word is reserved for the geopolitical scale, and weather earns it through the
 * hazard alerts, where somebody has actually assessed the impact.
 */
export function weatherStress(reading: {
  apparentC: number;
  temperatureC: number;
  windKph: number;
  precipitationMm: number;
}): WeatherStress {
  const candidates: WeatherStress[] = [];

  const feels = Number.isFinite(reading.apparentC) ? reading.apparentC : reading.temperatureC;

  if (feels >= 40) candidates.push({ kind: "heat", level: "high", note: `Feels like ${Math.round(feels)} °C` });
  else if (feels >= 35) candidates.push({ kind: "heat", level: "medium", note: `Feels like ${Math.round(feels)} °C` });
  else if (feels >= 30) candidates.push({ kind: "heat", level: "low", note: `Feels like ${Math.round(feels)} °C` });

  if (feels <= -25) candidates.push({ kind: "cold", level: "high", note: `Feels like ${Math.round(feels)} °C` });
  else if (feels <= -15) candidates.push({ kind: "cold", level: "medium", note: `Feels like ${Math.round(feels)} °C` });
  else if (feels <= -5) candidates.push({ kind: "cold", level: "low", note: `Feels like ${Math.round(feels)} °C` });

  if (reading.windKph >= 118) candidates.push({ kind: "wind", level: "high", note: `Wind ${Math.round(reading.windKph)} km/h` });
  else if (reading.windKph >= 75) candidates.push({ kind: "wind", level: "medium", note: `Wind ${Math.round(reading.windKph)} km/h` });
  else if (reading.windKph >= 50) candidates.push({ kind: "wind", level: "low", note: `Wind ${Math.round(reading.windKph)} km/h` });

  if (reading.precipitationMm >= 10) candidates.push({ kind: "rain", level: "high", note: `${reading.precipitationMm.toFixed(1)} mm in the hour` });
  else if (reading.precipitationMm >= 4) candidates.push({ kind: "rain", level: "medium", note: `${reading.precipitationMm.toFixed(1)} mm in the hour` });
  else if (reading.precipitationMm >= 1) candidates.push({ kind: "rain", level: "low", note: `${reading.precipitationMm.toFixed(1)} mm in the hour` });

  if (candidates.length === 0) return { kind: "none", level: "info", note: "Nothing notable" };

  candidates.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  return candidates[0]!;
}

/**
 * The wall clock at a place, from its current UTC offset. Formatting through a
 * shifted UTC timestamp rather than `toLocaleString` keeps the answer identical
 * on the server and in the browser — the two run in different zones, and a
 * clock that changes when the render moves is worse than no clock.
 */
export function localClock(
  utcOffsetMinutes: number,
  nowMs: number,
): { time: string; hour: number; minute: number } {
  const shifted = new Date(nowMs + utcOffsetMinutes * 60_000);
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();
  return {
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    hour,
    minute,
  };
}

/** Rough part of day, for the tint behind a clock row. */
export function partOfDay(hour: number): "night" | "morning" | "afternoon" | "evening" {
  if (hour < 6) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
}

// ── Fetch ───────────────────────────────────────────────────────────────────

interface OpenMeteoLocation {
  latitude?: number;
  longitude?: number;
  timezone?: string;
  utc_offset_seconds?: number;
  current?: Record<string, number | string>;
  daily?: Record<string, Array<number | string>>;
}

const cache = new Map<string, { at: number; weather: HubWeather[] }>();

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function hubsByIds(ids: string[]): GeoHubLocation[] {
  const wanted = new Set(ids);
  const hubs: GeoHubLocation[] = [];
  // Catalog order, not request order: the same set of hubs must produce the
  // same request, or the cache key below would miss on a reshuffle.
  for (const hub of GEO_HUBS) {
    if (wanted.has(hub.id)) hubs.push(hub);
    if (hubs.length >= MAX_WEATHER_HUBS) break;
  }
  return hubs;
}

/**
 * Current conditions and local time for the given hubs, in one request.
 * Cached for fifteen minutes per hub set — Open-Meteo itself updates on a
 * fifteen-minute cadence, so a faster refresh returns the same numbers.
 */
export async function fetchHubWeather(hubs: GeoHubLocation[]): Promise<HubWeather[]> {
  if (hubs.length === 0) return [];

  const key = hubs.map((hub) => hub.id).join(",");
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) {
    // Re-derive the clock so a cached reading never shows a stale time.
    return hit.weather.map((entry) => {
      const clock = localClock(entry.utcOffsetMinutes, now);
      return { ...entry, localTime: clock.time, localHour: clock.hour };
    });
  }

  const params = new URLSearchParams({
    latitude: hubs.map((hub) => hub.lat.toFixed(4)).join(","),
    longitude: hubs.map((hub) => hub.lon.toFixed(4)).join(","),
    current:
      "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day",
    daily: "temperature_2m_max,temperature_2m_min",
    timezone: "auto",
    forecast_days: "1",
  });

  const response = await fetch(`${ENDPOINT}?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);

  const payload = (await response.json()) as OpenMeteoLocation | OpenMeteoLocation[];
  // A single coordinate comes back as an object, several as an array.
  const locations = Array.isArray(payload) ? payload : [payload];

  const weather: HubWeather[] = [];
  for (const [index, hub] of hubs.entries()) {
    const location = locations[index];
    if (!location?.current) continue;

    const current = location.current;
    const temperatureC = num(current.temperature_2m);
    const apparentC = num(current.apparent_temperature, temperatureC);
    const windKph = num(current.wind_speed_10m);
    const precipitationMm = num(current.precipitation);
    const code = num(current.weather_code);
    const utcOffsetMinutes = Math.round(num(location.utc_offset_seconds) / 60);
    const clock = localClock(utcOffsetMinutes, now);

    weather.push({
      hubId: hub.id,
      name: hub.name,
      country: hub.country,
      region: hub.region,
      lat: hub.lat,
      lon: hub.lon,
      temperatureC: Math.round(temperatureC * 10) / 10,
      apparentC: Math.round(apparentC * 10) / 10,
      humidity: Math.round(num(current.relative_humidity_2m)),
      precipitationMm,
      windKph: Math.round(windKph),
      code,
      conditions: describeWeatherCode(code),
      isDay: num(current.is_day, 1) === 1,
      maxC: Math.round(num(location.daily?.temperature_2m_max?.[0]) * 10) / 10,
      minC: Math.round(num(location.daily?.temperature_2m_min?.[0]) * 10) / 10,
      timezone: typeof location.timezone === "string" ? location.timezone : "UTC",
      utcOffsetMinutes,
      localTime: clock.time,
      localHour: clock.hour,
      stress: weatherStress({ apparentC, temperatureC, windKph, precipitationMm }),
    });
  }

  cache.set(key, { at: now, weather });
  // The keys are hub-set strings; a session that pans around the map should not
  // grow this without bound.
  if (cache.size > 40) {
    for (const stale of [...cache.keys()].slice(0, 20)) cache.delete(stale);
  }

  return weather;
}

/** Test seam: drop the cached readings. */
export function resetWeatherCache(): void {
  cache.clear();
}
