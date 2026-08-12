import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  PERMISSION_WAIT_TIMEOUT_MS,
  PRE_DISPATCH_STREAM_TIMEOUT_MS,
  RUNTIME_INACTIVITY_TIMEOUT_MS,
  SILENT_STREAM_TIMEOUT_MS,
  runtimeIdentityKey,
  streamSupervisorDecision,
} from "../src/lib/hermes/stream-supervisor.ts";

const eventStream = fs.readFileSync(
  new URL("../src/lib/hermes/event-stream.ts", import.meta.url),
  "utf8",
);

const base = {
  boundIdentity: "hermes:sess_old:live_old",
  currentIdentity: "hermes:sess_old:live_old",
  sawRuntimeEvent: false,
  submitted: true,
  elapsedMs: 0,
  finalized: false,
  timedOut: false,
};

test("a replaced runtime identity is adopted rather than waited out", () => {
  // The regression: Hermes restarts, the first dispatch fails, the turn is
  // re-dispatched onto a new session, and the row's identity is rewritten
  // after this stream already subscribed to the old one.
  assert.deepEqual(
    streamSupervisorDecision({
      ...base,
      currentIdentity: "hermes:sess_new:live_new",
    }),
    { kind: "rebind" },
  );
});

test("a live session reissued under the same durable id still rebinds", () => {
  assert.deepEqual(
    streamSupervisorDecision({
      ...base,
      currentIdentity: "hermes:sess_old:live_new",
    }),
    { kind: "rebind" },
  );
});

test("an unchanged identity is left alone", () => {
  assert.equal(streamSupervisorDecision({ ...base }), null);
});

test("an unreadable row never triggers a rebind to nothing", () => {
  assert.equal(
    streamSupervisorDecision({ ...base, currentIdentity: null }),
    null,
  );
});

test("rebinding wins over the silence timeout", () => {
  // A replaced identity explains the silence and is recoverable, so the turn
  // must not be failed when both conditions hold at once.
  assert.deepEqual(
    streamSupervisorDecision({
      ...base,
      currentIdentity: "hermes:sess_new:live_new",
      elapsedMs: SILENT_STREAM_TIMEOUT_MS * 2,
    }),
    { kind: "rebind" },
  );
});

test("a submitted run that never emits is failed instead of hanging", () => {
  assert.equal(
    streamSupervisorDecision({ ...base, elapsedMs: SILENT_STREAM_TIMEOUT_MS - 1 }),
    null,
  );
  assert.deepEqual(
    streamSupervisorDecision({ ...base, elapsedMs: SILENT_STREAM_TIMEOUT_MS }),
    { kind: "silent_timeout" },
  );
});

test("the silence timeout leaves live, finished and undispatched turns alone", () => {
  const expired = { ...base, elapsedMs: SILENT_STREAM_TIMEOUT_MS * 2 };
  // Streaming normally — silence is measured from the first event, not dispatch.
  assert.equal(
    streamSupervisorDecision({ ...expired, sawRuntimeEvent: true }),
    null,
  );
  // Not yet handed to the runtime: the pre-dispatch deadline owns this case.
  assert.equal(streamSupervisorDecision({ ...expired, submitted: false }), null);
  // Already persisted, and already reported.
  assert.equal(streamSupervisorDecision({ ...expired, finalized: true }), null);
  assert.equal(streamSupervisorDecision({ ...expired, timedOut: true }), null);
});

test("a turn that streams and then goes quiet is stopped, not left hanging", () => {
  // The regression: a turn produced output, the runtime stopped answering about
  // it, and the pump waited forever — leaving the run active and every later
  // message in that conversation rejected.
  const streaming = { ...base, sawRuntimeEvent: true };
  assert.equal(
    streamSupervisorDecision({
      ...streaming,
      msSinceLastEvent: RUNTIME_INACTIVITY_TIMEOUT_MS - 1,
    }),
    null,
  );
  assert.deepEqual(
    streamSupervisorDecision({
      ...streaming,
      msSinceLastEvent: RUNTIME_INACTIVITY_TIMEOUT_MS,
    }),
    { kind: "inactivity_timeout" },
  );
});

test("a turn parked on an approval is given the person's own time to answer", () => {
  // Hermes says nothing at all while an approval waits, so the inactivity bound
  // must not read a person thinking as a dead runtime.
  const awaiting = {
    ...base,
    sawRuntimeEvent: true,
    awaitingPermission: true,
  };
  assert.equal(
    streamSupervisorDecision({
      ...awaiting,
      msSinceLastEvent: RUNTIME_INACTIVITY_TIMEOUT_MS * 2,
    }),
    null,
  );
  // But not forever: an approval Hermes never expires still ends the turn.
  assert.deepEqual(
    streamSupervisorDecision({
      ...awaiting,
      msSinceLastEvent: PERMISSION_WAIT_TIMEOUT_MS,
    }),
    { kind: "inactivity_timeout" },
  );
  assert.ok(PERMISSION_WAIT_TIMEOUT_MS > RUNTIME_INACTIVITY_TIMEOUT_MS);
});

test("inactivity never overrides a rebind, a finished turn or an undispatched one", () => {
  const stalled = {
    ...base,
    sawRuntimeEvent: true,
    msSinceLastEvent: RUNTIME_INACTIVITY_TIMEOUT_MS * 2,
  };
  assert.deepEqual(
    streamSupervisorDecision({
      ...stalled,
      currentIdentity: "hermes:sess_new:live_new",
    }),
    { kind: "rebind" },
  );
  assert.equal(streamSupervisorDecision({ ...stalled, finalized: true }), null);
  assert.equal(streamSupervisorDecision({ ...stalled, timedOut: true }), null);
  assert.equal(streamSupervisorDecision({ ...stalled, submitted: false }), null);
});

test("the pump heartbeats its run so a dead pump releases the conversation", () => {
  // Liveness cannot live in process memory: whoever asks whether this run still
  // has an owner is usually a different process.
  assert.match(eventStream, /touchRuntimeRunHeartbeat\(streamRun\.id\)/);
  assert.match(eventStream, /RUN_HEARTBEAT_INTERVAL_MS/);
  // A finalized turn must stop claiming its run.
  assert.match(eventStream, /!persisted &&\s*streamRun &&/);
});

test("the browser watchdog reports first so the server bound is looser", async () => {
  const { AGENT_STREAM_FIRST_ACTIVITY_TIMEOUT_MS } = await import(
    "../src/app/components/hermes/agent-stream-watchdog.ts"
  );
  assert.ok(SILENT_STREAM_TIMEOUT_MS > AGENT_STREAM_FIRST_ACTIVITY_TIMEOUT_MS);
});

test("cold route compilation cannot expire the stream before prompt dispatch", async () => {
  const { AGENT_STREAM_FIRST_ACTIVITY_TIMEOUT_MS } = await import(
    "../src/app/components/hermes/agent-stream-watchdog.ts"
  );
  assert.ok(PRE_DISPATCH_STREAM_TIMEOUT_MS >= AGENT_STREAM_FIRST_ACTIVITY_TIMEOUT_MS);
  assert.match(eventStream, /const markPumpConnected = \(\) =>/);
  assert.match(eventStream, /sink\.markConnected\(\);[\s\S]*PRE_DISPATCH_STREAM_TIMEOUT_MS/);
  assert.doesNotMatch(eventStream, /}, 15_000\);/);
});

test("identity keys separate durable id, live id and runtime kind", () => {
  assert.notEqual(
    runtimeIdentityKey({ runtimeKind: "hermes", externalSessionId: "a", liveSessionId: "1" }),
    runtimeIdentityKey({ runtimeKind: "hermes", externalSessionId: "a", liveSessionId: "2" }),
  );
  assert.equal(
    runtimeIdentityKey({ runtimeKind: "hermes", externalSessionId: "a", liveSessionId: undefined }),
    runtimeIdentityKey({ runtimeKind: "hermes", externalSessionId: "a" }),
  );
});

test("the pump re-reads identity from SQLite and resubscribes in place", () => {
  // Identity must come from the durable row on every poll: the prompt POST and
  // this stream can run in separate Next.js module contexts, so an in-process
  // notification would not reach the pump.
  assert.match(eventStream, /currentRuntimeIdentity\(session\.row\.id\)/);
  assert.match(eventStream, /streamSupervisorDecision\(\{/);

  // The rebind must swap the subscription without tearing down the viewer, or
  // the browser loses the turn it is waiting on.
  const generator = eventStream.slice(
    eventStream.indexOf("async function* subscribeAcrossRebinds"),
    eventStream.indexOf("for await (const event of subscribeAcrossRebinds())"),
  );
  assert.match(generator, /yield\* runtime\.streamSession\(/);
  assert.match(generator, /session = pendingRebind/);
  assert.match(generator, /runtimeSubscription = new AbortController\(\)/);
  assert.doesNotMatch(generator, /sink\.close\(\)/);

  // The supervisor must not outlive the turn.
  assert.match(eventStream, /clearInterval\(supervisor\)/);
});
