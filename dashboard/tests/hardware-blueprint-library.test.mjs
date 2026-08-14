// The component library itself, and the compiler paths the wider library needs.
//
// Every definition is checked structurally so a new part cannot be added with a
// contradictory pin, an anchor that does not exist, or an alias that collides
// with another part's name.

import assert from "node:assert/strict";
import test from "node:test";

const { COMPONENT_DEFINITIONS, componentDefinition, controllerProfile, isController } =
  await import("../src/lib/hardware/components/index.ts");
const { resolveComponentPhrase } = await import("../src/lib/hardware/resolver.ts");
const { compileCircuit, resolveRequestPeripherals } = await import(
  "../src/lib/hardware/compiler.ts"
);
const { validateCircuit } = await import("../src/lib/hardware/validation.ts");
const { buildDesign } = await import("../src/lib/hardware/design.ts");
const { referencedGeneratedConstants } = await import("../src/lib/hardware/firmware.ts");
const { isContactOnly } = await import("../src/lib/hardware/electrical.ts");

function request(overrides = {}) {
  return {
    purpose: "A test project",
    inputs: [],
    outputs: [],
    communication: [],
    power: { source: "usb" },
    prototypeType: "breadboard",
    firmware: { platform: "platformio", language: "cpp" },
    constraints: { beginnerFriendly: true, preferredComponents: [], forbiddenComponents: [] },
    ...overrides,
  };
}

const compile = (input) =>
  compileCircuit({ request: input, resolved: resolveRequestPeripherals(input) });
const instanceOf = (circuit, definitionId) =>
  circuit.components.find((instance) => instance.definitionId === definitionId);
const netByName = (circuit, name) => circuit.nets.find((net) => net.name === name);

// ---------------------------------------------------------------------------
// library integrity
// ---------------------------------------------------------------------------

test("the library is broad and every part is internally consistent", () => {
  assert.ok(COMPONENT_DEFINITIONS.length >= 120, "the extended library shrank unexpectedly");

  const categories = new Set(COMPONENT_DEFINITIONS.map((entry) => entry.category));
  for (const category of [
    "controller",
    "sensor",
    "display",
    "input",
    "actuator",
    "communication",
    "storage",
    "power-source",
    "indicator",
    "passive",
    "semiconductor",
    "interface",
    "prototyping",
    "optical",
    "mechanical",
    "module",
  ]) {
    assert.ok(categories.has(category), `nothing in the library covers ${category}`);
  }

  const ids = new Set();
  for (const definition of COMPONENT_DEFINITIONS) {
    assert.ok(!ids.has(definition.id), `${definition.id} is defined twice`);
    ids.add(definition.id);
    assert.ok(definition.name.trim(), `${definition.id} has no name`);
    assert.ok(
      definition.description.length > 40,
      `${definition.id} has no real description`,
    );
    assert.ok(definition.aliases.length >= 2, `${definition.id} has too few aliases`);

    // A pin cannot both carry a supply and be optional to connect.
    const pinIds = new Set();
    for (const pin of definition.pins) {
      assert.ok(!pinIds.has(pin.id), `${definition.id} declares pin ${pin.id} twice`);
      pinIds.add(pin.id);
      assert.ok(pin.label.trim(), `${definition.id} pin ${pin.id} has no label`);
      if (pin.electricalType === "power-input") {
        assert.ok(
          !pin.functions.includes("optional"),
          `${definition.id} makes its supply pin optional`,
        );
      }
    }

    // Every anchor names a real pin, and every wired pin has an anchor.
    for (const anchorId of Object.keys(definition.visual.pinAnchors)) {
      assert.ok(
        pinIds.has(anchorId),
        `${definition.id} anchors ${anchorId}, which is not one of its pins`,
      );
    }
    if (definition.pins.length && definition.category !== "prototyping") {
      for (const pin of definition.pins) {
        if (pin.functions.includes("optional")) continue;
        assert.ok(
          definition.visual.pinAnchors[pin.id],
          `${definition.id} pin ${pin.id} has no anchor, so a wire cannot land on it`,
        );
      }
    }

    // A supply window must be ordered.
    const { minimumSupplyVoltage: low, maximumSupplyVoltage: high } = definition.electrical;
    if (low !== undefined && high !== undefined) {
      assert.ok(low <= high, `${definition.id} has an inverted supply window`);
    }
    if (definition.visual.renderer === "wokwi-element") {
      assert.match(definition.visual.elementName ?? "", /^wokwi-/);
    }
  }
});

test("every part's own name resolves back to it", () => {
  for (const definition of COMPONENT_DEFINITIONS) {
    const outcome = resolveComponentPhrase(definition.name);
    assert.equal(
      outcome.status,
      "resolved",
      `"${definition.name}" does not resolve to a single part`,
    );
    assert.equal(
      outcome.definition.id,
      definition.id,
      `"${definition.name}" resolves to ${outcome.definition?.id}`,
    );
  }
});

test("everyday words for the new parts reach the right part", () => {
  const cases = [
    ["e-paper", "epaper-2in9"],
    ["eink screen", "epaper-2in9"],
    ["sd card", "microsd-module"],
    ["16x2 lcd", "lcd1602-i2c"],
    ["real time clock", "ds1307-rtc"],
    ["accelerometer", "mpu6050"],
    ["light sensor", "bh1750"],
    ["motion sensor", "pir-motion"],
    ["gas sensor", "mq2-gas-sensor"],
    ["load cell", "hx711-load-cell"],
    ["keypad", "membrane-keypad"],
    ["joystick", "analog-joystick"],
    ["rotary encoder", "rotary-encoder"],
    ["touch sensor", "capacitive-touch"],
    ["bluetooth", "hc-05-bluetooth"],
    ["gps", "neo-6m-gps"],
    ["rfid", "rc522-rfid"],
    ["mp3 player", "dfplayer-mini"],
    ["stepper motor", "stepper-28byj48"],
    ["water pump", "water-pump-5v"],
    ["buzzer", "passive-buzzer"],
    ["neopixel", "ws2812b-pixel"],
    ["lipo battery", "lipo-battery-1200mah"],
    ["voltage regulator", "ams1117-3v3"],
    ["arduino nano", "arduino-nano"],
    ["arduino mega", "arduino-mega"],
    ["infrared receiver", "ir-receiver"],
    ["ds18b20", "ds18b20"],
    ["SHT31", "sht31"],
    ["16 bit ADC", "ads1115"],
    ["LTE modem", "sim7600"],
    ["particulate matter sensor", "pms5003"],
    ["LoRa radio", "sx1276-lora"],
    ["waveguide combiner", "optical-combiner-waveguide"],
    ["glasses arm clip", "eyeglass-temple-clip"],
  ];
  for (const [phrase, expected] of cases) {
    const outcome = resolveComponentPhrase(phrase);
    assert.equal(outcome.status, "resolved", `"${phrase}" did not resolve`);
    assert.equal(
      outcome.definition.id,
      expected,
      `"${phrase}" resolved to ${outcome.definition?.id}`,
    );
  }
});

test("the enclosure catalog carries physical envelopes for long-tail and optical parts", () => {
  for (const id of [
    "sht31",
    "sim7600",
    "st7789-tft",
    "optical-combiner-waveguide",
    "eyeglass-temple-clip",
    "lipo-battery-1200mah",
    "slide-switch",
    "bme280",
    "ssd1306-oled-128x64",
    "mpu6050",
    "capacitive-touch",
  ]) {
    const definition = componentDefinition(id);
    assert.ok(definition?.mechanical, `${id} has no physical envelope`);
    assert.ok(definition.mechanical.length > 0);
    assert.ok(definition.mechanical.width > 0);
    assert.ok(definition.mechanical.height > 0);
  }
});

test("only active mechanical/BOM references are marked as electrical placeholders", () => {
  assert.deepEqual(
    COMPONENT_DEFINITIONS.filter((entry) => entry.rules.electricalPlaceholder)
      .map((entry) => entry.id)
      .sort(),
    ["lipo-pouch-custom", "micro-oled-display", "mipi-camera-module", "speaker-28mm"],
  );

  for (const id of [
    "optical-combiner-waveguide",
    "optical-combiner-birdbath",
    "ar-focusing-lens",
    "eyeglass-temple-clip",
    "eyeglass-bridge-mount",
    "wearable-flex-pcb",
  ]) {
    assert.equal(
      componentDefinition(id).rules.electricalPlaceholder,
      undefined,
      `${id} is a passive reference, not an unfinished active component`,
    );
  }
});

test("an AR concept with active reference parts cannot report itself build-ready", () => {
  const { design } = buildDesign({
    request: request({
      purpose: "A clip-on augmented-reality display for eyeglasses",
      outputs: [
        { type: "0.49-inch micro-OLED display module", quantity: 1 },
        { type: "Compact MIPI camera module reference", quantity: 1 },
        { type: "28 mm miniature loudspeaker", quantity: 1 },
        { type: "Custom-size single-cell LiPo pouch", quantity: 1 },
        { type: "Transparent optical waveguide combiner", quantity: 1 },
        { type: "Near-eye focusing lens assembly", quantity: 1 },
        { type: "Adjustable eyeglass temple clip", quantity: 1 },
      ],
      prototypeType: "pcb",
    }),
    designId: "hwd_ar_reference_test",
  });

  const placeholders = design.validationResults.filter(
    (entry) => entry.rule === "ELECTRICAL_PLACEHOLDER",
  );
  const missingProductRequirements = design.validationResults.filter(
    (entry) => entry.rule === "MISSING_PRODUCT_REQUIREMENT",
  );
  assert.equal(design.status, "needs-changes");
  assert.equal(placeholders.length, 4);
  assert.equal(missingProductRequirements.length, 0);
  assert.ok(placeholders.every((entry) => entry.severity === "error"));
  assert.ok(placeholders.every((entry) => /mechanical\/BOM reference/.test(entry.title)));
  assert.ok(placeholders.every((entry) => /real electrically specified part/.test(entry.message)));
});

test("AR placeholders fail firmware explicitly while passive optics never pretend to initialise", () => {
  const { design, circuit } = buildDesign({
    request: request({
      purpose: "A clip-on augmented-reality display for eyeglasses",
      outputs: [
        { type: "0.49-inch micro-OLED display module", quantity: 1 },
        { type: "Transparent optical waveguide combiner", quantity: 1 },
        { type: "Near-eye focusing lens assembly", quantity: 1 },
        { type: "Adjustable eyeglass temple clip", quantity: 1 },
      ],
      prototypeType: "pcb",
    }),
    designId: "hwd_ar_firmware_truth_test",
  });

  const main = design.firmware.files.find((file) => file.path === "src/main.cpp").content;
  const readme = design.firmware.files.find((file) => file.path === "README.md").content;
  const microdisplay = design.components.find(
    (component) => component.definitionId === "micro-oled-display",
  );
  assert.ok(microdisplay);
  assert.match(main, new RegExp(`UNRESOLVED ${microdisplay.reference}`));
  assert.match(main, new RegExp(`FAIL ${microdisplay.reference}`));
  assert.match(main, /ok = false;/);
  assert.doesNotMatch(main, /All parts initialised/);
  assert.doesNotMatch(design.firmware.expectedSerialOutput, /All parts initialised/);
  assert.match(design.firmware.expectedSerialOutput, /FAIL/);
  for (const passiveName of [
    "Transparent optical waveguide combiner",
    "Near-eye focusing lens assembly",
    "Adjustable eyeglass temple clip",
  ]) {
    assert.doesNotMatch(main, new RegExp(passiveName));
  }
  assert.match(readme, /UNRESOLVED: no verified firmware driver\/electrical definition/);
  assert.ok(circuit.currentEstimate.unknownComponentIds.includes(microdisplay.id));
  assert.match(design.summary, /at least .*known typical load/);
  assert.match(
    design.decisions.find((decision) => decision.category === "Power").rationale,
    /lower bounds/,
  );
});

test("a built-in bus module without an exact driver is blocked instead of generically initialised", () => {
  const { design } = buildDesign({
    request: request({
      purpose: "Measure temperature and humidity",
      controller: "ESP32",
      inputs: [{ type: "SHT31", quantity: 1 }],
      communication: ["i2c"],
    }),
    designId: "hwd_sht31_driver_truth_test",
  });

  const finding = design.validationResults.find(
    (entry) => entry.rule === "RESEARCHED_FIRMWARE_DRIVER_MISSING",
  );
  assert.ok(finding);
  assert.equal(finding.severity, "error");
  assert.match(finding.title, /has no verified firmware driver/);
  assert.equal(design.status, "needs-changes");

  const main = design.firmware.files.find((file) => file.path === "src/main.cpp").content;
  assert.match(main, /FAIL .*SHT31.*no verified firmware driver/);
  assert.match(main, /ok = false;/);
  assert.doesNotMatch(main, /SHT31.*pins configured/);
  assert.doesNotMatch(main, /All parts initialised/);
  assert.doesNotMatch(design.firmware.expectedSerialOutput, /All parts initialised/);
});

test("an electrically valid board is not mistaken for complete AR glasses", () => {
  const { design } = buildDesign({
    request: request({
      purpose: "Design AR glasses that clip onto my eyeglasses",
      outputs: [{ type: "capacitive touch sensor", quantity: 1 }],
      communication: ["bluetooth"],
      prototypeType: "pcb",
    }),
    designId: "hwd_incomplete_ar_test",
  });

  const missing = design.validationResults.filter(
    (entry) => entry.rule === "MISSING_PRODUCT_REQUIREMENT",
  );
  assert.equal(design.status, "needs-changes");
  assert.deepEqual(
    missing.map((entry) => entry.title).sort(),
    [
      "The design is missing its focusing or collimating optic",
      "The design is missing its near-eye microdisplay",
      "The design is missing its optical combiner",
      "The design is missing its retained eyeglass interface",
    ],
  );
});

test("the original AR brief survives an over-generic model interpretation", () => {
  const { design } = buildDesign({
    request: request({
      purpose: "Show phone notifications with a touch control",
      outputs: [{ type: "capacitive touch sensor", quantity: 1 }],
      communication: ["bluetooth"],
      prototypeType: "pcb",
    }),
    sourceBrief: "Design AR glasses that clip onto my eyeglasses",
    designId: "hwd_original_ar_brief_test",
  });

  assert.equal(design.status, "needs-changes");
  assert.equal(
    design.validationResults.filter(
      (entry) => entry.rule === "MISSING_PRODUCT_REQUIREMENT",
    ).length,
    4,
  );
});

test("passive optical and mounting references do not fail for having no pins", () => {
  const circuit = compile(
    request({
      purpose: "Reserve the passive optical path and eyeglass mounting envelope",
      outputs: [
        { type: "Transparent optical waveguide combiner", quantity: 1 },
        { type: "Near-eye focusing lens assembly", quantity: 1 },
        { type: "Adjustable eyeglass temple clip", quantity: 1 },
        { type: "Adjustable eyeglass bridge mount", quantity: 1 },
        { type: "Custom wearable flex PCB reference", quantity: 1 },
      ],
      prototypeType: "pcb",
    }),
  );
  const findings = validateCircuit(circuit);
  assert.deepEqual(findings.filter((entry) => entry.severity === "error"), []);
  assert.deepEqual(
    findings.filter((entry) => entry.rule === "ELECTRICAL_PLACEHOLDER"),
    [],
  );
});

test("every controller has a profile whose pins it actually has", () => {
  for (const definition of COMPONENT_DEFINITIONS.filter(
    (entry) => entry.category === "controller",
  )) {
    assert.ok(isController(definition.id), `${definition.id} has no profile`);
    const profile = controllerProfile(definition.id);
    const pinIds = new Set(definition.pins.map((pin) => pin.id));
    const named = [
      ...profile.digitalPinOrder,
      ...profile.pwmPinOrder,
      ...profile.analogPinOrder,
      ...profile.groundPinIds,
      ...profile.rails.map((rail) => rail.pinId),
      ...(profile.i2c ? [profile.i2c.sdaPinId, profile.i2c.sclPinId] : []),
      ...(profile.spi ? [profile.spi.sckPinId, profile.spi.mosiPinId, profile.spi.misoPinId] : []),
      ...(profile.uart ? [profile.uart.txPinId, profile.uart.rxPinId] : []),
      ...(profile.additionalUarts ?? []).flatMap((uart) => [uart.txPinId, uart.rxPinId]),
      ...Object.keys(profile.cautionPins),
    ];
    for (const pinId of named) {
      assert.ok(pinIds.has(pinId), `${definition.id}'s profile names missing pin ${pinId}`);
    }
    // An input-only pin can never be offered for digital allocation, which
    // would let the compiler try to drive a pin that cannot be driven.
    for (const pinId of profile.digitalPinOrder) {
      const pin = definition.pins.find((candidate) => candidate.id === pinId);
      assert.ok(
        !pin.functions.includes("input-only"),
        `${definition.id} offers input-only ${pinId} for digital allocation`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// compiler paths the wider library needs
// ---------------------------------------------------------------------------

test("a switch is never read as a load on the pin it sits on", () => {
  assert.equal(isContactOnly(componentDefinition("push-button")), true);
  assert.equal(isContactOnly(componentDefinition("membrane-keypad")), true);
  assert.equal(isContactOnly(componentDefinition("led-5mm")), false);
  assert.equal(isContactOnly(componentDefinition("bme280")), false);

  const circuit = compile(
    request({
      controller: "Arduino Uno",
      inputs: [{ type: "push button", quantity: 2 }],
      outputs: [{ type: "SSD1306 OLED", quantity: 1 }],
      communication: ["i2c"],
    }),
  );
  const results = validateCircuit(circuit);
  assert.deepEqual(
    results.filter((entry) => entry.rule === "GPIO_OVERCURRENT"),
    [],
    "a plain button was reported as overloading its pin",
  );
  assert.deepEqual(
    results.filter((entry) => entry.rule === "UNKNOWN_ELECTRICAL_VALUE"),
    [],
    "a switch was reported as having an unknown draw",
  );
  assert.deepEqual(results.filter((entry) => entry.severity === "error"), []);
});

test("a matrix keypad takes one pin per line and returns nothing to ground", () => {
  const circuit = compile(
    request({ controller: "Arduino Mega", inputs: [{ type: "keypad", quantity: 1 }] }),
  );
  const keypad = instanceOf(circuit, "membrane-keypad");
  const wired = circuit.nets.filter((net) =>
    net.connections.some((connection) => connection.componentId === keypad.id),
  );
  assert.equal(wired.length, 7, "the keypad did not get one net per line");
  for (const net of wired) {
    assert.equal(net.role, "digital");
    assert.ok(net.connections.some((c) => c.componentId === circuit.controllerInstance.id));
  }
  assert.equal(keypad.properties.usesInternalPullup, true);
  assert.deepEqual(validateCircuit(circuit).filter((entry) => entry.severity === "error"), []);
});

test("an SPI display gets its control pins as well as the bus", () => {
  const circuit = compile(
    request({
      controller: "ESP32",
      outputs: [{ type: "e-paper", quantity: 1 }],
      communication: ["spi"],
    }),
  );
  const panel = instanceOf(circuit, "epaper-2in9");
  const connectedPins = new Set(
    circuit.nets.flatMap((net) =>
      net.connections
        .filter((connection) => connection.componentId === panel.id)
        .map((connection) => connection.pinId),
    ),
  );
  for (const pinId of ["VCC", "GND", "DIN", "CLK", "CS", "DC", "RST", "BUSY"]) {
    assert.ok(connectedPins.has(pinId), `${pinId} was left unconnected`);
  }
  // The bus lines are shared; the control lines are its own.
  assert.equal(netByName(circuit, "SPI_MOSI").connections.length, 2);
  assert.ok(circuit.assignments.some((a) => a.constantName === "PIN_U2_BUSY"));
  assert.deepEqual(validateCircuit(circuit).filter((entry) => entry.severity === "error"), []);
});

test("two SPI devices share the bus without an output conflict", () => {
  const circuit = compile(
    request({
      controller: "ESP32",
      inputs: [{ type: "rfid", quantity: 1 }],
      outputs: [{ type: "sd card", quantity: 1 }],
      communication: ["spi"],
    }),
  );
  const miso = netByName(circuit, "SPI_MISO");
  assert.equal(miso.connections.length, 3, "both devices should sit on MISO");
  const chipSelects = circuit.assignments.filter(
    (assignment) => assignment.purpose === "spi-cs",
  );
  assert.equal(chipSelects.length, 2);
  assert.notEqual(chipSelects[0].controllerPinId, chipSelects[1].controllerPinId);
  assert.deepEqual(
    validateCircuit(circuit).filter((entry) => entry.rule === "OUTPUT_OUTPUT_CONFLICT"),
    [],
  );
});

test("an RGB LED gets one drive pin and one resistor per colour", () => {
  const circuit = compile(
    request({ controller: "ESP32", outputs: [{ type: "rgb led", quantity: 1 }] }),
  );
  const led = instanceOf(circuit, "rgb-led");
  const resistors = circuit.components.filter(
    (instance) => instance.definitionId === "resistor",
  );
  assert.equal(resistors.length, 3, "each colour needs its own series resistor");
  const drivePins = circuit.assignments.filter(
    (assignment) => assignment.componentId === led.id,
  );
  assert.equal(drivePins.length, 3);
  assert.equal(new Set(drivePins.map((a) => a.controllerPinId)).size, 3);
  assert.ok(
    netByName(circuit, "GND").connections.some(
      (c) => c.componentId === led.id && c.pinId === "COM",
    ),
  );
  assert.deepEqual(validateCircuit(circuit).filter((entry) => entry.severity === "error"), []);
});

test("serial devices take successive hardware ports and run out honestly", () => {
  const mega = compile(
    request({
      controller: "Arduino Mega",
      inputs: [
        { type: "gps", quantity: 1 },
        { type: "bluetooth", quantity: 1 },
      ],
    }),
  );
  const uartAssignments = mega.assignments.filter((assignment) =>
    assignment.purpose.startsWith("uart-"),
  );
  assert.equal(uartAssignments.length, 4, "two devices need two ports, two lines each");
  assert.equal(new Set(uartAssignments.map((a) => a.controllerPinId)).size, 4);

  // The Uno has one port, so a second serial device is refused with a reason.
  const uno = compile(
    request({
      controller: "Arduino Uno",
      inputs: [
        { type: "gps", quantity: 1 },
        { type: "bluetooth", quantity: 1 },
      ],
    }),
  );
  const refusal = validateCircuit(uno).find(
    (entry) => entry.rule === "INVALID_CONTROLLER_PIN",
  );
  assert.ok(refusal, "a second serial device on a one-port board was accepted");
  assert.match(refusal.remediation, /SoftwareSerial/);
});

test("a battery-powered build gets a cell and a switch that suit the board", () => {
  // The Pico runs straight from a single lithium cell on VSYS.
  const pico = compile(
    request({
      controller: "Raspberry Pi Pico",
      outputs: [{ type: "SSD1306 OLED", quantity: 1 }],
      communication: ["i2c"],
      power: { source: "battery" },
    }),
  );
  const cell = instanceOf(pico, "lipo-battery-1200mah");
  assert.ok(cell, "no battery was fitted");
  assert.equal(cell.automaticallyAdded, true);
  const switchInstance = instanceOf(pico, "slide-switch");
  assert.ok(switchInstance, "no power switch was fitted");
  // Cell -> switch -> the board's own input pin.
  const cellNet = netByName(pico, "VBAT_CELL");
  const switchedNet = netByName(pico, "VBAT");
  assert.ok(cellNet.connections.some((c) => c.componentId === cell.id && c.pinId === "POS"));
  assert.ok(cellNet.connections.some((c) => c.componentId === switchInstance.id));
  assert.ok(switchedNet.connections.some((c) => c.componentId === pico.controllerInstance.id));
  assert.deepEqual(validateCircuit(pico).filter((entry) => entry.severity === "error"), []);

  // 6 V of AA cells suits an ESP32's VIN but not an Uno's, and the Uno says so
  // instead of shipping a design that browns out.
  const esp32 = compile(
    request({ controller: "ESP32", power: { source: "battery" }, outputs: [{ type: "LED", quantity: 1 }] }),
  );
  assert.ok(instanceOf(esp32, "battery-holder-4aa"));

  const uno = compile(
    request({ controller: "Arduino Uno", power: { source: "battery" }, outputs: [{ type: "LED", quantity: 1 }] }),
  );
  assert.equal(instanceOf(uno, "battery-holder-4aa"), undefined);
  assert.equal(instanceOf(uno, "lipo-battery-1200mah"), undefined);
  const note = validateCircuit(uno).find(
    (entry) => entry.title === "No battery in the library matches this board's input",
  );
  assert.ok(note, "the Uno silently accepted a battery it cannot run from");
  assert.equal(note.severity, "warning");
});

// ---------------------------------------------------------------------------
// firmware
// ---------------------------------------------------------------------------

test("every part reaches the firmware, with or without a hand-written driver", () => {
  const { design } = buildDesign({
    request: request({
      purpose: "A handheld reader",
      controller: "ESP32",
      inputs: [
        { type: "push button", quantity: 2 },
        { type: "tilt switch", quantity: 1 },
      ],
      outputs: [
        { type: "e-paper", quantity: 1 },
        { type: "sd card", quantity: 1 },
      ],
      communication: ["spi"],
      power: { source: "battery" },
    }),
    designId: "hwd_reader",
  });
  assert.equal(design.status, "ready", JSON.stringify(design.validationResults, null, 1));

  const main = design.firmware.files.find((file) => file.path === "src/main.cpp");
  const header = design.firmware.files.find((file) => file.path.endsWith("generated_pins.h"));
  // The e-paper and the card have templates; the tilt module does not, and is
  // still configured and read rather than silently absent.
  assert.match(main.content, /epdU\d+\.init/);
  assert.match(main.content, /SD\.begin/);
  assert.match(main.content, /pins configured/);

  // Every part the controller talks to appears; the power switch, which sits in
  // the battery line and no pin reads, correctly does not.
  const controllerId = design.components[0].id;
  const talkedTo = design.components.filter(
    (instance) =>
      instance.id !== controllerId &&
      design.nets.some(
        (net) =>
          net.role !== "power" &&
          net.role !== "ground" &&
          net.connections.some((c) => c.componentId === instance.id) &&
          net.connections.some((c) => c.componentId === controllerId),
      ),
  );
  assert.ok(talkedTo.length >= 4, "too few parts reach a controller pin");
  for (const instance of talkedTo) {
    assert.ok(
      main.content.includes(instance.reference),
      `${instance.reference} (${instance.name}) is missing from the firmware`,
    );
  }
  const powerSwitch = design.components.find(
    (instance) => instance.definitionId === "slide-switch",
  );
  assert.ok(powerSwitch, "no power switch was fitted");
  assert.ok(!talkedTo.includes(powerSwitch));

  const defined = new Set(
    [...header.content.matchAll(/#define ([A-Z0-9_]+)/g)].map((match) => match[1]),
  );
  for (const file of design.firmware.files) {
    if (file.path.endsWith("generated_pins.h")) continue;
    for (const name of referencedGeneratedConstants(file.content)) {
      assert.ok(defined.has(name), `${file.path} references undefined ${name}`);
    }
  }
});

test("AVR boards name their pins the way their core does", async () => {
  const { firmwarePinLiteral } = await import("../src/lib/hardware/firmware.ts");
  assert.equal(firmwarePinLiteral("arduino-nano", "D9"), "9");
  assert.equal(firmwarePinLiteral("arduino-mega", "D53"), "53");
  assert.equal(firmwarePinLiteral("arduino-mega", "A15"), "A15");

  const { design } = buildDesign({
    request: request({
      controller: "Arduino Mega",
      inputs: [{ type: "keypad", quantity: 1 }],
    }),
    designId: "hwd_mega",
  });
  const header = design.firmware.files.find((file) => file.path.endsWith("generated_pins.h"));
  assert.doesNotMatch(header.content, /#define PIN_\w+ D\d/);
  const main = design.firmware.files.find((file) => file.path === "src/main.cpp");
  // The AVR Wire library takes its pins from the core, not from arguments.
  assert.doesNotMatch(main.content, /Wire\.begin\(PIN_/);
});
