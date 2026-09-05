import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  APP_THEME_CHANGE_EVENT,
  APP_THEME_LOCATION_STORAGE_KEY,
  APP_THEME_MESSAGE,
  APP_THEME_MODE_STORAGE_KEY,
  APP_THEME_OVERRIDE_STORAGE_KEY,
  APP_THEME_STORAGE_KEY,
  appThemeForMoment,
  appThemeScheduleForShell,
  applyAppTheme,
  applyAppThemeMode,
  getStoredAppTheme,
  getStoredAppThemeLocation,
  getStoredAppThemeMode,
  getStoredAppThemeOverrideUntil,
  isAppTheme,
  isAppThemeMode,
  nextAppThemeTransition,
  rememberEffectiveAppTheme,
  resolveAppTheme,
  solarTimesForDate,
} from "../src/lib/app-theme.ts";
import { quartzUrlWithTheme } from "../src/lib/quartz-url.ts";

const layout = fs.readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const home = fs.readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const runtime = fs.readFileSync(
  new URL("../src/app/components/app-theme-runtime.tsx", import.meta.url),
  "utf8",
);
const dashboard = fs.readFileSync(
  new URL("../src/app/dashboard/dashboard-client.tsx", import.meta.url),
  "utf8",
);
const newTab = fs.readFileSync(new URL("../src/app/new-tab/new-tab-client.tsx", import.meta.url), "utf8");
const appearance = fs.readFileSync(new URL("../src/app/components/page-appearance.tsx", import.meta.url), "utf8");
const globals = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const themeTransition = fs.readFileSync(
  new URL("../src/app/app-theme-transition.css", import.meta.url),
  "utf8",
);
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
const gardenClient = fs.readFileSync(
  new URL("../src/app/garden/[clusterSlug]/garden-client.tsx", import.meta.url),
  "utf8",
);
const libraryGardenClient = fs.readFileSync(
  new URL("../src/app/garden/library-garden-client.tsx", import.meta.url),
  "utf8",
);
const gardenQuartzFrame = fs.readFileSync(
  new URL("../src/app/garden/garden-quartz-frame.tsx", import.meta.url),
  "utf8",
);

function runThemeInitialization({ stored, search, storageThrows = false }) {
  const script = layout.match(
    /const themeInitializationScript = `([^`]*)`;/,
  )?.[1];
  assert.ok(script, "theme initialization script should be extractable");
  const values = new Map();
  if (stored !== undefined) values.set("breadboard:theme", stored);
  const documentElement = { dataset: {} };
  vm.runInNewContext(script, {
    URLSearchParams,
    location: { search },
    document: { documentElement },
    localStorage: {
      getItem(key) {
        if (storageThrows) throw new Error("storage unavailable");
        return values.get(key) ?? null;
      },
      setItem(key, value) {
        if (storageThrows) throw new Error("storage unavailable");
        values.set(key, value);
      },
    },
  });
  return { theme: documentElement.dataset.theme, stored: values.get("breadboard:theme") };
}

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

test("a manual pick under the sun switch holds until the next transition, then the sun resumes", () => {
  const storage = new Map();
  const readable = { getItem: (key) => storage.get(key) ?? null };
  const location = { latitude: 41.008, longitude: 28.978 };
  const noon = new Date(2026, 5, 21, 12);
  const { sunset } = solarTimesForDate(noon, location);
  storage.set(APP_THEME_LOCATION_STORAGE_KEY, JSON.stringify(location));

  // Manual mode never consults the override.
  storage.set(APP_THEME_STORAGE_KEY, "dark");
  storage.set(APP_THEME_OVERRIDE_STORAGE_KEY, String(sunset.getTime()));
  assert.deepEqual(resolveAppTheme(readable, noon), {
    theme: "dark",
    mode: "manual",
    overridden: false,
  });

  // Sun mode at noon says light, unless a pick is standing.
  storage.set(APP_THEME_MODE_STORAGE_KEY, "sun");
  assert.deepEqual(resolveAppTheme(readable, noon), {
    theme: "dark",
    mode: "sun",
    overridden: true,
  });
  // The minute after sunset the pick has expired and the sun answers again,
  // without anyone having touched the mode.
  assert.deepEqual(resolveAppTheme(readable, new Date(sunset.getTime() + 60_000)), {
    theme: "dark",
    mode: "sun",
    overridden: false,
  });
  storage.delete(APP_THEME_OVERRIDE_STORAGE_KEY);
  assert.deepEqual(resolveAppTheme(readable, noon), {
    theme: "light",
    mode: "sun",
    overridden: false,
  });

  // Garbage in the override slot is no override.
  assert.equal(getStoredAppThemeOverrideUntil({ getItem: () => "soon" }), null);
  assert.equal(getStoredAppThemeOverrideUntil({ getItem: () => "-5" }), null);
  assert.equal(getStoredAppThemeOverrideUntil({ getItem: () => "1700000000000" }), 1_700_000_000_000);
});

test("picking a theme records an override only while following the sun, and flipping the switch clears it", () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const stored = new Map();
  const events = [];
  const localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: (key) => stored.delete(key),
  };
  globalThis.window = {
    localStorage,
    dispatchEvent: (event) => events.push(event.type),
  };
  globalThis.CustomEvent ??= class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  globalThis.document = {
    documentElement: { dataset: { theme: "light" } },
    visibilityState: "hidden",
  };
  globalThis.fetch = () => Promise.reject(new Error("offline"));

  try {
    // Manual mode: a pick is just the theme.
    applyAppTheme("dark");
    assert.equal(stored.get(APP_THEME_STORAGE_KEY), "dark");
    assert.equal(stored.has(APP_THEME_OVERRIDE_STORAGE_KEY), false);

    // Sun mode: the pick is remembered together with the instant it lapses,
    // which is the next sunrise or sunset, and the switch itself stays on.
    stored.set(APP_THEME_MODE_STORAGE_KEY, "sun");
    const before = Date.now();
    applyAppTheme("light");
    const until = Number(stored.get(APP_THEME_OVERRIDE_STORAGE_KEY));
    assert.equal(stored.get(APP_THEME_MODE_STORAGE_KEY), "sun");
    assert.equal(until, nextAppThemeTransition(new Date(before), null).getTime());
    assert.ok(until > before);
    assert.deepEqual(resolveAppTheme(localStorage, new Date(before)), {
      theme: "light",
      mode: "sun",
      overridden: true,
    });

    // The account replaying the switch on page load is not a new decision.
    applyAppThemeMode("sun", { persist: false });
    assert.equal(stored.has(APP_THEME_OVERRIDE_STORAGE_KEY), true);
    // The person flipping it is.
    applyAppThemeMode("manual");
    assert.equal(stored.has(APP_THEME_OVERRIDE_STORAGE_KEY), false);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
  }
});

test("the remembered theme initializes before paint and is configurable from the pencil", () => {
  assert.match(layout, /themeInitializationScript/);
  // Desktop launches can move to a new loopback origin or reuse one containing
  // an older choice. The durable shell decision seeds that origin before paint.
  assert.match(layout, /new URLSearchParams\(location\.search\)\.get\("theme"\)/);
  assert.match(layout, /localStorage\.setItem\(key,theme\)/);
  assert.ok(
    layout.indexOf("new URLSearchParams(location.search)") <
      layout.indexOf("localStorage.getItem(key)"),
  );
  assert.match(layout, /suppressHydrationWarning/);
  assert.match(layout, /<AppThemeRuntime\s*\/>/);
  assert.match(dashboard, /<PageAppearance page="dashboard"/);
  assert.match(newTab, /<PageAppearance page="new-tab"/);
  assert.match(appearance, /aria-label="Customize appearance"/);
  assert.match(appearance, /applyAppTheme\(theme\)/);
  assert.match(appearance, /aria-label="App theme"/);
  assert.match(
    runtime,
    /setTheme\?\.\(theme, appThemeScheduleForShell\(window\.localStorage\)\)/,
  );
  assert.match(runtime, /document\.querySelectorAll\("iframe"\)/);
  assert.match(runtime, /nextAppThemeTransition/);
  assert.match(runtime, /window\.history\.replaceState\(window\.history\.state, "", current\)/);
  // A timer armed for the exact sunrise instant is a monotonic-clock deadline
  // that a sleeping machine never reaches, so automatic mode re-reads the wall
  // clock at least once a minute instead of trusting one long countdown.
  assert.match(runtime, /const THEME_RECHECK_INTERVAL_MS = 60_000;/);
  assert.match(runtime, /Math\.min\(\s*THEME_RECHECK_INTERVAL_MS,/);
  assert.match(runtime, /window\.addEventListener\("focus", handleModeChange\)/);
  // Every recheck (the minute tick, focus, visibility, the account replaying
  // the switch) goes through the resolver, so a manual pick made under the
  // sun switch is not put back to the sun's answer before the next transition.
  assert.match(runtime, /resolveAppTheme\(window\.localStorage, now\)/);
  assert.doesNotMatch(runtime, /appThemeForMoment/);
  assert.match(runtime, /event\.key === APP_THEME_OVERRIDE_STORAGE_KEY/);
  assert.match(profile, /title="Theme"/);
  assert.match(profile, /Sunrise to sunset/);
  assert.match(profile, /applyAppThemeMode\("sun"\)/);
  // Sunrise and sunset need a fix from whichever source this machine has, not
  // from the browser alone — inside the desktop shell the browser has none.
  assert.match(profile, /requestCurrentLocationFix\(\{ maxAgeMs: 7 \* 86_400_000 \}\)/);
});

test("the durable desktop launch theme overrides an empty or stale origin", () => {
  // The desktop opens the origin root. Its server redirect must not discard
  // the loading screen's decision before the final dashboard document exists.
  assert.match(home, /searchParams:\s*Promise<\{ theme\?: string \| string\[\] \}>/);
  assert.match(home, /theme === "dark" \|\| theme === "light"/);
  assert.match(home, /`\/dashboard\?theme=\$\{theme\}`/);
  assert.deepEqual(runThemeInitialization({ search: "?theme=dark" }), {
    theme: "dark",
    stored: "dark",
  });
  assert.deepEqual(
    runThemeInitialization({ stored: "light", search: "?theme=dark" }),
    { theme: "dark", stored: "dark" },
  );
  assert.deepEqual(
    runThemeInitialization({ search: "?theme=dark", storageThrows: true }),
    { theme: "dark", stored: undefined },
  );
  assert.deepEqual(runThemeInitialization({ search: "?theme=sepia" }), {
    theme: undefined,
    stored: undefined,
  });
});

test("theme changes crossfade without moving the page", () => {
  assert.match(layout, /import "\.\/app-theme-transition\.css"/);
  assert.match(runtime, /rememberEffectiveAppTheme\(theme, \{ animate: changed \}\)/);
  assert.match(themeTransition, /::view-transition-old\(root\)/);
  assert.match(themeTransition, /::view-transition-new\(root\)/);
  assert.match(themeTransition, /animation-duration:\s*200ms/);
  assert.match(themeTransition, /cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
  assert.match(themeTransition, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(themeTransition, /transform:/);
});

test("a rapid theme reversal interrupts the in-flight crossfade", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const stored = new Map();
  const root = { dataset: { theme: "light" } };
  const callbacks = [];
  const finishers = [];
  let skipped = 0;

  globalThis.window = {
    localStorage: {
      setItem(key, value) {
        stored.set(key, value);
      },
    },
  };
  globalThis.document = {
    documentElement: root,
    visibilityState: "visible",
    startViewTransition(callback) {
      callbacks.push(callback);
      let finish;
      const finished = new Promise((resolve) => {
        finish = resolve;
      });
      finishers.push(finish);
      return {
        finished,
        skipTransition() {
          skipped += 1;
        },
      };
    },
  };

  try {
    rememberEffectiveAppTheme("dark");
    rememberEffectiveAppTheme("light");
    callbacks[0]();
    finishers[0]();
    await Promise.resolve();

    assert.equal(skipped, 1);
    assert.equal(root.dataset.theme, "light");
    assert.equal(stored.get(APP_THEME_STORAGE_KEY), "light");
    assert.equal(root.dataset.themeTransition, undefined);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
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

test("navbar gardens share a deterministic, wall-clock-synchronized animation", () => {
  assert.match(animation, /const STAR_COUNT = 56/);
  assert.match(animation, /styles\.skyAnimation/);
  assert.doesNotMatch(animation, /createPlants\(Math\.random\)/);
  assert.doesNotMatch(animation, /createStars\(Math\.random\)/);
  assert.doesNotMatch(animation, /createComets\(Math\.random\)/);
  assert.match(animation, /function synchronizedDelay/);
  assert.match(animation, /setAnimationClockMs\(Date\.now\(\)\)/);
  assert.match(animation, /data-animation-ready=\{animationReady\}/);
  assert.match(animationStyles, /html\[data-theme="dark"\].*\.skyAnimation/);
  assert.match(animationStyles, /@keyframes starTwinkle/);
  assert.match(animationStyles, /@keyframes cometPass/);
  assert.match(animationStyles, /animation-play-state:\s*paused/);
  assert.match(animationStyles, /prefers-reduced-motion: reduce/);
});

test("the embedded Quartz reader accepts the dashboard theme message", () => {
  assert.match(quartzTheme, /event\.source !== window\.parent/);
  assert.match(quartzTheme, /message\?\.type !== "breadboard:theme"/);
  assert.match(quartzTheme, /applyTheme\(message\.theme\)/);
  assert.match(
    quartzTheme,
    /localStorage\.setItem\("theme", requestedTheme\)/,
    "the initial iframe theme must survive navigation to another Markdown page",
  );
});

test("Quartz iframe URLs carry the dashboard theme before first paint", () => {
  assert.equal(
    quartzUrlWithTheme("http://localhost:8081/physics-for-ee/?refresh=12", "light"),
    "http://localhost:8081/physics-for-ee/?refresh=12&theme=light",
  );
  assert.equal(
    quartzUrlWithTheme("http://localhost:8081/physics-for-ee/?theme=dark", "light"),
    "http://localhost:8081/physics-for-ee/?theme=light",
  );
  assert.equal(
    quartzUrlWithTheme("http://localhost:8081/physics-for-ee/", "sepia"),
    "http://localhost:8081/physics-for-ee/",
  );
  assert.match(gardenClient, /src=\{[\s\S]*quartzUrlWithAppTheme\(/);
  assert.match(libraryGardenClient, /src=\{quartzLease\.ready \? quartzUrlWithAppTheme\(src\)/);
  assert.match(gardenQuartzFrame, /src=\{quartzLease\.ready \? quartzUrlWithAppTheme\(src\)/);
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
