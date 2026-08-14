import test from "node:test";
import assert from "node:assert/strict";
import { HermesRuntimeAdapter } from "../src/lib/agent-runtime/adapters/hermes.ts";

test("every Breadboard Hermes session permanently includes real web lookup", async () => {
  const requests = [];
  const adapter = new HermesRuntimeAdapter({
    baseUrl: "http://127.0.0.1:9119",
    sessionToken: "test",
    requestTimeoutMs: 5_000,
  });
  adapter.client = {
    async request(method, params) {
      requests.push({ method, params });
      return method === "session.create"
        ? { session_id: "live-web", stored_session_id: "stored-web" }
        : {};
    },
    clearSession() {},
  };
  await adapter.createSession({
    surface: "dashboard_terminal",
    sessionKey: "web-invariant",
    title: "Web invariant",
  });
  const create = requests.find((request) => request.method === "session.create");
  assert.deepEqual(create.params.enabled_toolsets, ["breadboard", "web"]);
  const capabilities = await adapter.listCapabilities();
  assert.ok(capabilities.tools.includes("web_search"));
  assert.ok(capabilities.tools.includes("web_extract"));
});

test("Hermes YOLO follows the per-turn switch without leaking a lasting grant", async () => {
  const requests = [];
  const fakeClient = {
    async request(method, params) {
      requests.push({ method, params });
      if (method === "session.create") {
        return { session_id: "live-yolo", stored_session_id: "stored-yolo" };
      }
      return { status: "streaming" };
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
    sessionKey: "yolo-mode-test",
    filesystemMode: "restricted",
  });
  for (const [index, yoloMode] of [true, true, false].entries()) {
    await adapter.startRun({
      ...session,
      agentName: session.agentName,
      text: `turn ${index + 1}`,
      messageId: `msg_yolo-${index + 1}`,
      yoloMode,
    });
  }

  const yoloWrites = requests.filter(
    (request) =>
      request.method === "config.set" && request.params.key === "yolo",
  );
  assert.deepEqual(
    yoloWrites.map((request) => request.params),
    [
      { session_id: "live-yolo", key: "yolo", value: "1" },
      { session_id: "live-yolo", key: "yolo", value: "0" },
    ],
  );
  assert.equal(
    requests.filter((request) => request.method === "prompt.submit").length,
    3,
  );
  assert.ok(
    requests.indexOf(yoloWrites[0]) <
      requests.findIndex((request) => request.method === "prompt.submit"),
  );
});

test("Hermes receives the Breadboard PowerShell execution contract", async () => {
  const requests = [];
  const fakeClient = {
    async request(method, params) {
      requests.push({ method, params });
      if (method === "session.create") {
        return { session_id: "live-shell", stored_session_id: "stored-shell" };
      }
      return { status: "streaming" };
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
    sessionKey: "shell-contract-test",
    filesystemMode: "restricted",
  });
  await adapter.startRun({
    ...session,
    agentName: session.agentName,
    text: "measure the folder",
    messageId: "msg_shell-contract",
  });

  for (const request of requests.filter((entry) =>
    ["session.create", "prompt.submit"].includes(entry.method)
  )) {
    assert.match(request.params.system_prompt, /You are Bread, the Breadboard assistant\./);
    assert.match(request.params.system_prompt, /Assistant: Bread/);
    assert.doesNotMatch(request.params.system_prompt, /You are Hermes Agent/);
    assert.match(request.params.system_prompt, /Windows PowerShell 5\.1/);
    assert.match(request.params.system_prompt, /enumerate the directory tree only once/);
    assert.match(request.params.system_prompt, /Model: gpt-5\.6-sol/);
    assert.match(request.params.system_prompt, /Provider: chatgpt/);
    assert.doesNotMatch(request.params.system_prompt, /BREADBOARD_CHATMOCK_RESOLVED/);
    assert.match(request.params.system_prompt, /not the model identity/);
  }
});

test("the picked model becomes what ChatMock's `default` sentinel resolves to", async () => {
  const requests = [];
  const chatmockCalls = [];
  const originalFetch = globalThis.fetch;
  // The stored background model disagrees with the picker, which is exactly the
  // drift that used to run the turn on ChatGPT while the chat showed Claude.
  let storedDefaultModel = "gpt-5.6-sol";
  globalThis.fetch = async (url, init) => {
    chatmockCalls.push({ url: String(url), method: init?.method ?? "GET" });
    if (String(url).endsWith("/settings/default-model")) {
      storedDefaultModel = JSON.parse(init.body).model;
      return new Response(JSON.stringify({
        defaultModel: storedDefaultModel,
        storedDefaultModel,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    assert.equal(String(url), "http://127.0.0.1:8765/v1/settings/model-health");
    return new Response(JSON.stringify({
      preferredModel: storedDefaultModel,
      servingModel: storedDefaultModel,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const fakeClient = {
      async request(method, params) {
        requests.push({ method, params });
        if (method === "session.create") {
          return { session_id: "live-identity", stored_session_id: "stored-identity" };
        }
        return { status: "streaming" };
      },
      clearSession() {},
    };
    const adapter = new HermesRuntimeAdapter({
      baseUrl: "http://127.0.0.1:9119",
      chatmockBaseUrl: "http://127.0.0.1:8765/v1",
      sessionToken: "test",
      requestTimeoutMs: 5_000,
    });
    adapter.client = fakeClient;
    const session = await adapter.createSession({
      surface: "dashboard_terminal",
      sessionKey: "resolved-identity-test",
      filesystemMode: "restricted",
      model: "default",
    });
    await adapter.startRun({
      ...session,
      agentName: session.agentName,
      text: "what model are you?",
      model: { providerID: "chatmock", modelID: "default" },
      modelIdentity: { modelID: "cliproxy/claude-opus-5" },
      messageId: "msg_identity",
    });

    // The choice is written to ChatMock before the prompt goes out, so the
    // sentinel Hermes was given can only expand to the model that was picked.
    assert.deepEqual(
      chatmockCalls.filter((call) => call.method === "PUT"),
      [{ url: "http://127.0.0.1:8765/v1/settings/default-model", method: "PUT" }],
    );
    assert.equal(storedDefaultModel, "cliproxy/claude-opus-5");

    const submit = requests.find((entry) => entry.method === "prompt.submit");
    assert.match(submit.params.system_prompt, /Model: cliproxy\/claude-opus-5/);
    assert.match(submit.params.system_prompt, /Provider: cliproxy/);
    for (const request of requests.filter((entry) =>
      ["session.create", "prompt.submit"].includes(entry.method)
    )) {
      assert.doesNotMatch(request.params.system_prompt, /\{\{/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a turn that carries no choice leaves the stored background model alone", async () => {
  const requests = [];
  const chatmockCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    chatmockCalls.push({ url: String(url), method: init?.method ?? "GET" });
    // A model on cooldown: `default` is standing in with something else. Writing
    // that stand-in back would replace the user's choice with its substitute.
    return new Response(JSON.stringify({
      preferredModel: "cliproxy/claude-opus-5",
      servingModel: "gpt-5.6-sol",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const fakeClient = {
      async request(method, params) {
        requests.push({ method, params });
        if (method === "session.create") {
          return { session_id: "live-nochoice", stored_session_id: "stored-nochoice" };
        }
        return { status: "streaming" };
      },
      clearSession() {},
    };
    const adapter = new HermesRuntimeAdapter({
      baseUrl: "http://127.0.0.1:9119",
      chatmockBaseUrl: "http://127.0.0.1:8765/v1",
      sessionToken: "test",
      requestTimeoutMs: 5_000,
    });
    adapter.client = fakeClient;
    const session = await adapter.createSession({
      surface: "dashboard_terminal",
      sessionKey: "no-choice-test",
      filesystemMode: "restricted",
      model: "default",
    });
    await adapter.startRun({
      ...session,
      agentName: session.agentName,
      text: "hello",
      model: { providerID: "chatmock", modelID: "default" },
      messageId: "msg_nochoice",
    });

    assert.deepEqual(chatmockCalls.filter((call) => call.method !== "GET"), []);
    // The identity still names what actually answers, stand-in included.
    const submit = requests.find((entry) => entry.method === "prompt.submit");
    assert.match(submit.params.system_prompt, /Model: gpt-5\.6-sol/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("recovery cannot replay the previous answer before an identical turn is submitted", async () => {
  const requests = [];
  let pendingRun = null;
  const fakeClient = {
    async request(method, params) {
      requests.push({ method, params });
      if (method === "session.create") {
        return { session_id: "live-duplicate", stored_session_id: "stored-duplicate" };
      }
      if (method === "session.turn_result") {
        return {
          state: "completed",
          turn_id: params.turn_id,
          payload: {
            text: "the previous answer",
            status: "complete",
            recovered_from_history: true,
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
  adapter.client = fakeClient;
  const session = await adapter.createSession({
    surface: "dashboard_terminal",
    sessionKey: "duplicate-prompt-test",
    filesystemMode: "restricted",
  });
  const events = adapter.streamSession({
    externalSessionId: session.externalSessionId,
    liveSessionId: session.liveSessionId,
    workspaceKey: session.workspaceKey,
    directory: session.directory,
    resolveActiveTurn: () => pendingRun ?? {},
  })[Symbol.asyncIterator]();
  const nextEvent = events.next();

  // Breadboard persists the run before calling prompt.submit. Its text is the
  // same as the preceding turn, so text-only recovery would return that old
  // answer during this pre-dispatch window.
  pendingRun = {
    messageId: "msg_duplicate-turn",
    instruction: "what is the latest gmail i received?",
  };
  await new Promise((resolve) => setTimeout(resolve, 1_150));
  assert.equal(
    requests.filter((request) => request.method === "session.turn_result").length,
    0,
  );

  await adapter.startRun({
    ...session,
    agentName: session.agentName,
    text: pendingRun.instruction,
    messageId: pendingRun.messageId,
  });
  const recovered = await nextEvent;
  await events.return();

  assert.equal(recovered.value.type, "assistant.delta");
  assert.equal(recovered.value.payload.text, "the previous answer");
  assert.equal(
    requests.filter((request) => request.method === "session.turn_result").length,
    1,
  );
});

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
            completed_tools: [
              {
                tool_id: "call-recovered-web",
                name: "web_search",
                success: true,
                summary: "Found the supporting source",
              },
            ],
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
  for (let index = 0; index < 4; index += 1) {
    recovered.push((await events.next()).value);
  }
  await events.return();

  assert.deepEqual(
    recovered.map((event) => event.type),
    ["tool.completed", "assistant.delta", "assistant.completed", "session.status"],
  );
  assert.equal(recovered[0].payload.toolCallId, "call-recovered-web");
  assert.equal(recovered[0].payload.success, true);
  assert.equal(recovered[1].messageId, "msg_turn-1");
  assert.equal(recovered[3].payload.status, "idle");
  const recoveryRequest = requests.find(
    (request) => request.method === "session.turn_result",
  );
  assert.equal(recoveryRequest.params.turn_id, "msg_turn-1");
  assert.equal(recoveryRequest.params.expected_user_text, "delete the listed files");
});

test("a terminal tool journal does not duplicate lifecycle frames already seen live", async () => {
  const fakeClient = {
    async request(method) {
      if (method === "session.create") {
        return { session_id: "live-tools", stored_session_id: "stored-tools" };
      }
      return { status: "streaming" };
    },
    async *events(_liveSessionId, _signal, onConnected) {
      onConnected?.();
      yield {
        type: "tool.complete",
        session_id: "live-tools",
        payload: {
          tool_id: "call-web-live",
          name: "web_search",
          success: true,
          summary: "Found the source",
        },
      };
      yield {
        type: "message.complete",
        session_id: "live-tools",
        payload: {
          turn_id: "msg_live-tools",
          text: "Sourced answer.",
          status: "complete",
          completed_tools: [
            {
              tool_id: "call-web-live",
              name: "web_search",
              success: true,
              summary: "Found the source",
            },
          ],
        },
      };
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
    sessionKey: "live-tool-dedupe-test",
    filesystemMode: "restricted",
  });
  await adapter.startRun({
    ...session,
    agentName: session.agentName,
    text: "research the claim",
    messageId: "msg_live-tools",
  });

  const events = [];
  for await (const event of adapter.streamSession({
    externalSessionId: session.externalSessionId,
    liveSessionId: session.liveSessionId,
    workspaceKey: session.workspaceKey,
    directory: session.directory,
    messageId: "msg_live-tools",
    instruction: "research the claim",
  })) {
    events.push(event);
  }

  assert.deepEqual(
    events.map((event) => event.type),
    ["tool.completed", "assistant.delta", "assistant.completed", "session.status"],
  );
  assert.equal(
    events.filter((event) => event.type === "tool.completed").length,
    1,
  );
});

test("Hermes recovers a pending permission when its live approval frame is lost", async () => {
  const requests = [];
  const fakeClient = {
    async request(method, params) {
      requests.push({ method, params });
      if (method === "session.create") {
        return { session_id: "live-approval", stored_session_id: "stored-approval" };
      }
      if (method === "session.turn_result") {
        return {
          state: "waiting_for_permission",
          turn_id: params.turn_id,
          approval: {
            request_id: "plugin_rule:terminal:disk-usage",
            pattern_key: "plugin_rule:terminal:disk-usage",
            command: "du -sh .",
            description: "Run a disk-usage command",
            choices: ["once", "session", "deny"],
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
  adapter.client = fakeClient;
  const session = await adapter.createSession({
    surface: "dashboard_terminal",
    sessionKey: "permission-recovery-test",
    filesystemMode: "restricted",
  });
  await adapter.startRun({
    ...session,
    agentName: session.agentName,
    text: "how much disk space is used?",
    messageId: "msg_turn-approval",
  });

  const events = adapter.streamSession({
    externalSessionId: session.externalSessionId,
    liveSessionId: session.liveSessionId,
    workspaceKey: session.workspaceKey,
    directory: session.directory,
    messageId: "msg_turn-approval",
    instruction: "how much disk space is used?",
  })[Symbol.asyncIterator]();
  const permission = (await events.next()).value;
  await events.return();

  assert.equal(permission.type, "permission.requested");
  assert.equal(permission.payload.requestId, "plugin_rule:terminal:disk-usage");
  assert.equal(permission.payload.command, "du -sh .");
  assert.equal(permission.payload.risk, "execute");
  const recoveryRequest = requests.find(
    (request) => request.method === "session.turn_result",
  );
  assert.equal(recoveryRequest.params.turn_id, "msg_turn-approval");
});

test("a correlated running turn emits heartbeats while a long tool is silent", async () => {
  const fakeClient = {
    async request(method) {
      if (method === "session.create") {
        return { session_id: "live-heartbeat", stored_session_id: "stored-heartbeat" };
      }
      if (method === "session.turn_result") {
        return { state: "running", turn_id: "msg_heartbeat" };
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
    sessionKey: "heartbeat-test",
    filesystemMode: "restricted",
  });
  await adapter.startRun({
    ...session,
    agentName: session.agentName,
    text: "generate an image",
    messageId: "msg_heartbeat",
  });

  const events = adapter.streamSession({
    externalSessionId: session.externalSessionId,
    liveSessionId: session.liveSessionId,
    workspaceKey: session.workspaceKey,
    directory: session.directory,
    messageId: "msg_heartbeat",
    instruction: "generate an image",
  })[Symbol.asyncIterator]();
  const heartbeat = (await events.next()).value;
  await events.return();

  assert.equal(heartbeat.type, "session.status");
  assert.equal(heartbeat.payload.status, "busy");
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
    submitted: true,
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

test("switching models sends the model id alone, not a provider flag", async () => {
  // Hermes rejects `<model> --provider custom` with "Unknown provider
  // 'custom'": bare `custom` is a billing class, not a routable provider name.
  // That threw inside startRun before prompt.submit, so picking any model in
  // the composer produced a turn that never started — the client sat on
  // "Thinking" until its 90s watchdog called it a lost response.
  const requests = [];
  const fakeClient = {
    async request(method, params) {
      requests.push({ method, params });
      if (method === "session.create") {
        return { session_id: "live-switch", stored_session_id: "stored-switch" };
      }
      if (method === "config.set" && String(params.value).includes("--provider")) {
        throw new Error(
          "Unknown provider 'custom'. Check 'hermes model' for available providers.",
        );
      }
      return { status: "streaming" };
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
    sessionKey: "model-switch-test",
    filesystemMode: "restricted",
    model: "gpt-5.6-sol",
  });
  await adapter.startRun({
    ...session,
    agentName: session.agentName,
    text: "hi",
    messageId: "msg_model-switch",
    model: { modelID: "cliproxy/claude-opus-5" },
  });

  const configSet = requests.find(
    (request) => request.method === "config.set" && request.params.key === "model",
  );
  assert.equal(configSet.params.value, "cliproxy/claude-opus-5");
  // The switch must not swallow the turn: the prompt still goes out.
  assert.ok(requests.some((request) => request.method === "prompt.submit"));
});
