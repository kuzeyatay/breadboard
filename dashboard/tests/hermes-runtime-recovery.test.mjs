import test from "node:test";
import assert from "node:assert/strict";
import { HermesRuntimeAdapter } from "../src/lib/agent-runtime/adapters/hermes.ts";

test("Hermes recovers a correlated terminal result when the live completion frame is lost", async () => {
  const requests = [];
  const fakeClient = {
    async request(method, params) {
      requests.push({ method, params });
      if (method === "session.create") {
        return { session_id: "live-1", stored_session_id: "stored-1" };
      }
      if (method === "session.turn_result") {
        return {
          state: "completed",
          turn_id: params.turn_id,
          payload: {
            text: "Deleted the files and verified the preserved file still exists.",
            status: "complete",
          },
        };
      }
      return { status: "streaming" };
    },
    async *events(_liveSessionId, signal, onConnected) {
      onConnected?.();
      await new Promise((resolve) => {
        if (signal?.aborted) return resolve();
        signal?.addEventListener("abort", resolve, { once: true });
      });
    },
    clearSession() {},
  };
  const adapter = new HermesRuntimeAdapter({
    baseUrl: "http://127.0.0.1:9119",
    sessionToken: "test",
    requestTimeoutMs: 5_000,
  });
  // TypeScript's `private` is compile-time only; replace the transport with a
  // deterministic fake to exercise the adapter's recovery loop.
  adapter.client = fakeClient;

  const session = await adapter.createSession({
    surface: "dashboard_terminal",
    sessionKey: "test-session",
    filesystemMode: "restricted",
  });
  await adapter.startRun({
    ...session,
    agentName: session.agentName,
    text: "delete the listed files",
    messageId: "msg_turn-1",
  });

  const events = adapter.streamSession({
    externalSessionId: session.externalSessionId,
    liveSessionId: session.liveSessionId,
    workspaceKey: session.workspaceKey,
    directory: session.directory,
    messageId: "msg_turn-1",
    instruction: "delete the listed files",
  })[Symbol.asyncIterator]();
  const recovered = [];
  for (let index = 0; index < 3; index += 1) {
    recovered.push((await events.next()).value);
  }
  await events.return();

  assert.deepEqual(
    recovered.map((event) => event.type),
    ["assistant.delta", "assistant.completed", "session.status"],
  );
  assert.equal(recovered[0].messageId, "msg_turn-1");
  assert.equal(recovered[2].payload.status, "idle");
  const recoveryRequest = requests.find(
    (request) => request.method === "session.turn_result",
  );
  assert.equal(recoveryRequest.params.turn_id, "msg_turn-1");
  assert.equal(recoveryRequest.params.expected_user_text, "delete the listed files");
});

test("Hermes recovers the terminal result after its event WebSocket disconnects", async () => {
  const fakeClient = {
    async request(method, params) {
      if (method === "session.create") {
        return { session_id: "live-2", stored_session_id: "stored-2" };
      }
      if (method === "session.turn_result") {
        return {
          state: "completed",
          turn_id: params.turn_id,
          payload: { text: "Finished safely.", status: "complete" },
        };
      }
      return { status: "streaming" };
    },
    async *events() {
      throw new Error("Hermes gateway connection closed.");
    },
    clearSession() {},
  };
  const adapter = new HermesRuntimeAdapter({
    baseUrl: "http://127.0.0.1:9119",
    sessionToken: "test",
    requestTimeoutMs: 5_000,
  });
  adapter.client = fakeClient;
  const session = await adapter.createSession({
    surface: "dashboard_terminal",
    sessionKey: "disconnect-test",
    filesystemMode: "restricted",
  });
  await adapter.startRun({
    ...session,
    agentName: session.agentName,
    text: "finish the task",
    messageId: "msg_turn-2",
  });

  const events = adapter.streamSession({
    externalSessionId: session.externalSessionId,
    liveSessionId: session.liveSessionId,
    workspaceKey: session.workspaceKey,
    directory: session.directory,
    messageId: "msg_turn-2",
    instruction: "finish the task",
  })[Symbol.asyncIterator]();
  const recovered = [];
  for (let index = 0; index < 4; index += 1) {
    recovered.push((await events.next()).value);
  }
  await events.return();

  assert.deepEqual(
    recovered.map((event) => event.type),
    [
      "reasoning.status",
      "assistant.delta",
      "assistant.completed",
      "session.status",
    ],
  );
  assert.equal(recovered[0].payload.label, "Reconnecting to Hermes");
  assert.equal(recovered[1].payload.text, "Finished safely.");
});

test("Hermes discovers a durable turn created after the event stream connects", async () => {
  const requests = [];
  const fakeClient = {
    async request(method, params) {
      requests.push({ method, params });
      if (method === "session.create") {
        return { session_id: "live-3", stored_session_id: "stored-3" };
      }
      if (method === "session.turn_result") {
        return {
          state: "completed",
          turn_id: params.turn_id,
          payload: { text: "Cross-garden synthesis complete.", status: "complete" },
        };
      }
      return { status: "streaming" };
    },
    async *events(_liveSessionId, signal, onConnected) {
      onConnected?.();
      await new Promise((resolve) => {
        if (signal?.aborted) return resolve();
        signal?.addEventListener("abort", resolve, { once: true });
      });
    },
    clearSession() {},
  };
  const adapter = new HermesRuntimeAdapter({
    baseUrl: "http://127.0.0.1:9119",
    sessionToken: "test",
    requestTimeoutMs: 5_000,
  });
  adapter.client = fakeClient;
  const session = await adapter.createSession({
    surface: "dashboard_terminal",
    sessionKey: "late-turn-test",
    filesystemMode: "restricted",
  });
  let activeTurn = {};
  const events = adapter.streamSession({
    externalSessionId: session.externalSessionId,
    liveSessionId: session.liveSessionId,
    workspaceKey: session.workspaceKey,
    directory: session.directory,
    resolveActiveTurn: () => activeTurn,
  })[Symbol.asyncIterator]();

  const firstEvent = events.next();
  activeTurn = {
    messageId: "msg_late-turn",
    instruction: "What topics span more than one garden?",
  };
  const recovered = [(await firstEvent).value];
  recovered.push((await events.next()).value, (await events.next()).value);
  await events.return();

  assert.deepEqual(
    recovered.map((event) => event.type),
    ["assistant.delta", "assistant.completed", "session.status"],
  );
  const recoveryRequest = requests.find(
    (request) => request.method === "session.turn_result",
  );
  assert.equal(recoveryRequest.params.turn_id, "msg_late-turn");
  assert.equal(
    recoveryRequest.params.expected_user_text,
    "What topics span more than one garden?",
  );
});
