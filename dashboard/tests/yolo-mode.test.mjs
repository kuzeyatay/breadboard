import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { submitPermissionDecision } from "../src/app/components/hermes/permission-client.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const composer = source("../src/app/components/assistant-composer.tsx");
const yoloMode = source("../src/app/components/use-yolo-mode.ts");
const agentSession = source(
  "../src/app/components/hermes/use-agent-session.ts",
);
const legacyActivity = source(
  "../src/app/components/hermes/use-legacy-agent-activity.ts",
);
const agentBrowserCard = source(
  "../src/app/components/hermes/inline-agent-browser-run.tsx",
);
const agentTarsCard = source(
  "../src/app/components/hermes/inline-browser-run.tsx",
);
const inlineGadget = source(
  "../src/app/components/hermes/inline-gadget.tsx",
);
const messagesRoute = source(
  "../src/app/api/hermes/sessions/[sessionId]/messages/route.ts",
);
const yoloRoute = source(
  "../src/app/api/hermes/sessions/[sessionId]/yolo/route.ts",
);
const terminalRoute = source(
  "../src/app/api/hermes/tools/terminal/route.ts",
);
const turnService = source("../src/lib/conversations/turn-service.ts");
const hermesAdapter = source(
  "../src/lib/agent-runtime/adapters/hermes.ts",
);

test("the Intelligence menu contains an accessible YOLO mode switch", () => {
  // Anchored on the YOLO switch rather than on the first switch in the menu:
  // switches keep being added above it, and a fixed window from the top of the
  // stack measures how many neighbours it has rather than whether it is right.
  const start = composer.indexOf("aria-checked={yoloMode}");
  assert.ok(start >= 0);
  const block = composer.slice(Math.max(0, start - 200), start + 2_000);
  assert.match(block, /role="switch"/);
  assert.match(block, /aria-checked=\{yoloMode\}/);
  assert.match(block, /YOLO mode/);
  assert.match(block, /Bypass permission prompts/);
  assert.doesNotMatch(block, /Hermes/);
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
      /if \(isYoloModeEnabled\(\)\)[\s\S]*?submitPermissionDecision\([\s\S]*?"once"/,
    );
    assert.match(
      client,
      /if \(!yoloMode \|\| !pendingPermission\) return;[\s\S]*?respondToPermission\("once"\)/,
    );
  }
});

test("the switch configures Hermes's real session-scoped YOLO mode", () => {
  assert.match(agentSession, /yoloMode: isYoloModeEnabled\(\)/);
  assert.match(agentSession, /\/yolo`[\s\S]*?enabled: yoloMode/);
  assert.match(messagesRoute, /yoloMode: body\.yoloMode === true/);
  assert.match(yoloRoute, /authorizeRuntimeReference\(userId, sessionId\)/);
  assert.match(yoloRoute, /setApprovalBypass\(/);
  assert.match(turnService, /yoloMode: input\.yoloMode === true/);
  assert.match(
    hermesAdapter,
    /key: "yolo",\s*value: input\.enabled \? "1" : "0"/,
  );
});

test("an unplanned Terminal command reaches permission instead of a hard capability denial", () => {
  assert.doesNotMatch(terminalRoute, /terminal_turn_capability_denied/);
  assert.match(terminalRoute, /authorizeTerminalCommand\(command, terminalScope\)/);
  assert.match(terminalRoute, /terminal_permission_required/);
  assert.ok(
    terminalRoute.indexOf("authorizeTerminalCommand(command, terminalScope)") <
      terminalRoute.indexOf('"terminal_permission_required"'),
    "the exact-command policy must decide whether the permission widget is needed",
  );
});

test("YOLO also auto-approves permission surfaces inside agent cards and gadgets", () => {
  for (const card of [agentBrowserCard, agentTarsCard]) {
    assert.match(card, /const \[yoloMode\] = useYoloMode\(\)/);
    assert.match(
      card,
      /if \(!yoloMode \|\| !pending \|\| deciding\) return;[\s\S]*?decide\("approve"\)/,
    );
  }
  assert.match(inlineGadget, /const \[yoloMode\] = useYoloMode\(\)/);
  assert.match(
    inlineGadget,
    /if \(!yoloMode \|\| !nextPendingActionId[\s\S]*?decide\(nextPendingActionId, "approve"\)/,
  );
});

test("automatic approval posts a one-turn decision instead of a lasting grant", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return new Response(null, { status: 200 });
  };
  try {
    await submitPermissionDecision("permission/1", 42, "once");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(
    request.url,
    "/api/hermes/permissions/permission%2F1",
  );
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(request.init.body), {
    sessionId: 42,
    decision: "once",
  });
});
