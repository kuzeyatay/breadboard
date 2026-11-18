import assert from "node:assert/strict";
import test from "node:test";

import {
  createLatencyMeter,
  createListeningSounds,
  formatLatency,
  frameSize,
  isBackchannel,
  permissionAnswer,
  permissionQuestion,
} from "../src/lib/speech/voice-live-turns.ts";
import { voiceFrames } from "../src/lib/speech/voice-screen-context.ts";

test("a backchannel or a cough resumes the paused reply; real words do not", () => {
  for (const text of ["", "mm-hmm", "Yeah.", "uh huh", "okay okay", "ja", "tamam", "*cough*"]) assert.ok(isBackchannel(text), text);
  for (const text of ["wait, stop", "what about Tuesday", "no that is wrong", "yeah but the other one"]) assert.ok(!isBackchannel(text), text);
});

test("a spoken permission answer maps to once, always or reject, and refusal wins", () => {
  assert.equal(permissionAnswer("yes go ahead", true), "once");
  assert.equal(permissionAnswer("yes, always", true), "always");
  assert.equal(permissionAnswer("yes, always", false), "once");
  assert.equal(permissionAnswer("no", true), "reject");
  assert.equal(permissionAnswer("yes... no, don't", true), "reject");
  assert.equal(permissionAnswer("what does it do", true), null);
  assert.match(permissionQuestion("Run npm install", true), /Run npm install\. Allow it\? Say yes, always or no\./);
  assert.doesNotMatch(permissionQuestion("Run npm install", false), /always/);
});

test("listening sounds come at a pause after real speech, once per pause and never after a question", () => {
  let clock = 100_000;
  const sounds = createListeningSounds(() => clock);
  const talk = (ms, opts = { listening: true }) => { let fired = false; for (let t = 0; t < ms; t += 20) fired = sounds.push(true, 20, opts) || fired; clock += ms; return fired; };
  const pause = (ms, opts = { listening: true }) => { let fired = 0; for (let t = 0; t < ms; t += 20) { clock += 20; if (sounds.push(false, 20, opts)) fired++; } return fired; };
  talk(1_000);
  assert.equal(pause(1_000), 0, "too little speech yet");
  talk(2_500);
  assert.equal(pause(1_500), 1, "one sound per pause");
  talk(3_000);
  assert.equal(pause(1_000), 0, "not again within eight seconds");
  clock += 10_000;
  talk(3_000);
  assert.equal(pause(1_000, { listening: true, question: true }), 0, "never after a question");
  sounds.reset();
  talk(3_200);
  assert.equal(pause(1_000, { listening: false }), 0, "silent while not listening");
});

test("the latency chip shows the median voice-to-voice time", () => {
  const meter = createLatencyMeter(3);
  assert.equal(meter.finish(10), null);
  for (const [a, b] of [[0, 1_000], [0, 3_000], [0, 2_000], [0, 9_000]]) { meter.start(a); meter.finish(b); }
  assert.equal(meter.median(), 3_000);
  meter.start(0); meter.cancel();
  assert.equal(meter.finish(5_000), null);
  assert.equal(formatLatency(1_840), "1.8 s");
  assert.equal(formatLatency(null), "");
});

test("frames are scaled to 1280 px and only small JPEG or PNG data URLs ride a turn", () => {
  assert.deepEqual(frameSize(1920, 1080), { width: 1280, height: 720 });
  assert.deepEqual(frameSize(640, 480), { width: 640, height: 480 });
  assert.deepEqual(frameSize(0, 480), { width: 0, height: 0 });
  const jpeg = { type: "image", name: "camera.jpg", dataUrl: "data:image/jpeg;base64,AAAA" };
  assert.deepEqual(voiceFrames([jpeg, { ...jpeg, dataUrl: "data:image/svg+xml;base64,AAAA" }, { ...jpeg, dataUrl: "https://x/y.jpg" }, null]), [jpeg]);
  assert.equal(voiceFrames([jpeg, jpeg, jpeg]).length, 2);
  assert.deepEqual(voiceFrames([{ ...jpeg, dataUrl: `data:image/jpeg;base64,${"A".repeat(4_100_000)}` }]), []);
  assert.deepEqual(voiceFrames("nope"), []);
});
