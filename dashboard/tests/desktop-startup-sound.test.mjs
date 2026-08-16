// The Profile switch for the desktop app's startup chime.
//
// The preference itself lives in the Electron shell, because the screen that
// plays the sound runs before the dashboard serves anything and before anyone
// has signed in. All this module decides is whether there is a shell to ask at
// all, and what to believe when one answers badly — which is what keeps the
// switch off the page in a browser instead of on it and inert.

import assert from "node:assert/strict";
import test from "node:test";

import { startupSoundControl } from "../src/lib/desktop-startup-sound.ts";

function withBridge(bridge, body) {
  const had = "window" in globalThis;
  const previous = globalThis.window;
  globalThis.window = bridge === null ? {} : { breadboardDesktop: bridge };
  try {
    return body();
  } finally {
    if (had) globalThis.window = previous;
    else delete globalThis.window;
  }
}

test("there is no control where there is no startup screen", () => {
  const had = "window" in globalThis;
  const previous = globalThis.window;
  if (had) delete globalThis.window;
  try {
    // Server rendering: no window at all.
    assert.equal(startupSoundControl(), null);
  } finally {
    if (had) globalThis.window = previous;
  }

  // A browser: a window, but no shell behind it.
  assert.equal(withBridge(null, startupSoundControl), null);
  // A shell too old to know about the setting is the same answer, not a crash.
  assert.equal(withBridge({ setTheme: () => true }, startupSoundControl), null);
  assert.equal(
    withBridge({ getStartupSound: () => Promise.resolve(true) }, startupSoundControl),
    null,
  );
});

test("the shell's answer is read, and its silence is read as sound on", async () => {
  const muted = withBridge(
    {
      getStartupSound: () => Promise.resolve(false),
      setStartupSound: () => Promise.resolve(true),
    },
    startupSoundControl,
  );
  assert.equal(await muted.read(), false);

  // Answered lazily so a rejection is created only as it is consumed, and never
  // sits around as an unhandled one.
  const oddAnswers = {
    nothing: () => undefined,
    null: () => null,
    "a string": () => "yes",
    "a dead channel": () => Promise.reject(new Error("no channel")),
  };
  for (const [name, answer] of Object.entries(oddAnswers)) {
    const odd = withBridge(
      { getStartupSound: answer, setStartupSound: () => Promise.resolve(true) },
      startupSoundControl,
    );
    // Only an explicit false mutes. Anything else is an install whose chime
    // nobody has switched off.
    assert.equal(await odd.read(), true, name);
  }
});

test("a write that did not land is reported as a failure, so the switch can go back", async () => {
  const written = [];
  const control = withBridge(
    {
      getStartupSound: () => Promise.resolve(true),
      setStartupSound: (enabled) => {
        written.push(enabled);
        return Promise.resolve(true);
      },
    },
    startupSoundControl,
  );
  assert.equal(await control.write(false), true);
  assert.deepEqual(written, [false]);

  const refusals = {
    "a plain false": () => false,
    nothing: () => undefined,
    "a thrown write": () => Promise.reject(new Error("read-only disk")),
  };
  for (const [name, refusal] of Object.entries(refusals)) {
    const failing = withBridge(
      { getStartupSound: () => Promise.resolve(true), setStartupSound: refusal },
      startupSoundControl,
    );
    assert.equal(await failing.write(false), false, name);
  }
});
