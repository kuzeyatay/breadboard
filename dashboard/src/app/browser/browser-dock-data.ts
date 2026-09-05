export interface WorldCity {
  id: string;
  name: string;
  country: string;
  timezone: string;
  latitude: number;
  longitude: number;
}

export const WORLD_CITIES: readonly WorldCity[] = [
  { id: "amsterdam", name: "Amsterdam", country: "Netherlands", timezone: "Europe/Amsterdam", latitude: 52.37, longitude: 4.90 },
  { id: "london", name: "London", country: "United Kingdom", timezone: "Europe/London", latitude: 51.51, longitude: -0.13 },
  { id: "paris", name: "Paris", country: "France", timezone: "Europe/Paris", latitude: 48.86, longitude: 2.35 },
  { id: "berlin", name: "Berlin", country: "Germany", timezone: "Europe/Berlin", latitude: 52.52, longitude: 13.41 },
  { id: "rome", name: "Rome", country: "Italy", timezone: "Europe/Rome", latitude: 41.90, longitude: 12.50 },
  { id: "istanbul", name: "Istanbul", country: "Türkiye", timezone: "Europe/Istanbul", latitude: 41.01, longitude: 28.98 },
  { id: "new-york", name: "New York", country: "United States", timezone: "America/New_York", latitude: 40.71, longitude: -74.01 },
  { id: "los-angeles", name: "Los Angeles", country: "United States", timezone: "America/Los_Angeles", latitude: 34.05, longitude: -118.24 },
  { id: "chicago", name: "Chicago", country: "United States", timezone: "America/Chicago", latitude: 41.88, longitude: -87.63 },
  { id: "toronto", name: "Toronto", country: "Canada", timezone: "America/Toronto", latitude: 43.65, longitude: -79.38 },
  { id: "mexico-city", name: "Mexico City", country: "Mexico", timezone: "America/Mexico_City", latitude: 19.43, longitude: -99.13 },
  { id: "sao-paulo", name: "São Paulo", country: "Brazil", timezone: "America/Sao_Paulo", latitude: -23.55, longitude: -46.63 },
  { id: "buenos-aires", name: "Buenos Aires", country: "Argentina", timezone: "America/Argentina/Buenos_Aires", latitude: -34.60, longitude: -58.38 },
  { id: "cairo", name: "Cairo", country: "Egypt", timezone: "Africa/Cairo", latitude: 30.04, longitude: 31.24 },
  { id: "cape-town", name: "Cape Town", country: "South Africa", timezone: "Africa/Johannesburg", latitude: -33.92, longitude: 18.42 },
  { id: "nairobi", name: "Nairobi", country: "Kenya", timezone: "Africa/Nairobi", latitude: -1.29, longitude: 36.82 },
  { id: "dubai", name: "Dubai", country: "United Arab Emirates", timezone: "Asia/Dubai", latitude: 25.20, longitude: 55.27 },
  { id: "delhi", name: "Delhi", country: "India", timezone: "Asia/Kolkata", latitude: 28.61, longitude: 77.21 },
  { id: "kathmandu", name: "Kathmandu", country: "Nepal", timezone: "Asia/Kathmandu", latitude: 27.72, longitude: 85.32 },
  { id: "bangkok", name: "Bangkok", country: "Thailand", timezone: "Asia/Bangkok", latitude: 13.76, longitude: 100.50 },
  { id: "singapore", name: "Singapore", country: "Singapore", timezone: "Asia/Singapore", latitude: 1.35, longitude: 103.82 },
  { id: "hong-kong", name: "Hong Kong", country: "China", timezone: "Asia/Hong_Kong", latitude: 22.32, longitude: 114.17 },
  { id: "beijing", name: "Beijing", country: "China", timezone: "Asia/Shanghai", latitude: 39.90, longitude: 116.41 },
  { id: "seoul", name: "Seoul", country: "South Korea", timezone: "Asia/Seoul", latitude: 37.57, longitude: 126.98 },
  { id: "tokyo", name: "Tokyo", country: "Japan", timezone: "Asia/Tokyo", latitude: 35.68, longitude: 139.69 },
  { id: "sydney", name: "Sydney", country: "Australia", timezone: "Australia/Sydney", latitude: -33.87, longitude: 151.21 },
  { id: "auckland", name: "Auckland", country: "New Zealand", timezone: "Pacific/Auckland", latitude: -36.85, longitude: 174.76 },
];

export const DEFAULT_CITY_IDS = ["amsterdam", "london", "new-york", "tokyo", "sydney"];
export const MAX_WORLD_CITIES = 8;

export function normalizeCityIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_CITY_IDS];
  return [...new Set(value.filter((id): id is string =>
    typeof id === "string" && WORLD_CITIES.some((city) => city.id === id),
  ))].slice(0, MAX_WORLD_CITIES);
}

function zonedParts(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (name: string) => Number(parts.find((item) => item.type === name)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute") };
}

export function worldClock(now: Date, timezone: string, localTimezone: string) {
  const city = zonedParts(now, timezone);
  const local = zonedParts(now, localTimezone);
  const dayStamp = (p: ReturnType<typeof zonedParts>) => Date.UTC(p.year, p.month - 1, p.day);
  const wallTime = (p: ReturnType<typeof zonedParts>) => dayStamp(p) + (p.hour * 60 + p.minute) * 60_000;
  const difference = Math.round((wallTime(city) - wallTime(local)) / 60_000);
  const hours = Math.floor(Math.abs(difference) / 60);
  const minutes = Math.abs(difference) % 60;
  const dayDifference = Math.round((dayStamp(city) - dayStamp(local)) / 86_400_000);
  return {
    time: `${String(city.hour).padStart(2, "0")}:${String(city.minute).padStart(2, "0")}`,
    date: new Intl.DateTimeFormat(undefined, { timeZone: timezone, weekday: "short", month: "short", day: "numeric" }).format(now),
    daytime: city.hour >= 7 && city.hour < 19,
    difference: difference === 0 ? "Same time" : `${difference > 0 ? "+" : "−"}${hours ? `${hours}h` : ""}${minutes ? ` ${minutes}m` : ""}`,
    day: dayDifference === 0 ? "Today" : dayDifference > 0 ? "Tomorrow" : "Yesterday",
  };
}

export interface DockWeather {
  temperatureC: number;
  apparentC: number;
  code: number;
  condition: string;
  isDay: boolean;
  timezone: string;
}

export interface DockBattery {
  percent: number;
  charging: boolean;
  chargingTime: number | null;
  dischargingTime: number | null;
}

export interface DockNetwork {
  online: boolean;
  detail: string;
  effectiveType: string | null;
  downlink: number | null;
  rtt: number | null;
  saveData: boolean | null;
}

export function finiteEstimate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function batteryDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "Not available";
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours ? `${hours}h` : ""}${minutes ? ` ${minutes}m` : ""}`.trim();
}
