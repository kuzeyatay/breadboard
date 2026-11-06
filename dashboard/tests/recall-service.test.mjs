import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { DEFAULT_RECALL_SETTINGS, applyRecallSettingsPatch } from "../src/lib/recall/policy.ts";

const key = "__recallServiceTest";
const state = () => globalThis[key];
const prelude = `const state = () => globalThis[${JSON.stringify(key)}];`;
const stubs = {
  "settings.ts": `${prelude}
    export const getRecallSettings = () => state().settings;
    export const updateRecallSettings = (_id, patch) => state().settings = state().patch(state().settings, patch);`,
  "install.ts": `${prelude}
    export const installState = () => ({installed: state().installed, supported: true});
    export const readInstallStatus = () => state().progress;
    export const startInstall = async () => { state().installs++; state().progress = {phase: "installing", stalled: false}; };`,
  "runtime-service.ts": `${prelude}
    export const recallRuntimeManaged = () => true;
    export const readRecallRuntimeStatus = async () => state().runtime;
    export const reconcileRecallRuntime = async (_id, desiredState, configuration) => {
      state().reconciles.push({desiredState, configuration});
      if (state().stopFails && desiredState === "stopped") throw new Error("stop failed");
      state().runtime = {desiredState, ownedByRequester: true, serviceState: desiredState === "running" ? "healthy" : "stopped"};
      if (desiredState === "running") state().onStart?.();
    };
    export const recallRuntimeProcessRunning = status => status?.desiredState === "running";`,
};
const bundle = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../src/lib/recall/service.ts", import.meta.url))],
  bundle: true, format: "esm", platform: "node", target: "node22", write: false,
  plugins: [{ name: "recall-fixtures", setup(build) {
    build.onResolve({filter: /.*/}, args => {
      const name = args.path.split(/[\\/]/).at(-1);
      return Object.hasOwn(stubs, name) ? {path: name, namespace: "fixture"} : null;
    });
    build.onLoad({filter: /.*/, namespace: "fixture"}, args => ({contents: stubs[args.path], loader: "js"}));
  }}],
});
const service = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function reset(overrides = {}) {
  globalThis[key] = {
    settings: {...DEFAULT_RECALL_SETTINGS}, patch: applyRecallSettingsPatch,
    installed: false, progress: null, installs: 0, reconciles: [],
    runtime: {desiredState: "stopped", ownedByRequester: true, serviceState: "stopped"},
    ...overrides,
  };
}
const unavailableClient = {health: async () => { throw new Error("not running"); }};
const startup = () => service.autoStartRecallCapture(7, {client: unavailableClient});

test("first launch installs once, waits, then starts with the current settings", async () => {
  reset();
  assert.equal((await startup()).outcome, "installing");
  assert.equal((await startup()).outcome, "installing");
  assert.equal(state().installs, 1);
  assert.equal(state().reconciles.length, 0);
  state().installed = true;
  state().progress = {phase: "installed", stalled: false};
  state().settings.captureAudio = false;
  state().settings.excludedWindows = ["Bank"];
  assert.equal((await startup()).started, true);
  assert.equal(state().reconciles.length, 1);
  assert.equal(state().reconciles[0].configuration.captureAudio, false);
  assert.deepEqual(state().reconciles[0].configuration.excludedWindows, ["Bank"]);
  assert.equal((await startup()).outcome, "already_running");
  assert.equal(state().reconciles.length, 1);
});

test("opting out during installation prevents capture when the download finishes", async () => {
  reset();
  await startup();
  state().settings.captureEnabled = false;
  state().installed = true;
  assert.equal((await startup()).outcome, "capture_disabled");
  assert.equal(state().reconciles.length, 0);
});

test("saved opt-outs do not install or start anything", async () => {
  for (const setting of ["captureEnabled", "autoStartCapture"]) {
    reset({settings: {...DEFAULT_RECALL_SETTINGS, [setting]: false}});
    await startup();
    assert.equal(state().installs, 0);
    assert.equal(state().reconciles.length, 0);
  }
});

test("an opt-out during the health probe prevents a stale startup", async () => {
  reset({installed: true});
  const result = await service.autoStartRecallCapture(7, {client: {health: async () => {
    state().settings = {...state().settings, captureEnabled: false};
    throw new Error("offline");
  }}});
  assert.equal(result.outcome, "capture_disabled");
  assert.equal(state().reconciles.length, 0);
});

test("an opt-out during native startup stops the recorder before reporting completion", async () => {
  reset({installed: true, onStart: () => { state().settings.captureEnabled = false; }});
  assert.equal((await startup()).outcome, "capture_disabled");
  assert.deepEqual(state().reconciles.map(call => call.desiredState), ["running", "stopped"]);
});

test("failed or stalled installations do not create an automatic download loop", async () => {
  for (const progress of [{phase: "error"}, {phase: "interrupted"}, {phase: "installing", stalled: true}]) {
    reset({progress});
    assert.equal((await startup()).outcome, "install_failed");
    assert.equal((await startup()).outcome, "install_failed");
    assert.equal(state().installs, 0);
  }
});

test("turning capture off stops the owned recorder and persists across later startup", async () => {
  reset({installed: true, runtime: {desiredState: "running", ownedByRequester: true}});
  const settings = await service.saveRecallSettings(7, {captureEnabled: false});
  assert.equal(settings.captureEnabled, false);
  assert.deepEqual(state().reconciles, [{desiredState: "stopped", configuration: null}]);
  assert.equal((await startup()).outcome, "capture_disabled");
});

test("a failed stop is reported while the saved opt-out still prevents future startup", async () => {
  reset({stopFails: true, runtime: {desiredState: "running", ownedByRequester: true}});
  await assert.rejects(service.saveRecallSettings(7, {captureEnabled: false}), /stop failed/);
  assert.equal(state().settings.captureEnabled, false);
});

test("changing another user's settings never stops the recorder's owner", async () => {
  reset({runtime: {desiredState: "running", ownedByRequester: false}});
  await service.saveRecallSettings(7, {captureEnabled: false});
  assert.equal(state().reconciles.length, 0);
});

test("agent search applies access, time range, exclusions, and text limits", async () => {
  reset({settings: {...DEFAULT_RECALL_SETTINGS, excludedWindows: ["Bank"], maxResults: 1}});
  let query;
  const client = {search: async args => {
    query = args;
    return {hits: [
      {type: "OCR", appName: "Bank", text: "excluded"},
      {type: "OCR", appName: "Notes", text: "visible", timestamp: "2026-11-06T08:00:00Z"},
    ], hasMore: false};
  }};
  const result = await service.searchRecall(7, {query: "test", limit: 50}, {forAgent: true, client});
  assert.equal(query.startTime, "24h ago");
  assert.equal(query.limit, 2);
  assert.deepEqual(result.hits.map(hit => hit.text), ["visible"]);
  state().settings.agentAccess = false;
  await assert.rejects(service.searchRecall(7, {}, {forAgent: true, client}), error => error.code === "agent_access_disabled");
});
