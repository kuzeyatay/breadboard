import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  playSpeechBlob,
  stopSpeechPlayback,
} from "../src/lib/speech/playback.ts";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const source = (relativePath) =>
  fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");

test("Terminal and Garden Chat release every renderer SSE reader", () => {
  const session = source("src/app/components/hermes/use-agent-session.ts");
  assert.match(
    session,
    /let streamReader: ReadableStreamDefaultReader<Uint8Array> \| null = null;/,
  );
  assert.match(session, /streamReader = response\.body\.getReader\(\);/);
  assert.match(
    session,
    /\} finally \{\s*await disposeAgentStreamReader\(streamReader\);\s*\}/,
  );
  assert.match(
    session,
    /Component teardown detaches this page's viewer only[\s\S]*?abortRef\.current\?\.abort\(\);/,
  );
});

test("Terminal rail drags remove window listeners when their owner unmounts", () => {
  const rail = source("src/app/components/hermes/use-rail-resize.ts");
  assert.match(rail, /const dragCleanupRef = useRef<\(\(\) => void\) \| null>\(null\);/);
  assert.match(
    rail,
    /useEffect\(\s*\(\) => \(\) => \{\s*dragCleanupRef\.current\?\.\(\);\s*dragCleanupRef\.current = null;\s*\},\s*\[\],\s*\);/,
  );
  assert.match(rail, /window\.removeEventListener\("pointermove", handleMove\);/);
  assert.match(rail, /window\.removeEventListener\("pointerup", handleEnd\);/);
  assert.match(rail, /window\.removeEventListener\("pointercancel", handleEnd\);/);
  assert.match(rail, /dragCleanupRef\.current = detach;/);
});

test("garden-card resize drags are owned and disposed by the dashboard", () => {
  const dashboard = source("src/app/dashboard/dashboard-client.tsx");
  assert.match(
    dashboard,
    /const resizeCleanupRef = useRef<\(\(\) => void\) \| null>\(null\);/,
  );
  assert.match(
    dashboard,
    /useEffect\(\s*\(\) => \(\) => \{\s*resizeCleanupRef\.current\?\.\(\);\s*resizeCleanupRef\.current = null;\s*resizeSessionRef\.current = null;\s*\},\s*\[\],\s*\);/,
  );
  assert.match(dashboard, /resizeCleanupRef\.current\?\.\(\);/);
  assert.match(dashboard, /window\.removeEventListener\("pointermove", handleMove\);/);
  assert.match(dashboard, /window\.removeEventListener\("pointerup", handleEnd\);/);
  assert.match(dashboard, /window\.removeEventListener\("pointercancel", handleEnd\);/);
  assert.match(dashboard, /resizeCleanupRef\.current = detach;/);
});

test("Terminal and Garden history polls clean up timers and global listeners", () => {
  for (const relativePath of [
    "src/app/components/hermes/dashboard-agent-terminal.tsx",
    "src/app/components/hermes/garden-agent-chat.tsx",
  ]) {
    const component = source(relativePath);
    assert.match(component, /setInterval\(\(\) => refreshHistory\(true\), 10_000\)/);
    assert.match(component, /window\.clearInterval\(timer\);/);
    assert.match(
      component,
      /document\.removeEventListener\("visibilitychange", onVisibilityChange\);/,
    );
    assert.match(
      component,
      /window\.removeEventListener\(\s*HERMES_SESSIONS_CHANGED_EVENT,\s*onSessionsChanged,\s*\);/,
    );
  }
});

test("history and proposal fetches abort when their renderer owner leaves", () => {
  const sessionClient = source("src/lib/hermes/session-client.ts");
  const session = source("src/app/components/hermes/use-agent-session.ts");
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const garden = source("src/app/components/hermes/garden-agent-chat.tsx");

  assert.match(sessionClient, /function followSharedRequest<T>\(/);
  assert.match(sessionClient, /request\.consumers\.size === 0/);
  assert.match(sessionClient, /request\.abandon\(\);/);
  assert.match(session, /restoreController\.abort\(\);/);
  assert.match(terminal, /historyController\.abort\(\);/);
  assert.match(garden, /proposalRequestRef\.current\?\.abort\(\);/);
  assert.match(garden, /historyController\.abort\(\);/);
});

test("stopping speech empties the media element before revoking its blob", async () => {
  const calls = [];
  const instances = [];
  const originalAudio = globalThis.Audio;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;

  class FakeAudio {
    currentTime = 12;
    listeners = new Map();

    constructor(src) {
      this.src = src;
      instances.push(this);
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    pause() {
      calls.push("pause");
    }

    removeAttribute(name) {
      calls.push(`remove:${name}`);
      if (name === "src") this.src = "";
    }

    load() {
      calls.push("load");
    }

    async play() {
      calls.push("play");
    }
  }

  let finished = 0;
  try {
    globalThis.Audio = FakeAudio;
    URL.createObjectURL = () => "blob:renderer-lifecycle";
    URL.revokeObjectURL = (url) => calls.push(`revoke:${url}`);

    await playSpeechBlob(new Blob(["audio"]), () => {
      finished += 1;
    });
    stopSpeechPlayback();
    stopSpeechPlayback();
  } finally {
    stopSpeechPlayback();
    if (originalAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = originalAudio;
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  }

  assert.equal(instances.length, 1);
  assert.equal(instances[0].src, "");
  assert.equal(instances[0].currentTime, 0);
  assert.equal(finished, 1, "cleanup must notify the owner exactly once");
  assert.deepEqual(calls, [
    "play",
    "pause",
    "remove:src",
    "load",
    "revoke:blob:renderer-lifecycle",
  ]);
});
