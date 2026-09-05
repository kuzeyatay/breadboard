'use client';

import { memo } from 'react';
import { WeatherIcon, weatherKind } from './weather-icon';

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
