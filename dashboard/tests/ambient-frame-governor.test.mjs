import test from "node:test";
import assert from "node:assert/strict";
import { AMBIENT_FRAMES_PER_SECOND, AMBIENT_LIGHTING_CHANGE, FOREGROUND_AMBIENT_FPS, cssPlayStateFor, isAmbientLoop, setAmbientEffectPlaying, setAmbientLightPhase, startAmbientFrameGovernor } from "../src/lib/ambient-frame-governor.ts";

test("only slow infinite loops are governed; spinners keep the display rate", () => {
  assert.ok(isAmbientLoop({ iterations: Infinity, duration: 14000 }));
  assert.ok(!isAmbientLoop({ iterations: Infinity, duration: 800 }), "a spinner");
  assert.ok(!isAmbientLoop({ iterations: 1, duration: 2800 }), "a one-shot transition");
  assert.ok(isAmbientLoop({ iterations: 1, duration: 20000 }), "the 20 s palette fade is ambience");
  assert.ok(!isAmbientLoop({ iterations: Infinity, duration: "auto" }));
  assert.ok(AMBIENT_FRAMES_PER_SECOND <= 15);
});

test("the stylesheet's play state is read per animation name", () => {
  assert.equal(cssPlayStateFor("breathe", "drift, breathe", "running, paused"), "paused");
  assert.equal(cssPlayStateFor("drift", "drift, breathe", "running, paused"), "running");
  assert.equal(cssPlayStateFor("breathe", "drift, breathe", "paused"), "paused", "a single state applies to every animation");
  assert.equal(cssPlayStateFor("other", "drift", "paused"), "running");
});

test("governed animations advance together from one clock, respect a stylesheet pause, and are handed back", () => {
  class CSSAnimation {
    constructor(name, duration, state = "running") { this.animationName = name; this.playState = "running"; this.currentTime = 0; this.playbackRate = 1; this.cssState = state;
      this.effect = { target: { isConnected: true, owner: this, closest: () => null }, pseudoElement: null, getTiming: () => ({ iterations: Infinity, duration }) }; }
    pause() { this.playState = "paused"; }
    play() { this.playState = "running"; }
  }
  const drift = new CSSAnimation("drift", 14000);
  const spinner = new CSSAnimation("spin", 700);
  const held = new CSSAnimation("tide", 19000, "paused");
  const listeners = new Map();
  let nextFrame;
  let now = 0; const timers = [];
  const view = {
    CSSAnimation, performance: { now: () => now },
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearInterval: (id) => { timers[id - 1] = null; },
    getComputedStyle: (target) => ({ animationName: target.owner.animationName, animationPlayState: target.owner.cssState, getPropertyValue: () => "" }),
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: fn => { nextFrame = fn; return 1; },
  };
  const doc = { defaultView: view, hidden: false, getAnimations: () => [drift, spinner, held],
    addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) };
  const stop = startAmbientFrameGovernor(doc);
  assert.equal(drift.playState, "paused", "adopted");
  assert.equal(spinner.playState, "running", "left alone");
  const tick = timers.find((timer) => Math.round(timer.ms) === Math.round(1000 / AMBIENT_FRAMES_PER_SECOND)).fn;
  now = 250; tick();
  assert.equal(drift.currentTime, 250);
  assert.equal(held.currentTime, 0, "the stylesheet paused it");
  held.cssState = "running";
  listeners.get(AMBIENT_LIGHTING_CHANGE)();
  nextFrame();
  drift.currentTime = 5000; now = 350; tick();
  assert.equal(drift.currentTime, 5100, "a phase set by the component is kept");
  assert.equal(held.currentTime, 100, "resumed lighting advances without waiting for the one-second scan");
  doc.hidden = true; now = 9000; tick();
  assert.equal(drift.currentTime, 5100, "a hidden page draws nothing");
  stop();
  assert.equal(drift.playState, "running", "handed back to the browser");
  assert.ok(timers.every((timer) => timer === null));
});

test("a long one-shot is advanced at the ambient rate, then handed back finished", () => {
  class CSSAnimation {
    constructor() { this.animationName = "palette"; this.playState = "running"; this.currentTime = 19900; this.playbackRate = 1;
      this.effect = { target: { isConnected: true }, pseudoElement: "::after", getTiming: () => ({ iterations: 1, duration: 20000 }) }; }
    pause() { this.playState = "paused"; }
    play() { this.playState = "running"; }
    finish() { this.playState = "finished"; this.currentTime = 20000; }
  }
  const fade = new CSSAnimation();
  let now = 0; const timers = [];
  const view = { CSSAnimation, performance: { now: () => now }, setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearInterval: () => {},
    getComputedStyle: () => ({ animationName: "palette", animationPlayState: "running", getPropertyValue: () => "" }), matchMedia: () => ({ matches: false }) };
  const stop = startAmbientFrameGovernor({ defaultView: view, hidden: false, getAnimations: () => [fade] });
  assert.equal(fade.playState, "paused", "adopted");
  const tick = timers.find((timer) => Math.round(timer.ms) === Math.round(1000 / AMBIENT_FRAMES_PER_SECOND)).fn;
  now = 60; tick();
  assert.equal(fade.currentTime, 19960);
  now = 130; tick();
  assert.equal(fade.playState, "finished", "ends in its own fill state");
  now = 200; tick();
  assert.equal(fade.currentTime, 20000, "no longer advanced");
  stop();
  assert.equal(fade.playState, "finished", "a finished fade is not restarted on release");
});

test("one clock samples lights and lines at 30 FPS and other loops at 15 only while presented", t => {
  class CSSAnimation {
    playState = "running";
    currentTime = 0;
    playbackRate = 1;
    constructor(name, rate, duration = 4000, iterations = Infinity) {
      this.animationName = name;
      this.effect = { target: { isConnected: true, rate, name, closest: () => name === "album" },
        getTiming: () => ({ duration, iterations }) };
    }
    pause() { this.playState = "paused"; }
    play() { this.playState = "running"; }
  }
  const ring = new CSSAnimation("ring", 30), light = new CSSAnimation("light", 30);
  const album = new CSSAnimation("album", 30, 2800, 1), plant = new CSSAnimation("plant", 15);
  class CSSTransition {
    currentTime = 0;
    playbackRate = 1;
    playState = "running";
    transitionProperty = "opacity";
    constructor(isLighting) {
      this.effect = { target: { isConnected: true, rate: 30, matches: () => isLighting },
        getTiming: () => ({ duration: 2800, iterations: 1 }) };
    }
    pause() { this.playState = "paused"; }
    play() { this.playState = "running"; }
  }
  const crossfade = new CSSTransition(true), menu = new CSSTransition(false);
  const beam = {
    effect: { target: { isConnected: true }, getTiming: () => ({ duration: 27_000, iterations: Infinity }) },
    playState: "running", currentTime: 0, playbackRate: 1,
    play() { this.playState = "running"; }, pause() { this.playState = "paused"; },
  };
  const timers = new Map();
  let nextId = 0, now = 0, presented = false, notify, scan;
  const view = {
    CSSAnimation, CSSTransition, performance: { now: () => now },
    setInterval(fn, ms) { timers.set(++nextId, {fn, ms}); return nextId; },
    clearInterval(id) { timers.delete(id); },
    requestAnimationFrame(fn) { scan = fn; return 1; },
    getComputedStyle: target => ({
      animationName: target.name, animationPlayState: "running", getPropertyValue: () => String(target.rate),
    }),
  };
  const doc = { defaultView: view, hidden: false, getAnimations: () => [ring, light, album, plant, crossfade, menu, beam] };
  const stop = startAmbientFrameGovernor(doc, {
    visible: () => presented, subscribe: fn => { notify = fn; return () => {}; },
  });
  setAmbientEffectPlaying(doc, beam, true);
  scan();
  assert.equal(beam.playState, "paused", "a prewarmed composer never starts its own compositor loop");
  assert.equal(timers.size, 0, "a visible prewarmed document has no timers");
  now = 10_000;
  presented = true; notify();
  const clocks = [...timers.values()].filter(t => t.ms < 1000);
  assert.equal(clocks.length, 1);
  assert.equal(clocks[0].ms, 1000 / FOREGROUND_AMBIENT_FPS);
  let plantUpdates = 0, lastPlant = 0;
  for (let i = 1; i <= 30; i++) {
    now = 10_000 + i * 1000 / 30;
    clocks[0].fn();
    assert.equal(ring.currentTime, now - 10_000);
    assert.equal(light.currentTime, ring.currentTime);
    assert.equal(album.currentTime, ring.currentTime);
    assert.equal(crossfade.currentTime, ring.currentTime);
    assert.equal(beam.currentTime, ring.currentTime);
    assert.equal(menu.playState, "running");
    if (plant.currentTime !== lastPlant) plantUpdates++;
    lastPlant = plant.currentTime;
  }
  assert.equal(plantUpdates, 15);
  setAmbientEffectPlaying(doc, beam, false);
  scan();
  const heldBeamTime = beam.currentTime;
  presented = false; notify();
  assert.equal(timers.size, 0);
  now += 60_000;
  presented = true; notify();
  now += 33;
  [...timers.values()].find(t => t.ms < 1000).fn();
  assert.equal(light.currentTime, 1033, "time spent hidden is excluded");
  assert.equal(beam.currentTime, heldBeamTime, "typing holds the composer's phase");
  // An album or tab can join between ticks. The next frame must advance only
  // the time since the seek, even when the previous tick was delayed.
  t.mock.method(Date, "now", () => 50_010);
  setAmbientLightPhase(light, 50_000, 1_234);
  now += 200;
  [...timers.values()].find(t => t.ms < 1000).fn();
  assert.equal(light.currentTime, 1244);
  stop();
  assert.equal(beam.playState, "paused", "cleanup respects its owner's pause");
  setAmbientEffectPlaying(doc, beam, true);
  assert.equal(beam.playState, "running", "native fallback when no governor is mounted");
  assert.equal(timers.size, 0);
});
