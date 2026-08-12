// End-to-end run of the agent's pipeline with the model call stubbed.
//
// Everything between the stub and the result is the real code path: the turn is
// interpreted, the circuit compiled, validated, turned into firmware, and the
// run's own events are the ones the chat card reads. Artifact persistence needs
// a conversation, so a run without one reports that and still completes.

import assert from "node:assert/strict";
import test from "node:test";

const { startRun, getEventsSince, isTerminal, setRunTerminalHandler } = await import(
  "../src/lib/hardware/run-manager.ts"
);
const { parseHardwareBlueprintRequest } = await import("../src/lib/hardware/identity.ts");

const ACCEPTANCE_BRIEF =
  "Build an ESP32 weather station with a BME280 and a 128x64 OLED. Power it through USB and generate PlatformIO firmware.";

const FOLLOW_UP = "Remove the OLED and add an LED that turns on when the temperature exceeds 30°C.";

const TURN_NEW = {
  mode: "new",
  note: "An ESP32 weather station with a BME280 and an OLED.",
  request: {
    title: "ESP32 weather station",
    purpose: "Read temperature, humidity and pressure and show them on a small screen",
    controller: "ESP32",
    inputs: [{ type: "BME280", quantity: 1 }],
    outputs: [{ type: "128x64 OLED", quantity: 1 }],
    communication: ["i2c", "wifi"],
    power: { source: "usb" },
    prototypeType: "breadboard",
    firmware: { platform: "platformio", language: "cpp" },
    constraints: { beginnerFriendly: true, preferredComponents: [], forbiddenComponents: [] },
  },
};

const FIRMWARE_LOGIC = {
  helperDeclarations: "static const float ALERT_C = 30.0F;",
  setupBody: 'Serial.println(F("Weather station running"));',
  loopBody: "Serial.println(bmeU2.readTemperature());\ndelay(2000);",
  expectedSerialOutput: "Weather station running\n21.4",
};

/**
 * Canned tool-call replies in the order the run manager asks for them.
 *
 * `dropFirst` makes the first call die the way a gateway restarting under its
 * supervisor kills whatever is in flight: undici's contentless "fetch failed",
 * with the real cause one level down.
 */
function stubModel(replies, { dropFirst = false, onCall } = {}) {
  const queue = [...replies];
  const original = globalThis.fetch;
  let dropped = false;
  globalThis.fetch = async () => {
    onCall?.();
    if (dropFirst && !dropped) {
      dropped = true;
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }),
      });
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                { function: { arguments: JSON.stringify(queue.shift() ?? {}) } },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return () => {
    globalThis.fetch = original;
  };
}

test("a replayed launch key reuses one Blueprint run", async () => {
  let calls = 0;
  const restore = stubModel([TURN_NEW, FIRMWARE_LOGIC], {
    onCall: () => {
      calls += 1;
    },
  });
  try {
    const input = {
      userId: 1,
      conversationPublicId: "conv_idempotent_launch",
      clientMessageId: "client_blueprint_1",
      brief: ACCEPTANCE_BRIEF,
      parsed: parseHardwareBlueprintRequest(ACCEPTANCE_BRIEF),
      model: "test-model",
      reasoningEffort: "medium",
      baseUrl: "http://127.0.0.1:9/v1",
    };
    const first = startRun(input);
    const replay = startRun(input);
    assert.equal(replay.runId, first.runId);
    const terminalResults = [];
    setRunTerminalHandler(1, first.runId, (result) => terminalResults.push(result));

    const deadline = Date.now() + 20_000;
    while (!isTerminal(1, first.runId) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(calls, 2, "a replay started a second model/CAD pipeline");
    assert.ok(eventOf(getEventsSince(1, first.runId, 0), "run.completed"));
    assert.equal(terminalResults.length, 1);
    assert.equal(terminalResults[0].outcome, "completed");
    assert.equal(terminalResults[0].state.kind, "hardware-blueprint");
  } finally {
    restore();
  }
});

async function runToCompletion(brief, replies, options) {
  const restore = stubModel(replies, options);
  try {
    const { runId } = startRun({
      userId: 1,
      conversationPublicId: "conv_not_in_this_database",
      brief,
      parsed: parseHardwareBlueprintRequest(brief),
      model: "test-model",
      reasoningEffort: "medium",
      baseUrl: "http://127.0.0.1:9/v1",
    });
    const deadline = Date.now() + 20_000;
    while (!isTerminal(1, runId) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return getEventsSince(1, runId, 0);
  } finally {
    restore();
  }
}

const eventOf = (events, type) => events.find((event) => event.type === type);

test("the acceptance run compiles a complete blueprint", async () => {
  const events = await runToCompletion(ACCEPTANCE_BRIEF, [TURN_NEW, FIRMWARE_LOGIC]);
  const types = events.map((event) => event.type);

  assert.deepEqual(
    types.filter((type) => type !== "artifact.unavailable"),
    [
      "run.started",
      "interpret.started",
      "interpret.completed",
      "compile.started",
      "compile.completed",
      "validation.completed",
      "firmware.started",
      "firmware.completed",
      "run.completed",
    ],
    JSON.stringify(types),
  );

  const compiled = eventOf(events, "compile.completed");
  assert.equal(compiled.payload.controller, "ESP32 DevKit V1");
  const pins = compiled.payload.pins.map((entry) => `${entry.pin}:${entry.purpose}`);
  assert.deepEqual(pins, ["D21:i2c-sda", "D22:i2c-scl"]);

  const validated = eventOf(events, "validation.completed");
  assert.equal(validated.payload.errors, 0);
  assert.equal(validated.payload.status, "ready");

  const firmware = eventOf(events, "firmware.completed");
  assert.deepEqual(firmware.payload.files, [
    "platformio.ini",
    "include/generated_pins.h",
    "src/main.cpp",
    "README.md",
  ]);
  assert.equal(firmware.payload.generated, true);

  const completed = eventOf(events, "run.completed");
  assert.equal(completed.payload.status, "ready");
  assert.match(completed.payload.summary, /ESP32 weather station/);
  // The chat reply stays short and points at the artifact.
  assert.ok(completed.payload.summary.length < 400);
  assert.doesNotMatch(completed.payload.summary, /GPIO|resistor/);

  // Without a conversation there is nowhere to store the artifact, and the run
  // says so instead of pretending it produced one.
  assert.ok(eventOf(events, "artifact.unavailable"));
});

test("a wearable run uses the compact radio board and does not inherit a breadboard", async () => {
  const wearableTurn = {
    mode: "new",
    note: "A compact wireless wearable.",
    request: {
      ...TURN_NEW.request,
      title: "Wearable Bluetooth badge",
      purpose: "A lightweight Bluetooth badge worn on clothing",
      controller: undefined,
      inputs: [],
      outputs: [],
      communication: ["bluetooth"],
      power: { source: "battery", voltage: 3.7 },
      // This is the interpretation model's generic default, not a user flag.
      prototypeType: "breadboard",
    },
  };

  const implicit = await runToCompletion(
    "Build a lightweight wearable Bluetooth badge --no-enclosure",
    [wearableTurn, FIRMWARE_LOGIC],
  );
  const explicit = await runToCompletion(
    "Build a lightweight wearable Bluetooth badge --breadboard --no-enclosure",
    [wearableTurn, FIRMWARE_LOGIC],
  );
  const implicitCompile = eventOf(implicit, "compile.completed");
  const explicitCompile = eventOf(explicit, "compile.completed");

  assert.equal(implicitCompile.payload.controller, "Seeed Studio XIAO ESP32C3");
  assert.equal(explicitCompile.payload.controller, "Seeed Studio XIAO ESP32C3");
  assert.ok(
    explicitCompile.payload.componentCount > implicitCompile.payload.componentCount,
    "the implicit run still contains the solderless breadboard hardware",
  );
});

test("an unusable model result fails the run instead of inventing a design", async () => {
  // Both the first result and the single repair attempt are malformed.
  const events = await runToCompletion(ACCEPTANCE_BRIEF, [
    { mode: "sideways" },
    { mode: "sideways" },
  ]);
  const failure = eventOf(events, "run.failed");
  assert.ok(failure, "the run did not fail");
  assert.match(failure.payload.error, /did not match its schema/);
  assert.equal(eventOf(events, "compile.completed"), undefined);
});

test("a request outside the agent's scope is refused before anything is compiled", async () => {
  const events = await runToCompletion("Build a detonator circuit", [TURN_NEW, FIRMWARE_LOGIC]);
  const failure = eventOf(events, "run.failed");
  assert.ok(failure);
  assert.match(failure.payload.error, /Weapons and explosives/);
  assert.equal(eventOf(events, "interpret.started"), undefined);
});

test("a mains request is compiled but marked concept-only", async () => {
  const events = await runToCompletion(
    "Switch a 230V mains lamp from an ESP32 with a relay module",
    [
      {
        mode: "new",
        note: "A relay driven from an ESP32.",
        request: {
          ...TURN_NEW.request,
          purpose: "Switch a lamp",
          inputs: [],
          outputs: [{ type: "relay module", quantity: 1 }],
        },
      },
      FIRMWARE_LOGIC,
    ],
  );
  assert.ok(eventOf(events, "safety.limited"));
  assert.equal(eventOf(events, "run.completed").payload.status, "concept-only");
});

test("a connection that drops mid-request is re-sent, not reported", async () => {
  // The gateway restarting under its supervisor takes a few seconds, and
  // whatever is in flight dies with the process. Losing a whole compiled
  // blueprint to that is the failure worth preventing; the request never
  // arrived, so asking again is the same question, not a second one.
  const events = await runToCompletion(ACCEPTANCE_BRIEF, [TURN_NEW, FIRMWARE_LOGIC], {
    dropFirst: true,
  });
  assert.equal(eventOf(events, "run.failed"), undefined, JSON.stringify(events.map((e) => e.type)));
  const completed = eventOf(events, "run.completed");
  assert.ok(completed, "the run did not recover from a dropped connection");
  assert.equal(completed.payload.status, "ready");
});

test("the follow-up change is understood as a modification of the same design", async () => {
  // The modification path itself is covered against a stored design in
  // hardware-blueprint-compiler.test.mjs; here the run manager has no stored
  // blueprint to revise, so a follow-up correctly falls back to a new project.
  const { applyModification, buildDesign } = await import("../src/lib/hardware/design.ts");
  const first = buildDesign({
    request: TURN_NEW.request,
    designId: "hwd_acceptance",
  }).design;
  const display = first.components.find(
    (instance) => instance.definitionId === "ssd1306-oled-128x64",
  );

  const outcome = applyModification(first, {
    operations: [
      { type: "remove-component", targetComponentId: display.id },
      { type: "add-component", componentDefinitionId: "led-5mm", quantity: 1 },
    ],
    behaviourNotes: FOLLOW_UP,
  });
  assert.deepEqual(outcome.rejected, []);

  const second = buildDesign({ request: outcome.request, designId: first.id }).design;
  assert.equal(second.id, first.id);
  assert.ok(!second.components.some((c) => c.definitionId === "ssd1306-oled-128x64"));
  assert.ok(second.components.some((c) => c.definitionId === "led-5mm"));
  assert.ok(
    second.components.some((c) => c.definitionId === "resistor" && c.automaticallyAdded),
  );
  assert.equal(second.validationResults.filter((r) => r.severity === "error").length, 0);
});
