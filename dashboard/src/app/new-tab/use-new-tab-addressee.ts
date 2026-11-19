"use client";

import { useEffect, useState } from "react";
import { getStoredCurrentLocationPreference } from "@/lib/current-location";
import {
  cachedGreetingActivity,
  cachedGreetingWeather,
  greetingCalendar,
  greetingHour,
  normalizeGreetingActivity,
  normalizeGreetingWeather,
  pickNewTabAddressee,
  type GreetingActivity,
  type GreetingWeather,
} from "./new-tab-greetings";

export function useNewTabAddressee(initial: string, ownerKey: string): string {
  const [addressee, setAddressee] = useState(initial);

  useEffect(() => {
    const controller = new AbortController();
    const historyKey = `breadboard:new-tab-greetings:${ownerKey}`;
    const weatherKey = `breadboard:new-tab-weather:${ownerKey}`;
    const activityKey = `breadboard:new-tab-activity:${ownerKey}`;
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

      let activity: GreetingActivity | null = null;
      try {
        activity = cachedGreetingActivity(JSON.parse(storage.getItem(activityKey) ?? "null"), now.getTime());
      } catch { /* Activity is an optional flavour. */ }
      // Like weather, activity read now only flavours the next tab's greeting.
      if (!activity) {
        void fetch("/api/new-tab/greeting-activity", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
        }).then(async (response) => {
          if (!response.ok || controller.signal.aborted) return;
          const body = await response.json() as { activity?: unknown };
          window.localStorage.setItem(activityKey, JSON.stringify({ readAt: Date.now(), activity: normalizeGreetingActivity(body.activity) }));
        }).catch(() => { /* Screen Time off or offline: no activity nod. */ });
      }

      const next = pickNewTabAddressee({
        hour: greetingHour(now, location?.timeZone),
        ...greetingCalendar(now, location?.timeZone),
        location,
        weather,
        activity,
      }, recent);
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
