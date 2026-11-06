import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { transform } from "esbuild";

const scripts = new URL("../../quartz/quartz/components/scripts/", import.meta.url);
const { code } = await transform(fs.readFileSync(new URL("graphRenderLoop.ts", scripts), "utf8"), { loader: "ts", format: "esm" });
const { GraphRenderLoop } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

function fixture(draw) {
  const queued = new Map();
  let id = 0;
  const loop = new GraphRenderLoop(draw, callback => { queued.set(++id, callback); return id; }, id => queued.delete(id));
  return { loop, queued, frame(time = 0) {
    const callbacks = [...queued.values()];
    queued.clear();
    callbacks.forEach(callback => callback(time));
  } };
}

test("graph invalidations coalesce and a settled graph schedules no frames", () => {
  let draws = 0;
  const { loop, queued, frame } = fixture(() => { draws++; return false; });
  assert.equal(queued.size, 0);
  for (let i = 0; i < 100; i++) loop.invalidate();
  assert.equal(queued.size, 1);
  frame();
  assert.equal(draws, 1);
  assert.equal(queued.size, 0);
  for (let i = 0; i < 120; i++) frame();
  assert.equal(draws, 1, "two seconds at 60Hz must not redraw an unchanged graph");
  loop.invalidate();
  frame();
  assert.equal(draws, 2);
});

test("active tweens render through their final frame, then stop", () => {
  const times = [];
  const { loop, queued, frame } = fixture(time => { times.push(time); return time < 200; });
  loop.invalidate();
  frame(0);
  frame(100);
  frame(200);
  assert.deepEqual(times, [0, 100, 200]);
  assert.equal(queued.size, 0);
});

test("hidden graphs cancel work and redraw once on return; disposal is final", () => {
  let draws = 0;
  const { loop, queued, frame } = fixture(() => { draws++; return true; });
  loop.invalidate();
  loop.setActive(false);
  loop.invalidate();
  assert.equal(queued.size, 0);
  frame();
  assert.equal(draws, 0);
  loop.setActive(true);
  assert.equal(queued.size, 1);
  frame();
  assert.equal(draws, 1);
  const stale = [...queued.values()][0];
  loop.dispose();
  stale(100);
  loop.setActive(true);
  loop.invalidate();
  assert.equal(queued.size, 0);
  assert.equal(draws, 1);
});

test("graph rendering is invalidated by interactions and simulation, and releases visibility listeners", () => {
  const graph = fs.readFileSync(new URL("graph.inline.ts", scripts), "utf8");
  assert.doesNotMatch(graph, /requestAnimationFrame\(animate\)/);
  assert.match(graph, /simulation\.on\("tick\.render", requestRender\)\.on\("end\.render", requestRender\)/);
  assert.match(graph, /function renderPixiFromD3\(\) \{[\s\S]*?requestRender\(\)/);
  assert.match(graph, /\.on\("zoom",[\s\S]*?requestRender\(\)/);
  assert.match(graph, /const next = !document\.hidden && intersecting/);
  assert.match(graph, /visibilityObserver\?\.disconnect\(\)/);
  assert.match(graph, /document\.removeEventListener\("visibilitychange", updateVisibility\)/);
  assert.match(graph, /frames\?\.dispose\(\)/);
});
