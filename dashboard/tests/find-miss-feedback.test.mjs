import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";

const code = transformSync(fs.readFileSync(new URL("../src/lib/find-miss-feedback.ts", import.meta.url), "utf8"), {
  loader: "ts", format: "cjs",
}).code;

function fixture({ blocked = false, unavailable = false } = {}) {
  let now = 0, notes = 0;
  const contexts = [];
  const document = { hidden: false };
  const param = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const module = { exports: {} };
  vm.runInNewContext(code, { module, document, performance: { now: () => now }, window: {
    AudioContext: class {
      state = blocked ? "suspended" : "running"; currentTime = 0; destination = {};
      constructor() { if (unavailable) throw new Error("No audio device"); contexts.push(this); }
      async resume() {}
      async close() { this.state = "closed"; }
      createOscillator() { return { frequency: param(), connect: node => node, disconnect() {}, start() { notes++; }, stop() {} }; }
      createGain() { return { gain: param(), connect() {}, disconnect() {} }; }
    },
  } });
  return { feedback: module.exports.createFindMissFeedback(), contexts, document, notes: () => notes, advance: () => { now += 300; } };
}

test("only a completed, current, nonempty miss buzzes once; explicit retries buzz again", () => {
  const f = fixture(), s = f.feedback;
  s.begin(""); s.settle("", 0);
  s.begin("   "); s.settle("   ", 0);
  assert.equal(f.contexts.length, 0);
  s.begin("missing");
  s.settle("missing", 0, false);
  s.settle("old query", 0);
  assert.equal(f.notes(), 0);
  s.settle("missing", 0);
  s.settle("missing", 0);
  assert.equal(f.notes(), 2);
  f.advance(); s.begin("missing"); s.settle("missing", 0);
  assert.equal(f.notes(), 4);
  f.advance(); s.begin("found"); s.settle("found", 3); s.settle("found", 0);
  assert.equal(f.notes(), 4);
  assert.equal(f.contexts.length, 1, "reuse the unlocked audio context");
});

test("editing, closing, hidden pages and rapid repeats do not create stray sounds", () => {
  const f = fixture(), s = f.feedback;
  s.begin("missing"); s.cancel(); s.settle("missing", 0);
  assert.equal(f.notes(), 0);
  s.begin("missing"); s.settle("missing", 0);
  s.begin("missing"); s.settle("missing", 0);
  assert.equal(f.notes(), 2);
  f.advance(); f.document.hidden = true;
  s.begin("hidden"); s.settle("hidden", 0);
  f.document.hidden = false; s.settle("hidden", 0);
  assert.equal(f.notes(), 2);
  s.begin("closing"); s.dispose(); s.settle("closing", 0);
  assert.equal(f.contexts[0].state, "closed");
  assert.equal(f.notes(), 2);
});

test("blocked audio is consumed rather than queued for a later gesture", () => {
  const f = fixture({ blocked: true }), s = f.feedback;
  s.begin("missing"); s.settle("missing", 0);
  f.contexts[0].state = "running"; s.settle("missing", 0);
  assert.equal(f.notes(), 0);
  const unavailable = fixture({ unavailable: true });
  assert.doesNotThrow(() => { unavailable.feedback.begin("missing"); unavailable.feedback.settle("missing", 0); unavailable.feedback.dispose(); });
});
