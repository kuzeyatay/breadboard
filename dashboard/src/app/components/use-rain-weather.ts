"use client";

import { useSyncExternalStore } from "react";
import { subscribeCurrentLocation } from "@/lib/current-location";
import { LOCAL_WEATHER_READING_EVENT, LOCAL_WEATHER_READING_KEY, readLocalWeatherCode, type LocalWeatherCode } from "@/lib/local-weather-reading";

function subscribe(changed: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === null || event.key === LOCAL_WEATHER_READING_KEY) changed(); };
  const unsubscribeLocation = subscribeCurrentLocation(changed);
  window.addEventListener("storage", storage);
  window.addEventListener(LOCAL_WEATHER_READING_EVENT, changed);
  document.addEventListener("visibilitychange", changed);
  // Expire old readings even if a weather request is unavailable for a while.
  const expiry = window.setInterval(changed, 60_000);
  return () => {
    unsubscribeLocation();
    window.removeEventListener("storage", storage);
    window.removeEventListener(LOCAL_WEATHER_READING_EVENT, changed);
    document.removeEventListener("visibilitychange", changed);
    window.clearInterval(expiry);
  };
}
const waiting = (): LocalWeatherCode => "waiting";
const read = () => {
  try { return readLocalWeatherCode(window.localStorage); } catch { return "waiting" as const; }
};
const idle = () => () => {};

export function useRainWeather(enabled: boolean) {
  return useSyncExternalStore(enabled ? subscribe : idle, enabled ? read : waiting, waiting);
}
