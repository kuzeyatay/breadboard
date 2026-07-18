import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { submitPermissionDecision } from "../src/app/components/openharness/permission-client.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const composer = source("../src/app/components/assistant-composer.tsx");
const yoloMode = source("../src/app/components/use-yolo-mode.ts");
const agentSession = source(
  "../src/app/components/openharness/use-agent-session.ts",
);
const legacyActivity = source(
  "../src/app/components/openharness/use-legacy-agent-activity.ts",
);

test("the Intelligence menu contains an accessible YOLO mode switch", () => {
  const start = composer.indexOf('role="switch"');
  const block = composer.slice(start, start + 1_400);
  assert.ok(start >= 0);
  assert.match(block, /aria-checked=\{yoloMode\}/);
  assert.match(block, /YOLO mode/);
  assert.match(block, /Bypass permission prompts/);
  assert.doesNotMatch(block, /OpenHarness/);
  assert.match(block, /translate-x-5/);
});

test("YOLO mode persists and synchronizes its browser setting", () => {
  assert.match(yoloMode, /breadboard:yolo-mode/);
  assert.match(yoloMode, /useSyncExternalStore/);
  assert.match(yoloMode, /localStorage\.setItem/);
  assert.match(yoloMode, /addEventListener\("storage"/);
  assert.match(yoloMode, /dispatchEvent\(new Event/);
});

test("both permission clients auto-approve without opening a prompt", () => {
  for (const client of [agentSession, legacyActivity]) {
    assert.match(
      client,
      /if \(isYoloModeEnabled\(\)\)[\s\S]*?submitPermissionDecision\([\s\S]*?"always"/,
    );
    assert.match(
      client,
      /if \(!yoloMode \|\| !pendingPermission\) return;[\s\S]*?respondToPermission\("always"\)/,
    );
  }
});

test("automatic approval posts the session-scoped always decision", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return new Response(null, { status: 200 });
  };
  try {
    await submitPermissionDecision("permission/1", 42, "always");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(
    request.url,
    "/api/openharness/permissions/permission%2F1",
  );
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(request.init.body), {
    sessionId: 42,
    decision: "always",
  });
});
