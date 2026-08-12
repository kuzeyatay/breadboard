export const APP_THEME_STORAGE_KEY = "breadboard:theme";
export const APP_THEME_MODE_STORAGE_KEY = "breadboard:theme-mode";
export const APP_THEME_LOCATION_STORAGE_KEY = "breadboard:theme-location";
export const APP_THEME_CHANGE_EVENT = "breadboard:theme-change";
export const APP_THEME_MODE_CHANGE_EVENT = "breadboard:theme-mode-change";
export const APP_THEME_MESSAGE = "breadboard:theme";

export type AppTheme = "light" | "dark";
export type AppThemeMode = "manual" | "sun";

export interface AppThemeLocation {
  latitude: number;
  longitude: number;
}

export interface SolarTimes {
  sunrise: Date;
  sunset: Date;
}

export function isAppTheme(value: unknown): value is AppTheme {
  return value === "light" || value === "dark";
}

export function isAppThemeMode(value: unknown): value is AppThemeMode {
  return value === "manual" || value === "sun";
}

export function getStoredAppTheme(storage: Pick<Storage, "getItem">): AppTheme {
  try {
    const stored = storage.getItem(APP_THEME_STORAGE_KEY);
    return isAppTheme(stored) ? stored : "light";
  } catch {
    return "light";
  }
}

export function getStoredAppThemeMode(
  storage: Pick<Storage, "getItem">,
): AppThemeMode {
  try {
    const stored = storage.getItem(APP_THEME_MODE_STORAGE_KEY);
    return isAppThemeMode(stored) ? stored : "manual";
  } catch {
    return "manual";
  }
}

export function getStoredAppThemeLocation(
  storage: Pick<Storage, "getItem">,
): AppThemeLocation | null {
  try {
    const parsed = JSON.parse(
      storage.getItem(APP_THEME_LOCATION_STORAGE_KEY) ?? "null",
    ) as Partial<AppThemeLocation> | null;
    if (
      !parsed ||
      typeof parsed.latitude !== "number" ||
      typeof parsed.longitude !== "number" ||
      !Number.isFinite(parsed.latitude) ||
      !Number.isFinite(parsed.longitude) ||
      parsed.latitude < -90 ||
      parsed.latitude > 90 ||
      parsed.longitude < -180 ||
      parsed.longitude > 180
    ) {
      return null;
    }
    return {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
    };
  } catch {
    return null;
  }
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const offsetDelta = (start.getTimezoneOffset() - date.getTimezoneOffset()) * 60_000;
  return Math.floor((date.getTime() - start.getTime() + offsetDelta) / 86_400_000);
}

/**
 * NOAA's sunrise equation, evaluated for the device's local calendar day.
 * The returned instants are absolute Dates, so daylight-saving offsets are
 * handled by the platform when they are formatted for the profile.
 */
function solarEvent(
  date: Date,
  location: AppThemeLocation,
  sunrise: boolean,
): Date | null {
  const longitudeHour = location.longitude / 15;
  const approximateTime =
    dayOfYear(date) + ((sunrise ? 6 : 18) - longitudeHour) / 24;
  const meanAnomaly = 0.9856 * approximateTime - 3.289;
  const trueLongitude = normalizeDegrees(
    meanAnomaly +
      1.916 * Math.sin(degreesToRadians(meanAnomaly)) +
      0.02 * Math.sin(degreesToRadians(2 * meanAnomaly)) +
      282.634,
  );

  let rightAscension = normalizeDegrees(
    radiansToDegrees(
      Math.atan(0.91764 * Math.tan(degreesToRadians(trueLongitude))),
    ),
  );
  rightAscension +=
    Math.floor(trueLongitude / 90) * 90 - Math.floor(rightAscension / 90) * 90;
  rightAscension /= 15;

  const sinDeclination = 0.39782 * Math.sin(degreesToRadians(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHourAngle =
    (Math.cos(degreesToRadians(90.833)) -
      sinDeclination * Math.sin(degreesToRadians(location.latitude))) /
    (cosDeclination * Math.cos(degreesToRadians(location.latitude)));
  // Polar day/night has no event on this date. The local-clock fallback keeps
  // the setting deterministic instead of getting stuck in one theme forever.
  if (cosHourAngle < -1 || cosHourAngle > 1) return null;

  const hourAngle =
    (sunrise
      ? 360 - radiansToDegrees(Math.acos(cosHourAngle))
      : radiansToDegrees(Math.acos(cosHourAngle))) / 15;
  const localMeanTime =
    hourAngle + rightAscension - 0.06571 * approximateTime - 6.622;
  const utcHours = ((localMeanTime - longitudeHour) % 24 + 24) % 24;
  let instant = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) +
      utcHours * 3_600_000,
  );
  const localDayStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const nextLocalDayStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
  ).getTime();
  // UTC sunrise can belong to the previous UTC date east of Greenwich. Bring
  // the instant back onto the local calendar day the equation was asked for.
  if (instant.getTime() < localDayStart) {
    instant = new Date(instant.getTime() + 86_400_000);
  } else if (instant.getTime() >= nextLocalDayStart) {
    instant = new Date(instant.getTime() - 86_400_000);
  }
  return instant;
}

export function solarTimesForDate(
  date: Date,
  location: AppThemeLocation,
): SolarTimes | null {
  const sunrise = solarEvent(date, location, true);
  const sunset = solarEvent(date, location, false);
  return sunrise && sunset ? { sunrise, sunset } : null;
}

function fallbackSolarTimes(date: Date): SolarTimes {
  return {
    sunrise: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 6),
    sunset: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 18),
  };
}

export function appThemeForMoment(
  now: Date,
  location: AppThemeLocation | null,
): AppTheme {
  const times =
    (location ? solarTimesForDate(now, location) : null) ?? fallbackSolarTimes(now);
  return now >= times.sunrise && now < times.sunset ? "light" : "dark";
}

export function nextAppThemeTransition(
  now: Date,
  location: AppThemeLocation | null,
): Date {
  const today =
    (location ? solarTimesForDate(now, location) : null) ?? fallbackSolarTimes(now);
  if (now < today.sunrise) return today.sunrise;
  if (now < today.sunset) return today.sunset;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12);
  return (
    (location ? solarTimesForDate(tomorrow, location) : null) ??
    fallbackSolarTimes(tomorrow)
  ).sunrise;
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Applying the preference in this renderer is still useful when storage is
    // unavailable (for example, in a locked-down browser context).
  }
}

export function rememberEffectiveAppTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme;
  writeStorage(APP_THEME_STORAGE_KEY, theme);
}

export function applyAppThemeMode(mode: AppThemeMode): void {
  writeStorage(APP_THEME_MODE_STORAGE_KEY, mode);
  window.dispatchEvent(
    new CustomEvent<AppThemeMode>(APP_THEME_MODE_CHANGE_EVENT, { detail: mode }),
  );
}

export function rememberAppThemeLocation(location: AppThemeLocation): void {
  // Three decimal places is ample for sunrise/sunset while avoiding needless
  // precise-location retention. Everything stays in this browser profile.
  const coarse = {
    latitude: Math.round(location.latitude * 1_000) / 1_000,
    longitude: Math.round(location.longitude * 1_000) / 1_000,
  };
  writeStorage(APP_THEME_LOCATION_STORAGE_KEY, JSON.stringify(coarse));
  window.dispatchEvent(
    new CustomEvent<AppThemeMode>(APP_THEME_MODE_CHANGE_EVENT, { detail: "sun" }),
  );
}

export function applyAppTheme(theme: AppTheme): void {
  // Choosing Light or Dark is an explicit return to manual mode.
  applyAppThemeMode("manual");
  rememberEffectiveAppTheme(theme);
  window.dispatchEvent(
    new CustomEvent<AppTheme>(APP_THEME_CHANGE_EVENT, { detail: theme }),
  );
}
