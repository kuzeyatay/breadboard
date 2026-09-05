export const FAMILIAR_ADDRESSEES = [
  "sailor", "bub", "champ", "chief", "captain", "pal", "skipper", "ace",
  "scout", "buddy", "star", "friend",
] as const;

export const CREATIVE_ADDRESSEES = [
  "cosmic gardener", "pocket rocket", "curiosity captain", "space cadet",
  "bright spark", "cloud hopper", "comet rider", "moss boss", "clever clover",
  "idea sprout", "tiny titan", "wonder wanderer", "book goblin", "map maker",
  "compass keeper", "wayfinder", "orbit hopper", "plot twister", "dream weaver",
  "leaf chief", "riddle wrangler", "scribble skipper", "cosmic bean", "firefly",
  "trailblazer", "treasure hunter", "brain astronaut", "pebble skipper",
  "velvet thunder", "little legend", "sprocket", "curiosity cat", "ink wanderer",
  "brainwave", "rambling rose", "sparkplug", "stardust", "rover", "maestro",
  "daydreamer", "wild sprout", "moonbeam", "doodle pilot", "thought explorer",
  "question collector", "mischief maker", "notebook nomad", "waffle wizard",
] as const;

export interface GreetingWeather {
  code: number;
  temperatureC: number;
  isDay: boolean;
}

export interface GreetingLocation {
  latitude: number;
  longitude: number;
  timeZone: string;
}

export interface GreetingContext {
  hour?: number;
  weather?: GreetingWeather | null;
  location?: GreetingLocation | null;
}

export const GREETING_WEATHER_MAX_AGE_MS = 10 * 60_000;

export function cachedGreetingWeather(value: unknown, location: GreetingLocation | null, now: number): GreetingWeather | null {
  if (!value || typeof value !== "object" || !location) return null;
  const cached = value as Record<string, unknown>;
  if (cached.latitude !== location.latitude || cached.longitude !== location.longitude ||
      typeof cached.readAt !== "number" || !Number.isFinite(cached.readAt) ||
      !Number.isFinite(now) || now < cached.readAt || now - cached.readAt >= GREETING_WEATHER_MAX_AGE_MS) return null;
  return normalizeGreetingWeather(cached.weather);
}

export function timeAddressees(hour: number | undefined): readonly string[] {
  if (hour === undefined || !Number.isFinite(hour) || hour < 0 || hour >= 24) return [];
  if (hour < 5 || hour >= 22) return ["night owl", "moonwalker", "midnight gardener", "night navigator", "after-hours ace", "stargazer"];
  if (hour < 10) return ["early bird", "sunrise scout", "dew drop", "toast captain", "morning spark", "dawn wanderer"];
  if (hour < 14) return ["daylight rover", "noon navigator", "lunch legend", "daydreamer"];
  if (hour < 18) return ["afternoon ace", "tea-time captain", "daylight dreamer", "sunlit scribbler"];
  return ["dusk wanderer", "evening explorer", "lamplighter", "twilight scout"];
}

export function normalizeGreetingWeather(value: unknown): GreetingWeather | null {
  if (!value || typeof value !== "object") return null;
  const weather = value as Record<string, unknown>;
  if (typeof weather.code !== "number" || !Number.isInteger(weather.code) ||
      typeof weather.temperatureC !== "number" || !Number.isFinite(weather.temperatureC) ||
      weather.temperatureC < -90 || weather.temperatureC > 65 || typeof weather.isDay !== "boolean") return null;
  if (![0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99].includes(weather.code)) return null;
  return { code: weather.code, temperatureC: weather.temperatureC, isDay: weather.isDay };
}

export function weatherAddressees(weather: GreetingWeather | null | undefined): readonly string[] {
  if (!weather) return [];
  const { code, temperatureC, isDay } = weather;
  if ([95, 96, 99].includes(code)) return ["storm watcher", "thunder buddy", "lightning lookout"];
  if ([71, 73, 75, 77, 85, 86].includes(code)) return ["snow fox", "snowflake scout", "snowday dreamer"];
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return ["puddle skipper", "rain rambler", "umbrella captain", "drizzle dreamer"];
  if ([45, 48].includes(code)) return ["fog navigator", "mist wanderer", "haze explorer"];
  if (temperatureC <= 3) return ["frost scout", "cocoa captain", "woolly wanderer"];
  if (temperatureC >= 29) return ["heatwave hero", "shade seeker", "iced-tea captain"];
  if (code <= 1) return isDay
    ? ["sunbeam", "sunshine scout", "sun seeker"]
    : ["stargazer", "moonbeam", "constellation scout"];
  return ["cloud watcher", "silver lining", "cloud hopper"];
}

export function locationAddressees(location: GreetingLocation | null | undefined): readonly string[] {
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return [];
  const { latitude, longitude, timeZone } = location;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
  // Combine the active fix with its zone; a time-zone name alone does not
  // establish where someone is. These are broad regional nods, never an address.
  if (timeZone === "Europe/Amsterdam" && latitude >= 50.75 && latitude <= 53.6 && longitude >= 3.2 && longitude <= 7.25) {
    return ["canal captain", "polder pilot", "bicycle baron", "windmill wanderer"];
  }
  if (Math.abs(latitude) <= 10) return ["equator explorer", "equatorial rover"];
  if (Math.abs(latitude) <= 23.44) return ["tropic rover", "tropical trailblazer"];
  if (latitude >= 55) return ["northern star", "northbound scout", "northern wanderer"];
  if (latitude <= -35) return ["southern star", "southern rover", "southbound scout"];
  return latitude > 0
    ? ["northern rover", "hemisphere hopper"]
    : ["southern wanderer", "hemisphere hopper"];
}

/** Roughly 20% familiar, 45% creative, 35% contextual when signals exist. */
export function pickNewTabAddressee(
  context: GreetingContext = {},
  recent: readonly string[] = [],
  random: () => number = Math.random,
): string {
  const roll = random();
  const contextual = [timeAddressees(context.hour), weatherAddressees(context.weather), locationAddressees(context.location)]
    .filter((pool) => pool.length > 0);
  let pool: readonly string[] = roll < 0.2 ? FAMILIAR_ADDRESSEES : CREATIVE_ADDRESSEES;
  if (roll >= 0.65 && contextual.length) {
    pool = contextual[Math.floor(random() * contextual.length)];
  }
  const seen = new Set(recent.slice(-8));
  let available = pool.filter((name) => !seen.has(name));
  if (!available.length) {
    available = [...CREATIVE_ADDRESSEES, ...FAMILIAR_ADDRESSEES].filter((name) => !seen.has(name));
  }
  return available[Math.floor(random() * available.length)] ?? "sailor";
}

export function greetingHour(now: Date, timeZone?: string): number {
  if (timeZone) {
    try {
      return Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
    } catch { /* Use the device clock when a zone is unavailable. */ }
  }
  return now.getHours();
}
