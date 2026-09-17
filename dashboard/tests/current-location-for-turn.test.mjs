import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  CURRENT_LOCATION_STORAGE_KEY,
  CURRENT_LOCATION_MAX_AGE_MS,
  writeStoredCurrentLocationPreference,
} from "../src/lib/current-location.ts";

// Run the real refresh/store/prompt policy together, replacing only device IO
// and preference hydration so startup, travel, and revocation are deterministic.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/app/components/current-location-autorefresh.tsx", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "cjs",
  plugins: [{ name: "device-io", setup(builder) {
    builder.onResolve({ filter: /^(react|.*current-location-preference\.ts|.*current-location-source\.ts)$/ }, args => ({ path: args.path, namespace: "device-io" }));
    builder.onLoad({ filter: /.*/, namespace: "device-io" }, args => ({ contents:
      args.path === "react" ? "export const useEffect = fn => globalThis.fixture.effects.push(fn);" :
      args.path.includes("preference") ? "export const hydrateCurrentLocationPreference = () => globalThis.fixture.hydrate();" :
      "export const requestCurrentLocationFix = options => globalThis.fixture.fix(options); export const resolveCurrentLocationLabel = (...args) => globalThis.fixture.label(...args);"
    }));
  } }],
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function environment({ enabled = true, snapshot = null } = {}) {
  let now = Date.parse("2026-09-09T12:00:00Z");
  const stored = new Map();
  const storage = {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: key => stored.delete(key),
  };
  const fixture = {
    effects: [], calls: 0, hydrations: 0,
    async hydrate() { fixture.hydrations += 1; },
    async fix(options) {
      fixture.calls += 1;
      assert.equal(options.maxAgeMs, 0);
      return { ok: true, fix: { latitude: 52.37, longitude: 4.90, accuracyMeters: 80, source: "system" } };
    },
    async label() { return "Amsterdam, Netherlands"; },
  };
  const save = (useForAnswers, nextSnapshot = null) => writeStoredCurrentLocationPreference(storage, { useForAnswers, snapshot: nextSnapshot }, now);
  save(enabled, snapshot);
  const module = { exports: {} };
  const timers = new Map();
  let timerId = 0;
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, fixture, Intl, Event,
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    window: { localStorage: storage, dispatchEvent() {}, setInterval() {}, clearInterval() {} },
    document: { documentElement: { dataset: {} }, addEventListener() {}, removeEventListener() {} },
  });
  return { api: module.exports, fixture, save, stored, timers, advance: ms => { now += ms; } };
}

test("a first turn waits for durable consent and startup fix, including its area", async () => {
  const env = environment({ enabled: false });
  const hydration = deferred();
  env.fixture.hydrate = async () => { await hydration.promise; env.save(true); };
  // Mount the automatic refresher, then send before its hydration has finished.
  env.api.default();
  const cleanup = env.fixture.effects[0]();
  let settled = false;
  const pending = env.api.getCurrentLocationForTurn("And those?").then(value => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(env.fixture.calls, 0);
  hydration.resolve();
  const result = await pending;
  assert.equal(result.label, "Amsterdam, Netherlands");
  assert.equal(result.latitude, 52.37);
  assert.equal(env.fixture.calls, 1);
  assert.equal(env.timers.size, 0);
  cleanup();
});

test("fresh context survives unrelated turns and refreshes after travelling", async () => {
  const env = environment();
  const first = await env.api.getCurrentLocationForTurn("Explain binary trees");
  assert.equal(first.label, "Amsterdam, Netherlands");
  assert.equal((await env.api.getCurrentLocationForTurn("これについては？")).label, first.label);
  assert.equal(env.fixture.calls, 1);
  env.advance(16 * 60_000);
  env.fixture.fix = async () => ({ ok: true, fix: { latitude: 35.68, longitude: 139.69, accuracyMeters: 60, source: "system" } });
  env.fixture.label = async () => "Tokyo, Japan";
  const next = await env.api.getCurrentLocationForTurn("And those?");
  assert.equal(next.label, "Tokyo, Japan");
  assert.equal(next.longitude, 139.69);
  assert.notEqual(next.capturedAt, first.capturedAt);
});

test("a turn joins a refresh already started by the visibility timer", async () => {
  const env = environment();
  await env.api.getCurrentLocationForTurn("First");
  env.advance(16 * 60_000);
  const fix = deferred();
  env.fixture.fix = () => { env.fixture.calls += 1; return fix.promise; };
  const refresh = env.api.refreshCurrentLocationIfDue();
  let settled = false;
  const turn = env.api.getCurrentLocationForTurn("Next").then(value => { settled = true; return value; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);
  fix.resolve({ ok: true, fix: { latitude: -33.87, longitude: 151.21, accuracyMeters: 60 } });
  env.fixture.label = async () => "Sydney, Australia";
  await refresh;
  assert.equal((await turn).label, "Sydney, Australia");
  assert.equal(env.fixture.calls, 2);
});

test("disabled location and per-turn opt-outs do not request or attach a fix", async () => {
  const env = environment({ enabled: false });
  assert.equal(await env.api.getCurrentLocationForTurn("Where can I get those?"), undefined);
  assert.equal(env.fixture.calls, 0);
  env.save(true);
  assert.equal(await env.api.getCurrentLocationForTurn("Do not use my location"), undefined);
  assert.equal(env.fixture.calls, 0);
});

test("revoking consent during a fix cannot attach it or opt the device back in", async () => {
  const env = environment();
  const fix = deferred();
  const started = deferred();
  env.fixture.fix = () => { started.resolve(); return fix.promise; };
  const pending = env.api.getCurrentLocationForTurn("And those?");
  await started.promise;
  env.save(false);
  fix.resolve({ ok: true, fix: { latitude: 52.37, longitude: 4.90, accuracyMeters: 80 } });
  assert.equal(await pending, undefined);
  assert.equal(JSON.parse(env.stored.get(CURRENT_LOCATION_STORAGE_KEY)).useForAnswers, false);
});

test("failed refreshes retain only a valid recent fix and never attach expired data", async () => {
  const env = environment();
  const first = await env.api.getCurrentLocationForTurn("First");
  env.fixture.fix = async () => ({ ok: false, kind: "unavailable" });
  env.advance(16 * 60_000);
  assert.equal((await env.api.getCurrentLocationForTurn("Next")).capturedAt, first.capturedAt);
  env.advance(CURRENT_LOCATION_MAX_AGE_MS);
  assert.equal(await env.api.getCurrentLocationForTurn("Next"), undefined);
});

test("a stalled service cannot hold the turn indefinitely", async () => {
  const env = environment();
  env.fixture.fix = () => new Promise(() => {});
  const pending = env.api.getCurrentLocationForTurn("And those?");
  assert.equal(env.timers.size, 1);
  const timer = [...env.timers.values()][0];
  assert.equal(timer.delay, 10_000);
  timer.fn();
  assert.equal(await pending, undefined);
  assert.equal(env.timers.size, 0);
});
