import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  WINDOW_THEME_STATE_FILE,
  isWindowThemeSchedule,
  readLastWindowTheme,
  themeForWindowSchedule,
  writeLastWindowTheme,
} from "../src/main/theme-state";

function withFixture(run: (fixture: string) => void): void {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-window-theme-"));
  try {
    run(fixture);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

test("desktop remembers the last effective window theme across launches", () => {
  withFixture((fixture) => {
    assert.equal(readLastWindowTheme(fixture), "light");

    writeLastWindowTheme(fixture, "dark");
    assert.equal(readLastWindowTheme(fixture), "dark");
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(path.join(fixture, WINDOW_THEME_STATE_FILE), "utf8"),
      ),
      { theme: "dark", schedule: { mode: "manual" } },
    );

    writeLastWindowTheme(fixture, "light");
    assert.equal(readLastWindowTheme(fixture), "light");

    // The file as it was written before schedules existed still reads.
    fs.writeFileSync(
      path.join(fixture, WINDOW_THEME_STATE_FILE),
      JSON.stringify({ theme: "dark" }),
    );
    assert.equal(readLastWindowTheme(fixture), "dark");

    fs.writeFileSync(
      path.join(fixture, WINDOW_THEME_STATE_FILE),
      JSON.stringify({ theme: "sepia" }),
    );
    assert.equal(readLastWindowTheme(fixture), "light");
  });
});

test("a launch under the sun schedule opens in the theme the clock calls for", () => {
  withFixture((fixture) => {
    // Closed at night, dark; opened the next morning, the loading scene must
    // not replay the dark it was closed in.
    writeLastWindowTheme(fixture, "dark", {
      mode: "sun",
      sunriseMinutes: 6 * 60 + 30,
      sunsetMinutes: 19 * 60 + 45,
    });
    assert.equal(readLastWindowTheme(fixture, new Date(2026, 7, 30, 9)), "light");
    assert.equal(readLastWindowTheme(fixture, new Date(2026, 7, 30, 6, 29)), "dark");
    assert.equal(readLastWindowTheme(fixture, new Date(2026, 7, 30, 6, 30)), "light");
    assert.equal(readLastWindowTheme(fixture, new Date(2026, 7, 30, 19, 44)), "light");
    assert.equal(readLastWindowTheme(fixture, new Date(2026, 7, 30, 19, 45)), "dark");
    assert.equal(readLastWindowTheme(fixture, new Date(2026, 7, 30, 3)), "dark");

    // The voice overlay hands the chrome back naming only the theme; the sun
    // schedule it never knew about is not lost with it.
    writeLastWindowTheme(fixture, "light");
    assert.equal(readLastWindowTheme(fixture, new Date(2026, 7, 30, 22)), "dark");

    // Switching the sun off replays the theme again.
    writeLastWindowTheme(fixture, "light", { mode: "manual" });
    assert.equal(readLastWindowTheme(fixture, new Date(2026, 7, 30, 22)), "light");
  });
});

test("only well-formed schedules cross the IPC boundary", () => {
  assert.equal(isWindowThemeSchedule({ mode: "manual" }), true);
  assert.equal(
    isWindowThemeSchedule({ mode: "sun", sunriseMinutes: 0, sunsetMinutes: 1439 }),
    true,
  );
  assert.equal(isWindowThemeSchedule({ mode: "sun", sunriseMinutes: 360 }), false);
  assert.equal(
    isWindowThemeSchedule({ mode: "sun", sunriseMinutes: 360, sunsetMinutes: 1440 }),
    false,
  );
  assert.equal(
    isWindowThemeSchedule({ mode: "sun", sunriseMinutes: 6.5, sunsetMinutes: 18 }),
    false,
  );
  assert.equal(isWindowThemeSchedule({ mode: "auto" }), false);
  assert.equal(isWindowThemeSchedule("sun"), false);
  assert.equal(isWindowThemeSchedule(null), false);

  assert.equal(themeForWindowSchedule({ mode: "manual" }, new Date()), null);
  // A schedule that wraps midnight still has a daylight side.
  const wrapped = { mode: "sun" as const, sunriseMinutes: 23 * 60, sunsetMinutes: 60 };
  assert.equal(themeForWindowSchedule(wrapped, new Date(2026, 0, 1, 23, 30)), "light");
  assert.equal(themeForWindowSchedule(wrapped, new Date(2026, 0, 1, 0, 30)), "light");
  assert.equal(themeForWindowSchedule(wrapped, new Date(2026, 0, 1, 12)), "dark");
});
