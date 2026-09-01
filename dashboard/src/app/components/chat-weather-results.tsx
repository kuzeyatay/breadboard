'use client';

import { memo, type ReactNode } from 'react';

// Native renderer for the ```weather-results contract emitted after the
// weather_forecast tool runs. The parser is deliberately tolerant while a
// response streams: incomplete JSON renders nothing, never a code wall.

interface WeatherDay {
  date: string;
  temperatureC: number;
  minC: number;
  maxC: number;
  code: number;
  condition: string;
  isDay: boolean;
}

interface WeatherResults {
  location: string;
  country: string;
  timezone: string;
  days: WeatherDay[];
}

const MAX_DAYS = 10;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asString(value: unknown, maxLength = 100): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parseWeatherResults(code: string): WeatherResults | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(code.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const location = asString(record.location);
  if (!location || !Array.isArray(record.days)) return null;

  const days = record.days
    .flatMap((value): WeatherDay[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const raw = value as Record<string, unknown>;
      const date = asString(raw.date, 10);
      const temperatureC = finiteNumber(raw.temperatureC);
      const minC = finiteNumber(raw.minC);
      const maxC = finiteNumber(raw.maxC);
      const code = finiteNumber(raw.code);
      const condition = asString(raw.condition, 60);
      if (
        !ISO_DATE.test(date) ||
        temperatureC === null ||
        minC === null ||
        maxC === null ||
        code === null ||
        !condition
      ) {
        return [];
      }
      return [{
        date,
        temperatureC,
        minC,
        maxC,
        code: Math.round(code),
        condition,
        isDay: raw.isDay !== false,
      }];
    })
    .slice(0, MAX_DAYS);

  if (days.length === 0) return null;
  return {
    location,
    country: asString(record.country),
    timezone: asString(record.timezone),
    days,
  };
}

function displayTemperature(value: number): string {
  return `${Math.round(value)}°`;
}

function dateLabel(date: string): string {
  const instant = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(instant.getTime())) return date;
  return new Intl.DateTimeFormat('en', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(instant);
}

type WeatherKind = 'clear' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm';

function weatherKind(code: number): WeatherKind {
  if (code === 0) return 'clear';
  if (code <= 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'rain';
}

function SunIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="8" fill="currentColor" />
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3">
        <path d="M24 4v5M24 39v5M4 24h5M39 24h5M9.9 9.9l3.5 3.5M34.6 34.6l3.5 3.5M38.1 9.9l-3.5 3.5M13.4 34.6l-3.5 3.5" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path
        d="M36.7 31.8A16.2 16.2 0 0 1 16.2 11.3 17.3 17.3 0 1 0 36.7 31.8Z"
        fill="currentColor"
      />
      <path d="m34.5 8 .9 2.7 2.6.9-2.6.9-.9 2.7-.9-2.7-2.6-.9 2.6-.9.9-2.7Z" fill="currentColor" />
    </svg>
  );
}

function CloudShape({ x = 0, y = 0 }: { x?: number; y?: number }) {
  return (
    <path
      d={`M${10 + x} ${32 + y}h25.5a7.5 7.5 0 0 0 .4-15 12 12 0 0 0-22.7 3.1A6 6 0 0 0 ${10 + x} ${32 + y}Z`}
      fill="currentColor"
    />
  );
}

function CloudIcon() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><CloudShape /></svg>;
}

function RainIcon({ snow = false }: { snow?: boolean }) {
  return (
    <svg viewBox="0 0 48 52" aria-hidden="true">
      <CloudShape y={-5} />
      {snow ? (
        <g fill="currentColor">
          <circle cx="16" cy="40" r="2" /><circle cx="25" cy="44" r="2" /><circle cx="34" cy="40" r="2" />
        </g>
      ) : (
        <g stroke="currentColor" strokeLinecap="round" strokeWidth="3">
          <path d="m17 39-2 5M26 39l-2 5M35 39l-2 5" />
        </g>
      )}
    </svg>
  );
}

function StormIcon() {
  return (
    <svg viewBox="0 0 48 54" aria-hidden="true">
      <CloudShape y={-6} />
      <path d="m28 34-7 10h6l-3 8 10-13h-6l4-5Z" fill="currentColor" />
    </svg>
  );
}

function FogIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <CloudShape y={-8} />
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3">
        <path d="M9 36h30M14 43h24" />
      </g>
    </svg>
  );
}

function WeatherIcon({ kind, isDay }: { kind: WeatherKind; isDay: boolean }): ReactNode {
  if (kind === 'clear') return isDay ? <SunIcon /> : <MoonIcon />;
  if (kind === 'cloud') return <CloudIcon />;
  if (kind === 'fog') return <FogIcon />;
  if (kind === 'snow') return <RainIcon snow />;
  if (kind === 'storm') return <StormIcon />;
  return <RainIcon />;
}

function LocationArrow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m20.4 3.6-7 16.1a1 1 0 0 1-1.9-.1l-1.7-6.3-6.3-1.7a1 1 0 0 1-.1-1.9l16.1-7a.7.7 0 0 1 .9.9Z" fill="currentColor" />
    </svg>
  );
}

function WeatherCard({
  place,
  accessiblePlace,
  day,
}: {
  place: string;
  accessiblePlace: string;
  day: WeatherDay;
}) {
  const kind = weatherKind(day.code);
  const accessible = `${accessiblePlace}, ${dateLabel(day.date)}: ${day.condition}, ${displayTemperature(day.temperatureC)}, high ${displayTemperature(day.maxC)}, low ${displayTemperature(day.minC)}`;

  return (
    <article
      className="chat-weather-card"
      data-weather-kind={kind}
      data-daylight={day.isDay ? 'day' : 'night'}
      aria-label={accessible}
    >
      <div className="chat-weather-card-left">
        <div className="chat-weather-location">
          <strong>{place}</strong>
          <span className="chat-weather-location-arrow"><LocationArrow /></span>
        </div>
        <time dateTime={day.date}>{dateLabel(day.date)}</time>
        <span className="chat-weather-temperature" aria-hidden="true">
          {displayTemperature(day.temperatureC)}
        </span>
      </div>
      <div className="chat-weather-card-right" aria-hidden="true">
        <span className="chat-weather-icon"><WeatherIcon kind={kind} isDay={day.isDay} /></span>
        <span className="chat-weather-condition">{day.condition}</span>
        <span className="chat-weather-range">
          H:{displayTemperature(day.maxC)} <span>L:{displayTemperature(day.minC)}</span>
        </span>
      </div>
    </article>
  );
}

function ChatWeatherResults({ code }: { code: string }) {
  const results = parseWeatherResults(code);
  if (!results) return null;
  const accessiblePlace = results.country && !results.location.toLowerCase().includes(results.country.toLowerCase())
    ? `${results.location}, ${results.country}`
    : results.location;

  return (
    <section
      className="chat-weather-results"
      aria-label={`Weather forecast for ${accessiblePlace}`}
      data-selection-exclude
    >
      {results.days.map((day) => (
        <WeatherCard
          key={day.date}
          place={results.location}
          accessiblePlace={accessiblePlace}
          day={day}
        />
      ))}
    </section>
  );
}

export default memo(ChatWeatherResults, (previous, next) => previous.code === next.code);
