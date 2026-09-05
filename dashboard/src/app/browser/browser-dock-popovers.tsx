"use client";

import * as Popover from "@radix-ui/react-popover";
import { BatteryCharging, CalendarDays, Clock3, CloudSun, Globe2, Laptop, Moon, Plus, Search, Sun, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { WeatherIcon, weatherKind } from "@/app/components/weather-icon";
import { batteryDuration, DEFAULT_CITY_IDS, MAX_WORLD_CITIES, normalizeCityIds, WORLD_CITIES, worldClock, type DockBattery, type DockNetwork, type DockWeather, type WorldCity } from "./browser-dock-data";
import styles from "./browser-dock-popovers.module.css";

export type DockPanel = "time" | "weather" | "network" | "battery" | "spotify" | "calendar";
const CITY_STORAGE_KEY = "breadboard:world-cities:v1";
const CITY_CHANGE_EVENT = "breadboard:world-cities-change";

export function useWorldCities() {
  const [ids, setIds] = useState<string[]>(DEFAULT_CITY_IDS);
  useEffect(() => {
    const read = () => {
      try {
        const stored = window.localStorage.getItem(CITY_STORAGE_KEY);
        setIds(stored === null ? [...DEFAULT_CITY_IDS] : normalizeCityIds(JSON.parse(stored)));
      } catch { /* Keep the default cities when storage is unavailable. */ }
    };
    read();
    window.addEventListener("storage", read);
    window.addEventListener(CITY_CHANGE_EVENT, read);
    return () => {
      window.removeEventListener("storage", read);
      window.removeEventListener(CITY_CHANGE_EVENT, read);
    };
  }, []);
  const save = (next: string[]) => {
    const normalized = normalizeCityIds(next);
    setIds(normalized);
    try {
      window.localStorage.setItem(CITY_STORAGE_KEY, JSON.stringify(normalized));
      window.dispatchEvent(new Event(CITY_CHANGE_EVENT));
    } catch { /* City selection still works for this session. */ }
  };
  const cities = useMemo(() => ids.flatMap((id) => WORLD_CITIES.filter((city) => city.id === id)), [ids]);
  return { cities, save };
}

const PANEL_META = {
  time: { title: "World clocks", subtitle: "Local times across your cities.", Icon: Clock3 },
  weather: { title: "World weather", subtitle: "Current conditions around the world.", Icon: CloudSun },
  network: { title: "Your connection", subtitle: "Network status and connection estimates.", Icon: Globe2 },
  battery: { title: "Battery", subtitle: "Charge status and remaining power.", Icon: BatteryCharging },
  calendar: { title: "Calendar", subtitle: "Your upcoming events this week.", Icon: CalendarDays },
};

export function DockPopover({ panel, open, onOpenChange, trigger, children }: {
  panel: Exclude<DockPanel, "spotify">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  const [pointerOpened, setPointerOpened] = useState(false);
  const { title, subtitle, Icon } = PANEL_META[panel];
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild data-dock-popup-trigger onPointerDown={() => setPointerOpened(true)} onKeyDown={() => setPointerOpened(false)}>
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={styles.popover} side="top" align="start" sideOffset={18} collisionPadding={{ top: 48, bottom: 16, left: 16, right: 16 }}
          aria-labelledby={headingId} data-panel={panel} data-motion={pointerOpened}
          onInteractOutside={(event) => {
            // The shared dock state switches panels; outside-dismissal must not
            // consume the click that opens a neighboring widget.
            if (event.target instanceof Element && event.target.closest("[data-dock-popup-trigger]")) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            if (document.querySelector('[data-dock-popup-trigger][aria-expanded="true"]')) event.preventDefault();
          }}
          onOpenAutoFocus={(event) => {
            // Keep the city search from grabbing the keyboard on a pointer click.
            if (pointerOpened) event.preventDefault();
          }}
        >
          <header className={styles.header}>
            <span className={styles.headingIcon}><Icon aria-hidden="true" /></span>
            <div><h2 id={headingId}>{title}</h2><p>{subtitle}</p></div>
            <Popover.Close className={styles.iconButton} aria-label={`Close ${title}`}><X aria-hidden="true" /></Popover.Close>
          </header>
          <div className={styles.body}>{children}</div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CitySearch({ cities, save, query, setQuery }: {
  cities: WorldCity[]; save: (ids: string[]) => void; query: string; setQuery: (query: string) => void;
}) {
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  const matches = WORLD_CITIES.filter((city) =>
    !cities.some((saved) => saved.id === city.id) && normalize(`${city.name} ${city.country}`).includes(normalize(query.trim())),
  );
  return (
    <>
      <label className={styles.search}>
        <Search aria-hidden="true" />
        <input aria-label="Find a city to add" placeholder="Add a city…" value={query} onChange={(event) => setQuery(event.target.value)} />
        {query && <button type="button" className={styles.iconButton} onClick={() => setQuery("")} aria-label="Clear city search"><X /></button>}
      </label>
      {query.trim() && <div className={styles.searchResults} aria-label="Matching cities">
        {cities.length >= MAX_WORLD_CITIES ? <p className={styles.note}>You have eight cities. Remove one to add another.</p> : matches.length ? matches.map((city) => (
          <button key={city.id} type="button" className={styles.cityOption} onClick={() => { save([...cities.map((item) => item.id), city.id]); setQuery(""); }} aria-label={`Add ${city.name}`}>
            <span><strong>{city.name}</strong><small>{city.country}</small></span><Plus aria-hidden="true" />
          </button>
        )) : <p className={styles.note}>No new cities found. Try another city or country.</p>}
      </div>}
    </>
  );
}

function RemoveCity({ city, cities, save }: { city: WorldCity; cities: WorldCity[]; save: (ids: string[]) => void }) {
  return <button type="button" className={styles.removeCity} aria-label={`Remove ${city.name}`} onClick={() => save(cities.filter((item) => item.id !== city.id).map((item) => item.id))}><X aria-hidden="true" /></button>;
}

export function WorldClocks({ now, cities, save }: { now: Date | null; cities: WorldCity[]; save: (ids: string[]) => void }) {
  const [query, setQuery] = useState("");
  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return <>
    <div className={styles.clockHero}>
      <div><span className={styles.eyebrow}>Your time</span><strong>{now?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) ?? "--:--"}</strong></div>
      <span>{now?.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}<small>{localTimezone.replaceAll("_", " ")}</small></span>
    </div>
    <CitySearch cities={cities} save={save} query={query} setQuery={setQuery} />
    {!query.trim() && <div className={styles.cityList} aria-label="Saved world clocks">
      {cities.map((city) => {
        const clock = now ? worldClock(now, city.timezone, localTimezone) : null;
        return <div className={styles.cityRow} key={city.id}>
          <span className={styles.dayIcon} data-day={clock?.daytime}>{clock?.daytime ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}</span>
          <div className={styles.cityName}><strong>{city.name}</strong><small>{clock?.day} · {clock?.difference}</small></div>
          <time className={styles.cityTime} title={clock?.date}>{clock?.time ?? "--:--"}</time>
          <RemoveCity city={city} cities={cities} save={save} />
        </div>;
      })}
      {!cities.length && <p className={styles.note}>Add your first city above to keep its time close.</p>}
    </div>}
    <footer className={styles.footer}>Your cities are shared with World weather.</footer>
  </>;
}

const weatherCache = new Map<string, { reading: DockWeather; at: number }>();

function useWorldWeather(cities: WorldCity[]) {
  const [readings, setReadings] = useState<Record<string, DockWeather | "unavailable">>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    void Promise.all(cities.map(async (city) => {
      const cached = weatherCache.get(city.id);
      if (cached && Date.now() - cached.at < 10 * 60_000) {
        setReadings((previous) => ({ ...previous, [city.id]: cached.reading }));
        return;
      }
      try {
        const url = new URL("/api/browser/weather", window.location.origin);
        url.searchParams.set("latitude", String(city.latitude));
        url.searchParams.set("longitude", String(city.longitude));
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Weather unavailable");
        const reading = await response.json() as DockWeather;
        if (!Number.isFinite(reading.temperatureC) || !Number.isFinite(reading.code)) throw new Error("Incomplete weather");
        weatherCache.set(city.id, { reading, at: Date.now() });
        if (!controller.signal.aborted) setReadings((previous) => ({ ...previous, [city.id]: reading }));
      } catch {
        if (!cancelled) setReadings((previous) => ({ ...previous, [city.id]: "unavailable" }));
      }
    })).finally(() => window.clearTimeout(timeout));
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timeout); };
  }, [cities, attempt]);
  useEffect(() => {
    const timer = window.setInterval(() => setAttempt((value) => value + 1), 10 * 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return { readings, retry: () => { setReadings({}); setAttempt((value) => value + 1); } };
}

export function WorldWeather({ cities, save, localWeather }: { cities: WorldCity[]; save: (ids: string[]) => void; localWeather: DockWeather | null }) {
  const [query, setQuery] = useState("");
  const { readings, retry } = useWorldWeather(cities);
  const weatherRow = (name: string, reading: DockWeather | "unavailable" | undefined, city?: WorldCity) => {
    const weather = reading && reading !== "unavailable" ? reading : null;
    return <div key={city?.id ?? "local"} className={styles.weatherRow} data-day={weather?.isDay}>
      <div className={styles.cityName}><strong>{name}</strong><small>{weather?.condition ?? (reading === "unavailable" ? "Unavailable right now" : "Getting weather…")}</small>{weather && <small>Feels like {weather.apparentC}°</small>}</div>
      <span className={styles.weatherIcon}>{weather ? <WeatherIcon kind={weatherKind(weather.code)} isDay={weather.isDay} /> : <CloudSun aria-hidden="true" />}</span>
      <strong className={styles.weatherTemperature}>{weather ? `${weather.temperatureC}°` : "–°"}</strong>
      {city && <RemoveCity city={city} cities={cities} save={save} />}
    </div>;
  };
  return <>
    <CitySearch cities={cities} save={save} query={query} setQuery={setQuery} />
    {!query.trim() && <div className={styles.weatherList} aria-label="Weather in saved cities">
      {localWeather && weatherRow("Your location", localWeather)}
      {cities.map((city) => weatherRow(city.name, readings[city.id], city))}
      {!cities.length && <p className={styles.note}>Add a city above to see its weather.</p>}
    </div>}
    {cities.some((city) => readings[city.id] === "unavailable") && <button type="button" className={styles.action} onClick={retry}>Retry unavailable weather</button>}
    <footer className={styles.footer}><span>Current conditions · °C</span><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather by Open-Meteo</a></footer>
  </>;
}

export function BatteryDetails({ battery }: { battery: DockBattery | null }) {
  const low = Boolean(battery && battery.percent <= 20 && !battery.charging);
  const full = battery?.percent === 100;
  return <>
    <div className={styles.batteryHero} data-low={low}>
      <div className={styles.batteryGauge} style={{ "--charge": `${battery?.percent ?? 0}%` } as CSSProperties}><span />{battery?.charging ? <BatteryCharging aria-hidden="true" /> : <Laptop aria-hidden="true" />}</div>
      <strong>{battery ? `${battery.percent}%` : "—"}</strong>
      <span>{!battery ? "Battery reading unavailable" : full ? "Fully charged" : battery.charging ? "Charging up" : low ? "Running low" : "On battery power"}</span>
    </div>
    <dl className={styles.stats}>
      <div><dt>Power source</dt><dd>{battery ? battery.charging ? "Plugged in" : "Battery" : "Not available"}</dd></div>
      <div><dt>{battery?.charging ? "Time until full" : "Estimated time left"}</dt><dd>{battery?.charging && full ? "Fully charged" : batteryDuration(battery ? battery.charging ? battery.chargingTime : battery.dischargingTime : null)}</dd></div>
    </dl>
    <div className={styles.tip}><strong>{low ? "Time to plug in" : "Make your charge last"}</strong><p>{low ? "Connect your charger when you can. Lowering brightness can help stretch the remaining charge." : "Lower your screen brightness and pause video or music when you don’t need it."}</p></div>
    <footer className={styles.footer}>{battery ? "Time estimates appear when your device provides them." : "This device isn’t sharing battery information."}</footer>
  </>;
}

export function NetworkDetails({ network }: { network: DockNetwork }) {
  const [check, setCheck] = useState<{ state: "idle" | "checking" | "ready" | "failed"; ms?: number }>({ state: "idle" });
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); requestRef.current = null; }, []);
  const checkConnection = async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 5_000);
    setCheck({ state: "checking" });
    const started = performance.now();
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("App unreachable");
      await response.json();
      if (requestRef.current === controller) setCheck({ state: "ready", ms: Math.round(performance.now() - started) });
    } catch {
      if (requestRef.current === controller) setCheck({ state: "failed" });
    } finally { window.clearTimeout(timeout); }
  };
  return <>
    <div className={styles.networkHero} data-online={network.online}>
      <strong><span className={styles.networkStatusDot} aria-hidden="true" />{network.online ? "You’re online" : "You’re offline"}</strong>
      <p>{network.online ? "Your device reports a network connection." : "Reconnect to Wi-Fi or check your network cable."}</p>
    </div>
    <dl className={styles.networkStats}>
      <div><dt>Estimated quality</dt><dd>{network.online && network.effectiveType ? `${network.effectiveType} equivalent` : "Not available"}</dd></div>
      <div><dt>Download estimate</dt><dd>{network.online && network.downlink !== null ? `${network.downlink} Mbps` : "Not available"}</dd></div>
      <div><dt>Latency estimate</dt><dd>{network.online && network.rtt !== null ? `${network.rtt} ms` : "Not available"}</dd></div>
      <div><dt>Data saver</dt><dd>{network.saveData === null ? "Not available" : network.saveData ? "On" : "Off"}</dd></div>
    </dl>
    <div className={styles.connectionCheck}>
      <div><strong>Breadboard reachability</strong><p role="status">{check.state === "checking" ? "Checking app response…" : check.state === "ready" ? `Responded in ${check.ms} ms` : check.state === "failed" ? "No response. Try again in a moment." : "See how quickly the app responds."}</p></div>
      <button type="button" className={styles.action} onClick={() => void checkConnection()} disabled={check.state === "checking"}>{check.state === "checking" ? "Checking…" : "Check now"}</button>
    </div>
    <footer className={styles.footer}>Device estimates, not a speed test. The check measures this app’s response.</footer>
  </>;
}
