import assert from "node:assert/strict";
import test from "node:test";

const {
  controllerFootprint,
  resolveComponentPhrase,
  resolveController,
  selectController,
} = await import(
  "../src/lib/hardware/resolver.ts"
);
const { compileCircuit, resolveRequestPeripherals } = await import(
  "../src/lib/hardware/compiler.ts"
);
const { componentDefinition, controllerProfile } = await import(
  "../src/lib/hardware/components/index.ts"
);
const { detectSizeConstraint, preferPcbForPortableRequest } = await import(
  "../src/lib/hardware/form-factor.ts"
);
const { validateCircuit, designStatus } = await import("../src/lib/hardware/validation.ts");
const { buildDesign, applyModification } = await import("../src/lib/hardware/design.ts");
const { firmwarePinLiteral, referencedGeneratedConstants } = await import(
  "../src/lib/hardware/firmware.ts"
);
const { toCircuitJson } = await import("../src/lib/hardware/circuit-json.ts");
const { bomToCsv } = await import("../src/lib/hardware/bom.ts");
const { createZip, crc32 } = await import("../src/lib/hardware/zip.ts");
const { assessSafety } = await import("../src/lib/hardware/safety.ts");

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

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

const FIXTURES = {
  blinkUno: request({
    purpose: "Blink an LED using an Arduino Uno",
    controller: "Arduino Uno",
    outputs: [{ type: "LED", quantity: 1 }],
  }),
  weatherStation: request({
    purpose: "Build an ESP32 weather station with a BME280 and a 128x64 OLED",
    controller: "ESP32",
    inputs: [{ type: "BME280", quantity: 1 }],
    outputs: [{ type: "128x64 OLED", quantity: 1 }],
    communication: ["i2c", "wifi"],
  }),
  distanceUno: request({
    purpose: "Use an HC-SR04 distance sensor with an Arduino Uno",
    controller: "Arduino Uno",
    inputs: [{ type: "HC-SR04 distance sensor", quantity: 1 }],
  }),
  servoEsp32: request({
    purpose: "Control an SG90 servo using an ESP32",
    controller: "ESP32",
    outputs: [{ type: "SG90 servo", quantity: 1 }],
  }),
  motorEsp32: request({
    purpose: "Switch a small DC motor on and off from an ESP32",
    controller: "ESP32",
    outputs: [{ type: "DC motor", quantity: 1 }],
  }),
};

function compile(input) {
  return compileCircuit({ request: input, resolved: resolveRequestPeripherals(input) });
}

function netByName(circuit, name) {
  return circuit.nets.find((net) => net.name === name);
}

function connectedPins(circuit, netName, componentId) {
  const net = netByName(circuit, netName);
  return net
    ? net.connections
        .filter((connection) => connection.componentId === componentId)
        .map((connection) => connection.pinId)
    : [];
}

function instanceOf(circuit, definitionId) {
  return circuit.components.find((instance) => instance.definitionId === definitionId);
}

function rulesFired(results) {
  return new Set(results.map((entry) => entry.rule));
}

// ---------------------------------------------------------------------------
// component resolution
// ---------------------------------------------------------------------------

test("everyday phrases resolve to exactly one library part", () => {
  const cases = [
    ["temperature sensor", "bme280"],
    ["environment sensor", "bme280"],
    ["OLED screen", "ssd1306-oled-128x64"],
    ["ESP32 board", "esp32-devkit-v1"],
    ["Arduino", "arduino-uno"],
    ["distance sensor", "hc-sr04"],
    ["servo", "sg90-servo"],
    ["a 128x64 OLED display", "ssd1306-oled-128x64"],
    ["two LEDs", "led-5mm"],
    ["level shifter", "logic-level-converter"],
    ["logic level converter", "logic-level-converter"],
    ["a dc motor", "dc-motor-5v"],
    ["motor", "dc-motor-5v"],
    ["mosfet", "mosfet-logic-level"],
    ["a flyback diode", "diode-1n4007"],
  ];
  for (const [phrase, expected] of cases) {
    const outcome = resolveComponentPhrase(phrase);
    assert.equal(outcome.status, "resolved", `"${phrase}" did not resolve`);
    assert.equal(outcome.definition.id, expected, `"${phrase}" resolved to ${outcome.definition?.id}`);
  }
});

test("an unknown part is reported, never guessed", () => {
  assert.equal(resolveComponentPhrase("neutrino detector").status, "unsupported");
  assert.equal(resolveComponentPhrase("flux inverter").status, "unsupported");
  assert.equal(resolveComponentPhrase("").status, "unsupported");
});

test("an explicitly requested controller is preserved", () => {
  const outcome = resolveController("Raspberry Pi Pico");
  assert.equal(outcome.status, "resolved");
  assert.equal(outcome.definition.id, "raspberry-pi-pico");

  // A 3.3 V-only sensor would normally pull the automatic choice to an ESP32.
  const circuit = compile(
    request({
      controller: "Arduino Uno",
      inputs: [{ type: "BME280", quantity: 1 }],
    }),
  );
  assert.equal(circuit.controllerDefinition.id, "arduino-uno");

  // Naming a non-controller as the board falls back but says so.
  const fallback = compile(request({ controller: "toaster" }));
  assert.equal(
    fallback.notes.some((note) => note.rule === "UNSUPPORTED_COMPONENT"),
    true,
  );
});

test("automatic controller selection prefers a networked 3.3 V board when needed", () => {
  const wifi = selectController({
    peripherals: [],
    communication: ["wifi"],
    beginnerFriendly: true,
  });
  assert.equal(wifi.definition.id, "esp32-devkit-v1");

  const threeVolt = selectController({
    peripherals: [componentDefinition("bme280")],
    communication: [],
    beginnerFriendly: true,
  });
  assert.equal(threeVolt.definition.id, "esp32-devkit-v1");

  const plain = selectController({ peripherals: [], communication: [], beginnerFriendly: true });
  assert.equal(plain.definition.id, "arduino-uno");
});

test("the XIAO ESP32C3 record carries its documented buses, radio and compact footprint", () => {
  const definition = componentDefinition("seeed-xiao-esp32c3");
  const profile = controllerProfile("seeed-xiao-esp32c3");
  const footprint = controllerFootprint("seeed-xiao-esp32c3");

  assert.equal(definition.name, "Seeed Studio XIAO ESP32C3");
  assert.deepEqual(
    definition.interfaces.filter((entry) => entry === "wifi" || entry === "bluetooth"),
    ["wifi", "bluetooth"],
  );
  assert.deepEqual(profile.i2c, { sdaPinId: "D4", sclPinId: "D5" });
  assert.deepEqual(profile.spi, { sckPinId: "D8", mosiPinId: "D10", misoPinId: "D9" });
  assert.deepEqual(profile.uart, { txPinId: "D6", rxPinId: "D7" });
  assert.equal(profile.firmware.platformioBoard, "seeed_xiao_esp32c3");
  assert.equal(definition.pins.find((pin) => pin.id === "D0").label, "D0 / GPIO2");
  assert.equal(definition.pins.find((pin) => pin.id === "D10").label, "D10 / GPIO10");
  assert.equal(footprint.length, 21);
  assert.equal(footprint.width, 17.8);
  assert.equal(footprint.height, 4);
  assert.match(footprint.heightAssumption, /not a measured figure/i);
});

test("a size constraint is read from the words, and wiring language is not one", () => {
  for (const [text, evidence] of [
    ["A display module that attaches to my glasses", "glasses"],
    ["A wearable step counter", "wearable"],
    ["A logger for a backpack", "backpack"],
    ["A handheld reader", "handheld"],
    // Nothing here is worn by name; the fastening is the whole signal.
    ["A sensor pod that clips onto a bike", "clips onto"],
    ["A pod that attaches to the dashboard", "attaches to"],
  ]) {
    const found = detectSizeConstraint(text);
    assert.equal(found.constrained, true, text);
    assert.equal(found.evidence, evidence, text);
  }

  for (const text of [
    "Attach the DHT22 to pin 4 and log it",
    "A weather station on a windowsill",
    "Attach the sensor to the breadboard rails",
  ]) {
    assert.equal(detectSizeConstraint(text).constrained, false, text);
  }
});

test("something worn or carried gets the smallest board, not the friendliest one", () => {
  // The electrical rules alone pick an Uno here, and an Uno is 68.6 × 53.4 mm.
  const worn = selectController({
    peripherals: [],
    communication: [],
    beginnerFriendly: true,
    sizeConstrained: true,
    sizeEvidence: "glasses",
  });
  assert.equal(worn.definition.id, "seeed-xiao-esp32c3");
  assert.match(worn.rationale, /glasses/);
  // The rationale quotes the measurements rather than asserting "smaller".
  assert.match(worn.rationale, /21 × 17\.8 × 4 mm/);
  assert.match(worn.rationale, /not a measured figure/);
  assert.match(worn.rationale, /68\.6 × 53\.4 × 15 mm/);

  // The compact board keeps the requested radio instead of falling back to a
  // full-size ESP32 development board.
  const wornWithWifi = selectController({
    peripherals: [],
    communication: ["wifi"],
    beginnerFriendly: true,
    sizeConstrained: true,
    sizeEvidence: "wearable",
  });
  assert.equal(wornWithWifi.definition.id, "seeed-xiao-esp32c3");
  assert.match(wornWithWifi.rationale, /requested radio built in/);

  // Nothing changes for a build with no stated physical constraint.
  assert.equal(
    selectController({ peripherals: [], communication: [], beginnerFriendly: true }).definition.id,
    "arduino-uno",
  );
});

test("a portable brief changes only the implicit breadboard default to PCB", () => {
  const interpreted = request({
    purpose: "A Bluetooth display that clips onto eyeglasses",
    communication: ["bluetooth"],
    prototypeType: "breadboard",
  });

  const portable = preferPcbForPortableRequest(interpreted, {
    userBrief: "Make a Bluetooth display that clips onto my glasses",
    explicitPrototypeType: null,
  });
  assert.equal(portable.prototypeType, "pcb");

  const explicitFlag = preferPcbForPortableRequest(interpreted, {
    userBrief: "Make a wearable display",
    explicitPrototypeType: "breadboard",
  });
  assert.equal(explicitFlag.prototypeType, "breadboard");

  const explicitWords = preferPcbForPortableRequest(interpreted, {
    userBrief: "Build this wearable display on a solderless breadboard",
    explicitPrototypeType: null,
  });
  assert.equal(explicitWords.prototypeType, "breadboard");

  const ordinary = preferPcbForPortableRequest(request(), {
    userBrief: "A desk clock",
    explicitPrototypeType: null,
  });
  assert.equal(ordinary.prototypeType, "breadboard");
});

test("the physical constraint is read from the request and reaches the compiled board", () => {
  const glasses = compile(
    request({
      title: "Clip-On AR Glasses Prototype",
      purpose:
        "Build a battery-powered display module that attaches to generic rectangular-framed glasses and shows simple information while sensing head orientation.",
      inputs: [{ type: "accelerometer", quantity: 1 }],
      outputs: [{ type: "SSD1306 OLED", quantity: 1 }],
      communication: ["i2c"],
      power: { source: "battery", voltage: 3.7 },
    }),
  );
  assert.equal(glasses.controllerDefinition.id, "seeed-xiao-esp32c3");
  // A 3.3 V board removes the level converter the 5 V board needed, and the
  // 3.7 V cell the request asked for now fits the board's own input.
  assert.equal(instanceOf(glasses, "logic-level-converter"), undefined);
  assert.ok(instanceOf(glasses, "lipo-battery-1200mah"), "the requested cell was still dropped");

  // A board named outright is kept, and its size is reported rather than fixed.
  const namedUno = compile(
    request({
      purpose: "A wearable step counter on an Arduino Uno",
      controller: "Arduino Uno",
      inputs: [{ type: "accelerometer", quantity: 1 }],
      communication: ["i2c"],
    }),
  );
  assert.equal(namedUno.controllerDefinition.id, "arduino-uno");
  const note = validateCircuit(namedUno).find((entry) => entry.rule === "FORM_FACTOR_MISMATCH");
  assert.ok(note, "an Uno was chosen for a wearable with nothing said about its size");
  assert.match(note.message, /68\.6 × 53\.4 × 15 mm/);
  // A note, not a warning: the circuit is sound, only its shape is in question.
  assert.equal(note.severity, "info");
  assert.equal(designStatus(validateCircuit(namedUno)), "ready");
});

test("a part the request asked for and did not get is reported, never dropped in silence", () => {
  const circuit = compile(
    request({
      purpose: "A portable logger",
      controller: "Arduino Uno",
      outputs: [{ type: "SSD1306 OLED", quantity: 1 }],
      communication: ["i2c"],
      power: { source: "battery", voltage: 3.7 },
      constraints: {
        beginnerFriendly: true,
        preferredComponents: ["lipo-battery-1200mah", "tp4056-charger", "a warp core"],
        forbiddenComponents: [],
      },
    }),
  );
  const missing = validateCircuit(circuit).filter(
    (entry) => entry.rule === "PREFERRED_COMPONENT_MISSING",
  );
  assert.equal(missing.length, 3);

  // The cell was considered and rejected, so the reason is the real one.
  const cell = missing.find((entry) => entry.title.includes("1200"));
  assert.ok(cell, missing.map((entry) => entry.title).join(" | "));
  assert.match(cell.message, /VIN input range/);

  // The charger was never needed by any wiring, which is a different reason.
  const charger = missing.find((entry) => entry.title.includes("TP4056"));
  assert.ok(charger);
  assert.match(charger.message, /only fits parts the wiring requires/);

  // A phrase the library does not know is reported as that, not as an omission.
  const unknown = missing.find((entry) => entry.title.includes("warp core"));
  assert.ok(unknown);
  assert.match(unknown.message, /Nothing in the library matches/);
});

test("a battery build never hangs a part on a rail that only exists over USB", () => {
  // The Pico's VBUS is the USB connector's own 5 V. A cell on VSYS leaves it
  // dead, so an MPU-6050 — happy anywhere from 3.3 V to 5 V — belongs on 3V3.
  const onBattery = compile(
    request({
      purpose: "A portable orientation logger",
      controller: "Raspberry Pi Pico",
      inputs: [{ type: "accelerometer", quantity: 1 }],
      communication: ["i2c"],
      power: { source: "battery", voltage: 3.7 },
    }),
  );
  const sensor = instanceOf(onBattery, "mpu6050");
  const vbus = netByName(onBattery, "+5V");
  assert.equal(vbus, undefined, "a USB-only rail was brought up in a battery design");
  assert.ok(
    netByName(onBattery, "+3.3V").connections.some(
      (connection) => connection.componentId === sensor.id,
    ),
    "the sensor was not moved onto the regulated rail",
  );

  // On USB the same board may use VBUS, and the part goes back to 5 V.
  const onUsb = compile(
    request({
      purpose: "A desk orientation logger",
      controller: "Raspberry Pi Pico",
      inputs: [{ type: "accelerometer", quantity: 1 }],
      communication: ["i2c"],
    }),
  );
  assert.ok(netByName(onUsb, "+5V"), "the USB rail disappeared from a USB-powered design");
});

test("a part the request ruled out is reported when the circuit needs it anyway", () => {
  const circuit = compile(
    request({
      purpose: "A 5 V board reading a 3.3 V sensor",
      controller: "Arduino Uno",
      inputs: [{ type: "accelerometer", quantity: 1 }],
      communication: ["i2c"],
      constraints: {
        beginnerFriendly: true,
        preferredComponents: [],
        forbiddenComponents: ["logic level converter"],
      },
    }),
  );
  assert.ok(instanceOf(circuit, "logic-level-converter"), "the fixture stopped needing one");
  const conflict = validateCircuit(circuit).find(
    (entry) => entry.rule === "FORBIDDEN_COMPONENT_PRESENT",
  );
  assert.ok(conflict, "a forbidden part was fitted without a word");
  assert.match(conflict.message, /5 V/);
  assert.ok(conflict.componentIds.length > 0);
});

// ---------------------------------------------------------------------------
// compiler
// ---------------------------------------------------------------------------

test("ESP32 + BME280 shares 3.3 V, ground, SDA and SCL", () => {
  const circuit = compile(
    request({
      controller: "ESP32",
      inputs: [{ type: "BME280", quantity: 1 }],
      communication: ["i2c"],
    }),
  );
  const sensor = instanceOf(circuit, "bme280");
  assert.ok(sensor);

  assert.deepEqual(connectedPins(circuit, "+3.3V", sensor.id), ["VIN"]);
  assert.deepEqual(connectedPins(circuit, "GND", sensor.id), ["GND"]);
  assert.deepEqual(connectedPins(circuit, "I2C_SDA", sensor.id), ["SDA"]);
  assert.deepEqual(connectedPins(circuit, "I2C_SCL", sensor.id), ["SCL"]);

  assert.deepEqual(
    connectedPins(circuit, "+3.3V", circuit.controllerInstance.id),
    ["3V3"],
  );
  assert.deepEqual(
    connectedPins(circuit, "I2C_SDA", circuit.controllerInstance.id),
    ["GPIO21"],
  );
  assert.deepEqual(
    connectedPins(circuit, "I2C_SCL", circuit.controllerInstance.id),
    ["GPIO22"],
  );
});

test("a second I²C device joins the same bus and takes a free address", () => {
  const circuit = compile(FIXTURES.weatherStation);
  const sda = netByName(circuit, "I2C_SDA");
  const scl = netByName(circuit, "I2C_SCL");
  const sensor = instanceOf(circuit, "bme280");
  const display = instanceOf(circuit, "ssd1306-oled-128x64");

  assert.equal(sda.connections.length, 3); // controller + two devices
  assert.equal(scl.connections.length, 3);
  assert.equal(sensor.properties.i2cAddress, "0x76");
  assert.equal(display.properties.i2cAddress, "0x3C");

  // One bus means exactly one SDA and one SCL pin on the board.
  const busAssignments = circuit.assignments.filter((assignment) =>
    assignment.purpose.startsWith("i2c-"),
  );
  assert.equal(new Set(busAssignments.map((entry) => entry.controllerPinId)).size, 2);
});

test("an LED automatically receives a series resistor between pin and anode", () => {
  const circuit = compile(FIXTURES.blinkUno);
  const led = instanceOf(circuit, "led-5mm");
  const resistor = instanceOf(circuit, "resistor");
  assert.ok(led);
  assert.ok(resistor, "no resistor was added for the LED");
  assert.equal(resistor.automaticallyAdded, true);
  assert.match(resistor.additionReason, /current limiting/i);
  assert.equal(resistor.value, "330 Ω");

  // controller pin -> resistor -> LED anode -> LED cathode -> ground
  const drive = circuit.nets.find((net) => net.id.endsWith("_drive"));
  const anode = circuit.nets.find((net) => net.id.endsWith("_anode"));
  assert.ok(drive.connections.some((c) => c.componentId === circuit.controllerInstance.id));
  assert.ok(drive.connections.some((c) => c.componentId === resistor.id && c.pinId === "1"));
  assert.ok(anode.connections.some((c) => c.componentId === resistor.id && c.pinId === "2"));
  assert.ok(anode.connections.some((c) => c.componentId === led.id && c.pinId === "A"));
  assert.ok(
    netByName(circuit, "GND").connections.some(
      (c) => c.componentId === led.id && c.pinId === "C",
    ),
  );
  // The LED's anode is never wired straight to the controller.
  assert.equal(
    drive.connections.some((c) => c.componentId === led.id),
    false,
  );
});

test("a UART link crosses TX and RX", () => {
  // Compiled directly so the rule is exercised without inventing a library part.
  const circuit = compile(FIXTURES.weatherStation);
  const profile = circuit.profile;
  assert.notEqual(profile.uart.txPinId, profile.uart.rxPinId);

  const uartRequest = request({ controller: "ESP32" });
  const uartCircuit = compileCircuit({
    request: uartRequest,
    resolved: [
      {
        requested: { type: "uart-test-device", quantity: 1 },
        role: "input",
        outcome: {
          status: "resolved",
          matchedOn: "uart-test-device",
          definition: {
            ...componentDefinition("bme280"),
            id: "bme280",
            interfaces: ["uart"],
            pins: [
              { id: "VIN", label: "VIN", electricalType: "power-input", functions: ["supply-3v3"] },
              { id: "GND", label: "GND", electricalType: "ground", functions: ["ground"] },
              { id: "TX", label: "TX", electricalType: "digital-output", functions: ["uart-tx"] },
              { id: "RX", label: "RX", electricalType: "digital-input", functions: ["uart-rx"] },
            ],
          },
        },
      },
    ],
  });
  const device = uartCircuit.components.find((instance) => instance.id !== "cmp_controller" &&
    instance.definitionId === "bme280");
  const txNet = uartCircuit.nets.find((net) => net.role === "uart-tx");
  const rxNet = uartCircuit.nets.find((net) => net.role === "uart-rx");

  // Controller TX faces the device's RX, and controller RX faces device TX.
  assert.ok(
    txNet.connections.some((c) => c.componentId === uartCircuit.controllerInstance.id &&
      c.pinId === uartCircuit.profile.uart.txPinId),
  );
  assert.ok(txNet.connections.some((c) => c.componentId === device.id && c.pinId === "RX"));
  assert.ok(
    rxNet.connections.some((c) => c.componentId === uartCircuit.controllerInstance.id &&
      c.pinId === uartCircuit.profile.uart.rxPinId),
  );
  assert.ok(rxNet.connections.some((c) => c.componentId === device.id && c.pinId === "TX"));
});

test("no controller pin carries two different signals", () => {
  const circuit = compile(
    request({
      controller: "ESP32",
      inputs: [
        { type: "BME280", quantity: 1 },
        { type: "HC-SR04", quantity: 2 },
        { type: "push button", quantity: 2 },
      ],
      outputs: [
        { type: "LED", quantity: 3 },
        { type: "SG90 servo", quantity: 1 },
      ],
      communication: ["i2c"],
    }),
  );
  const byPin = new Map();
  for (const assignment of circuit.assignments) {
    if (assignment.purpose === "power" || assignment.purpose === "ground") continue;
    const nets = byPin.get(assignment.controllerPinId) ?? new Set();
    nets.add(assignment.netId);
    byPin.set(assignment.controllerPinId, nets);
  }
  for (const [pinId, nets] of byPin) {
    assert.equal(nets.size, 1, `${pinId} carries ${nets.size} signals`);
  }
  assert.equal(
    rulesFired(validateCircuit(circuit)).has("DUPLICATE_PIN_ASSIGNMENT"),
    false,
  );
});

test("a servo takes power from a rail and only its signal from a pin", () => {
  const circuit = compile(FIXTURES.servoEsp32);
  const servo = instanceOf(circuit, "sg90-servo");
  const supplyNet = circuit.nets.find((net) =>
    net.connections.some((c) => c.componentId === servo.id && c.pinId === "VCC"),
  );
  assert.equal(supplyNet.role, "power");
  assert.equal(supplyNet.nominalVoltage, 5);

  const signalNet = circuit.nets.find((net) =>
    net.connections.some((c) => c.componentId === servo.id && c.pinId === "PWM"),
  );
  assert.equal(signalNet.role, "digital");
  assert.ok(
    signalNet.connections.some((c) => c.componentId === circuit.controllerInstance.id),
  );
  // The supply pin never lands on a controller GPIO.
  const controllerPinsOnSupply = supplyNet.connections
    .filter((c) => c.componentId === circuit.controllerInstance.id)
    .map((c) => c.pinId);
  assert.deepEqual(controllerPinsOnSupply, ["VIN"]);
});

test("a DHT22 gets a pull-up on its data line", () => {
  const circuit = compile(
    request({ controller: "ESP32", inputs: [{ type: "DHT22", quantity: 1 }] }),
  );
  const resistor = instanceOf(circuit, "resistor");
  assert.ok(resistor);
  assert.equal(resistor.value, "10 kΩ");
  assert.match(resistor.additionReason, /pull-up/i);
});

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

test("a valid weather station has no validation errors", () => {
  const circuit = compile(FIXTURES.weatherStation);
  const results = validateCircuit(circuit);
  const errors = results.filter((entry) => entry.severity === "error");
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 1));
  assert.equal(designStatus(results), "ready");
});

test("a 5 V part on a 3.3 V board is routed through a level converter", () => {
  const circuit = compile(
    request({ controller: "ESP32", inputs: [{ type: "HC-SR04", quantity: 1 }] }),
  );
  const converter = instanceOf(circuit, "logic-level-converter");
  assert.ok(converter, "no level converter was inserted");
  assert.equal(converter.automaticallyAdded, true);
  assert.match(converter.additionReason, /3\.3 V and 5 V domains/);

  const sensor = instanceOf(circuit, "hc-sr04");
  // Both signals cross, and both share one converter rather than one each.
  for (const [pinId, channel] of [
    ["TRIG", 1],
    ["ECHO", 2],
  ]) {
    const deviceNet = circuit.nets.find((net) =>
      net.connections.some((c) => c.componentId === sensor.id && c.pinId === pinId),
    );
    assert.equal(deviceNet.nominalVoltage, 5, `${pinId} is not on the 5 V side`);
    assert.ok(
      deviceNet.connections.some(
        (c) => c.componentId === converter.id && c.pinId === `HV${channel}`,
      ),
      `${pinId} does not reach HV${channel}`,
    );
    const controllerNet = circuit.nets.find((net) =>
      net.connections.some(
        (c) => c.componentId === converter.id && c.pinId === `LV${channel}`,
      ),
    );
    assert.equal(controllerNet.nominalVoltage, 3.3);
    assert.ok(
      controllerNet.connections.some((c) => c.componentId === circuit.controllerInstance.id),
    );
    // The device pin is never wired straight to the controller.
    assert.equal(
      deviceNet.connections.some((c) => c.componentId === circuit.controllerInstance.id),
      false,
    );
  }
  assert.equal(instanceOf(circuit, "logic-level-converter").value, "3.3 V ↔ 5 V");

  const results = validateCircuit(circuit);
  assert.deepEqual(
    results.filter((entry) => entry.severity === "error"),
    [],
    JSON.stringify(results, null, 1),
  );
  assert.equal(designStatus(results), "ready");
});

test("the same parts in one voltage domain get no converter", () => {
  const circuit = compile(FIXTURES.distanceUno);
  assert.equal(instanceOf(circuit, "logic-level-converter"), undefined);
  assert.deepEqual(
    validateCircuit(circuit).filter((entry) => entry.rule === "LOGIC_LEVEL_MISMATCH"),
    [],
  );
});

test("a level mismatch is still reported when nothing bridges it", () => {
  const circuit = compile(
    request({ controller: "ESP32", inputs: [{ type: "HC-SR04", quantity: 1 }] }),
  );
  // Strip the converter from the record to exercise the rule directly.
  for (const placement of circuit.peripherals) {
    for (const signal of placement.signalPins) delete signal.viaLevelShifter;
  }
  const mismatch = validateCircuit(circuit).find(
    (entry) => entry.rule === "LOGIC_LEVEL_MISMATCH" && entry.severity === "error",
  );
  assert.ok(mismatch, "no logic level mismatch was reported");
  assert.match(mismatch.message, /drives more voltage than the controller pin is rated for/);
  assert.match(mismatch.remediation, /logic level converter/);
});

test("one converter carries four signals before a second is bought", () => {
  const circuit = compile(
    request({
      controller: "ESP32",
      inputs: [{ type: "HC-SR04", quantity: 3 }],
    }),
  );
  const converters = circuit.components.filter(
    (instance) => instance.definitionId === "logic-level-converter",
  );
  // Six crossing signals: four on the first board, two on the second.
  assert.equal(converters.length, 2);
  const channelsUsed = (id) =>
    circuit.nets.filter((net) =>
      net.connections.some((c) => c.componentId === id && /^LV\d$/.test(c.pinId)),
    ).length;
  assert.equal(channelsUsed(converters[0].id), 4);
  assert.equal(channelsUsed(converters[1].id), 2);
});

test("a 3.3 V I²C sensor on a 5 V board gets its own bus segment", () => {
  const circuit = compile(
    request({
      controller: "Arduino Uno",
      inputs: [{ type: "BME280", quantity: 1 }],
      communication: ["i2c"],
    }),
  );
  const converter = instanceOf(circuit, "logic-level-converter");
  assert.ok(converter, "no converter was inserted for the 3.3 V sensor");
  const sensor = instanceOf(circuit, "bme280");

  // The controller's bus reaches only the converter's high side.
  const busSda = netByName(circuit, "I2C_SDA");
  assert.ok(busSda.connections.some((c) => c.componentId === circuit.controllerInstance.id));
  assert.ok(busSda.connections.some((c) => c.componentId === converter.id && c.pinId === "HV1"));
  assert.equal(busSda.connections.some((c) => c.componentId === sensor.id), false);

  // The sensor sits on the translated segment.
  const segment = netByName(circuit, "I2C_SDA_3.3V");
  assert.ok(segment, "no translated bus segment was created");
  assert.equal(segment.nominalVoltage, 3.3);
  assert.ok(segment.connections.some((c) => c.componentId === sensor.id && c.pinId === "SDA"));
  assert.ok(segment.connections.some((c) => c.componentId === converter.id && c.pinId === "LV1"));

  assert.deepEqual(
    validateCircuit(circuit).filter((entry) => entry.severity === "error"),
    [],
  );
});

test("a 5 V-tolerant display on a 5 V board needs no converter", () => {
  const circuit = compile(
    request({
      controller: "Arduino Uno",
      outputs: [{ type: "SSD1306", quantity: 1 }],
      communication: ["i2c"],
    }),
  );
  assert.equal(instanceOf(circuit, "logic-level-converter"), undefined);
  const display = instanceOf(circuit, "ssd1306-oled-128x64");
  assert.ok(
    netByName(circuit, "I2C_SDA").connections.some((c) => c.componentId === display.id),
  );
});

test("a part whose logic follows its supply lands on the controller's rail", () => {
  // A DHT22 pulled up to 5 V would put 5 V on a 3.3 V GPIO, so the compiler
  // powers it from the rail the controller's logic already sits on.
  const esp32 = compile(
    request({ controller: "ESP32", inputs: [{ type: "DHT22", quantity: 1 }] }),
  );
  assert.equal(instanceOf(esp32, "dht22").properties.supplyVoltage, 3.3);
  assert.equal(instanceOf(esp32, "logic-level-converter"), undefined);

  const uno = compile(
    request({ controller: "Arduino Uno", inputs: [{ type: "DHT22", quantity: 1 }] }),
  );
  assert.equal(instanceOf(uno, "dht22").properties.supplyVoltage, 5);

  // A part with its own declared logic level is unaffected: a servo still needs
  // 5 V for torque even on a 3.3 V board.
  const servo = compile(FIXTURES.servoEsp32);
  assert.equal(instanceOf(servo, "sg90-servo").properties.supplyVoltage, 5);
});

test("a 3.3 V-only sensor on a 5 V board is out of range", () => {
  const circuit = compile(
    request({ controller: "Arduino Uno", inputs: [{ type: "BME280", quantity: 1 }] }),
  );
  // The Uno's 3.3 V rail is in range, so a healthy design must not fire this
  // rule; force the failure by putting the part on the 5 V rail instead.
  const sensor = instanceOf(circuit, "bme280");
  const fiveVolt = circuit.nets.find((net) => net.nominalVoltage === 5) ?? {
    id: "net_5",
    name: "+5V",
    role: "power",
    nominalVoltage: 5,
    connections: [],
  };
  if (!circuit.nets.includes(fiveVolt)) circuit.nets.push(fiveVolt);
  const placement = circuit.peripherals.find((entry) => entry.instance.id === sensor.id);
  placement.supplyVoltage = 5;
  placement.supplyNetId = fiveVolt.id;
  fiveVolt.connections.push({ componentId: sensor.id, pinId: "VIN" });

  const results = validateCircuit(circuit);
  const finding = results.find((entry) => entry.rule === "POWER_VOLTAGE_OUT_OF_RANGE");
  assert.ok(finding);
  assert.equal(finding.severity, "error");
});

test("a missing ground connection is reported", () => {
  const circuit = compile(FIXTURES.weatherStation);
  const ground = circuit.nets.find((net) => net.role === "ground");
  const sensor = instanceOf(circuit, "bme280");
  ground.connections = ground.connections.filter(
    (connection) => connection.componentId !== sensor.id,
  );
  const rules = rulesFired(validateCircuit(circuit));
  assert.ok(rules.has("MISSING_GROUND"));
  assert.ok(rules.has("REQUIRED_PIN_UNCONNECTED"));
});

test("three identical I²C devices exhaust the address space", () => {
  const circuit = compile(
    request({
      controller: "ESP32",
      outputs: [{ type: "SSD1306", quantity: 3 }],
      communication: ["i2c"],
    }),
  );
  const conflict = validateCircuit(circuit).find(
    (entry) => entry.rule === "I2C_ADDRESS_CONFLICT" && entry.severity === "error",
  );
  assert.ok(conflict, "no address conflict was reported for three identical devices");
  assert.match(conflict.message, /0x3C or 0x3D/);
});

test("a motor is switched by a low-side MOSFET, never by the pin itself", () => {
  const circuit = compile(FIXTURES.motorEsp32);
  const motor = instanceOf(circuit, "dc-motor-5v");
  const mosfet = instanceOf(circuit, "mosfet-logic-level");
  const diode = instanceOf(circuit, "diode-1n4007");
  const pulldown = circuit.components.find(
    (instance) => instance.definitionId === "resistor" && instance.value === "100 kΩ",
  );
  assert.ok(mosfet, "no driver was inserted");
  assert.ok(diode, "no flyback diode was inserted");
  assert.ok(pulldown, "no gate pull-down was inserted");
  assert.equal(mosfet.reference, "Q1");
  for (const part of [mosfet, diode, pulldown]) {
    assert.equal(part.automaticallyAdded, true);
    assert.ok(part.additionReason, `${part.reference} has no stated reason`);
  }

  // The motor sits between the 5 V rail and the drain; the source returns to
  // ground; the controller only drives the gate.
  const supply = netByName(circuit, "+5V");
  assert.ok(supply.connections.some((c) => c.componentId === motor.id && c.pinId === "1"));
  const drain = netByName(circuit, "M1_SWITCHED");
  assert.ok(drain.connections.some((c) => c.componentId === motor.id && c.pinId === "2"));
  assert.ok(drain.connections.some((c) => c.componentId === mosfet.id && c.pinId === "D"));
  assert.ok(drain.connections.some((c) => c.componentId === diode.id && c.pinId === "A"));
  assert.ok(supply.connections.some((c) => c.componentId === diode.id && c.pinId === "K"));
  assert.ok(
    netByName(circuit, "GND").connections.some(
      (c) => c.componentId === mosfet.id && c.pinId === "S",
    ),
  );

  const gate = netByName(circuit, "M1_GATE");
  assert.ok(gate.connections.some((c) => c.componentId === circuit.controllerInstance.id));
  assert.ok(gate.connections.some((c) => c.componentId === mosfet.id && c.pinId === "G"));
  assert.ok(gate.connections.some((c) => c.componentId === pulldown.id));
  // The two share a supply rail, but no signal net joins them: the controller
  // never switches the motor itself.
  assert.equal(
    circuit.nets.some(
      (net) =>
        net.role !== "power" &&
        net.role !== "ground" &&
        net.connections.some((c) => c.componentId === motor.id) &&
        net.connections.some((c) => c.componentId === circuit.controllerInstance.id),
    ),
    false,
    "the controller is wired straight to the motor",
  );

  const results = validateCircuit(circuit);
  assert.deepEqual(
    results.filter((entry) => entry.severity === "error"),
    [],
    JSON.stringify(results, null, 1),
  );
  // Peak current still gets its honest warning.
  assert.ok(results.some((entry) => entry.rule === "ESTIMATED_SUPPLY_OVERCURRENT"));
});

test("an inductive load with no flyback path is still reported", () => {
  const circuit = compile(FIXTURES.motorEsp32);
  const diode = instanceOf(circuit, "diode-1n4007");
  for (const net of circuit.nets) {
    net.connections = net.connections.filter((c) => c.componentId !== diode.id);
  }
  const finding = validateCircuit(circuit).find(
    (entry) => entry.rule === "INDUCTIVE_LOAD_PROTECTION_MISSING",
  );
  assert.ok(finding, "a motor with no diode was accepted");
  assert.equal(finding.severity, "error");
});

test("a load that needs a driver but has none is reported", () => {
  const circuit = compile(FIXTURES.motorEsp32);
  const mosfet = instanceOf(circuit, "mosfet-logic-level");
  for (const net of circuit.nets) {
    net.connections = net.connections.filter((c) => c.componentId !== mosfet.id);
  }
  const finding = validateCircuit(circuit).find(
    (entry) => entry.rule === "GPIO_DRIVING_HIGH_CURRENT_LOAD",
  );
  assert.ok(finding, "a motor with no driver was accepted");
  assert.equal(finding.severity, "error");
  assert.match(finding.remediation, /low side/);
});

test("a high-current load on a GPIO is reported", () => {
  const circuit = compile(FIXTURES.blinkUno);
  const led = instanceOf(circuit, "led-5mm");
  // A resistor far too small for the rail: 5 V - 2 V over 10 Ω is 300 mA.
  led.properties.seriesResistor = "10 Ω";
  const finding = validateCircuit(circuit).find((entry) => entry.rule === "GPIO_OVERCURRENT");
  assert.ok(finding, "no overcurrent was reported for a 10 ohm series resistor");
  assert.match(finding.message, /300 mA/);
});

test("boot-strapping pins are warned about but do not block a design", () => {
  const circuit = compile(
    request({
      controller: "ESP32",
      outputs: Array.from({ length: 14 }, () => ({ type: "LED", quantity: 1 })),
    }),
  );
  const results = validateCircuit(circuit);
  const bootstrap = results.filter((entry) => entry.rule === "BOOT_STRAP_PIN_WARNING");
  assert.ok(bootstrap.length > 0, "no boot-strap warning fired after exhausting plain GPIO");
  assert.ok(bootstrap.every((entry) => entry.severity === "warning"));
});

test("an unsupported part is an error, and the rest of the design still compiles", () => {
  const circuit = compile(
    request({
      controller: "ESP32",
      inputs: [
        { type: "BME280", quantity: 1 },
        { type: "neutrino detector", quantity: 1 },
      ],
      communication: ["i2c"],
    }),
  );
  assert.ok(instanceOf(circuit, "bme280"), "the supported part was dropped too");
  const finding = validateCircuit(circuit).find(
    (entry) => entry.rule === "UNSUPPORTED_COMPONENT",
  );
  assert.ok(finding);
  assert.equal(finding.severity, "error");
});

test("status is derived deterministically from severity", () => {
  assert.equal(designStatus([]), "ready");
  assert.equal(designStatus([{ severity: "info" }]), "ready");
  assert.equal(designStatus([{ severity: "warning" }]), "ready-with-warnings");
  assert.equal(
    designStatus([{ severity: "warning" }, { severity: "error" }]),
    "needs-changes",
  );
  assert.equal(designStatus([], { conceptOnly: true }), "concept-only");
});

// ---------------------------------------------------------------------------
// firmware
// ---------------------------------------------------------------------------

test("generated pin constants match the compiled circuit", () => {
  const { design, circuit } = buildDesign({
    request: FIXTURES.weatherStation,
    designId: "hwd_test",
  });
  const header = design.firmware.files.find((file) => file.path === "include/generated_pins.h");
  assert.ok(header);
  assert.match(header.content, /#define PIN_I2C_SDA 21/);
  assert.match(header.content, /#define PIN_I2C_SCL 22/);
  assert.match(header.content, /#define I2C_ADDR_U2 0x76/);
  assert.match(header.content, /#define I2C_ADDR_U3 0x3C/);
  assert.match(header.content, /#define SERIAL_BAUD 115200/);

  // Every constant traces back to an actual assignment.
  for (const assignment of circuit.assignments) {
    if (!assignment.constantName) continue;
    const literal = firmwarePinLiteral(
      circuit.controllerDefinition.id,
      assignment.controllerPinId,
    );
    assert.match(
      header.content,
      new RegExp(`#define ${assignment.constantName} ${literal}\\b`),
      `${assignment.constantName} is missing from generated_pins.h`,
    );
  }
});

test("firmware never references a pin constant the circuit does not define", () => {
  const { design } = buildDesign({ request: FIXTURES.weatherStation, designId: "hwd_test" });
  const header = design.firmware.files.find((file) => file.path === "include/generated_pins.h");
  const defined = new Set(
    [...header.content.matchAll(/#define ([A-Z0-9_]+)/g)].map((match) => match[1]),
  );
  for (const file of design.firmware.files) {
    if (file.path === "include/generated_pins.h") continue;
    for (const name of referencedGeneratedConstants(file.content)) {
      assert.ok(defined.has(name), `${file.path} references undefined ${name}`);
    }
  }
});

test("model-supplied logic referencing an unknown pin is rejected for the fallback", () => {
  const { design } = buildDesign({
    request: FIXTURES.weatherStation,
    designId: "hwd_test",
    firmwareLogic: {
      setupBody: "",
      loopBody: "digitalWrite(PIN_MADE_UP, HIGH);",
      helperDeclarations: "",
      expectedSerialOutput: "",
    },
  });
  const main = design.firmware.files.find((file) => file.path === "src/main.cpp");
  assert.doesNotMatch(main.content, /PIN_MADE_UP/);
  assert.match(main.content, /readTemperature/);
});

test("declared dependencies match the parts on the board", () => {
  const { design } = buildDesign({ request: FIXTURES.weatherStation, designId: "hwd_test" });
  const names = design.firmware.dependencies.map((entry) => entry.name);
  assert.ok(names.includes("adafruit/Adafruit BME280 Library"));
  assert.ok(names.includes("adafruit/Adafruit SSD1306"));

  const ini = design.firmware.files.find((file) => file.path === "platformio.ini");
  assert.match(ini.content, /board = esp32dev/);
  assert.match(ini.content, /adafruit\/Adafruit SSD1306/);

  const servo = buildDesign({ request: FIXTURES.servoEsp32, designId: "hwd_servo" }).design;
  assert.ok(servo.firmware.dependencies.some((entry) => entry.name.includes("Servo")));
});

test("a driven load's firmware drives the gate, never the load", () => {
  const { design, circuit } = buildDesign({
    request: FIXTURES.motorEsp32,
    designId: "hwd_motor",
  });
  const header = design.firmware.files.find((file) => file.path.endsWith("generated_pins.h"));
  const main = design.firmware.files.find((file) => file.path === "src/main.cpp");

  const gate = circuit.assignments.find(
    (assignment) => assignment.constantName === "PIN_M1_GATE",
  );
  assert.ok(gate, "no gate pin was assigned");
  assert.match(
    header.content,
    new RegExp(`#define PIN_M1_GATE ${firmwarePinLiteral("esp32-devkit-v1", gate.controllerPinId)}\\b`),
  );
  assert.match(main.content, /motorM1Gate = PIN_M1_GATE/);
  assert.match(main.content, /pinMode\(motorM1Gate, OUTPUT\)/);
  // It starts and stays off until the loop asks for it.
  assert.match(main.content, /digitalWrite\(motorM1Gate, LOW\);[\s\S]{0,120}motor driver held off/);

  // A level converter is passive: it must contribute no firmware at all.
  const shifted = buildDesign({
    request: request({ controller: "ESP32", inputs: [{ type: "HC-SR04", quantity: 1 }] }),
    designId: "hwd_shifted",
  }).design;
  const shiftedMain = shifted.firmware.files.find((file) => file.path === "src/main.cpp");
  assert.doesNotMatch(shiftedMain.content, /logic-level-converter|LV1|HV1/);
  assert.match(shiftedMain.content, /sonarU2ReadCm/);
  for (const name of referencedGeneratedConstants(shiftedMain.content)) {
    assert.match(
      shifted.firmware.files.find((file) => file.path.endsWith("generated_pins.h")).content,
      new RegExp(`#define ${name}\\b`),
      `${name} is not defined`,
    );
  }
});

test("pin literals follow each board's Arduino naming", () => {
  assert.equal(firmwarePinLiteral("esp32-devkit-v1", "GPIO21"), "21");
  assert.equal(firmwarePinLiteral("arduino-uno", "D9"), "9");
  assert.equal(firmwarePinLiteral("arduino-uno", "A4"), "A4");
  assert.equal(firmwarePinLiteral("raspberry-pi-pico", "GP4"), "4");
});

// ---------------------------------------------------------------------------
// design, exports and modification
// ---------------------------------------------------------------------------

test("every fixture project compiles into a complete design", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    const { design } = buildDesign({ request: fixture, designId: `hwd_${name}` });
    assert.ok(design.components.length >= 2, `${name} produced no parts`);
    assert.ok(design.nets.length >= 2, `${name} produced no nets`);
    assert.ok(design.bom.length >= 2, `${name} produced no BOM`);
    assert.ok(design.assemblySteps.length >= 8, `${name} produced too few steps`);
    assert.ok(design.firmware.files.length === 4, `${name} produced the wrong file set`);
    assert.ok(design.circuitJson, `${name} produced no circuit JSON`);
    for (const instance of design.components) {
      assert.ok(instance.position, `${name}: ${instance.reference} has no position`);
    }
  }
});

test("assembly steps name real references and pins, never a vague instruction", () => {
  const { design } = buildDesign({ request: FIXTURES.weatherStation, designId: "hwd_test" });
  const text = design.assemblySteps.map((step) => step.instruction).join("\n");
  assert.match(text, /U1 D21/);
  assert.match(text, /U2 SDA/);
  assert.match(text, /U3 SDA/);
  assert.match(text, /3.3 V rail/);
  assert.doesNotMatch(text, /Connect the sensor\.$/m);

  const busStep = design.assemblySteps.find((step) => step.title.includes("I2C_SDA"));
  assert.ok(busStep.componentIds.length >= 3);
  assert.ok(busStep.netIds.includes("net_i2c_sda"));
  assert.equal(design.assemblySteps[0].title, "Disconnect all power");
  assert.match(design.assemblySteps.at(-1).title, /start-up/i);
});

test("circuit JSON carries a port for every pin and a trace for every net", () => {
  const { design } = buildDesign({ request: FIXTURES.weatherStation, designId: "hwd_test" });
  const elements = toCircuitJson(design);
  const nets = elements.filter((element) => element.type === "source_net");
  const traces = elements.filter((element) => element.type === "source_trace");
  assert.equal(nets.length, design.nets.length);
  assert.equal(traces.length, design.nets.length);
  assert.ok(elements.some((element) => element.type === "source_component"));
  assert.ok(elements.some((element) => element.type === "schematic_component"));
  assert.ok(nets.some((net) => net.is_ground === true));
  assert.ok(nets.some((net) => net.is_power === true));
});

test("the BOM exports as CSV with quoted fields and marked estimates", () => {
  const { design } = buildDesign({ request: FIXTURES.weatherStation, designId: "hwd_test" });
  const csv = bomToCsv(design.bom);
  const [header] = csv.split("\n");
  assert.match(header, /^Reference,Component,Value or model,Quantity,Purpose/);
  assert.match(csv, /ESP32 DevKit V1/);
  assert.ok(csv.split("\n").length >= design.bom.length + 1);
  assert.ok(design.bom.every((item) => item.priceIsEstimate === true));
});

test("a design can be serialised and read back", async () => {
  const { parseStoredDesign } = await import("../src/lib/hardware/schemas.ts");
  const { design } = buildDesign({ request: FIXTURES.weatherStation, designId: "hwd_test" });
  const restored = parseStoredDesign(JSON.parse(JSON.stringify(design)));
  assert.equal(restored.ok, true, JSON.stringify(restored.issues ?? []));
  assert.equal(restored.value.id, design.id);
  assert.equal(restored.value.components.length, design.components.length);
});

test("removing the display and adding an LED recompiles the whole design", () => {
  const first = buildDesign({ request: FIXTURES.weatherStation, designId: "hwd_test" }).design;
  const display = first.components.find(
    (instance) => instance.definitionId === "ssd1306-oled-128x64",
  );

  const outcome = applyModification(first, {
    operations: [
      { type: "remove-component", targetComponentId: display.id },
      { type: "add-component", componentDefinitionId: "led-5mm", quantity: 1 },
    ],
    behaviourNotes: "Turn the LED on when the temperature goes above 30 C.",
  });
  assert.equal(outcome.rejected.length, 0, outcome.rejected.join("; "));

  const second = buildDesign({ request: outcome.request, designId: first.id }).design;
  assert.equal(
    second.components.some((instance) => instance.definitionId === "ssd1306-oled-128x64"),
    false,
    "the OLED survived removal",
  );
  const led = second.components.find((instance) => instance.definitionId === "led-5mm");
  assert.ok(led, "no LED was added");
  const resistor = second.components.find((instance) => instance.definitionId === "resistor");
  assert.ok(resistor?.automaticallyAdded, "no resistor was added for the new LED");

  // The BOM, the instructions, the firmware and validation all moved with it.
  assert.ok(second.bom.some((item) => item.componentDefinitionId === "led-5mm"));
  assert.ok(!second.bom.some((item) => item.componentDefinitionId === "ssd1306-oled-128x64"));
  const header = second.firmware.files.find((file) => file.path.endsWith("generated_pins.h"));
  assert.doesNotMatch(header.content, /I2C_ADDR_U3/);
  assert.match(header.content, /PIN_D1_ANODE/);
  const steps = second.assemblySteps.map((step) => step.instruction).join("\n");
  assert.doesNotMatch(steps, /SSD1306/);
  assert.match(steps, /D1/);
  assert.equal(second.id, first.id, "the revision changed the design identity");
});

test("replacing the controller with any profiled library board keeps every other part", () => {
  const first = buildDesign({ request: FIXTURES.weatherStation, designId: "hwd_test" }).design;
  const controller = first.components.find(
    (instance) => instance.definitionId === "esp32-devkit-v1",
  );
  const outcome = applyModification(first, {
    operations: [
      {
        type: "replace-component",
        targetComponentId: controller.id,
        replacementDefinitionId: "seeed-xiao-esp32c3",
      },
    ],
  });
  assert.deepEqual(outcome.rejected, []);
  assert.equal(outcome.request.controller, "Seeed Studio XIAO ESP32C3");
  const second = buildDesign({ request: outcome.request, designId: first.id }).design;
  assert.equal(second.components[0].definitionId, "seeed-xiao-esp32c3");
  assert.ok(second.components.some((instance) => instance.definitionId === "bme280"));
});

test("adding a motor to a working design brings its whole driver stage with it", () => {
  const first = buildDesign({ request: FIXTURES.weatherStation, designId: "hwd_test" }).design;
  const outcome = applyModification(first, {
    operations: [{ type: "add-component", componentDefinitionId: "dc-motor-5v", quantity: 1 }],
  });
  assert.deepEqual(outcome.rejected, []);

  const second = buildDesign({ request: outcome.request, designId: first.id }).design;
  for (const definitionId of ["dc-motor-5v", "mosfet-logic-level", "diode-1n4007"]) {
    assert.ok(
      second.components.some((instance) => instance.definitionId === definitionId),
      `${definitionId} is missing after the change`,
    );
    assert.ok(
      second.bom.some((item) => item.componentDefinitionId === definitionId),
      `${definitionId} is missing from the BOM`,
    );
  }
  // The instructions name the new parts, and the orientation step warns about
  // the diode that now exists.
  const steps = second.assemblySteps.map((step) => `${step.title} ${step.instruction}`).join("\n");
  assert.match(steps, /Q1/);
  assert.match(steps, /banded end \(cathode\)/);
  assert.match(second.firmware.files.find((f) => f.path === "src/main.cpp").content, /motorM1Gate/);
  assert.deepEqual(
    second.validationResults.filter((entry) => entry.severity === "error"),
    [],
  );
});

test("a modification naming something that is not in the design is rejected", () => {
  const design = buildDesign({ request: FIXTURES.weatherStation, designId: "hwd_test" }).design;
  const outcome = applyModification(design, {
    operations: [
      { type: "remove-component", targetComponentId: "cmp_does_not_exist" },
      { type: "add-component", componentDefinitionId: "warp-core", quantity: 1 },
      { type: "change-constraint", key: "colour", value: "blue" },
    ],
  });
  assert.equal(outcome.applied.length, 0);
  assert.equal(outcome.rejected.length, 3);
});

// ---------------------------------------------------------------------------
// safety
// ---------------------------------------------------------------------------

test("high-risk requests are limited to a concept or refused", () => {
  assert.equal(assessSafety("blink an LED").level, "supported");
  assert.equal(assessSafety("switch a 230V mains lamp with a relay").level, "concept-only");
  assert.equal(assessSafety("build a ventilator controller").level, "concept-only");
  assert.equal(assessSafety("spot weld an 18650 battery pack").level, "concept-only");
  assert.equal(assessSafety("a detonator circuit").level, "refused");
});

test("a concept-only design is marked as such, whatever the rules say", () => {
  const { design } = buildDesign({
    request: request({
      purpose: "Switch a 230V mains lamp from an ESP32",
      controller: "ESP32",
      outputs: [{ type: "relay module", quantity: 1 }],
    }),
    designId: "hwd_safety",
  });
  assert.equal(design.status, "concept-only");
  assert.ok(design.validationResults.some((entry) => entry.id === "safety_scope"));
});

// ---------------------------------------------------------------------------
// zip container
// ---------------------------------------------------------------------------

test("the ZIP writer produces a valid, deterministic archive", async () => {
  const { designProjectZip, projectZipFilename } = await import(
    "../src/lib/hardware/exports.ts"
  );
  const { design } = buildDesign({ request: FIXTURES.weatherStation, designId: "hwd_test" });
  const first = designProjectZip(design);
  const second = designProjectZip(design);
  assert.deepEqual(Buffer.from(first), Buffer.from(second), "the archive is not deterministic");

  const bytes = Buffer.from(first);
  assert.equal(bytes.readUInt32LE(0), 0x04034b50, "no local file header");
  const text = bytes.toString("latin1");
  for (const name of ["hardware-design.json", "bom.csv", "assembly.md", "firmware/platformio.ini"]) {
    assert.ok(text.includes(name), `${name} is missing from the archive`);
  }
  assert.match(projectZipFilename(design), /-project\.zip$/);

  // Known CRC-32 of "123456789".
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const empty = createZip([]);
  assert.equal(empty.length, 22);
});
