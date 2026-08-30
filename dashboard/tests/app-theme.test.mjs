import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  APP_THEME_CHANGE_EVENT,
  APP_THEME_LOCATION_STORAGE_KEY,
  APP_THEME_MESSAGE,
  APP_THEME_MODE_STORAGE_KEY,
  APP_THEME_STORAGE_KEY,
  appThemeForMoment,
  appThemeScheduleForShell,
  getStoredAppTheme,
  getStoredAppThemeLocation,
  getStoredAppThemeMode,
  isAppTheme,
  isAppThemeMode,
  nextAppThemeTransition,
  solarTimesForDate,
} from "../src/lib/app-theme.ts";

const layout = fs.readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const runtime = fs.readFileSync(
  new URL("../src/app/components/app-theme-runtime.tsx", import.meta.url),
  "utf8",
);
const dashboard = fs.readFileSync(
  new URL("../src/app/dashboard/dashboard-client.tsx", import.meta.url),
  "utf8",
);
const globals = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const animation = fs.readFileSync(
  new URL("../src/app/components/navbar-flower-wind.tsx", import.meta.url),
  "utf8",
);
const animationStyles = fs.readFileSync(
  new URL("../src/app/components/navbar-flower-wind.module.css", import.meta.url),
  "utf8",
);
const quartzTheme = fs.readFileSync(
  new URL("../../quartz/quartz/components/scripts/darkmode.inline.ts", import.meta.url),
  "utf8",
);
const login = fs.readFileSync(new URL("../src/app/auth/login/page.tsx", import.meta.url), "utf8");
const profile = fs.readFileSync(
  new URL("../src/app/profile/profile-client.tsx", import.meta.url),
  "utf8",
);

test("theme preference accepts only explicit light and dark values", () => {
  assert.equal(APP_THEME_STORAGE_KEY, "breadboard:theme");
  assert.equal(APP_THEME_CHANGE_EVENT, "breadboard:theme-change");
  assert.equal(APP_THEME_MESSAGE, "breadboard:theme");
  assert.equal(isAppTheme("light"), true);
  assert.equal(isAppTheme("dark"), true);
  assert.equal(isAppTheme("system"), false);
  assert.equal(getStoredAppTheme({ getItem: () => "dark" }), "dark");
  assert.equal(getStoredAppTheme({ getItem: () => "unexpected" }), "light");
  assert.equal(
    getStoredAppTheme({
      getItem: () => {
        throw new Error("storage disabled");
      },
    }),
    "light",
  );
});

test("automatic theme mode validates its preference and coarse location", () => {
  assert.equal(APP_THEME_MODE_STORAGE_KEY, "breadboard:theme-mode");
  assert.equal(APP_THEME_LOCATION_STORAGE_KEY, "breadboard:theme-location");
  assert.equal(isAppThemeMode("manual"), true);
  assert.equal(isAppThemeMode("sun"), true);
  assert.equal(isAppThemeMode("system"), false);
  assert.equal(getStoredAppThemeMode({ getItem: () => "sun" }), "sun");
  assert.equal(getStoredAppThemeMode({ getItem: () => "unexpected" }), "manual");
  assert.deepEqual(
    getStoredAppThemeLocation({
      getItem: () => JSON.stringify({ latitude: 41.008, longitude: 28.978 }),
    }),
    { latitude: 41.008, longitude: 28.978 },
  );
  assert.equal(
    getStoredAppThemeLocation({
      getItem: () => JSON.stringify({ latitude: 91, longitude: 0 }),
    }),
    null,
  );
});

test("sunrise mode is light only between the local solar transitions", () => {
  const location = { latitude: 41.008, longitude: 28.978 };
  const noon = new Date(2026, 5, 21, 12);
  const times = solarTimesForDate(noon, location);
  assert.ok(times);
  assert.ok(times.sunrise < times.sunset);

  const daylight = new Date((times.sunrise.getTime() + times.sunset.getTime()) / 2);
  assert.equal(appThemeForMoment(daylight, location), "light");
  assert.equal(
    appThemeForMoment(new Date(times.sunrise.getTime() - 1), location),
    "dark",
  );
  assert.equal(appThemeForMoment(times.sunset, location), "dark");
  assert.equal(
    nextAppThemeTransition(new Date(times.sunrise.getTime() - 1), location).getTime(),
    times.sunrise.getTime(),
  );
  assert.equal(
    nextAppThemeTransition(new Date(times.sunrise.getTime() + 1), location).getTime(),
    times.sunset.getTime(),
  );
});

test("automatic theme has a deterministic local-clock fallback", () => {
  assert.equal(appThemeForMoment(new Date(2026, 0, 1, 5, 59), null), "dark");
  assert.equal(appThemeForMoment(new Date(2026, 0, 1, 6), null), "light");
  assert.equal(appThemeForMoment(new Date(2026, 0, 1, 17, 59), null), "light");
  assert.equal(appThemeForMoment(new Date(2026, 0, 1, 18), null), "dark");
});

test("the remembered theme initializes before paint and is configurable from the pencil", () => {
  assert.match(layout, /themeInitializationScript/);
  assert.match(layout, /suppressHydrationWarning/);
  assert.match(layout, /<AppThemeRuntime\s*\/>/);
  assert.match(dashboard, /aria-label="Customize dashboard appearance"/);
  assert.match(dashboard, /applyAppTheme\(theme\)/);
  assert.match(dashboard, /role="radiogroup"/);
  assert.match(
    runtime,
    /setTheme\?\.\(theme, appThemeScheduleForShell\(window\.localStorage\)\)/,
  );
  assert.match(runtime, /document\.querySelectorAll\("iframe"\)/);
  assert.match(runtime, /nextAppThemeTransition/);
  // A timer armed for the exact sunrise instant is a monotonic-clock deadline
  // that a sleeping machine never reaches, so automatic mode re-reads the wall
  // clock at least once a minute instead of trusting one long countdown.
  assert.match(runtime, /const THEME_RECHECK_INTERVAL_MS = 60_000;/);
  assert.match(runtime, /Math\.min\(\s*THEME_RECHECK_INTERVAL_MS,/);
  assert.match(runtime, /window\.addEventListener\("focus", handleModeChange\)/);
  assert.match(profile, /title="Theme"/);
  assert.match(profile, /Sunrise to sunset/);
  assert.match(profile, /applyAppThemeMode\("sun"\)/);
  // Sunrise and sunset need a fix from whichever source this machine has, not
  // from the browser alone — inside the desktop shell the browser has none.
  assert.match(profile, /requestCurrentLocationFix\(\{ maxAgeMs: 7 \* 86_400_000 \}\)/);
});

test("dark mode uses charcoal paper and Breadboard's pastel utility bridge", () => {
  assert.match(globals, /:root\[data-theme="dark"\]\s*\{/);
  assert.match(globals, /--paper-bg:\s*#0b0c0a/);
  assert.match(globals, /--paper-surface:\s*#171916/);
  assert.match(globals, /--ink:\s*#ccd2c9/);
  assert.match(globals, /--botanical:\s*#91b7a1/);
  assert.match(globals, /--botanical-2:\s*#9fb5c4/);
  assert.match(globals, /--botanical-3:\s*#a8c4bb/);
  assert.match(globals, /--danger:\s*#c98282/);
  assert.match(globals, /--color-gray-950:\s*var\(--bb-color-gray-950, #f5f3ee\)/);
  assert.match(globals, /--bb-color-gray-950:\s*#0b0c0a/);
  assert.match(globals, /--color-amber-400:\s*#c5a963/);
  assert.doesNotMatch(globals, /filter:\s*grayscale\(1\)/);
  assert.doesNotMatch(globals, /Aurora dark|#38bdf8|#a78bfa|#2dd4bf/);
  assert.match(globals, /html\[data-theme="dark"\] \.desktop-title-bar/);
  assert.match(globals, /html\[data-theme="dark"\] \.bb-neu-toolbar/);
  assert.match(login, /bg-\[var\(--paper-surface\)\]/);
  assert.match(login, /bg-gray-900/);
});

test("dark navbars use a reduced-motion-aware randomized pastel sky", () => {
  assert.match(animation, /const STAR_COUNT = 56/);
  assert.match(animation, /styles\.skyAnimation/);
  assert.match(animation, /createStars\(Math\.random\)/);
  assert.match(animation, /createComets\(Math\.random\)/);
  assert.match(animationStyles, /html\[data-theme="dark"\].*\.skyAnimation/);
  assert.match(animationStyles, /@keyframes starTwinkle/);
  assert.match(animationStyles, /@keyframes cometPass/);
  assert.match(animationStyles, /prefers-reduced-motion: reduce/);
});

test("the embedded Quartz reader accepts the dashboard theme message", () => {
  assert.match(quartzTheme, /event\.source !== window\.parent/);
  assert.match(quartzTheme, /message\?\.type !== "breadboard:theme"/);
  assert.match(quartzTheme, /applyTheme\(message\.theme\)/);
});

test("the desktop shell is told the day's sunrise and sunset, never the coordinates", () => {
  const storage = new Map();
  const readable = { getItem: (key) => storage.get(key) ?? null };
  // Off: the shell replays the last theme it was given.
  assert.deepEqual(appThemeScheduleForShell(readable, new Date(2026, 5, 21, 12)), {
    mode: "manual",
  });

  // On without a fix: the 06:00/18:00 fallback, in minutes of the local day.
  storage.set(APP_THEME_MODE_STORAGE_KEY, "sun");
  assert.deepEqual(appThemeScheduleForShell(readable, new Date(2026, 5, 21, 12)), {
    mode: "sun",
    sunriseMinutes: 6 * 60,
    sunsetMinutes: 18 * 60,
  });

  // On with a fix: the same instants appThemeForMoment switches on, and
  // nothing about where they were computed for.
  storage.set(
    APP_THEME_LOCATION_STORAGE_KEY,
    JSON.stringify({ latitude: 51.5, longitude: -0.12 }),
  );
  const noon = new Date(2026, 5, 21, 12);
  const schedule = appThemeScheduleForShell(readable, noon);
  assert.equal(schedule.mode, "sun");
  assert.equal(Object.keys(schedule).sort().join(","), "mode,sunriseMinutes,sunsetMinutes");
  const minuteOf = (date) => date.getHours() * 60 + date.getMinutes();
  const times = solarTimesForDate(noon, getStoredAppThemeLocation(readable));
  assert.equal(schedule.sunriseMinutes, minuteOf(times.sunrise));
  assert.equal(schedule.sunsetMinutes, minuteOf(times.sunset));
  assert.ok(schedule.sunriseMinutes < schedule.sunsetMinutes);
});
