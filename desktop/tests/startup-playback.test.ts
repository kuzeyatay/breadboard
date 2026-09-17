import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vm from "node:vm";

const script = fs.readFileSync(path.resolve(__dirname, "../../dist/startup/startup.js"), "utf8");
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function startupRenderer(options: {
  enabled?: boolean;
  ready?: () => Promise<void>;
  claim?: () => Promise<boolean>;
} = {}) {
  let playCount = 0;
  let pauseCount = 0;
  let claimCount = 0;
  let listener: (state: { phase: string; services: never[]; message: string }) => void = () => {};
  const element = () => ({
    hidden: true, disabled: false, textContent: "", dataset: {},
    classList: { add() {}, remove() {} }, style: { setProperty() {} },
    replaceChildren() {}, append() {}, addEventListener() {},
    play: async () => { playCount++; }, pause: () => { pauseCount++; }, currentTime: 0,
  });
  const elements = new Map<string, ReturnType<typeof element>>();
  const body = { dataset: {} as Record<string, string> };
  const state = (phase: string) => ({ phase, services: [] as never[], message: phase });
  vm.runInNewContext(script, {
    document: {
      body, createElement: element, querySelectorAll: () => [],
      getElementById: (id: string) => {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      },
    },
    window: {
      breadboardDesktop: {
        getStartupSound: async () => options.enabled ?? true,
        claimStartupSound: async () => {
          claimCount++;
          return options.claim ? options.claim() : claimCount === 1;
        },
        awaitDashboardReady: options.ready ?? (async () => {}),
        onStartupState: (callback: typeof listener) => { listener = callback; },
        getStartupState: async () => state("starting"),
        getVersions: async () => ({ app: "test", electron: "test" }),
      },
      addEventListener() {}, setTimeout: () => 1, setInterval: () => 1, clearInterval() {},
    },
  });
  return {
    emit: (phase: string) => listener(state(phase)),
    counts: () => ({ playCount, pauseCount, claimCount }),
    stage: () => body.dataset["stage"],
  };
}

test("the startup chime plays once and stops when services reconnect", async () => {
  const renderer = startupRenderer();
  await flush();
  renderer.emit("ready");
  await flush();
  assert.equal(renderer.counts().playCount, 1);
  renderer.emit("ready");
  await flush();
  assert.equal(renderer.counts().playCount, 1);
  renderer.emit("starting");
  assert.equal(renderer.counts().pauseCount, 1);
  assert.equal(renderer.stage(), "loading");
  renderer.emit("ready");
  await flush();
  assert.equal(renderer.counts().playCount, 1, "recovery must not replay the chime");
  assert.equal(renderer.stage(), "welcome", "silent recovery still allows the handoff");
});

test("reconnecting invalidates an outstanding dashboard or sound wait", async () => {
  for (const waitingOn of ["ready", "claim"] as const) {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const renderer = startupRenderer(waitingOn === "ready"
      ? { ready: () => waiting }
      : { claim: async () => { await waiting; return true; } });
    await flush();
    renderer.emit("ready");
    await flush();
    renderer.emit("starting");
    release();
    await flush();
    assert.equal(renderer.counts().playCount, 0, waitingOn);
    assert.equal(renderer.stage(), "loading", waitingOn);
  }
});

test("muted, denied, and unavailable sound claims leave welcome silent", async () => {
  for (const options of [
    { enabled: false },
    { claim: async () => false },
    { claim: async () => { throw new Error("shell unavailable"); } },
  ]) {
    const renderer = startupRenderer(options);
    await flush();
    renderer.emit("ready");
    await flush();
    assert.equal(renderer.counts().playCount, 0);
    assert.equal(renderer.stage(), "welcome");
    if (options.enabled === false) assert.equal(renderer.counts().claimCount, 0);
  }
});
