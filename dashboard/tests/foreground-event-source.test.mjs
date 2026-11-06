import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { transform } from "esbuild";

test("hidden and prepared tabs release update streams, then reconnect on activation", async t => {
  const source = fs.readFileSync(new URL("../src/lib/foreground-event-source.ts", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/, "const desktopTabsBridge = () => globalThis.testBridge;\n");
  const { code } = await transform(source, { loader: "ts", format: "esm" });
  const { ForegroundEventSource } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  const previous = { document: globalThis.document, EventSource: globalThis.EventSource, bridge: globalThis.testBridge };
  t.after(() => { globalThis.document = previous.document; globalThis.EventSource = previous.EventSource; globalThis.testBridge = previous.bridge; });
  const document = new EventTarget();
  document.visibilityState = "visible";
  globalThis.document = document;
  const streams = [];
  globalThis.EventSource = class {
    constructor(url) { this.url = url; this.closed = false; streams.push(this); }
    close() { this.closed = true; }
  };
  let push, resolveInitial, detached = false;
  globalThis.testBridge = {
    getTabsState: () => new Promise(resolve => { resolveInitial = resolve; }),
    onTabsState: listener => { push = listener; return () => { detached = true; }; },
  };
  const events = new ForegroundEventSource("/api/browser/spotify/events");
  push({ selfId: null, activeId: null });
  assert.equal(streams.length, 0, "prepared tabs never subscribe");
  push({ selfId: 4, activeId: 4 });
  assert.equal(streams.length, 1);
  resolveInitial({ selfId: null, activeId: 1 });
  await Promise.resolve();
  assert.equal(streams[0].closed, false, "a late read cannot replace newer tab state");
  let message;
  events.onmessage = event => { message = event.data; };
  streams[0].onmessage({ data: "playback" });
  assert.equal(message, "playback");
  push({ selfId: 4, activeId: 5 });
  assert.equal(streams[0].closed, true);
  push({ selfId: 4, activeId: 4 });
  assert.equal(streams.length, 2);
  document.visibilityState = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(streams[1].closed, true);
  document.visibilityState = "visible";
  events.setActive(false);
  push({ selfId: 4, activeId: 4 });
  assert.equal(streams.length, 2, "an inactive subtree stays asleep inside an active shared renderer");
  events.setActive(true);
  assert.equal(streams.length, 3);
  events.close();
  assert.equal(detached, true);
  document.visibilityState = "visible";
  push({ selfId: 4, activeId: 4 });
  assert.equal(streams.length, 3, "disposed widgets cannot reconnect");
});
