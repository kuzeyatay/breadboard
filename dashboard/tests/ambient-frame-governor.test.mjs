import test from "node:test";
import assert from "node:assert/strict";
import { AMBIENT_FRAMES_PER_SECOND, cssPlayStateFor, isAmbientLoop, startAmbientFrameGovernor } from "../src/lib/ambient-frame-governor.ts";

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
      this.effect = { target: { isConnected: true, owner: this }, pseudoElement: null, getTiming: () => ({ iterations: Infinity, duration }) }; }
    pause() { this.playState = "paused"; }
    play() { this.playState = "running"; }
  }
  const drift = new CSSAnimation("drift", 14000);
  const spinner = new CSSAnimation("spin", 700);
  const held = new CSSAnimation("tide", 19000, "paused");
  let now = 0; const timers = [];
  const view = {
    CSSAnimation, performance: { now: () => now },
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearInterval: (id) => { timers[id - 1] = null; },
    getComputedStyle: (target) => ({ animationName: target.owner.animationName, animationPlayState: target.owner.cssState }),
    matchMedia: () => ({ matches: false }),
  };
  const doc = { defaultView: view, hidden: false, getAnimations: () => [drift, spinner, held] };
  const stop = startAmbientFrameGovernor(doc);
  assert.equal(drift.playState, "paused", "adopted");
  assert.equal(spinner.playState, "running", "left alone");
  const tick = timers.find((timer) => Math.round(timer.ms) === Math.round(1000 / AMBIENT_FRAMES_PER_SECOND)).fn;
  now = 250; tick();
  assert.equal(drift.currentTime, 250);
  assert.equal(held.currentTime, 0, "the stylesheet paused it");
  drift.currentTime = 5000; now = 350; tick();
  assert.equal(drift.currentTime, 5100, "a phase set by the component is kept");
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
    getComputedStyle: () => ({ animationName: "palette", animationPlayState: "running" }), matchMedia: () => ({ matches: false }) };
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
