import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "./runtime-config";
import type { WindowThemeSchedule } from "../shared/ipc-contract";
import type { BreadboardWindowTheme } from "./window-options";

export const WINDOW_THEME_STATE_FILE = "window-theme.json";

interface WindowThemeState {
  /** The theme the dashboard last painted. */
  theme: BreadboardWindowTheme;
  /** How the dashboard was choosing it at the time. */
  schedule: WindowThemeSchedule;
}

const MANUAL: WindowThemeSchedule = { mode: "manual" };

function isWindowTheme(value: unknown): value is BreadboardWindowTheme {
  return value === "light" || value === "dark";
}

function isMinuteOfDay(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < 24 * 60
  );
}

export function isWindowThemeSchedule(
  value: unknown,
): value is WindowThemeSchedule {
  if (!value || typeof value !== "object") return false;
  const candidate = value as {
    mode?: unknown;
    sunriseMinutes?: unknown;
    sunsetMinutes?: unknown;
  };
  if (candidate.mode === "manual") return true;
  return (
    candidate.mode === "sun" &&
    isMinuteOfDay(candidate.sunriseMinutes) &&
    isMinuteOfDay(candidate.sunsetMinutes)
  );
}

function readWindowThemeState(configDir: string): WindowThemeState {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(configDir, WINDOW_THEME_STATE_FILE), "utf8"),
    ) as { theme?: unknown; schedule?: unknown };
    return {
      theme: isWindowTheme(parsed.theme) ? parsed.theme : "light",
      schedule: isWindowThemeSchedule(parsed.schedule) ? parsed.schedule : MANUAL,
    };
  } catch {
    return { theme: "light", schedule: MANUAL };
  }
}

/**
 * The theme a sun schedule calls for at `now`, or null when the schedule is
 * not following the sun and the last painted theme stands.
 */
export function themeForWindowSchedule(
  schedule: WindowThemeSchedule,
  now: Date,
): BreadboardWindowTheme | null {
  if (schedule.mode !== "sun") return null;
  const minute = now.getHours() * 60 + now.getMinutes();
  const { sunriseMinutes, sunsetMinutes } = schedule;
  const daylight =
    sunriseMinutes <= sunsetMinutes
      ? minute >= sunriseMinutes && minute < sunsetMinutes
      : minute >= sunriseMinutes || minute < sunsetMinutes;
  return daylight ? "light" : "dark";
}

/**
 * The theme a launch at `now` should open in.
 *
 * The loading scene, the startup screen and the window chrome all paint
 * before the dashboard has decided anything, from this answer. With the sun
 * switch on it is resolved for the current clock rather than replayed: an app
 * closed at night and opened the next morning would otherwise show a dark
 * loading page in front of a dashboard about to turn light.
 */
export function readLastWindowTheme(
  configDir: string,
  now: Date = new Date(),
): BreadboardWindowTheme {
  const state = readWindowThemeState(configDir);
  return themeForWindowSchedule(state.schedule, now) ?? state.theme;
}

/**
 * Write the theme down, with the schedule it was chosen by when the caller
 * knows it. A caller naming only the theme (the voice overlay handing the
 * chrome back to the page) leaves the schedule already on disk as it is.
 */
export function writeLastWindowTheme(
  configDir: string,
  theme: BreadboardWindowTheme,
  schedule?: WindowThemeSchedule,
): void {
  const nextSchedule = schedule ?? readWindowThemeState(configDir).schedule;
  fs.mkdirSync(configDir, { recursive: true });
  atomicWriteFile(
    path.join(configDir, WINDOW_THEME_STATE_FILE),
    JSON.stringify({ theme, schedule: nextSchedule }, null, 2),
  );
}
