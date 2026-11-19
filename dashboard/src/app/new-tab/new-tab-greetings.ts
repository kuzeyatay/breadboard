export const FAMILIAR_ADDRESSEES = [
  "sailor", "bub", "champ", "chief", "captain", "pal", "skipper", "ace",
  "scout", "buddy", "star", "friend",
  "boss", "partner", "commander", "navigator", "pilot", "coach", "rockstar",
  "hotshot", "sport", "legend", "genius", "professor", "doc", "sunshine",
  "kiddo", "comrade", "chef", "maverick", "wizard", "hero", "sleuth",
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
  "breadboard baron", "circuit sage", "sourdough scholar", "crumb collector",
  "loaf legend", "toast whisperer", "knowledge gardener", "seed sower",
  "root explorer", "branch climber", "pixel poet", "syntax sorcerer",
  "neuron navigator", "synapse surfer", "brain gardener", "memory keeper",
  "archive diver", "footnote fanatic", "margin scribbler", "chapter chaser",
  "thesis tamer", "lecture slayer", "deadline dancer", "focus falcon",
  "tab tamer", "rabbit-hole ranger", "idea juggler", "thought gardener",
  "noodle navigator", "biscuit bandit", "pancake pilot", "dumpling duke",
  "honey badger", "otter admiral", "fox scholar", "owl apprentice",
  "hedgehog hero", "panda pilot", "koala captain", "penguin pioneer",
  "galaxy brain", "quasar queen", "nebula knight", "rocket scientist",
  "meteor maven", "gravity groover", "quantum quokka", "atom wrangler",
  "jazz hands", "groove master", "rhythm rider", "melody maker",
  "lucky duck", "golden goose", "sunny side", "good egg", "smart cookie",
  "bright bulb", "big thinker", "fresh mind", "keen bean", "wise owl",
  "clockwork kid", "gear grinder", "spark wrangler", "voltage viking",
] as const;

/** Day-of-week nods, 0 = Sunday as in Date#getDay. */
export function weekdayAddressees(day: number | undefined): readonly string[] {
  switch (day) {
    case 0: return ["sunday stroller", "lazy-day legend", "brunch baron"];
    case 1: return ["monday warrior", "fresh-start captain", "week opener"];
    case 2: return ["tuesday trooper", "momentum maker"];
    case 3: return ["midweek maverick", "hump-day hero"];
    case 4: return ["almost-friday ace", "thursday thinker"];
    case 5: return ["friday flyer", "weekend scout", "TGIF captain"];
    case 6: return ["saturday sailor", "weekend wanderer", "free-day explorer"];
    default: return [];
  }
}

/** Season by month (0-11), flipped south of the equator when a fix says so. */
export function seasonAddressees(month: number | undefined, latitude?: number): readonly string[] {
  if (month === undefined || !Number.isInteger(month) || month < 0 || month > 11) return [];
  const shifted = latitude !== undefined && Number.isFinite(latitude) && latitude < 0 ? (month + 6) % 12 : month;
  if (shifted <= 1 || shifted === 11) return ["winter wanderer", "snow globe", "cozy captain", "mitten maestro"];
  if (shifted <= 4) return ["spring sprout", "blossom scout", "tulip tamer", "bud buddy"];
  if (shifted <= 7) return ["summer sailor", "sunscreen scout", "beach bum", "solstice surfer"];
  return ["autumn ranger", "leaf peeper", "pumpkin pilot", "acorn collector"];
}

/** What Screen Time says the last couple of hours mostly were. Category only, never apps or titles. */
export interface GreetingActivity {
  category: "creating" | "learning" | "communication" | "entertainment" | "browsing";
  /** One unbroken stretch of 45+ minutes. */
  focused: boolean;
  /** Many quick context switches. */
  scattered: boolean;
}

export function activityAddressees(activity: GreetingActivity | null | undefined): readonly string[] {
  if (!activity) return [];
  const extra = activity.focused ? ["deep diver", "flow-state pilot", "focus monk"]
    : activity.scattered ? ["tab juggler", "multitask maestro", "context hopper"] : [];
  switch (activity.category) {
    case "creating": return [...extra, "maker", "builder", "code wrangler", "craftsperson", "creator", "bug squasher", "draft smith"];
    case "learning": return [...extra, "scholar", "study buddy", "bookworm", "knowledge seeker", "flashcard fiend", "eager learner"];
    case "communication": return [...extra, "social butterfly", "message maestro", "inbox ranger", "chatterbox", "people person"];
    case "entertainment": return [...extra, "binge buddy", "couch captain", "playlist pilot", "popcorn pal", "game ace"];
    case "browsing": return [...extra, "web surfer", "link hopper", "internet explorer", "rabbit-hole diver"];
    default: return extra;
  }
}

export const GREETING_ACTIVITY_MAX_AGE_MS = 15 * 60_000;

export function normalizeGreetingActivity(value: unknown): GreetingActivity | null {
  if (!value || typeof value !== "object") return null;
  const activity = value as Record<string, unknown>;
  if (!["creating", "learning", "communication", "entertainment", "browsing"].includes(activity.category as string)) return null;
  return { category: activity.category as GreetingActivity["category"], focused: activity.focused === true, scattered: activity.scattered === true };
}

export function cachedGreetingActivity(value: unknown, now: number): GreetingActivity | null {
  if (!value || typeof value !== "object") return null;
  const cached = value as Record<string, unknown>;
  if (typeof cached.readAt !== "number" || !Number.isFinite(now) || now < cached.readAt ||
      now - cached.readAt >= GREETING_ACTIVITY_MAX_AGE_MS) return null;
  return normalizeGreetingActivity(cached.activity);
}

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
  /** Date#getDay in the active zone. */
  day?: number;
  /** Date#getMonth in the active zone. */
  month?: number;
  activity?: GreetingActivity | null;
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
  if (hour < 5 || hour >= 22) return ["night owl", "moonwalker", "midnight gardener", "night navigator", "after-hours ace", "stargazer",
    "midnight oil burner", "insomnia ace", "moonlight coder", "nocturnal scholar", "dream catcher"];
  if (hour < 10) return ["early bird", "sunrise scout", "dew drop", "toast captain", "morning spark", "dawn wanderer",
    "coffee commander", "rise-and-shiner", "morning glory", "breakfast baron", "first-light pilot"];
  if (hour < 14) return ["daylight rover", "noon navigator", "lunch legend", "daydreamer",
    "high-noon hero", "sandwich scout", "midday maverick", "brunch buddy"];
  if (hour < 18) return ["afternoon ace", "tea-time captain", "daylight dreamer", "sunlit scribbler",
    "siesta skipper", "golden-hour scout", "snack-break champ", "afternoon alchemist"];
  return ["dusk wanderer", "evening explorer", "lamplighter", "twilight scout",
    "sunset chaser", "dinner diplomat", "evening owl", "night-shift navigator"];
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
  const contextual = [
    timeAddressees(context.hour), weatherAddressees(context.weather), locationAddressees(context.location),
    weekdayAddressees(context.day), seasonAddressees(context.month, context.location?.latitude),
    activityAddressees(context.activity),
  ]
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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Day of week (0 = Sunday) and month (0-11) in the active zone. */
export function greetingCalendar(now: Date, timeZone?: string): { day: number; month: number } {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "numeric" }).formatToParts(now);
      const day = WEEKDAYS.indexOf(parts.find((part) => part.type === "weekday")?.value ?? "");
      const month = Number(parts.find((part) => part.type === "month")?.value) - 1;
      if (day >= 0 && month >= 0 && month <= 11) return { day, month };
    } catch { /* Use the device clock when a zone is unavailable. */ }
  }
  return { day: now.getDay(), month: now.getMonth() };
}

export function greetingHour(now: Date, timeZone?: string): number {
  if (timeZone) {
    try {
      return Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
    } catch { /* Use the device clock when a zone is unavailable. */ }
  }
  return now.getHours();
}
