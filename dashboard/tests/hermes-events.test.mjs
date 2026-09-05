import test from "node:test";
import assert from "node:assert/strict";
import {
  createHermesEventNormalizationState,
  normalizeHermesEvent,
} from "../src/lib/agent-runtime/hermes-events.ts";

const normalize = (raw, state = createHermesEventNormalizationState()) =>
  normalizeHermesEvent(raw, "live-1", "runtime-1", state);

test("filters Hermes events to the live session", () => {
  assert.deepEqual(
    normalize({
      type: "message.delta",
      session_id: "other",
      payload: { text: "not ours" },
    }),
    [],
  );
});

test("maps streamed answer text without exposing the Hermes session id", () => {
  const [event] = normalize({
    type: "message.delta",
    session_id: "live-1",
    payload: { text: "Hello" },
  });
  assert.equal(event.type, "assistant.delta");
  assert.equal(event.sessionId, "runtime-1");
  assert.equal(event.payload.text, "Hello");
});

test("answer previews are never classified as thinking", () => {
  const events = normalize({
    type: "reasoning.available",
    session_id: "live-1",
    payload: { text: "Here is the final answer." },
  });
  assert.deepEqual(events, []);
});

test("genuine reasoning deltas retain their whitespace between chunks", () => {
  const chunks = ["Compare", " ", "the sources.\n\n", "Then answer."];
  const events = chunks.flatMap((text) => normalize({
    type: "thinking.delta", session_id: "live-1", payload: { text },
  }));
  const [event] = events;
  assert.equal(event.type, "reasoning.status");
  assert.equal(event.payload.detailMode, "append");
  assert.equal(events.map((entry) => entry.payload.detail).join(""), chunks.join(""));
});

test("maps tool lifecycle events and failed structured results", () => {
  const [started] = normalize({
    type: "tool.start",
    session_id: "live-1",
    payload: {
      tool_id: "call-1",
      name: "breadboard_terminal",
      context: "Get-ChildItem",
    },
  });
  assert.equal(started.type, "tool.started");
  assert.equal(started.payload.toolCallId, "call-1");

  const [completed] = normalize({
    type: "tool.complete",
    session_id: "live-1",
    payload: {
      tool_id: "call-1",
      name: "breadboard_terminal",
      result: { success: false, error: "denied" },
    },
  });
  assert.equal(completed.type, "tool.completed");
  assert.equal(completed.payload.success, false);
});

test("projects a live product_search result onto the native UI event contract", () => {
  const resource = {
    schemaVersion: 1,
    kind: "product-search",
    renderer: "product-carousel",
    id: "product-search:live-event",
    title: "Product results",
    createdAt: "2026-08-31T10:00:00.000Z",
    actions: ["open-details", "find-similar", "compare", "visit"],
    data: {
      query: "bluetooth trackpad",
      sources: [{
        id: "source:live-event",
        title: "Trackpad product page",
        url: "https://shop.example/trackpad",
        site: "shop.example",
        accessedAt: "2026-08-31T10:00:00.000Z",
      }],
      products: [{
        id: "product:live-event",
        title: "Bluetooth Trackpad",
        merchant: "Example",
        url: "https://shop.example/trackpad",
        sourceIds: ["source:live-event"],
      }],
    },
  };

  const [completed] = normalize({
    type: "tool.complete",
    session_id: "live-1",
    payload: {
      tool_id: "product-call",
      name: "product_search",
      result: { success: true, uiResources: [resource] },
    },
  });
  assert.equal(completed.type, "tool.completed");
  assert.equal(completed.payload.success, true);
  assert.equal(completed.payload.uiResources?.length, 1);
  assert.equal(completed.payload.uiResources?.[0].renderer, "product-carousel");

  const [wrongTool] = normalize({
    type: "tool.complete",
    session_id: "live-1",
    payload: {
      tool_id: "web-call",
      name: "web_search",
      result: { success: true, uiResources: [resource] },
    },
  });
  assert.equal(wrongTool.payload.uiResources, undefined);
});

test("a plugin tool_error JSON string is a failure, not a success", () => {
  // hermes-agent/plugins/breadboard returns tool_error() -> a JSON *string*.
  // Reading that as success told the model a denied command had worked.
  for (const field of ["result", "output", "content"]) {
    const [completed] = normalize({
      type: "tool.complete",
      session_id: "live-1",
      payload: {
        tool_id: "call-1",
        name: "breadboard_terminal",
        [field]: JSON.stringify({
          error:
            "Only read-only inspection, read-only Git, and focused existing verification commands are allowed automatically.",
        }),
      },
    });
    assert.equal(completed.type, "tool.completed", field);
    assert.equal(completed.payload.success, false, field);
  }

  const [ok] = normalize({
    type: "tool.complete",
    session_id: "live-1",
    payload: {
      tool_id: "call-2",
      name: "breadboard_terminal",
      result: JSON.stringify({ success: true, exitCode: 0 }),
    },
  });
  assert.equal(ok.payload.success, true);

  // Non-JSON output stays a success: only an explicit error demotes it.
  const [plain] = normalize({
    type: "tool.complete",
    session_id: "live-1",
    payload: { tool_id: "call-3", name: "breadboard_terminal", result: "total 4\nfile.txt" },
  });
  assert.equal(plain.payload.success, true);
});

test("nonzero and timed-out terminal results are failures", () => {
  for (const result of [
    { exitCode: 1, timedOut: false, stderr: "ParserError" },
    { exitCode: null, timedOut: true, stderr: "" },
  ]) {
    const [completed] = normalize({
      type: "tool.complete",
      session_id: "live-1",
      payload: {
        tool_id: "call-terminal",
        name: "terminal_execute_command",
        result: JSON.stringify(result),
      },
    });
    assert.equal(completed.payload.success, false);
  }

  const [completed] = normalize({
    type: "tool.complete",
    session_id: "live-1",
    payload: {
      tool_id: "call-terminal-ok",
      name: "terminal_execute_command",
      result: JSON.stringify({ exitCode: 0, timedOut: false }),
    },
  });
  assert.equal(completed.payload.success, true);
});

test("maps destructive approval requests without a session-wide grant", () => {
  const [event] = normalize({
    type: "approval.request",
    session_id: "live-1",
    payload: {
      command: "Remove-Item report.txt",
      description: "Delete report.txt",
      choices: ["once", "session", "deny"],
    },
  });
  assert.equal(event.type, "permission.requested");
  assert.equal(event.payload.risk, "delete");
  assert.equal(event.payload.allowSession, false);
  assert.equal(event.payload.requestId, "runtime-1:approval");
});

test("maps a clarify question to a pickable card and drops one nobody could answer", () => {
  const [event] = normalize({
    type: "clarify.request",
    session_id: "live-1",
    payload: {
      question: "Which deployment target?",
      choices: ["staging", " prod ", "", 42, "a", "b", "c"],
      request_id: "rq-1",
    },
  });
  assert.equal(event.type, "clarify.requested");
  assert.equal(event.sessionId, "runtime-1");
  assert.equal(event.payload.requestId, "rq-1");
  assert.equal(event.payload.question, "Which deployment target?");
  assert.deepEqual(event.payload.choices, ["staging", "prod", "a", "b"]);

  const [freeText] = normalize({
    type: "clarify.request",
    session_id: "live-1",
    payload: { question: "What should the title be?", request_id: "rq-2" },
  });
  assert.deepEqual(freeText.payload.choices, []);

  assert.deepEqual(
    normalize({
      type: "clarify.request",
      session_id: "live-1",
      payload: { question: "Orphaned?" },
    }),
    [],
  );

  const [expired] = normalize({
    type: "clarify.expire",
    session_id: "live-1",
    payload: { request_id: "rq-1" },
  });
  assert.equal(expired.type, "clarify.expired");
  assert.equal(expired.payload.requestId, "rq-1");
});

test("emits an unstreamed completion suffix before the terminal status", () => {
  const state = createHermesEventNormalizationState();
  normalizeHermesEvent(
    {
      type: "message.delta",
      session_id: "live-1",
      payload: { text: "Hello" },
    },
    "live-1",
    "runtime-1",
    state,
  );
  const events = normalizeHermesEvent(
    {
      type: "message.complete",
      session_id: "live-1",
      payload: {
        text: "Hello world",
        status: "complete",
        turn_id: "msg_turn-1",
        usage: { input: 3, output: 2 },
      },
    },
    "live-1",
    "runtime-1",
    state,
  );
  assert.deepEqual(
    events.map((event) => event.type),
    ["assistant.delta", "assistant.completed", "session.status"],
  );
  assert.equal(events[0].payload.text, " world");
  assert.equal(events[0].messageId, "msg_turn-1");
  assert.equal(events[1].messageId, "msg_turn-1");
  assert.equal(events[2].payload.status, "idle");
});

test("text streamed before a tool call is sealed as narration, and the final segment survives completion", () => {
  const state = createHermesEventNormalizationState();
  const normalizeWith = (raw) =>
    normalizeHermesEvent(raw, "live-1", "runtime-1", state);

  normalizeWith({
    type: "message.delta",
    session_id: "live-1",
    payload: { text: "Checking your calendar now." },
  });
  const toolEvents = normalizeWith({
    type: "tool.start",
    session_id: "live-1",
    payload: { tool_id: "call-1", name: "calendar_list" },
  });
  assert.deepEqual(
    toolEvents.map((event) => event.type),
    ["assistant.segment", "tool.started"],
  );
  assert.equal(toolEvents[0].payload.text, "Checking your calendar now.");
  assert.equal(toolEvents[0].payload.streamed, true);

  normalizeWith({
    type: "message.delta",
    session_id: "live-1",
    payload: { text: "Nothing is booked in Q1." },
  });
  const completion = normalizeWith({
    type: "message.complete",
    session_id: "live-1",
    payload: { text: "Nothing is booked in Q1.", status: "complete" },
  });
  // The sealed narration must not resurface: the streamed final segment
  // already matches the completion text, so no residual delta is emitted.
  assert.deepEqual(
    completion.map((event) => event.type),
    ["assistant.completed", "session.status"],
  );
});

test("message.interim with already_streamed seals the buffer once; the following tool.start does not double-seal", () => {
  const state = createHermesEventNormalizationState();
  const normalizeWith = (raw) =>
    normalizeHermesEvent(raw, "live-1", "runtime-1", state);

  normalizeWith({
    type: "message.delta",
    session_id: "live-1",
    payload: { text: "Pulling the board first." },
  });
  const interim = normalizeWith({
    type: "message.interim",
    session_id: "live-1",
    payload: { text: "Pulling the board first.", already_streamed: true },
  });
  assert.deepEqual(interim.map((event) => event.type), ["assistant.segment"]);
  assert.equal(interim[0].payload.text, "Pulling the board first.");
  assert.equal(interim[0].payload.streamed, true);

  const toolEvents = normalizeWith({
    type: "tool.start",
    session_id: "live-1",
    payload: { tool_id: "call-1", name: "plan_list" },
  });
  assert.deepEqual(toolEvents.map((event) => event.type), ["tool.started"]);
});

test("an unstreamed interim message surfaces as narration without touching the streamed buffer", () => {
  const state = createHermesEventNormalizationState();
  const normalizeWith = (raw) =>
    normalizeHermesEvent(raw, "live-1", "runtime-1", state);

  normalizeWith({
    type: "message.delta",
    session_id: "live-1",
    payload: { text: "Partial" },
  });
  const interim = normalizeWith({
    type: "message.interim",
    session_id: "live-1",
    payload: { text: "Working through the list.", already_streamed: false },
  });
  assert.deepEqual(interim.map((event) => event.type), ["assistant.segment"]);
  assert.equal(interim[0].payload.streamed, false);
  assert.equal(interim[0].payload.text, "Working through the list.");

  // The streamed buffer keeps accumulating across the unstreamed interim.
  const completion = normalizeWith({
    type: "message.complete",
    session_id: "live-1",
    payload: { text: "Partial done.", status: "complete" },
  });
  assert.equal(completion[0].type, "assistant.delta");
  assert.equal(completion[0].payload.text, " done.");
});

test("an answer sealed by a trailing tool call is restored from the completion text", () => {
  const state = createHermesEventNormalizationState();
  const normalizeWith = (raw) =>
    normalizeHermesEvent(raw, "live-1", "runtime-1", state);

  normalizeWith({
    type: "message.delta",
    session_id: "live-1",
    payload: { text: "Saved. The answer is 42." },
  });
  normalizeWith({
    type: "tool.start",
    session_id: "live-1",
    payload: { tool_id: "call-1", name: "save_memory" },
  });
  const completion = normalizeWith({
    type: "message.complete",
    session_id: "live-1",
    payload: { text: "Saved. The answer is 42.", status: "complete" },
  });
  assert.deepEqual(
    completion.map((event) => event.type),
    ["assistant.delta", "assistant.completed", "session.status"],
  );
  assert.equal(completion[0].payload.text, "Saved. The answer is 42.");
});

test("maps interrupted and failed completions to terminal statuses", () => {
  const interrupted = normalize({
    type: "message.complete",
    session_id: "live-1",
    payload: { text: "", status: "interrupted" },
  });
  assert.equal(interrupted.at(-1).payload.status, "aborted");

  const failed = normalize({
    type: "message.complete",
    session_id: "live-1",
    payload: { text: "", status: "error" },
  });
  assert.equal(failed.at(-1).payload.status, "failed");
});

test("web search lifecycle captures query and extracted websites across start and complete", () => {
  const state = createHermesEventNormalizationState();
  const normalizeWith = (raw) =>
    normalizeHermesEvent(raw, "live-1", "runtime-1", state);

  const startEvents = normalizeWith({
    type: "tool.start",
    session_id: "live-1",
    payload: {
      tool_id: "call-search-1",
      name: "web_search",
      args_text: JSON.stringify({ query: "TU/e Eindhoven student teams" }),
    },
  });
  assert.equal(startEvents.length, 1);
  assert.equal(startEvents[0].type, "tool.started");
  assert.equal(startEvents[0].payload.location, "TU/e Eindhoven student teams");

  const completeEvents = normalizeWith({
    type: "tool.complete",
    session_id: "live-1",
    payload: {
      tool_id: "call-search-1",
      name: "web_search",
      summary: "Found 2 results",
      result: "1. [Student Teams | TU/e](https://www.tue.nl/student-teams)\n2. [Solar Team](https://solarteam.nl)",
    },
  });
  assert.equal(completeEvents.length, 1);
  assert.equal(completeEvents[0].type, "tool.completed");
  assert.equal(completeEvents[0].payload.location, "TU/e Eindhoven student teams");
  assert.equal(completeEvents[0].payload.websites?.length, 2);
  assert.equal(completeEvents[0].payload.websites[0].url, "https://www.tue.nl/student-teams");
  assert.equal(completeEvents[0].payload.websites[0].title, "Student Teams | TU/e");
  assert.equal(completeEvents[0].payload.websites[0].domain, "tue.nl");
  assert.equal(completeEvents[0].payload.websites[1].url, "https://solarteam.nl");
});

test("web extract lifecycle captures URL in location and websites", () => {
  const state = createHermesEventNormalizationState();
  const normalizeWith = (raw) =>
    normalizeHermesEvent(raw, "live-1", "runtime-1", state);

  const startEvents = normalizeWith({
    type: "tool.start",
    session_id: "live-1",
    payload: {
      tool_id: "call-extract-1",
      name: "web_extract",
      args_text: JSON.stringify({ url: "https://www.tue.nl/en/education/student-teams" }),
    },
  });
  assert.equal(startEvents.length, 1);
  assert.equal(startEvents[0].payload.location, "https://www.tue.nl/en/education/student-teams");

  const completeEvents = normalizeWith({
    type: "tool.complete",
    session_id: "live-1",
    payload: {
      tool_id: "call-extract-1",
      name: "web_extract",
      summary: "Extracted 2500 characters",
      result: "Page content from TU/e student teams...",
    },
  });
  assert.equal(completeEvents.length, 1);
  assert.equal(completeEvents[0].payload.location, "https://www.tue.nl/en/education/student-teams");
  assert.equal(completeEvents[0].payload.websites?.length, 1);
  assert.equal(completeEvents[0].payload.websites[0].url, "https://www.tue.nl/en/education/student-teams");
  assert.equal(completeEvents[0].payload.websites[0].domain, "tue.nl");
});

test("the live gateway's own tool.complete shape carries its result pages through", () => {
  // Exactly what tui_gateway/server.py puts on the wire: args, a duration
  // summary, and the parsed tool result. Nothing in the panel can name a
  // source unless this event carries one.
  const state = createHermesEventNormalizationState();
  const events = normalizeHermesEvent(
    {
      type: "tool.complete",
      session_id: "live-1",
      payload: {
        tool_id: "call-search-9",
        name: "web_search",
        args: { query: "TU/e student teams", limit: 5 },
        duration_s: 6.4,
        summary: "Did 5 searches in 6.4s",
        result: {
          success: true,
          data: {
            web: [
              {
                title: "Student Teams | TU/e",
                url: "https://www.tue.nl/en/education/student-teams",
                description: "Overview of official student teams.",
                position: 1,
              },
              {
                title: "Solar Team Eindhoven",
                url: "https://solarteam.nl",
                description: "Solar Team Eindhoven builds solar cars.",
                position: 2,
              },
            ],
          },
        },
      },
    },
    "live-1",
    "runtime-1",
    state,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.websites?.length, 2);
  assert.equal(events[0].payload.websites[0].domain, "tue.nl");
  assert.equal(events[0].payload.details.websites.length, 2);
});

test("a shell tool's incidental URL is never reported as a consulted website", () => {
  const state = createHermesEventNormalizationState();
  const events = normalizeHermesEvent(
    {
      type: "tool.complete",
      session_id: "live-1",
      payload: {
        tool_id: "call-bash-1",
        name: "terminal",
        summary: "Ran a command",
        result: "Cloning into https://github.com/example/repo.git",
      },
    },
    "live-1",
    "runtime-1",
    state,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.websites, undefined);
});

test("web_search_tool and web_extract_tool names correctly extract websites and query", () => {
  const state = createHermesEventNormalizationState();
  const normalizeWith = (raw) =>
    normalizeHermesEvent(raw, "live-1", "runtime-1", state);

  const startEvents = normalizeWith({
    type: "tool.start",
    session_id: "live-1",
    payload: {
      tool_id: "call-search-tool-1",
      name: "web_search_tool",
      args: { query: "TU/e Eindhoven student teams", limit: 5 },
    },
  });
  assert.equal(startEvents.length, 1);
  assert.equal(startEvents[0].type, "tool.started");
  assert.equal(startEvents[0].payload.location, "TU/e Eindhoven student teams");

  const completeEvents = normalizeWith({
    type: "tool.complete",
    session_id: "live-1",
    payload: {
      tool_id: "call-search-tool-1",
      name: "web_search_tool",
      summary: "Did 5 searches in 6.5s",
      result: {
        success: true,
        data: {
          web: [
            {
              title: "Student Teams | TU/e",
              url: "https://www.tue.nl/en/education/student-teams",
              description: "Overview of official student teams.",
            },
          ],
        },
      },
    },
  });
  assert.equal(completeEvents.length, 1);
  assert.equal(completeEvents[0].type, "tool.completed");
  assert.equal(completeEvents[0].payload.location, "TU/e Eindhoven student teams");
  assert.equal(completeEvents[0].payload.websites?.length, 1);
  assert.equal(completeEvents[0].payload.websites[0].url, "https://www.tue.nl/en/education/student-teams");
  assert.equal(completeEvents[0].payload.websites[0].title, "Student Teams | TU/e");
  assert.equal(completeEvents[0].payload.websites[0].domain, "tue.nl");
});

test("context-compression progress never becomes the Thinking label", () => {
  for (const payload of [
    { kind: "compressing", text: "⠋ compressing 6 messages (~6,000 tok)…" },
    { kind: "compacting", text: "🗜️ Compacting context — summarizing earlier conversation so I can continue..." },
    { kind: "lifecycle", text: "🗜️ Compacting context — summarizing earlier conversation so I can continue..." },
  ]) {
    assert.deepEqual(
      normalize({ type: "status.update", session_id: "live-1", payload }),
      [],
      payload.text,
    );
  }
  const [kept] = normalize({
    type: "status.update",
    session_id: "live-1",
    payload: { kind: "process", text: "Reconnecting to the provider" },
  });
  assert.equal(kept.type, "reasoning.status");
  assert.equal(kept.payload.label, "Reconnecting to the provider");
});
