import assert from "node:assert/strict";
import test from "node:test";

const { groundHardwareRequest } = await import(
  "../src/lib/hardware/request-grounding.ts"
);
const { buildDesign } = await import("../src/lib/hardware/design.ts");

function request(overrides = {}) {
  return {
    title: "Universal Clip-On AR Glasses",
    purpose: "Show simple information in front of one eye",
    controller: "Seeed XIAO ESP32C3",
    inputs: [
      { type: "mipi-camera-module", quantity: 1 },
      { type: "push-button", quantity: 1 },
    ],
    outputs: [
      { type: "micro-oled-display", quantity: 1 },
      { type: "ar-focusing-lens", quantity: 1 },
      { type: "optical-combiner-waveguide", quantity: 1 },
      { type: "eyeglass-temple-clip", quantity: 1 },
    ],
    communication: ["bluetooth"],
    power: { source: "battery", part: "lipo-pouch-custom" },
    prototypeType: "pcb",
    firmware: { platform: "platformio", language: "cpp" },
    constraints: {
      beginnerFriendly: true,
      preferredComponents: [
        "wearable-flex-pcb",
        "Adjustable hardware for universal eyeglass-frame fit",
      ],
      forbiddenComponents: ["breadboard"],
    },
    ...overrides,
  };
}

test("grounds the exact AR prompt and separates physical requirements from the circuit", () => {
  const brief =
    "please design an ar glass that fits onto my glasses, assume the glasses that it must fit are universal";
  const grounded = groundHardwareRequest(request(), brief);

  assert.equal(grounded.inputs.some((part) => /camera/i.test(part.type)), false);
  assert.deepEqual(grounded.power, { source: "battery", part: undefined });
  assert.deepEqual(grounded.constraints.preferredComponents, []);
  assert.deepEqual(grounded.outputs.map((part) => part.type), ["micro-oled-display"]);
  assert.deepEqual(
    grounded.physicalParts.map((part) => part.type).sort(),
    ["ar-focusing-lens", "eyeglass-temple-clip", "optical-combiner-waveguide"],
  );

  const compiled = buildDesign({ request: grounded, sourceBrief: brief });
  const titles = compiled.design.validationResults.map((finding) => finding.title);
  assert.equal(titles.some((title) => title.includes("camera")), false);
  assert.equal(titles.some((title) => title.includes("wearable flex")), false);
  assert.equal(titles.some((title) => title.includes("universal eyeglass")), false);
  assert.equal(
    titles.some((title) => title.includes("focusing or collimating optic")),
    false,
  );
  assert.equal(titles.some((title) => title.includes("optical combiner")), false);
  assert.equal(titles.some((title) => title.includes("eyeglass interface")), false);

  // The one remaining blocker is honest: the catalog display is only a physical
  // envelope until a real, electrically documented module is selected. The
  // agent must not invent a camera circuit, current draw, or successful driver.
  assert.equal(compiled.design.status, "needs-changes");
  assert.ok(
    compiled.design.validationResults.some(
      (finding) => finding.rule === "ELECTRICAL_PLACEHOLDER" && finding.severity === "error",
    ),
  );
  assert.ok(compiled.design.powerEstimate.unknownComponentIds.length > 0);
  const main = compiled.design.firmware.files.find((file) => file.path === "src/main.cpp").content;
  assert.match(main, /UNRESOLVED/);
  assert.doesNotMatch(main, /All parts initialised/);
  assert.doesNotMatch(compiled.design.firmware.expectedSerialOutput ?? "", /All parts initialised/);
});

test("drops invented custom packaging even when the model puts it in physicalParts", () => {
  const grounded = groundHardwareRequest(
    request({
      physicalParts: [
        { type: "wearable-flex-pcb", quantity: 1 },
        { type: "Adjustable hardware for universal eyeglass-frame fit", quantity: 1 },
      ],
    }),
    "Design AR glasses that fit onto my glasses.",
  );

  assert.equal(
    grounded.physicalParts.some((part) => part.type === "wearable-flex-pcb"),
    false,
  );
  assert.equal(
    grounded.physicalParts.some((part) => part.type.startsWith("Adjustable hardware")),
    false,
  );
});

test("keeps a camera and exact component choices when the person actually names them", () => {
  const brief =
    "Use a mipi-camera-module and lipo-pouch-custom with wearable-flex-pcb to record video.";
  const grounded = groundHardwareRequest(request(), brief);

  assert.equal(grounded.inputs.some((part) => part.type === "mipi-camera-module"), true);
  assert.equal(grounded.power.part, "lipo-pouch-custom");
  assert.deepEqual(grounded.constraints.preferredComponents, []);
  assert.equal(
    grounded.physicalParts.some((part) => part.type === "wearable-flex-pcb"),
    true,
  );
});

test("moves legacy optical and mechanical inputs or outputs into physicalParts", () => {
  const grounded = groundHardwareRequest(
    request({
      inputs: [{ type: "eyeglass-bridge-mount", quantity: 1 }],
      outputs: [{ type: "ar-focusing-lens", quantity: 2 }],
      physicalParts: [{ type: "ar-focusing-lens", quantity: 1 }],
      constraints: { beginnerFriendly: true, preferredComponents: [], forbiddenComponents: [] },
      power: { source: "usb" },
    }),
    "Build smart glasses with an eyeglass bridge mount.",
  );

  assert.deepEqual(grounded.inputs, []);
  assert.deepEqual(grounded.outputs, [{ type: "micro-oled-display", quantity: 1 }]);
  assert.equal(
    grounded.physicalParts.find((part) => part.type === "ar-focusing-lens").quantity,
    2,
  );
});
