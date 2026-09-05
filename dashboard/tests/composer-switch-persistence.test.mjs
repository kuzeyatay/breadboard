// Browser switches survive a Breadboard restart.
//
// Each switch is a localStorage-backed store, and localStorage is keyed by
// origin. Runtime V2 serves the desktop dashboard on a fresh loopback port
// every launch, so after a restart the app opened on an origin that had never
// seen the switches and every one of them read as its default. The account now
// carries them: the stores write through on change and hydrate on load.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-switches-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const { getHermesUserSettings, setHermesUserSettings } = await import(
  "../src/lib/hermes/runtime-store.ts"
);
const { mergeComposerSwitches, pickComposerSwitches, parseComposerSwitches } =
  await import("../src/lib/hermes/composer-switches.ts");

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

/** A localStorage-shaped stub plus the window surface the stores subscribe to. */
function installBrowser(initial = {}) {
  const store = new Map(Object.entries(initial));
  const dispatched = [];
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent(event) {
      dispatched.push(event.type);
    },
  };
  globalThis.Event = class {
    constructor(type) {
      this.type = type;
    }
  };
  return { store, dispatched };
}

/** A fetch stub that answers the preferences GET and records every PATCH. */
function installFetch(payload) {
  const patches = [];
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(url, "/api/assistant-preferences");
    if (init.method === "PATCH") {
      patches.push(JSON.parse(init.body));
      return { ok: true, json: async () => payload };
    }
    return { ok: true, json: async () => payload };
  };
  return patches;
}

test("the account stores a partial switch record with the browser's coupling applied", () => {
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
  assert.deepEqual(getHermesUserSettings(1).composerSwitches, {});

  setHermesUserSettings(1, { composerSwitches: { personalize: false } });
  assert.deepEqual(getHermesUserSettings(1).composerSwitches, { personalize: false });

  // Super agent needs the agent runtime and the bypass policy.
  setHermesUserSettings(1, { composerSwitches: { superAgent: true } });
  assert.deepEqual(getHermesUserSettings(1).composerSwitches, {
    personalize: false,
    superAgent: true,
    agentMode: true,
    yoloMode: true,
  });

  // Agent mode off takes super agent with it; YOLO is its own choice.
  setHermesUserSettings(1, { composerSwitches: { agentMode: false } });
  assert.deepEqual(getHermesUserSettings(1).composerSwitches, {
    personalize: false,
    superAgent: false,
    agentMode: false,
    yoloMode: true,
  });

  // Choosing a model must not disturb the switches.
  setHermesUserSettings(1, { defaultModel: "gpt-5.6-terra" });
  assert.equal(getHermesUserSettings(1).composerSwitches.yoloMode, true);
});

test("unknown keys and non-boolean values are refused, and a corrupt column reads as empty", () => {
  assert.equal(pickComposerSwitches({ yoloMode: "true" }), null);
  assert.equal(pickComposerSwitches({ theme: true }), null);
  assert.equal(pickComposerSwitches([]), null);
  assert.deepEqual(pickComposerSwitches({}), {});
  assert.deepEqual(parseComposerSwitches("not json"), {});
  assert.deepEqual(parseComposerSwitches('{"yoloMode":true,"junk":1}'), {});
  assert.deepEqual(pickComposerSwitches({ currentLocation: true }), {
    currentLocation: true,
  });
  assert.deepEqual(
    mergeComposerSwitches({ superAgent: true, agentMode: true }, { agentMode: false }),
    { superAgent: false, agentMode: false },
  );
});

test("the preferences route reads and writes the switches beside the other account settings", () => {
  const route = source("../src/app/api/assistant-preferences/route.ts");
  assert.match(route, /switches: settings\.composerSwitches/);
  assert.match(route, /pickComposerSwitches\(body\.switches\)/);
  assert.match(route, /composerSwitches: switches/);
  // A switch-only PATCH is a complete request.
  assert.match(route, /switches === undefined\s*\)/);
});

test("every switch hydrates from the account on load and writes through on change", async () => {
  const { store, dispatched } = installBrowser({
    "breadboard:yolo-mode": "false",
    "breadboard:personalize": "true",
  });
  const patches = installFetch({
    model: "gpt-5.6-sol",
    switches: { yoloMode: true, agentMode: true, superAgent: true, directMode: true, personalize: false },
    humanizerAuto: true,
  });

  const bootstrap = await import("../src/lib/assistant-bootstrap-client.ts");
  bootstrap.resetAssistantPreferencesForTest();
  const preferences = await import("../src/app/components/composer-switch-preferences.ts");
  preferences.resetComposerSwitchPreferencesForTest();
  // First import of each store registers its applier, as a page load would.
  const yolo = await import("../src/app/components/use-yolo-mode.ts");
  const agent = await import("../src/app/components/use-agent-mode.ts");
  const direct = await import("../src/app/components/use-direct-mode.ts");
  const personalize = await import("../src/app/components/use-personalize.ts");
  const humanizer = await import("../src/app/components/use-humanizer-mode.ts");

  // A page load hydrates once; a second call shares the first.
  await preferences.hydrateComposerSwitches();
  await preferences.hydrateComposerSwitches();

  assert.equal(yolo.isYoloModeEnabled(), true);
  assert.equal(agent.isAgentModeEnabled(), true);
  assert.equal(agent.isSuperAgentEnabled(), true);
  assert.equal(direct.isDirectModeEnabled(), true);
  assert.equal(personalize.isPersonalizeEnabled(), false);
  assert.equal(humanizer.isHumanizerEnabled(), true);
  assert.equal(store.get("breadboard:super-agent"), "true");
  assert.equal(store.get("breadboard:direct-mode"), "true");
  assert.ok(dispatched.includes("breadboard:yolo-mode-change"));
  // Hydration never writes back: nothing chose these values just now.
  assert.deepEqual(patches, []);

  // A change writes through as a switch-only PATCH.
  yolo.setYoloModeEnabled(false);
  assert.deepEqual(patches.at(-1), { switches: { yoloMode: false } });
  agent.setAgentModeEnabled(false);
  assert.deepEqual(patches.slice(-2), [
    { switches: { agentMode: false } },
    { switches: { superAgent: false } },
  ]);
  assert.equal(agent.isSuperAgentEnabled(), false);
});

test("a switch touched while the account copy is in flight keeps the user's choice", async () => {
  installBrowser();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const patches = [];
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === "PATCH") {
      patches.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({}) };
    }
    await gate;
    return { ok: true, json: async () => ({ switches: { yoloMode: false, directMode: true } }) };
  };

  const bootstrap = await import("../src/lib/assistant-bootstrap-client.ts");
  bootstrap.resetAssistantPreferencesForTest();
  const preferences = await import("../src/app/components/composer-switch-preferences.ts");
  preferences.resetComposerSwitchPreferencesForTest();
  const yolo = await import("../src/app/components/use-yolo-mode.ts");
  const direct = await import("../src/app/components/use-direct-mode.ts");
  // The stores registered at their first import, before the reset above;
  // register again through the same public seam their modules use. These
  // appliers would visibly overwrite the browser copy if the guard failed.
  preferences.registerComposerSwitch("yoloMode", (value) => {
    window.localStorage.setItem("breadboard:yolo-mode", String(value));
  });
  preferences.registerComposerSwitch("directMode", (value) => {
    window.localStorage.setItem("breadboard:direct-mode", String(value));
  });

  const hydration = preferences.hydrateComposerSwitches();
  yolo.setYoloModeEnabled(true);
  release();
  await hydration;

  // YOLO was the user's click; Direct mode came from the account.
  assert.equal(yolo.isYoloModeEnabled(), true);
  assert.equal(direct.isDirectModeEnabled(), true);
  assert.deepEqual(patches, [{ switches: { yoloMode: true } }]);
});

test("the current-location consent switch hydrates after restart without syncing coordinates", async () => {
  const { store, dispatched } = installBrowser();
  const patches = installFetch({ switches: { currentLocation: true } });

  const bootstrap = await import("../src/lib/assistant-bootstrap-client.ts");
  bootstrap.resetAssistantPreferencesForTest();
  const preferences = await import("../src/app/components/composer-switch-preferences.ts");
  preferences.resetComposerSwitchPreferencesForTest();
  const location = await import(
    "../src/app/components/current-location-preference.ts"
  );

  await preferences.hydrateComposerSwitches();
  assert.deepEqual(JSON.parse(store.get("breadboard:current-location")), {
    useForAnswers: true,
    snapshot: null,
  });
  assert.ok(dispatched.includes("breadboard:current-location-change"));
  assert.deepEqual(patches, [], "hydration must not write the preference back");

  // A desktop installation's own setting wins after account hydration. This
  // is the copy that survives the shell choosing a new loopback port.
  let desktopEnabled = false;
  globalThis.window.breadboardDesktop = {
    getCurrentLocationPreference: async () => desktopEnabled,
    setCurrentLocationPreference: async (enabled) => {
      desktopEnabled = enabled;
      return true;
    },
  };
  await location.hydrateCurrentLocationPreference();
  assert.equal(store.has("breadboard:current-location"), false);

  await location.persistCurrentLocationPreference(true);
  assert.equal(desktopEnabled, true);
  assert.deepEqual(patches, [{ switches: { currentLocation: true } }]);

  await location.hydrateCurrentLocationPreference();
  assert.deepEqual(JSON.parse(store.get("breadboard:current-location")), {
    useForAnswers: true,
    snapshot: null,
  });

  // Turning the switch off is persisted, while applying the remote off state
  // removes the device-local fix rather than placing it on the account.
  await location.persistCurrentLocationPreference(false);
  assert.equal(desktopEnabled, false);
  assert.deepEqual(patches, [
    { switches: { currentLocation: true } },
    { switches: { currentLocation: false } },
  ]);
  location.applyRemoteCurrentLocationPreference(false);
  assert.equal(store.has("breadboard:current-location"), false);
  assert.equal(patches.length, 2);
});

test("the profile's sunrise-to-sunset switch rides the same column and comes back on every page", async () => {
  const { store, dispatched } = installBrowser({ "breadboard:theme-mode": "manual" });
  const patches = installFetch({ switches: { sunTheme: true } });

  const bootstrap = await import("../src/lib/assistant-bootstrap-client.ts");
  bootstrap.resetAssistantPreferencesForTest();
  const preferences = await import("../src/app/components/composer-switch-preferences.ts");
  preferences.resetComposerSwitchPreferencesForTest();
  // First import in this file: the theme module registers its applier here.
  const theme = await import("../src/lib/app-theme.ts");

  await preferences.hydrateComposerSwitches();
  assert.equal(store.get("breadboard:theme-mode"), "sun");
  assert.ok(dispatched.includes("breadboard:theme-mode-change"));
  // Replaying the account's copy is not a choice; nothing is written back.
  assert.deepEqual(patches, []);

  // Picking Light or Dark changes the appearance without silently turning off
  // the separate Sunrise-to-sunset preference.
  globalThis.document = {
    documentElement: { dataset: { theme: "light" } },
    visibilityState: "hidden",
  };
  theme.applyAppTheme("dark");
  assert.equal(store.get("breadboard:theme"), "dark");
  assert.equal(store.get("breadboard:theme-mode"), "sun");
  assert.deepEqual(patches, []);

  // Turning the switch off from the profile is the action that writes through.
  theme.applyAppThemeMode("manual");
  assert.equal(store.get("breadboard:theme-mode"), "manual");
  assert.deepEqual(patches, [{ switches: { sunTheme: false } }]);
  theme.applyAppThemeMode("sun");
  assert.deepEqual(patches.at(-1), { switches: { sunTheme: true } });

  // The theme runtime sits in the root layout, so a page without a composer
  // (the profile, a garden) still hydrates the switch after a restart.
  assert.match(source("../src/app/layout.tsx"), /<AppThemeRuntime\s*\/>/);
  assert.match(
    source("../src/app/components/app-theme-runtime.tsx"),
    /void hydrateComposerSwitches\(\);/,
  );
  assert.deepEqual(pickComposerSwitches({ sunTheme: true }), { sunTheme: true });
});

test("location hydration completes before the startup refresh reads the new origin", () => {
  const refresh = source(
    "../src/app/components/current-location-autorefresh.tsx",
  );
  const preference = source(
    "../src/app/components/current-location-preference.ts",
  );
  assert.match(
    refresh,
    /hydrateCurrentLocationPreference\(\)\.then\(\(\) =>\s*refreshCurrentLocationAtInitialization\(\)/,
  );
  assert.match(preference, /getCurrentLocationPreference/);
  assert.match(preference, /setCurrentLocationPreference/);
  assert.match(preference, /const enabled = await desktop\.read\(\)/);
  assert.match(preference, /if \(current\.useForAnswers\) await desktop\.write\(true\)/);
  const profile = source("../src/app/profile/profile-client.tsx");
  assert.match(profile, /await persistCurrentLocationPreference\(true\)/);
  assert.match(profile, /await persistCurrentLocationPreference\(false\)/);
});

test("the composer mounts the hydration once beside the switches it renders", () => {
  const composer = source("../src/app/components/assistant-composer.tsx");
  assert.match(composer, /useComposerSwitchHydration\(\);/);
  for (const store of [
    "use-yolo-mode",
    "use-agent-mode",
    "use-direct-mode",
    "use-personalize",
    "use-humanizer-mode",
  ]) {
    assert.match(source(`../src/app/components/${store}.ts`), /registerComposerSwitch\(/, store);
  }
});
