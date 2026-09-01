const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 10;
const MAX_RANGE_DAYS = 31;

export class WeatherForecastError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "WeatherForecastError";
    this.code = code;
  }
}

export interface WeatherForecastInput {
  location: string;
  dates?: string[];
}

export interface WeatherForecastDay {
  date: string;
  temperatureC: number;
  minC: number;
  maxC: number;
  code: number;
  condition: string;
  isDay: boolean;
}

export interface WeatherForecastDisplay {
  location: string;
  country: string;
  timezone: string;
  days: WeatherForecastDay[];
}

export interface WeatherForecastResult {
  display: WeatherForecastDisplay;
  source: {
    name: "Open-Meteo";
    url: string;
    generatedAt: string;
  };
}

interface GeocodingResult {
  name?: unknown;
  admin1?: unknown;
  country?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  timezone?: unknown;
}

interface ForecastPayload {
  timezone?: unknown;
  current?: {
    time?: unknown;
    temperature_2m?: unknown;
    weather_code?: unknown;
    is_day?: unknown;
  };
  daily?: {
    time?: unknown;
    weather_code?: unknown;
    temperature_2m_max?: unknown;
    temperature_2m_min?: unknown;
  };
  reason?: unknown;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function dateNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function validateInput(input: WeatherForecastInput): { location: string; dates: string[] } {
  const location = stringValue(input?.location).slice(0, 160);
  if (location.length < 2) {
    throw new WeatherForecastError(
      "Weather needs a city, region, or named place.",
      "weather_invalid_arguments",
    );
  }
  const rawDates = input.dates ?? [];
  if (!Array.isArray(rawDates) || rawDates.length > MAX_DAYS) {
    throw new WeatherForecastError(
      `Choose no more than ${MAX_DAYS} forecast dates.`,
      "weather_invalid_arguments",
    );
  }
  const dates = [...new Set(rawDates.map((value) => stringValue(value)))];
  if (dates.some((date) => !ISO_DATE.test(date) || Number.isNaN(dateNumber(date)))) {
    throw new WeatherForecastError(
      "Forecast dates must use YYYY-MM-DD.",
      "weather_invalid_arguments",
    );
  }
  dates.sort();
  if (
    dates.length > 1 &&
    (dateNumber(dates.at(-1)!) - dateNumber(dates[0])) / 86_400_000 > MAX_RANGE_DAYS
  ) {
    throw new WeatherForecastError(
      `Forecast dates must fit within a ${MAX_RANGE_DAYS}-day window.`,
      "weather_invalid_arguments",
    );
  }
  return { location, dates };
}

export function weatherCondition(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Foggy";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code === 95) return "Thunderstorms";
  if (code === 96 || code === 99) return "Thunderstorms with hail";
  return "Mixed conditions";
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: URL,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new WeatherForecastError("The weather request was cancelled.", "weather_aborted");
    }
    throw new WeatherForecastError(
      `The weather service could not be reached${error instanceof Error ? `: ${error.message}` : "."}`,
      "weather_unavailable",
    );
  }
  if (!response.ok) {
    throw new WeatherForecastError(
      `The weather service returned HTTP ${response.status}.`,
      "weather_upstream_error",
    );
  }
  return response.json();
}

function resolvedPlace(result: GeocodingResult): string {
  return stringValue(result.name);
}

export async function fetchWeatherForecast(
  rawInput: WeatherForecastInput,
  options: {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    now?: Date;
  } = {},
): Promise<WeatherForecastResult> {
  const input = validateInput(rawInput);
  const fetchImpl = options.fetchImpl ?? fetch;

  const geocodingUrl = new URL(GEOCODING_ENDPOINT);
  geocodingUrl.searchParams.set("name", input.location);
  geocodingUrl.searchParams.set("count", "1");
  geocodingUrl.searchParams.set("language", "en");
  geocodingUrl.searchParams.set("format", "json");
  const geocoding = await fetchJson(fetchImpl, geocodingUrl, options.signal) as {
    results?: unknown;
  };
  const result = Array.isArray(geocoding?.results)
    ? geocoding.results[0] as GeocodingResult | undefined
    : undefined;
  const latitude = numberValue(result?.latitude);
  const longitude = numberValue(result?.longitude);
  if (!result || latitude === null || longitude === null || !stringValue(result.name)) {
    throw new WeatherForecastError(
      `No weather location matched “${input.location}”.`,
      "weather_location_not_found",
    );
  }

  const forecastUrl = new URL(FORECAST_ENDPOINT);
  forecastUrl.searchParams.set("latitude", String(latitude));
  forecastUrl.searchParams.set("longitude", String(longitude));
  forecastUrl.searchParams.set("current", "temperature_2m,weather_code,is_day");
  forecastUrl.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min",
  );
  forecastUrl.searchParams.set("timezone", "auto");
  if (input.dates.length > 0) {
    forecastUrl.searchParams.set("start_date", input.dates[0]);
    forecastUrl.searchParams.set("end_date", input.dates.at(-1)!);
  } else {
    forecastUrl.searchParams.set("forecast_days", "1");
  }

  const forecast = await fetchJson(fetchImpl, forecastUrl, options.signal) as ForecastPayload;
  const times = Array.isArray(forecast.daily?.time) ? forecast.daily.time : [];
  const codes = Array.isArray(forecast.daily?.weather_code) ? forecast.daily.weather_code : [];
  const highs = Array.isArray(forecast.daily?.temperature_2m_max)
    ? forecast.daily.temperature_2m_max
    : [];
  const lows = Array.isArray(forecast.daily?.temperature_2m_min)
    ? forecast.daily.temperature_2m_min
    : [];
  const requested = new Set(input.dates);
  const currentDate = stringValue(forecast.current?.time).slice(0, 10);
  const currentTemperature = numberValue(forecast.current?.temperature_2m);
  const currentCode = numberValue(forecast.current?.weather_code);
  const currentIsDay = numberValue(forecast.current?.is_day);

  const days = times.flatMap((value, index): WeatherForecastDay[] => {
    const date = stringValue(value);
    if (!ISO_DATE.test(date) || (requested.size > 0 && !requested.has(date))) return [];
    const maxC = numberValue(highs[index]);
    const minC = numberValue(lows[index]);
    const dailyCode = numberValue(codes[index]);
    if (maxC === null || minC === null || dailyCode === null) return [];
    const usesCurrent = date === currentDate && currentTemperature !== null;
    const code = Math.round(usesCurrent && currentCode !== null ? currentCode : dailyCode);
    return [{
      date,
      temperatureC: roundOne(usesCurrent ? currentTemperature : (maxC + minC) / 2),
      minC: roundOne(minC),
      maxC: roundOne(maxC),
      code,
      condition: weatherCondition(code),
      isDay: usesCurrent ? currentIsDay !== 0 : true,
    }];
  });

  if (days.length === 0) {
    const reason = stringValue(forecast.reason);
    throw new WeatherForecastError(
      reason || "No forecast is available for those dates.",
      "weather_dates_unavailable",
    );
  }

  const now = options.now ?? new Date();
  return {
    display: {
      location: resolvedPlace(result),
      country: stringValue(result.country),
      timezone: stringValue(forecast.timezone) || stringValue(result.timezone) || "UTC",
      days,
    },
    source: {
      name: "Open-Meteo",
      url: "https://open-meteo.com/",
      generatedAt: now.toISOString(),
    },
  };
}
