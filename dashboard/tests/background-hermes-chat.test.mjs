import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const terminal = source(
  "../src/app/components/hermes/dashboard-agent-terminal.tsx",
);
const gardenChat = source(
  "../src/app/components/hermes/garden-agent-chat.tsx",
);
const gardenWorkspace = source(
  "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
);
const sessionHook = source(
  "../src/app/components/hermes/use-agent-session.ts",
);
const eventStream = source("../src/lib/hermes/event-stream.ts");
const detachedPump = source(
  "../src/lib/hermes/detached-event-pump.ts",
);
const chatSessionRoute = source(
  "../src/app/api/chat-sessions/[sessionId]/route.ts",
);

test("chat navigation detaches the viewer while Hermes remains server-owned", () => {
  assert.match(eventStream, /acquireDetachedEventPump/);
  assert.match(eventStream, /`hermes:\$\{session\.row\.id\}`/);
  assert.match(eventStream, /return pump\.response\(signal, extraHeaders\)/);
  assert.doesNotMatch(eventStream, /signal\.addEventListener\("abort"/);
  assert.match(
    detachedPump,
    /Deliberately do not stop the driver[\s\S]*durable conversation/,
  );
  assert.doesNotMatch(detachedPump, /abortController|stopRun/);
});

test("Terminal and both Garden chat surfaces allow chat changes during a run", () => {
  for (const surface of [terminal, gardenChat]) {
    const newChat = surface.slice(
      surface.indexOf("function startNewChat"),
      surface.indexOf("function startNewChat") + 240,
    );
    const openChat = surface.slice(
      surface.indexOf("function openHistorySession"),
      surface.indexOf("async function deleteHistorySession"),
    );
    assert.doesNotMatch(newChat, /if \(busy\) return/);
    assert.doesNotMatch(openChat, /if \(busy/);
    assert.match(openChat, /session\.openSession/);
  }

  assert.doesNotMatch(
    gardenWorkspace,
    /async function handleNewChat\(\) \{\s*if \(isStreaming\) return/,
  );
  assert.doesNotMatch(
    gardenWorkspace,
    /!isStreaming && setActiveChatId\(session\.id\)/,
  );
  assert.match(gardenWorkspace, /streamingChatIds\.has\(activeChatId\)/);
});

test("opening an active conversation reloads it and reattaches its run", () => {
  assert.match(sessionHook, /const openSession = useCallback/);
  // The session list is fetched through the shared client rather than by each
  // surface building its own URL. What matters here is that the hook reaches
  // that client -- an assertion dead code cannot satisfy -- while the surface
  // round-trip itself is exercised in hermes-live-routing.
  assert.match(sessionHook, /loadHermesSessionSummaries/);
  assert.match(sessionHook, /setRunToResume\(\{/);
  assert.match(sessionHook, /viewEpochRef\.current !== viewEpoch/);
  assert.match(sessionHook, /abortRef\.current\?\.abort\(\)/);
});

test("a fresh terminal opens blank while a renderer reload reattaches its selected chat", () => {
  // Opting out of the durable restore keeps New chat as the resting state for a
  // fresh app window. The tab-scoped pointer is narrower: it only reattaches a
  // conversation when that same renderer session reloads underneath it.
  assert.match(terminal, /restoreLastConversation: false/);
  assert.match(terminal, /readActiveTerminalChatId\(restoreOwnerKey\)/);
  assert.match(
    terminal,
    /openTerminalSession\([\s\S]*?savedSessionId,[\s\S]*?readActiveTerminalChatSnapshot\(restoreOwnerKey, savedSessionId\)/,
  );
  assert.match(terminal, /window\.addEventListener\("pagehide", persist\)/);
  assert.match(
    sessionHook,
    /if \(!restoreLastConversation\) \{\s*markLoadingSession\(false\);\s*return;\s*\}/,
  );

  // The boot restore may only fill a view nobody has chosen anything in. An
  // empty sessionRef is not that test -- starting a new chat empties it too --
  // so the restore is superseded by the epoch reset() bumps, and never adopts a
  // conversation after the reader has asked for a blank one.
  const restore = sessionHook.slice(
    sessionHook.indexOf("const bootEpoch = viewEpochRef.current"),
    sessionHook.indexOf("// Component teardown detaches this page's viewer"),
  );
  assert.ok(restore.length > 0, "boot restore effect not found");
  assert.match(restore, /viewEpochRef\.current !== bootEpoch/);
  assert.doesNotMatch(restore, /if \(cancelled \|\| sessionRef\.current\) return;/);
  assert.equal(restore.match(/if \(superseded\(\)\) return;/g)?.length, 2);
});

test("a detached event pump is shared and replays events to a new viewer", async () => {
  const { acquireDetachedEventPump } = await import(
    new URL(
      "../src/lib/hermes/detached-event-pump.ts",
      import.meta.url,
    ).href
  );
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let driveCount = 0;
  const key = `test-detached-pump-${crypto.randomUUID()}`;

  const firstPump = acquireDetachedEventPump(key, async (sink) => {
    driveCount += 1;
    sink.markConnected();
    sink.emit(encoder.encode("data: first\n\n"));
    await gate;
    sink.emit(encoder.encode("data: finished\n\n"));
    sink.close();
  });
  const firstAbort = new AbortController();
  const firstReader = firstPump
    .response(firstAbort.signal, {})
    .body.getReader();
  firstAbort.abort();
  await firstReader.cancel();

  const secondPump = acquireDetachedEventPump(key, async () => {
    driveCount += 1;
  });
  assert.equal(secondPump, firstPump);
  const secondReader = secondPump
    .response(new AbortController().signal, {})
    .body.getReader();
  const connected = decoder.decode((await secondReader.read()).value);
  const replay = decoder.decode((await secondReader.read()).value);
  assert.equal(connected, ": connected\n\n");
  assert.equal(replay, "data: first\n\n");

  release();
  const completed = decoder.decode((await secondReader.read()).value);
  assert.equal(completed, "data: finished\n\n");
  assert.equal((await secondReader.read()).done, true);
  assert.equal(driveCount, 1);
});

test("a detached Garden viewer cannot save its network error as the answer", () => {
  assert.match(gardenWorkspace, /isRecoverableAgentStreamDisconnect\(error\)/);
  assert.match(gardenWorkspace, /if \(viewerDetached\)[\s\S]*setChatStreaming\(sessionId, false\)/);
  const detachedStart = gardenWorkspace.indexOf("if (viewerDetached)");
  const detachedBranch = gardenWorkspace.slice(
    detachedStart,
    gardenWorkspace.indexOf("} else {", detachedStart),
  );
  assert.doesNotMatch(detachedBranch, /persistChatSession/);
  assert.match(chatSessionRoute, /const runtimeOwnsMessages =/);
  assert.match(chatSessionRoute, /getActiveRuntimeRun\(runtimeSession\.id\)/);
  assert.match(chatSessionRoute, /const messagesToPersist = runtimeOwnsMessages \? undefined : messages/);
});
