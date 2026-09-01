import type { WeatherForecastDisplay } from "./forecast.ts";

const WEATHER_WORD =
  /\b(?:weather|forecast|temperature|temperatures|rain|raining|rainy|snow|snowing|snowy|sunny|windy|conditions?)\b/i;
const META_REQUEST =
  /\b(?:build|code|create|design|develop|debug|fix|implement|mockup|style|widget|component|average|climate|histor(?:y|ical)|record)\b/i;
const ISO_DATE_GLOBAL = /\b(\d{4}-\d{2}-\d{2})\b/g;
const MAX_DAYS = 10;
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export interface WeatherChatIntent {
  location: string;
  /** Omitted means the named place's current day. */
  dates?: string[];
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDay(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function validIsoDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && isoDate(parsed) === value;
}

function cleanLocation(raw: string): string {
  let value = raw
    .replace(/^[\s,:;-]+|[\s,?!.:;-]+$/g, "")
    .replace(/^(?:the\s+)?(?:weather|forecast|temperature|conditions?)\s+(?:like\s+)?/i, "")
    .replace(/^(?:like\s+)?(?:in|at|for|near|around)\s+/i, "")
    .trim();

  // Everything after a time clause describes which cards to request, not the
  // geocoding query. Keeping the place separate is what makes phrases such as
  // “London for the next three days” resolve reliably.
  value = value.split(
    /\s+(?=(?:today|tonight|tomorrow|the\s+day\s+after\s+tomorrow|next\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?|for\s+(?:the\s+)?next\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?|for\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?|this\s+week(?:end)?|next\s+week(?:end)?|on\s+\d{4}-\d{2}-\d{2}|on\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day|on\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?))\b)/i,
  )[0].trim();

  value = value
    .replace(/^(?:what(?:'s|s|\s+is)|how(?:'s|s|\s+is)|tell\s+me)\s+/i, "")
    .replace(/\s+(?:please|right\s+now|currently)$/i, "")
    .trim();

  if (
    value.length < 2 ||
    value.length > 120 ||
    /^(?:the|current|here|there|outside|me|my\s+location|near\s+me|today|tonight|tomorrow|the\s+day\s+after\s+tomorrow|this\s+week(?:end)?|next\s+week(?:end)?|\d+\s+days?)$/i.test(value) ||
    /\b(?:weather|forecast|temperature)\b/i.test(value)
  ) {
    return "";
  }
  return value;
}

function locationFromText(text: string): string {
  const candidates: string[] = [];

  // Place prepositions are the least ambiguous form. “for” is separate so a
  // duration such as “for three days in London” does not win over London.
  const placePreposition = text.match(/\b(?:in|at|near|around)\s+([^?]+)/i)?.[1];
  if (placePreposition) candidates.push(placePreposition);

  const forCandidate = text.match(/\bfor\s+([^?]+)/i)?.[1];
  if (
    forCandidate &&
    !/^(?:the\s+)?(?:next\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?\b/i.test(forCandidate)
  ) {
    candidates.push(forCandidate);
  }

  const afterWeather = text.match(
    /\b(?:weather|forecast|temperature|conditions?)\b\s+(?:like\s+)?(?:in|at|for|near|around)?\s*([^?]+)/i,
  )?.[1];
  if (afterWeather) candidates.push(afterWeather);

  const beforeWeather = text.match(
    /^(?:what(?:'s|s|\s+is)\s+|how(?:'s|s|\s+is)\s+|tell\s+me\s+(?:about\s+)?)?(?:the\s+)?(.+?)\s+(?:weather|forecast|temperature|conditions?)\b/i,
  )?.[1];
  if (beforeWeather) candidates.push(beforeWeather);

  for (const candidate of candidates) {
    const location = cleanLocation(candidate);
    if (location) return location;
  }
  return "";
}

function requestedDates(text: string, now: Date): string[] | undefined {
  const base = utcDay(now);
  const values = new Set<string>();
  const addOffset = (offset: number) => values.add(isoDate(addDays(base, offset)));

  for (const match of text.matchAll(ISO_DATE_GLOBAL)) {
    if (validIsoDate(match[1])) values.add(match[1]);
  }

  const lower = text.toLowerCase();
  if (/\b(today|tonight)\b/.test(lower)) addOffset(0);
  if (/\bday\s+after\s+tomorrow\b/.test(lower)) addOffset(2);
  if (/\btomorrow\b/.test(lower) && !/\bday\s+after\s+tomorrow\b/.test(lower)) {
    addOffset(1);
  }

  const dayCount = lower.match(
    /\b(?:for\s+(?:the\s+)?next\s+|for\s+|next\s+)(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?\b/,
  );
  if (dayCount) {
    const requestedCount = NUMBER_WORDS[dayCount[1]] ?? Number(dayCount[1]);
    const count = Math.min(MAX_DAYS, Math.max(1, requestedCount));
    for (let offset = 0; offset < count; offset += 1) addOffset(offset);
  } else if (/\bthis\s+week\b/.test(lower)) {
    for (let offset = 0; offset < 7; offset += 1) addOffset(offset);
  } else if (/\bnext\s+week\b/.test(lower)) {
    for (let offset = 1; offset <= 7; offset += 1) addOffset(offset);
  }

  const weekend = lower.match(/\b(this|next)\s+weekend\b/);
  if (weekend) {
    let saturdayOffset = (6 - base.getUTCDay() + 7) % 7;
    if (weekend[1] === "next" || saturdayOffset === 0) saturdayOffset += 7;
    addOffset(saturdayOffset);
    addOffset(saturdayOffset + 1);
  }

  for (const [name, weekday] of Object.entries(WEEKDAYS)) {
    const match = lower.match(new RegExp(`\\b(?:(next|this)\\s+)?${name}\\b`));
    if (!match) continue;
    let offset = (weekday - base.getUTCDay() + 7) % 7;
    if (match[1] === "next" && offset === 0) offset = 7;
    values.add(isoDate(addDays(base, offset)));
  }

  const monthPattern = Object.keys(MONTHS).join("|");
  const monthDates = new RegExp(
    `\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
    "gi",
  );
  for (const match of text.matchAll(monthDates)) {
    const month = MONTHS[match[1].toLowerCase()];
    const day = Number(match[2]);
    let year = match[3] ? Number(match[3]) : base.getUTCFullYear();
    let candidate = new Date(Date.UTC(year, month, day));
    if (!match[3] && candidate < base) {
      year += 1;
      candidate = new Date(Date.UTC(year, month, day));
    }
    if (
      candidate.getUTCFullYear() === year &&
      candidate.getUTCMonth() === month &&
      candidate.getUTCDate() === day
    ) {
      values.add(isoDate(candidate));
    }
  }

  const dates = [...values]
    .sort()
    .slice(0, MAX_DAYS);
  return dates.length > 0 ? dates : undefined;
}

/**
 * Conservative app-owned routing for simple named-place weather questions.
 * Broader analysis and meta requests keep going through the normal agent.
 */
export function parseWeatherChatIntent(
  rawText: string,
  options: { now?: Date } = {},
): WeatherChatIntent | null {
  const text = typeof rawText === "string" ? rawText.trim() : "";
  if (
    !text ||
    text.length > 500 ||
    !WEATHER_WORD.test(text) ||
    META_REQUEST.test(text)
  ) {
    return null;
  }
  const location = locationFromText(text);
  if (!location) return null;
  return {
    location,
    dates: requestedDates(text, options.now ?? new Date()),
  };
}

export function weatherResultsMessage(display: WeatherForecastDisplay): string {
  const description = display.days.length === 1
    ? `Here’s the weather for ${display.location}.`
    : `Here’s the ${display.days.length}-day forecast for ${display.location}.`;
  return `${description}\n\n\`\`\`weather-results\n${JSON.stringify(display)}\n\`\`\``;
}
