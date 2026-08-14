// Which source is asked for a fix, in which order, and what is reported when
// neither can answer. The desktop shell is the case that matters: Electron's
// Chromium has no geolocation provider, so a page that only asks the browser
// there gets a failure that looks exactly like a refusal.

import assert from "node:assert/strict";
import test from "node:test";

import {
  inDesktopShell,
  requestCurrentLocationFix,
} from "../src/lib/current-location-source.ts";

const POSITION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;

function define(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

/**
 * Stand in for the two sources. `browser` is either a fix, an error code, or
 * null for a runtime with no geolocation at all; `system` is the JSON body the
 * local route would return, or null for a request that never lands.
 */
function environment({ shell = false, browser = null, system = null } = {}) {
  const asked = [];
  define("window", shell ? { breadboardDesktop: { allowThemeLocation: async () => true } } : {});
  define("navigator", {
    geolocation: browser === null
      ? undefined
      : {
          getCurrentPosition(onFix, onFailure) {
            asked.push("browser");
            if (typeof browser === "number") {
              onFailure({
                code: browser,
                PERMISSION_DENIED: POSITION_DENIED,
                POSITION_UNAVAILABLE,
              });
              return;
            }
            onFix({ coords: { ...browser } });
          },
        },
  });
  if (browser === null) delete globalThis.navigator.geolocation;
  define("fetch", async () => {
    asked.push("system");
    if (!system) throw new Error("no route");
    return { json: async () => system };
  });
  return asked;
}

test.afterEach(() => {
  for (const name of ["window", "navigator", "fetch"]) delete globalThis[name];
});

test("the desktop shell asks the operating system before the browser", async () => {
  const asked = environment({
    shell: true,
    browser: POSITION_UNAVAILABLE,
    system: { state: "available", latitude: 40.94, longitude: 29.11, accuracyMeters: 97 },
  });
  assert.equal(inDesktopShell(), true);
  const attempt = await requestCurrentLocationFix();
  assert.deepEqual(attempt, {
    ok: true,
    fix: { latitude: 40.94, longitude: 29.11, accuracyMeters: 97, source: "system" },
  });
  // The browser is never troubled for an answer it cannot give.
  assert.deepEqual(asked, ["system"]);
});

test("a browser that can answer is not routed through the machine", async () => {
  const asked = environment({
    browser: { latitude: 1.5, longitude: 2.5, accuracy: 30 },
    system: { state: "available", latitude: 9, longitude: 9, accuracyMeters: 10 },
  });
  assert.equal(inDesktopShell(), false);
  const attempt = await requestCurrentLocationFix();
  assert.equal(attempt.ok, true);
  assert.equal(attempt.fix.source, "browser");
  assert.deepEqual(asked, ["browser"]);
});

test("a browser with no provider falls back to the operating system", async () => {
  const asked = environment({
    browser: POSITION_UNAVAILABLE,
    system: { state: "available", latitude: 3, longitude: 4, accuracyMeters: 120 },
  });
  const attempt = await requestCurrentLocationFix();
  assert.equal(attempt.ok, true);
  assert.equal(attempt.fix.source, "system");
  assert.deepEqual(asked, ["browser", "system"]);
});

test("a runtime without geolocation at all still reaches the machine", async () => {
  environment({ browser: null, system: { state: "available", latitude: 3, longitude: 4 } });
  const attempt = await requestCurrentLocationFix();
  assert.equal(attempt.ok, true);
  assert.equal(attempt.fix.source, "system");
});

test("when both fail, the refusal is reported over the empty answer", async () => {
  // A refusal names something the person can go and change; "nothing answered"
  // leaves them nowhere, so it must not be the last word when a block is known.
  environment({
    browser: POSITION_UNAVAILABLE,
    system: { state: "blocked", reason: "The Windows location service is turned off." },
  });
  const both = await requestCurrentLocationFix();
  assert.deepEqual(both, {
    ok: false,
    kind: "blocked",
    message: "The Windows location service is turned off.",
  });

  environment({ browser: POSITION_DENIED, system: { state: "unavailable" } });
  const denied = await requestCurrentLocationFix();
  assert.equal(denied.ok, false);
  assert.equal(denied.kind, "blocked");
  assert.match(denied.message, /Allow location/);
});

test("nothing answering at all is an unavailable fix, not a block", async () => {
  environment({ browser: POSITION_UNAVAILABLE, system: null });
  const attempt = await requestCurrentLocationFix();
  assert.equal(attempt.ok, false);
  assert.equal(attempt.kind, "unavailable");
  assert.match(attempt.message, /could not determine/);
});
