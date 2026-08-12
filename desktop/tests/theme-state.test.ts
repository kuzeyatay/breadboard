import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  WINDOW_THEME_STATE_FILE,
  readLastWindowTheme,
  writeLastWindowTheme,
} from "../src/main/theme-state";

test("desktop remembers the last effective window theme across launches", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-window-theme-"));
  try {
    assert.equal(readLastWindowTheme(fixture), "light");

    writeLastWindowTheme(fixture, "dark");
    assert.equal(readLastWindowTheme(fixture), "dark");
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(path.join(fixture, WINDOW_THEME_STATE_FILE), "utf8"),
      ),
      { theme: "dark" },
    );

    writeLastWindowTheme(fixture, "light");
    assert.equal(readLastWindowTheme(fixture), "light");

    fs.writeFileSync(
      path.join(fixture, WINDOW_THEME_STATE_FILE),
      JSON.stringify({ theme: "sepia" }),
    );
    assert.equal(readLastWindowTheme(fixture), "light");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
