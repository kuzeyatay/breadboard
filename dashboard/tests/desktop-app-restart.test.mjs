import assert from "node:assert/strict";
import test from "node:test";

import { breadboardRestartControl } from "../src/lib/desktop-app-restart.ts";

function withBridge(bridge, body) {
  const hadWindow = "window" in globalThis;
  const previous = globalThis.window;
  globalThis.window = bridge === null ? {} : { breadboardDesktop: bridge };
  try {
    return body();
  } finally {
    if (hadWindow) globalThis.window = previous;
    else delete globalThis.window;
  }
}

test("restart is absent outside the Breadboard desktop shell", () => {
  const hadWindow = "window" in globalThis;
  const previous = globalThis.window;
  if (hadWindow) delete globalThis.window;
  try {
    assert.equal(breadboardRestartControl(), null);
  } finally {
    if (hadWindow) globalThis.window = previous;
  }

  assert.equal(withBridge(null, breadboardRestartControl), null);
  assert.equal(withBridge({ quit: () => Promise.resolve() }, breadboardRestartControl), null);
});

test("restart reports only an accepted desktop relaunch as success", async () => {
  let calls = 0;
  const accepted = withBridge(
    {
      restartBreadboard: () => {
        calls += 1;
        return Promise.resolve(true);
      },
    },
    breadboardRestartControl,
  );
  assert.equal(await accepted.restart(), true);
  assert.equal(calls, 1);

  for (const restartBreadboard of [
    () => Promise.resolve(false),
    () => Promise.resolve(undefined),
    () => Promise.reject(new Error("build failed")),
  ]) {
    const refused = withBridge({ restartBreadboard }, breadboardRestartControl);
    assert.equal(await refused.restart(), false);
  }
});
