// Relative, with extensions: the node tests import this module directly.
import {
  persistComposerSwitch,
  registerComposerSwitch,
} from "../app/components/composer-switch-preferences.ts";
import {
  inDesktopShell,
  requestCurrentLocationFix,
} from "./current-location-source.ts";

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
  const times = effectiveSolarTimes(now, location);
  return now >= times.sunrise && now < times.sunset ? "light" : "dark";
}

/**
 * The sunrise and sunset the theme follows on `now`'s calendar day: the
 * location's when one is stored and the sun rises there that day, otherwise
 * the 06:00/18:00 fallback.
 */
export function effectiveSolarTimes(
  now: Date,
  location: AppThemeLocation | null,
): SolarTimes {
  return (
    (location ? solarTimesForDate(now, location) : null) ?? fallbackSolarTimes(now)
  );
}

export function nextAppThemeTransition(
  now: Date,
  location: AppThemeLocation | null,
): Date {
  const today = effectiveSolarTimes(now, location);
  if (now < today.sunrise) return today.sunrise;
  if (now < today.sunset) return today.sunset;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12);
  return effectiveSolarTimes(tomorrow, location).sunrise;
}

/**
 * What the desktop shell is told alongside every theme, so that it can open
 * the next launch on the right side of sunrise before this page has painted.
 *
 * The shell keeps only the local-clock minutes of today's sunrise and sunset,
 * never the coordinates they came from; those stay in this origin's storage.
 * Mirrors `WindowThemeSchedule` in desktop/src/shared/ipc-contract.ts.
 */
export type AppThemeSchedule =
  | { mode: "manual" }
  | { mode: "sun"; sunriseMinutes: number; sunsetMinutes: number };

function minuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function appThemeScheduleForShell(
  storage: Pick<Storage, "getItem">,
  now: Date = new Date(),
): AppThemeSchedule {
  if (getStoredAppThemeMode(storage) !== "sun") return { mode: "manual" };
  const times = effectiveSolarTimes(now, getStoredAppThemeLocation(storage));
  return {
    mode: "sun",
    sunriseMinutes: minuteOfDay(times.sunrise),
    sunsetMinutes: minuteOfDay(times.sunset),
  };
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Applying the preference in this renderer is still useful when storage is
    // unavailable (for example, in a locked-down browser context).
  }
}

let activeThemeTransition: ViewTransition | null = null;
let pendingAppTheme: AppTheme | null = null;
let themeTransitionSequence = 0;

/**
 * Paint a changed theme as a short crossfade. The first render stays instant:
 * the inline layout script has already selected its theme before this module
 * runs, and animating hydration would turn a correct first paint into a flash.
 */
export function rememberEffectiveAppTheme(
  theme: AppTheme,
  options: { animate?: boolean } = {},
): void {
  writeStorage(APP_THEME_STORAGE_KEY, theme);

  const root = document.documentElement;
  const currentTheme = root.dataset.theme;
  if (pendingAppTheme === theme) return;
  if (currentTheme === theme && pendingAppTheme === null) return;

  const canAnimate =
    options.animate !== false &&
    isAppTheme(currentTheme) &&
    currentTheme !== theme &&
    document.visibilityState !== "hidden" &&
    typeof document.startViewTransition === "function";
  const sequence = ++themeTransitionSequence;

  activeThemeTransition?.skipTransition();
  activeThemeTransition = null;
  pendingAppTheme = null;

  if (!canAnimate) {
    delete root.dataset.themeTransition;
    root.dataset.theme = theme;
    return;
  }

  root.dataset.themeTransition = "true";
  pendingAppTheme = theme;
  try {
    const transition = document.startViewTransition(() => {
      if (sequence !== themeTransitionSequence) return;
      root.dataset.theme = theme;
    });
    activeThemeTransition = transition;
    void transition.finished
      .catch(() => undefined)
      .then(() => {
        if (sequence !== themeTransitionSequence) return;
        activeThemeTransition = null;
        pendingAppTheme = null;
        delete root.dataset.themeTransition;
      });
  } catch {
    activeThemeTransition = null;
    pendingAppTheme = null;
    delete root.dataset.themeTransition;
    root.dataset.theme = theme;
  }
}

/**
 * Choose between a fixed theme and following the sun.
 *
 * The choice is written to this origin's localStorage for the next paint and
 * through to the account so it is still there after a restart — the desktop
 * dashboard opens on a different loopback port each launch, and that port is a
 * different origin with an empty localStorage. Hydration from the account
 * passes `persist: false`: it is replaying a choice, not making one.
 */
export function applyAppThemeMode(
  mode: AppThemeMode,
  options: { persist?: boolean } = {},
): void {
  writeStorage(APP_THEME_MODE_STORAGE_KEY, mode);
  if (options.persist !== false) persistComposerSwitch("sunTheme", mode === "sun");
  window.dispatchEvent(
    new CustomEvent<AppThemeMode>(APP_THEME_MODE_CHANGE_EVENT, { detail: mode }),
  );
}

/**
 * The account's copy of the switch, arriving on page load.
 *
 * The coordinates sunrise and sunset are computed from stay on the device, so
 * a fresh origin has the switch back but not the fix. Inside the desktop shell
 * the operating system can answer that without a prompt (the server asks it),
 * so the fix is fetched again; a browser keeps its origin across restarts and
 * still has the one it stored, and is never prompted for location unasked.
 * Until a fix lands, the 06:00/18:00 fallback applies, as it always has.
 */
function applyRemoteSunTheme(enabled: boolean): void {
  applyAppThemeMode(enabled ? "sun" : "manual", { persist: false });
  if (!enabled || !inDesktopShell()) return;
  if (getStoredAppThemeLocation(window.localStorage)) return;
  void requestCurrentLocationFix({ maxAgeMs: 7 * 86_400_000 })
    .then((attempt) => {
      if (attempt.ok) rememberAppThemeLocation(attempt.fix);
    })
    .catch(() => {
      // The fallback times stand until the profile asks again.
    });
}

registerComposerSwitch("sunTheme", applyRemoteSunTheme);

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
