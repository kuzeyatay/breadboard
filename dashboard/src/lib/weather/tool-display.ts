import type { WeatherForecastDisplay } from './forecast.ts';

type ToolEvidence = { success: boolean; details: Record<string, unknown> };
const WEATHER_BLOCK = /(?:^|\n)[ \t]{0,3}(`{3,}|~{3,})weather-results[^\n]*\n[\s\S]*?\n[ \t]{0,3}\1[ \t]*(?=\n|$)/gi;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max && !/[\r\n]/u.test(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function toolDisplay(value: unknown): WeatherForecastDisplay | null {
  if (typeof value === 'string') {
    if (value.length > 128_000) return null;
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!record(value) || value.error || value.success === false || value.ok === false) return null;
  const display = value.display;
  if (!record(display) || !text(display.location, 200) || !display.location.trim()
    || !text(display.country, 200) || !text(display.timezone, 100)
    || !Array.isArray(display.days) || !display.days.length || display.days.length > 10) return null;
  const days: WeatherForecastDisplay['days'] = [];
  for (const day of display.days) {
    if (!record(day) || !text(day.date, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)
      || !finite(day.temperatureC) || !finite(day.minC) || !finite(day.maxC)
      || !finite(day.code) || !text(day.condition, 100) || !day.condition.trim()
      || typeof day.isDay !== 'boolean') return null;
    days.push({ date: day.date, temperatureC: day.temperatureC, minC: day.minC,
      maxC: day.maxC, code: day.code, condition: day.condition, isDay: day.isDay });
  }
  return { location: display.location, country: display.country, timezone: display.timezone, days };
}

/** Materialize the existing weather renderer contract from this turn's successful
 * tool output. The model need not copy JSON, and cannot change its quantities.
 * Call only when a turn completes successfully, before both emission and saving. */
export function appendWeatherToolDisplays(answer: string, evidence: readonly ToolEvidence[]): string {
  const displays = new Map<string, WeatherForecastDisplay>();
  for (const item of evidence) {
    if (!item.success || item.details.toolName !== 'weather_forecast') continue;
    const display = toolDisplay(item.details.result);
    if (!display) continue;
    const key = JSON.stringify([display.location, display.country, display.timezone, display.days.map(day => day.date)]);
    displays.set(key, display);
  }
  if (!displays.size) return answer;
  // Replace copied blocks with the exact validated tool values; retain prose.
  const prose = answer.replace(WEATHER_BLOCK, '').trimEnd();
  const blocks = [...displays.values()].map(display =>
    '```weather-results\n' + JSON.stringify(display).replace(/`/g, '\\u0060') + '\n```');
  return [prose, ...blocks].filter(Boolean).join('\n\n');
}
