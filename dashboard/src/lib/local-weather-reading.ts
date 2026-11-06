import { getStoredCurrentLocationPreference } from "./current-location.ts";

export const LOCAL_WEATHER_READING_KEY = "breadboard:local-weather-reading:v1";
export const LOCAL_WEATHER_READING_EVENT = "breadboard:local-weather-reading";
export const LOCAL_WEATHER_RETAIN_MS = 30 * 60_000;
export type LocalWeatherCode = number | "off" | "waiting";

/** Reuse the dock's current reading; background effects never fetch weather. */
export function publishLocalWeatherReading(locationKey: string, code: number) {
  if (typeof window === "undefined" || !Number.isFinite(code)) return;
  try {
    window.localStorage.setItem(LOCAL_WEATHER_READING_KEY, JSON.stringify({ locationKey, code, at: Date.now() }));
    window.dispatchEvent(new Event(LOCAL_WEATHER_READING_EVENT));
  } catch { /* An optional effect must not interrupt the weather widget. */ }
}

export function readLocalWeatherCode(storage: Pick<Storage, "getItem">, now = Date.now()): LocalWeatherCode {
  const location = getStoredCurrentLocationPreference(storage, now);
  if (!location.useForAnswers || !location.snapshot) return "off";
  try {
    const value = JSON.parse(storage.getItem(LOCAL_WEATHER_READING_KEY) ?? "null");
    const { latitude, longitude } = location.snapshot;
    if (value?.locationKey === `${latitude},${longitude}` && Number.isInteger(value.code)
      && Number.isFinite(value.at) && value.at <= now && now - value.at < LOCAL_WEATHER_RETAIN_MS) return value.code;
  } catch { /* Wait for the dock to publish a valid reading. */ }
  return "waiting";
}

/** WMO rain/drizzle/showers and thunderstorms; snow and fog stay dry. */
export function localRainIntensity(code: LocalWeatherCode): "none" | "light" | "steady" | "heavy" {
  if (typeof code !== "number") return "none";
  if ([51, 53, 55, 56, 57, 61, 80].includes(code)) return "light";
  if ([63, 66, 81].includes(code)) return "steady";
  return [65, 67, 82, 95, 96, 99].includes(code) ? "heavy" : "none";
}
