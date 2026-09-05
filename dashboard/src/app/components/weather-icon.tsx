import type { ReactNode } from "react";

// Shared weather artwork for chat forecasts and the browser dock.
type WeatherKind = 'clear' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm';

export function weatherKind(code: number): WeatherKind {
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

export function WeatherIcon({ kind, isDay }: { kind: WeatherKind; isDay: boolean }): ReactNode {
  if (kind === 'clear') return isDay ? <SunIcon /> : <MoonIcon />;
  if (kind === 'cloud') return <CloudIcon />;
  if (kind === 'fog') return <FogIcon />;
  if (kind === 'snow') return <RainIcon snow />;
  if (kind === 'storm') return <StormIcon />;
  return <RainIcon />;
}

