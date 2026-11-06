import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transform } from "esbuild";

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL("../src/app/components/hermes/goal-card.tsx", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "tsx", format: "cjs", jsx: "automatic" });
const base = { goalId: "lab-goal", objective: "Complete the lab", status: "blocked",
  turnsUsed: 1, tokensUsed: 0, timeUsedSeconds: 5, createdAt: new Date().toISOString() };
const tick = () => new Promise(resolve => setImmediate(resolve));

// Execute the component's real effects and event handlers with deterministic
// request completion order. No browser or live server is involved.
function mount() {
  const hooks = [], requests = [], timers = new Map(), listeners = new Map();
  let cursor = 0, nextTimer = 0, effects = [], tree;
  const React = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], value => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }];
    },
    useRef(value) { const index = cursor++; return hooks[index] ??= { current: value }; },
    useCallback(callback) { cursor++; return callback; },
    useEffect(effect, deps) {
      const index = cursor++, previous = hooks[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        previous?.cleanup?.();
        hooks[index] = { deps };
        effects.push(() => { hooks[index].cleanup = effect(); });
      }
    },
  };
  const window = {
    setInterval(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearInterval(id) { timers.delete(id); },
    addEventListener(event, fn) { listeners.set(event, fn); },
    removeEventListener(event, fn) { if (listeners.get(event) === fn) listeners.delete(event); },
  };
  const fetch = (url, init) => new Promise(resolve => requests.push({ url, init,
    finish(goal) { resolve({ ok: true, json: async () => ({ goal }) }); },
  }));
  const exports = {};
  const mod = { exports };
  new Function("require", "module", "exports", "window", "fetch", code)(
    name => name === "react" ? React : require(name), mod, exports, window, fetch,
  );
  const render = (sessionId = "lab-chat") => {
    cursor = 0; effects = [];
    tree = mod.exports.default({ sessionId, running: true });
    effects.forEach(effect => effect());
    return tree;
  };
  function button(label, node = tree) {
    if (!node) return;
    if (Array.isArray(node)) return node.map(child => button(label, child)).find(Boolean);
    if (node.props?.["aria-label"] === label) return node;
    return button(label, node.props?.children ?? null);
  }
  render();
  return { requests, render, button, goal: () => hooks[0],
    poll() { [...timers.values()].filter(timer => timer.ms === 5000).forEach(timer => timer.fn()); },
    focus() { listeners.get("focus")?.(); },
    unmount() { hooks.forEach(hook => hook?.cleanup?.()); }, timers, listeners,
  };
}

test("an external goal resume refreshes a blocked card without a run-state change", async () => {
  const view = mount();
  view.requests[0].finish(base); await tick(); view.render();
  assert.equal(view.goal().status, "blocked");
  view.poll(); view.poll(); // A slow read must not create an overlapping request.
  assert.equal(view.requests.length, 2);
  view.requests[1].finish({ ...base, status: "active" }); await tick(); view.render();
  assert.equal(view.goal().status, "active");
  assert.ok(view.button("Pause this goal"));
  view.unmount();
});

test("a pending refresh cannot undo a newer pause and focus reads current state", async () => {
  const view = mount();
  view.requests[0].finish({ ...base, status: "active" }); await tick(); view.render();
  view.focus();
  view.button("Pause this goal").props.onClick();
  assert.equal(view.requests[2].init.method, "PATCH");
  view.poll(); assert.equal(view.requests.length, 3);
  view.requests[2].finish({ ...base, status: "paused" }); await tick();
  view.requests[1].finish({ ...base, status: "active" }); await tick(); view.render();
  assert.equal(view.goal().status, "paused");
  view.unmount();
});

test("navigation and unmount discard late reads and remove refresh listeners", async () => {
  const view = mount();
  view.render("another-chat");
  assert.equal(view.requests[0].init.signal.aborted, true);
  view.requests[1].finish({ ...base, goalId: "another-goal" }); await tick();
  view.requests[0].finish(base); await tick();
  assert.equal(view.goal().goalId, "another-goal");
  view.unmount();
  assert.equal(view.timers.size, 0);
  assert.equal(view.listeners.size, 0);
});
