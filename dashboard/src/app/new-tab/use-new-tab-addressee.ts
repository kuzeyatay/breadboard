"use client";

import { useEffect, useState } from "react";
import { getStoredCurrentLocationPreference } from "@/lib/current-location";
import {
  cachedGreetingWeather,
  greetingHour,
  normalizeGreetingWeather,
  pickNewTabAddressee,
  type GreetingWeather,
} from "./new-tab-greetings";

export function useNewTabAddressee(initial: string, ownerKey: string): string {
  const [addressee, setAddressee] = useState(initial);

  useEffect(() => {
    const controller = new AbortController();
    const historyKey = `breadboard:new-tab-greetings:${ownerKey}`;
    const weatherKey = `breadboard:new-tab-weather:${ownerKey}`;
    const storage = {
      getItem: (key: string) => window.localStorage.getItem(key),
    };
    const frame = window.requestAnimationFrame(() => {
      const now = new Date();
      const preference = getStoredCurrentLocationPreference(storage, now);
      const location = preference.state === "available" ? preference.snapshot : null;
      let recent: string[] = [];
      let weather: GreetingWeather | null = null;
      try {
        const stored = JSON.parse(storage.getItem(historyKey) ?? "[]");
        if (Array.isArray(stored)) recent = stored.filter((value): value is string => typeof value === "string").slice(-8);
      } catch { /* Nicknames still work with browser storage turned off. */ }
      try {
        weather = cachedGreetingWeather(JSON.parse(storage.getItem(weatherKey) ?? "null"), location, now.getTime());
      } catch { /* Missing weather simply leaves time and general nicknames. */ }

      const next = pickNewTabAddressee({ hour: greetingHour(now, location?.timeZone), location, weather }, recent);
      setAddressee(next);
      try {
        window.localStorage.setItem(historyKey, JSON.stringify([...recent, next].slice(-8)));
      } catch { /* Recent-repeat avoidance is optional. */ }

      // Warm current weather for subsequent tabs. The greeting already on
      // screen never changes when a slow response arrives or the clock ticks.
      if (!location || weather) return;
      const url = new URL("/api/browser/weather", window.location.origin);
      url.searchParams.set("latitude", String(location.latitude));
      url.searchParams.set("longitude", String(location.longitude));
      void fetch(url, {
        cache: "default",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
      }).then(async (response) => {
        if (!response.ok) return;
        const freshWeather = normalizeGreetingWeather(await response.json());
        const current = getStoredCurrentLocationPreference(storage);
        if (!freshWeather || controller.signal.aborted || current.state !== "available" ||
            current.snapshot?.latitude !== location.latitude || current.snapshot?.longitude !== location.longitude) return;
        window.localStorage.setItem(weatherKey, JSON.stringify({
          latitude: location.latitude,
          longitude: location.longitude,
          readAt: Date.now(),
          weather: freshWeather,
        }));
      }).catch(() => { /* An unavailable forecast never delays the launcher. */ });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [initial, ownerKey]);

  return addressee;
}
