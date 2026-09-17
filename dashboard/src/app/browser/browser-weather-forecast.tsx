"use client";

import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, Droplets, X } from "lucide-react";
import { useEffect, useId, useMemo, useState, useSyncExternalStore, type RefObject } from "react";
import { WeatherIcon, weatherKind } from "@/app/components/weather-icon";
import type { DockWeatherForecast } from "./browser-dock-data";
import styles from "./browser-dock-popovers.module.css";

const forecastCache = new Map<string, { forecast: DockWeatherForecast; at: number }>();
const CACHE_TTL = 10 * 60_000;

function cachedForecast(key: string) {
  const cached = forecastCache.get(key);
  return cached && Date.now() - cached.at < CACHE_TTL ? cached.forecast : null;
}

function subscribeViewport(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

export function WeatherForecastPopover({ name, latitude, longitude, pointerOpened, listRef }: {
  name: string; latitude: number; longitude: number; pointerOpened: boolean;
  listRef: RefObject<HTMLDivElement | null>;
}) {
  const headingId = useId();
  const compact = useSyncExternalStore(subscribeViewport, () => {
    const bounds = listRef.current?.closest('[data-panel="weather"]')?.getBoundingClientRect();
    const spaceNeeded = 390 + 12 + 16;
    return window.innerWidth < 900 || Boolean(bounds && bounds.left < spaceNeeded && window.innerWidth - bounds.right < spaceNeeded);
  }, () => false);
  const anchor = useMemo(() => ({ current: {
    getBoundingClientRect: () => compact
      ? new DOMRect(window.innerWidth / 2, 48, 0, 0)
      : listRef.current?.closest('[data-panel="weather"]')?.getBoundingClientRect() ?? new DOMRect(),
  } }), [compact, listRef]);
  const cacheKey = `${latitude},${longitude}`;
  const [forecast, setForecast] = useState(() => cachedForecast(cacheKey));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (cachedForecast(cacheKey)) return;
    const controller = new AbortController();
    let cancelled = false;
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    const load = async () => {
      try {
        const url = new URL("/api/browser/weather", window.location.origin);
        url.searchParams.set("latitude", String(latitude));
        url.searchParams.set("longitude", String(longitude));
        url.searchParams.set("forecast", "7");
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Forecast unavailable");
        const next = await response.json() as DockWeatherForecast;
        if (!Array.isArray(next.days) || next.days.length !== 7) throw new Error("Incomplete forecast");
        if (cancelled || controller.signal.aborted) return;
        forecastCache.set(cacheKey, { forecast: next, at: Date.now() });
        if (forecastCache.size > 32) forecastCache.delete(forecastCache.keys().next().value!);
        setForecast(next);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        window.clearTimeout(timeout);
      }
    };
    void load();
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timeout); };
  }, [latitude, longitude, cacheKey, attempt]);

  return <>
    <Popover.Anchor virtualRef={anchor} />
    <Popover.Portal>
      <Popover.Content
        className={`${styles.popover} ${styles.forecastPopover}`}
        side={compact ? "bottom" : "right"} align={compact ? "center" : "start"} sideOffset={compact ? 0 : 12}
        collisionPadding={{ top: 48, bottom: 16, left: 16, right: 16 }}
        aria-labelledby={headingId} data-weather-forecast
        onOpenAutoFocus={(event) => { if (pointerOpened) event.preventDefault(); }}
        onInteractOutside={(event) => {
          // Let another city trigger switch the selection without closing the list.
          if (event.target instanceof Element && event.target.closest("[data-weather-location-trigger]")) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (document.querySelector('[data-weather-location-trigger][aria-expanded="true"]')) event.preventDefault();
        }}
      >
        <header className={styles.header}>
          <span className={styles.headingIcon}><CalendarDays aria-hidden="true" /></span>
          <div><h2 id={headingId}>{name}</h2><p>7-day forecast</p></div>
          <Popover.Close className={styles.iconButton} aria-label={`Close forecast for ${name}`}><X aria-hidden="true" /></Popover.Close>
        </header>
        <div className={styles.body} aria-busy={!forecast && !failed}>
          {forecast ? <ol className={styles.forecastDays} aria-label={`Seven-day forecast for ${name}`}>
            {forecast.days.map((day) => {
              // Daily dates are local to the selected city; UTC formatting keeps
              // their calendar day intact regardless of the viewer's timezone.
              const date = new Date(`${day.date}T12:00:00Z`);
              return <li key={day.date} className={styles.forecastDay}>
                <time dateTime={day.date}>
                  <strong>{date.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })}</strong>
                  <small>{date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}</small>
                </time>
                <span className={styles.forecastIcon}><WeatherIcon kind={weatherKind(day.code)} isDay /></span>
                <span className={styles.forecastCondition}>
                  <span>{day.condition}</span>
                  {day.precipitationChance !== null && <small aria-label={`${day.precipitationChance}% chance of precipitation`}><Droplets aria-hidden="true" />{day.precipitationChance}%</small>}
                </span>
                <span className={styles.forecastTemperatures} aria-label={`High ${day.maxC}°C, low ${day.minC}°C`}>
                  <strong>{day.maxC}°</strong><span>{day.minC}°</span>
                </span>
              </li>;
            })}
          </ol> : failed ? <div role="alert">
            <p className={styles.note}>The forecast is unavailable right now.</p>
            <button type="button" className={styles.action} onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>Retry forecast</button>
          </div> : <p className={styles.note} role="status">Getting the seven-day forecast…</p>}
          <footer className={styles.footer}><span>Daily high / low · °C</span><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a></footer>
        </div>
      </Popover.Content>
    </Popover.Portal>
  </>;
}
