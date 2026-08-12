"use client";

// The climate column: what is measured, what the weather is doing at the hubs
// on the map, and what is currently alerted.
//
// The rest of the console is reportage — somebody said something happened. This
// panel is instruments, so every number carries the archive it came from and
// the day it was observed, and nothing here is written by a model.

import { useEffect, useState } from "react";

import { localClock, partOfDay } from "@/lib/worldmonitor/weather.ts";
import type {
  ClimateIndicator,
  ClimateSnapshot,
  HazardEvent,
  HubWeather,
} from "@/lib/worldmonitor/types.ts";

/** Hub clocks tick on their own so the tab is right to the minute while open. */
const CLOCK_TICK_MS = 10_000;

const HAZARD_LABELS: Record<HazardEvent["kind"], string> = {
  cyclone: "Cyclone",
  flood: "Flood",
  drought: "Drought",
  wildfire: "Wildfire",
  earthquake: "Quake",
  volcano: "Volcano",
  other: "Alert",
};

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" />
      <path strokeLinecap="round" d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </svg>
  );
}

function TrendArrow({ direction }: { direction: "up" | "down" }) {
  return (
    <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true">
      {direction === "up" ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M6 11l6-6 6 6" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M6 13l6 6 6-6" />
      )}
    </svg>
  );
}

function relative(iso: string, now: number): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 60) return `${Math.max(0, minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** "2026-08-04" → "4 Aug", which is all the date a tile has room for. */
function shortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getUTCDate()} ${date.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`;
}

function IndicatorTile({ indicator }: { indicator: ClimateIndicator }) {
  const change = indicator.change;
  const hasChange = typeof change === "number" && change !== 0;
  // "Bad" is the direction the series is not supposed to go: more CO₂, less ice.
  const worrying =
    hasChange && (indicator.concern === "up" ? change > 0 : change < 0);

  return (
    <a
      href={indicator.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="bb-wm-metric neu-surface block rounded-lg border p-1.5"
      title={`${indicator.detail ?? ""}\n${indicator.source} — observed ${indicator.asOf}`}
    >
      <span className="block truncate text-[0.6rem] tracking-wide bb-wm-ink-muted uppercase">
        {indicator.label}
      </span>
      <span className="mt-0.5 flex items-baseline gap-1">
        <span className="bb-wm-metric-value font-mono text-[0.95rem] tabular-nums">
          {indicator.value.toFixed(indicator.unit === "ppb" ? 0 : 2)}
        </span>
        <span className="text-[0.6rem] bb-wm-ink-muted">{indicator.unit}</span>
      </span>
      <span className="mt-0.5 flex items-center gap-1 text-[0.58rem] bb-wm-ink-faint">
        {hasChange && (
          <span className={`bb-wm-change ${worrying ? "is-worrying" : "is-easing"}`}>
            <TrendArrow direction={change > 0 ? "up" : "down"} />
            {change > 0 ? "+" : ""}
            {change.toFixed(indicator.unit === "ppb" ? 0 : 2)}
          </span>
        )}
        <span className="truncate">{indicator.changeLabel ?? shortDate(indicator.asOf)}</span>
      </span>
    </a>
  );
}

function WeatherRow({
  entry,
  clockNow,
  selected,
  onSelect,
}: {
  entry: HubWeather;
  clockNow: number;
  selected: boolean;
  onSelect: () => void;
}) {
  // Re-derived from the offset rather than trusted from the payload: the
  // reading is up to fifteen minutes old, the clock must not be.
  const clock = localClock(entry.utcOffsetMinutes, clockNow);
  const flagged = entry.stress.kind !== "none";

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`bb-wm-clock-row ${selected ? "is-selected" : ""} flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left`}
        title={`${entry.timezone} · ${entry.conditions} · high ${entry.maxC}° / low ${entry.minC}°${flagged ? ` · ${entry.stress.note}` : ""}`}
      >
        <span
          className={`bb-wm-clock-face bb-wm-part-${partOfDay(clock.hour)} flex items-center gap-1 rounded-md px-1 py-0.5`}
        >
          <span className="bb-wm-ink-muted">{entry.isDay ? <SunIcon /> : <MoonIcon />}</span>
          <span className="font-mono text-[0.68rem] tabular-nums">{clock.time}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="bb-wm-ink block truncate text-[0.68rem] font-medium">{entry.name}</span>
          <span className="block truncate text-[0.58rem] bb-wm-ink-faint">
            {entry.conditions}
            {flagged ? ` · ${entry.stress.note}` : ""}
          </span>
        </span>
        {flagged && (
          <span
            className={`bb-wm-dot bb-wm-level-${entry.stress.level}`}
            aria-label={`${entry.stress.kind} stress`}
          />
        )}
        <span className="font-mono text-[0.72rem] bb-wm-ink tabular-nums">
          {Math.round(entry.temperatureC)}°
        </span>
      </button>
    </li>
  );
}

function HazardRow({ hazard, now }: { hazard: HazardEvent; now: number }) {
  return (
    <li className={`bb-wm-row neu-surface rounded-lg border bb-wm-level-${hazard.level}`}>
      <a
        href={hazard.link || undefined}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start gap-2 px-2 py-1.5"
        title={[
          hazard.severity,
          hazard.population,
          `began ${hazard.from.slice(0, 10)}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <span className={`bb-wm-dot mt-1 bb-wm-level-${hazard.level}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="bb-wm-ink block text-[0.7rem] leading-snug">{hazard.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.58rem] bb-wm-ink-muted">
            <span className="bb-wm-hazard-kind">{HAZARD_LABELS[hazard.kind]}</span>
            {hazard.country && <span className="truncate">{hazard.country}</span>}
            {/* Last revised, not started: a drought's start date says nothing
                about whether anyone has looked at it lately. */}
            <span>{relative(hazard.updated, now)}</span>
          </span>
        </span>
      </a>
    </li>
  );
}

export interface ClimatePanelProps {
  snapshot: ClimateSnapshot | null;
  loading: boolean;
  error: string | null;
  /** Only the alerts the map's hazard layers currently admit. */
  hazards: HazardEvent[];
  selectedHub: string | null;
  onSelectHub: (hubId: string | null) => void;
}

export default function ClimatePanel({
  snapshot,
  loading,
  error,
  hazards,
  selectedHub,
  onSelectHub,
}: ClimatePanelProps) {
  const [clockNow, setClockNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const weather = snapshot?.weather ?? [];
  const indicators = snapshot?.indicators ?? [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
      {error && (
        <p className="bb-wm-alert neu-surface mb-1.5 rounded-lg border px-2 py-1.5 text-[0.68rem]">
          {error}
        </p>
      )}

      {loading && !snapshot && (
        <p className="px-2 py-6 text-center text-xs bb-wm-ink-muted">Reading the instruments…</p>
      )}

      {indicators.length > 0 && (
        <>
          <p className="px-0.5 pb-1 text-[0.58rem] tracking-[0.1em] bb-wm-ink-muted uppercase">
            Global indicators
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-1.5">
            {indicators.map((indicator) => (
              <IndicatorTile key={indicator.id} indicator={indicator} />
            ))}
          </div>
        </>
      )}

      <p className="px-0.5 pt-2.5 pb-1 text-[0.58rem] tracking-[0.1em] bb-wm-ink-muted uppercase">
        Local time & conditions
        {weather.length > 0 && (
          <span className="ml-1.5 font-mono bb-wm-ink-faint tabular-nums">{weather.length}</span>
        )}
      </p>
      {weather.length === 0 ? (
        <p className="px-2 py-3 text-[0.66rem] bb-wm-ink-muted">
          {loading
            ? "Reading conditions…"
            : "No hubs pinned in the current window, so there is nowhere to read the clock."}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {weather.map((entry) => (
            <WeatherRow
              key={entry.hubId}
              entry={entry}
              clockNow={clockNow}
              selected={selectedHub === entry.hubId}
              onSelect={() => onSelectHub(selectedHub === entry.hubId ? null : entry.hubId)}
            />
          ))}
        </ul>
      )}

      <p className="px-0.5 pt-2.5 pb-1 text-[0.58rem] tracking-[0.1em] bb-wm-ink-muted uppercase">
        Hazard alerts
        {hazards.length > 0 && (
          <span className="ml-1.5 font-mono bb-wm-ink-faint tabular-nums">{hazards.length}</span>
        )}
      </p>
      {hazards.length === 0 ? (
        <p className="px-2 py-3 text-[0.66rem] bb-wm-ink-muted">
          {loading ? "Reading alerts…" : "No alerts of the selected kinds are current."}
        </p>
      ) : (
        <ul className="space-y-1">
          {hazards.slice(0, 60).map((hazard) => (
            <HazardRow key={hazard.id} hazard={hazard} now={clockNow} />
          ))}
        </ul>
      )}

      {snapshot && (
        <p className="px-0.5 pt-2.5 text-[0.56rem] leading-relaxed bb-wm-ink-faint">
          NOAA GML · NASA GISTEMP · NSIDC · Open-Meteo · GDACS. Measurements, not
          forecasts — each tile links to the archive it came from.
          {snapshot.notes.length > 0 && ` Not answering: ${snapshot.notes.join("; ")}.`}
        </p>
      )}
    </div>
  );
}
