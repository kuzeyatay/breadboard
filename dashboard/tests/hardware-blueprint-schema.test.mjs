import assert from "node:assert/strict";
import test from "node:test";

const {
  hardwareProjectRequestSchema,
  hardwareDesignModificationSchema,
  hardwareTurnSchema,
  parseWithSchema,
  parseModelJson,
  extractJsonObject,
  parseStoredDesign,
} = await import("../src/lib/hardware/schemas.ts");

const VALID_REQUEST = {
  purpose: "Measure the weather and show it on a screen",
  controller: "ESP32",
  inputs: [{ type: "BME280", quantity: 1 }],
  outputs: [{ type: "128x64 OLED", quantity: 1 }],
  communication: ["i2c", "wifi"],
  power: { source: "usb" },
  prototypeType: "breadboard",
  firmware: { platform: "platformio", language: "cpp" },
  constraints: {
    beginnerFriendly: true,
    preferredComponents: [],
    forbiddenComponents: [],
  },
};

test("a well-formed request is accepted and keeps its parts verbatim", () => {
  const result = parseWithSchema(hardwareProjectRequestSchema, VALID_REQUEST, "request");
  assert.equal(result.ok, true);
  assert.equal(result.value.controller, "ESP32");
  assert.equal(result.value.inputs[0].type, "BME280");
  assert.equal(result.value.constraints.beginnerFriendly, true);
});

test("a request missing its purpose is rejected", () => {
  const { purpose: _purpose, ...withoutPurpose } = VALID_REQUEST;
  const result = parseWithSchema(hardwareProjectRequestSchema, withoutPurpose, "request");
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.startsWith("purpose")));
});

test("an invalid enum value is rejected rather than coerced", () => {
  const result = parseWithSchema(
    hardwareProjectRequestSchema,
    { ...VALID_REQUEST, prototypeType: "wire-wrap" },
    "request",
  );
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.startsWith("prototypeType")));

  const badPower = parseWithSchema(
    hardwareProjectRequestSchema,
    { ...VALID_REQUEST, power: { source: "nuclear" } },
    "request",
  );
  assert.equal(badPower.ok, false);
});

test("optional collections default rather than failing", () => {
  const result = parseWithSchema(
    hardwareProjectRequestSchema,
    { purpose: "Blink an LED" },
    "request",
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.inputs, []);
  assert.deepEqual(result.value.outputs, []);
  assert.equal(result.value.prototypeType, "breadboard");
  assert.equal(result.value.firmware.platform, "platformio");
  assert.equal(result.value.power.source, "unknown");
});

test("modification operations are validated as a discriminated union", () => {
  const good = parseWithSchema(
    hardwareDesignModificationSchema,
    {
      operations: [
        { type: "remove-component", targetComponentId: "cmp_2" },
        { type: "add-component", componentDefinitionId: "led-5mm", quantity: 1 },
      ],
    },
    "modification",
  );
  assert.equal(good.ok, true);
  assert.equal(good.value.operations.length, 2);

  const bad = parseWithSchema(
    hardwareDesignModificationSchema,
    { operations: [{ type: "teleport-component", targetComponentId: "cmp_2" }] },
    "modification",
  );
  assert.equal(bad.ok, false);
});

test("a turn must declare its mode", () => {
  assert.equal(
    parseWithSchema(hardwareTurnSchema, { mode: "new", request: VALID_REQUEST }, "turn").ok,
    true,
  );
  assert.equal(parseWithSchema(hardwareTurnSchema, { request: VALID_REQUEST }, "turn").ok, false);
});

test("model JSON is extracted from prose and fences but still validated", () => {
  const wrapped = "Sure!\n```json\n" + JSON.stringify({ mode: "new", request: VALID_REQUEST }) + "\n```";
  const parsed = parseModelJson(hardwareTurnSchema, wrapped, "turn");
  assert.equal(parsed.ok, true);

  assert.equal(extractJsonObject('prefix {"a": "}"} suffix'), '{"a": "}"}');
  assert.equal(extractJsonObject("no object here"), null);

  const invalid = parseModelJson(hardwareTurnSchema, '{"mode":"sideways"}', "turn");
  assert.equal(invalid.ok, false);
});

test("a stored design is rejected when its schema version does not match", () => {
  const result = parseStoredDesign({
    schemaVersion: "0.0.1",
    id: "hwd_1",
    title: "x",
    summary: "",
    status: "ready",
    request: VALID_REQUEST,
    decisions: [],
    components: [],
    nets: [],
    validationResults: [],
    bom: [],
    assemblySteps: [],
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /schema version/i);
});
