// The other two AVR boards.
//
// The Nano is an Uno in a smaller package with the same silicon, and the Mega
// is what a project reaches for when it runs out of pins. Both are kept apart
// from controllers.ts so that file stays about the three original boards.

import type { ComponentDefinition, ComponentPin, ControllerProfile } from "../types.ts";
import { pin } from "./pin.ts";

// ---------------------------------------------------------------------------
// Arduino Nano
// ---------------------------------------------------------------------------

const nanoDigital = (number: number, functions: string[] = []) =>
  pin(`D${number}`, String(number), "digital-io", ["gpio", ...functions], {
    maximumVoltage: 5,
    maximumCurrentMa: 40,
  });

export const arduinoNano: ComponentDefinition = {
  id: "arduino-nano",
  aliases: ["nano", "arduino nano", "nano v3", "small arduino", "breadboard arduino"],
  name: "Arduino Nano",
  category: "controller",
  description:
    "The Uno's ATmega328P in a package that plugs straight into a breadboard, with two extra analog-only inputs and a mini-USB socket.",
  manufacturer: "Arduino",
  manufacturerPartNumber: "A000005",
  electrical: {
    minimumSupplyVoltage: 7,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 12,
    logicVoltage: 5,
    typicalCurrentMa: 19,
    maximumCurrentMa: 200,
  },
  interfaces: ["i2c", "spi", "uart", "usb"],
  pins: [
    pin("VIN", "VIN", "power-input", ["supply-vin"], { maximumVoltage: 12 }),
    pin("5V", "5V", "power-output", ["supply-5v"], { maximumVoltage: 5, maximumCurrentMa: 500 }),
    pin("3V3", "3.3V", "power-output", ["supply-3v3"], { maximumVoltage: 3.3, maximumCurrentMa: 50 }),
    pin("GND1", "GND", "ground", ["ground"]),
    pin("GND2", "GND", "ground", ["ground"]),
    pin("RESET", "RESET", "digital-input", ["reset", "optional"], { maximumVoltage: 5 }),
    pin("AREF", "AREF", "analog-input", ["reference", "optional"], { maximumVoltage: 5 }),
    pin("D0", "0", "digital-io", ["gpio", "uart-rx", "usb-console"], {
      maximumVoltage: 5,
      maximumCurrentMa: 40,
    }),
    pin("D1", "1", "digital-io", ["gpio", "uart-tx", "usb-console"], {
      maximumVoltage: 5,
      maximumCurrentMa: 40,
    }),
    nanoDigital(2, ["interrupt"]),
    nanoDigital(3, ["pwm", "interrupt"]),
    nanoDigital(4),
    nanoDigital(5, ["pwm"]),
    nanoDigital(6, ["pwm"]),
    nanoDigital(7),
    nanoDigital(8),
    nanoDigital(9, ["pwm"]),
    nanoDigital(10, ["pwm", "spi-cs"]),
    nanoDigital(11, ["pwm", "spi-mosi"]),
    nanoDigital(12, ["spi-miso"]),
    nanoDigital(13, ["spi-sck", "onboard-led"]),
    pin("A0", "A0", "analog-input", ["gpio", "adc"], { maximumVoltage: 5, maximumCurrentMa: 40 }),
    pin("A1", "A1", "analog-input", ["gpio", "adc"], { maximumVoltage: 5, maximumCurrentMa: 40 }),
    pin("A2", "A2", "analog-input", ["gpio", "adc"], { maximumVoltage: 5, maximumCurrentMa: 40 }),
    pin("A3", "A3", "analog-input", ["gpio", "adc"], { maximumVoltage: 5, maximumCurrentMa: 40 }),
    pin("A4", "A4", "analog-input", ["gpio", "adc", "i2c-sda"], {
      maximumVoltage: 5,
      maximumCurrentMa: 40,
    }),
    pin("A5", "A5", "analog-input", ["gpio", "adc", "i2c-scl"], {
      maximumVoltage: 5,
      maximumCurrentMa: 40,
    }),
    // A6 and A7 exist only as ADC inputs; they cannot be used as digital pins.
    pin("A6", "A6", "analog-input", ["adc", "input-only"], { maximumVoltage: 5 }),
    pin("A7", "A7", "analog-input", ["adc", "input-only"], { maximumVoltage: 5 }),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: ["#include <Arduino.h>"] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-arduino-nano",
    width: 170,
    height: 67,
    pinAnchors: {
      D0: { x: 144.5, y: 4.8 },
      D1: { x: 154.1, y: 4.8 },
      D2: { x: 115.7, y: 4.8 },
      D3: { x: 106.1, y: 4.8 },
      D4: { x: 96.5, y: 4.8 },
      D5: { x: 86.9, y: 4.8 },
      D6: { x: 77.3, y: 4.8 },
      D7: { x: 67.7, y: 4.8 },
      D8: { x: 58.1, y: 4.8 },
      D9: { x: 48.5, y: 4.8 },
      D10: { x: 38.9, y: 4.8 },
      D11: { x: 29.3, y: 4.8 },
      D12: { x: 19.7, y: 4.8 },
      D13: { x: 19.7, y: 62.4 },
      GND2: { x: 125.3, y: 4.8 },
      "3V3": { x: 29.3, y: 62.4 },
      AREF: { x: 38.9, y: 62.4 },
      A0: { x: 48.5, y: 62.4 },
      A1: { x: 58.1, y: 62.4 },
      A2: { x: 67.7, y: 62.4 },
      A3: { x: 77.3, y: 62.4 },
      A4: { x: 86.9, y: 62.4 },
      A5: { x: 96.5, y: 62.4 },
      A6: { x: 106.1, y: 62.4 },
      A7: { x: 115.7, y: 62.4 },
      "5V": { x: 125.3, y: 62.4 },
      RESET: { x: 134.9, y: 62.4 },
      GND1: { x: 144.5, y: 62.4 },
      VIN: { x: 154.1, y: 62.4 },
    },
  },
  estimatedUnitPrice: 8,
  substitutes: ["Arduino Uno (same silicon, bigger board)", "Arduino Nano Every"],
};

export const arduinoNanoProfile: ControllerProfile = {
  definitionId: arduinoNano.id,
  logicVoltage: 5,
  rails: [
    { pinId: "5V", voltage: 5, budgetMa: 400 },
    { pinId: "3V3", voltage: 3.3, budgetMa: 50 },
  ],
  groundPinIds: ["GND1", "GND2"],
  maximumPinCurrentMa: 20,
  digitalPinOrder: ["D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12", "D13"],
  pwmPinOrder: ["D9", "D10", "D11", "D3", "D5", "D6"],
  analogPinOrder: ["A0", "A1", "A2", "A3", "A6", "A7"],
  i2c: { sdaPinId: "A4", sclPinId: "A5" },
  spi: { sckPinId: "D13", mosiPinId: "D11", misoPinId: "D12" },
  uart: { txPinId: "D1", rxPinId: "D0" },
  cautionPins: {
    D0: "Digital 0 (RX) is the USB serial console; using it breaks Serial output and uploading.",
    D1: "Digital 1 (TX) is the USB serial console; using it breaks Serial output and uploading.",
    D13: "Digital 13 drives the on-board LED through a resistor, which loads the pin.",
    A6: "A6 is analog-only on the Nano; it cannot be read or driven as a digital pin.",
    A7: "A7 is analog-only on the Nano; it cannot be read or driven as a digital pin.",
  },
  firmware: {
    platformioEnvironment: "nanoatmega328new",
    platformioBoard: "nanoatmega328new",
    platformioPlatform: "atmelavr",
    framework: "arduino",
    arduinoBoardName: "Arduino Nano (ATmega328P, new bootloader)",
    serialBaud: 9600,
  },
};

// ---------------------------------------------------------------------------
// Arduino Mega 2560
// ---------------------------------------------------------------------------

/** Wokwi's header coordinates, kept as one table because there are eighty. */
const MEGA_ANCHORS: Record<string, [number, number]> = {
  D0: [257.5, 9], D1: [247.5, 9], D2: [238, 9], D3: [228.5, 9], D4: [219, 9], D5: [209.5, 9],
  D6: [200, 9], D7: [190, 9], D8: [177, 9], D9: [167.5, 9], D10: [157.5, 9], D11: [148, 9],
  D12: [138, 9], D13: [129, 9], D14: [270.5, 9], D15: [280, 9], D16: [289.5, 9], D17: [299, 9],
  D18: [308.5, 9], D19: [318.5, 9], D20: [328, 9], D21: [337.5, 9], D22: [361, 17.5], D23: [371, 17.5],
  D24: [361, 27.25], D25: [371, 27.25], D26: [361, 36.75], D27: [371, 36.75], D28: [361, 46.25],
  D29: [371, 46.25], D30: [361, 56], D31: [371, 56], D32: [361, 65.5], D33: [371, 65.5],
  D34: [361, 75], D35: [371, 75], D36: [361, 84.5], D37: [371, 84.5], D38: [361, 94.25],
  D39: [371, 94.25], D40: [361, 103.75], D41: [371, 103.75], D42: [361, 113.5], D43: [371, 113.5],
  D44: [361, 123], D45: [371, 123], D46: [361, 132.75], D47: [371, 132.75], D48: [361, 142.25],
  D49: [371, 142.25], D50: [361, 152], D51: [371, 152], D52: [361, 161.5], D53: [371, 161.5],
  AREF: [109, 9], GND1: [119, 9], GND2: [174.25, 184.5], GND3: [183.75, 184.5],
  IOREF: [136, 184.5], RESET: [145.5, 184.5], "3V3": [155, 184.5], "5V": [164.5, 184.5],
  VIN: [193.5, 184.5], A0: [208.5, 184.5], A1: [218, 184.5], A2: [227.5, 184.5],
  A3: [237.25, 184.5], A4: [246.75, 184.5], A5: [256.25, 184.5], A6: [266, 184.5],
  A7: [275.5, 184.5], A8: [290.25, 184.5], A9: [300, 184.5], A10: [309.5, 184.5],
  A11: [319.25, 184.5], A12: [328.75, 184.5], A13: [338.5, 184.5], A14: [348, 184.5],
  A15: [357.75, 184.5],
};

const MEGA_PWM = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46];

function megaPins(): ComponentPin[] {
  const pins: ComponentPin[] = [
    pin("VIN", "VIN", "power-input", ["supply-vin"], { maximumVoltage: 12 }),
    pin("5V", "5V", "power-output", ["supply-5v"], { maximumVoltage: 5, maximumCurrentMa: 800 }),
    pin("3V3", "3.3V", "power-output", ["supply-3v3"], { maximumVoltage: 3.3, maximumCurrentMa: 50 }),
    pin("GND1", "GND", "ground", ["ground"]),
    pin("GND2", "GND", "ground", ["ground"]),
    pin("GND3", "GND", "ground", ["ground"]),
    pin("RESET", "RESET", "digital-input", ["reset", "optional"], { maximumVoltage: 5 }),
    pin("IOREF", "IOREF", "power-output", ["reference", "optional"], { maximumVoltage: 5 }),
    pin("AREF", "AREF", "analog-input", ["reference", "optional"], { maximumVoltage: 5 }),
  ];
  for (let number = 0; number <= 53; number += 1) {
    const functions = ["gpio"];
    if (MEGA_PWM.includes(number)) functions.push("pwm");
    if (number === 0) functions.push("uart-rx", "usb-console");
    if (number === 1) functions.push("uart-tx", "usb-console");
    // Serial1..Serial3 on 18-19, 16-17 and 14-15.
    if (number === 18) functions.push("uart-tx");
    if (number === 19) functions.push("uart-rx");
    if (number === 20) functions.push("i2c-sda");
    if (number === 21) functions.push("i2c-scl");
    if (number === 50) functions.push("spi-miso");
    if (number === 51) functions.push("spi-mosi");
    if (number === 52) functions.push("spi-sck");
    if (number === 53) functions.push("spi-cs");
    pins.push(
      pin(`D${number}`, String(number), "digital-io", functions, {
        maximumVoltage: 5,
        maximumCurrentMa: 40,
      }),
    );
  }
  for (let number = 0; number <= 15; number += 1) {
    pins.push(
      pin(`A${number}`, `A${number}`, "analog-input", ["gpio", "adc"], {
        maximumVoltage: 5,
        maximumCurrentMa: 40,
      }),
    );
  }
  return pins;
}

export const arduinoMega: ComponentDefinition = {
  id: "arduino-mega",
  aliases: [
    "mega",
    "arduino mega",
    "mega 2560",
    "atmega2560",
    "big arduino",
    "board with many pins",
    "lots of pins",
  ],
  name: "Arduino Mega 2560",
  category: "controller",
  description:
    "ATmega2560 board with 54 digital pins, 16 analog inputs and four hardware serial ports. The board to reach for when a project runs out of pins on an Uno; it is 5 V logic like the rest of the family.",
  manufacturer: "Arduino",
  manufacturerPartNumber: "A000067",
  electrical: {
    minimumSupplyVoltage: 7,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 12,
    logicVoltage: 5,
    typicalCurrentMa: 50,
    maximumCurrentMa: 200,
  },
  interfaces: ["i2c", "spi", "uart", "usb"],
  pins: megaPins(),
  rules: {},
  firmware: { libraries: [], includeStatements: ["#include <Arduino.h>"] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-arduino-mega",
    width: 388,
    height: 192,
    pinAnchors: Object.fromEntries(
      Object.entries(MEGA_ANCHORS).map(([id, [x, y]]) => [id, { x, y }]),
    ),
  },
  estimatedUnitPrice: 38,
  substitutes: ["Arduino Due (3.3 V, faster)", "ESP32, if a radio is wanted too"],
};

export const arduinoMegaProfile: ControllerProfile = {
  definitionId: arduinoMega.id,
  logicVoltage: 5,
  rails: [
    { pinId: "5V", voltage: 5, budgetMa: 800 },
    { pinId: "3V3", voltage: 3.3, budgetMa: 50 },
  ],
  groundPinIds: ["GND1", "GND2", "GND3"],
  maximumPinCurrentMa: 20,
  // Plain pins first, then the ones that double as a bus, so a design only
  // spends a bus pin once every ordinary pin is gone.
  digitalPinOrder: [
    ...Array.from({ length: 32 }, (_, index) => `D${index + 22}`),
    ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((number) => `D${number}`),
  ],
  pwmPinOrder: MEGA_PWM.map((number) => `D${number}`),
  analogPinOrder: Array.from({ length: 16 }, (_, index) => `A${index}`),
  i2c: { sdaPinId: "D20", sclPinId: "D21" },
  spi: { sckPinId: "D52", mosiPinId: "D51", misoPinId: "D50" },
  uart: { txPinId: "D18", rxPinId: "D19" },
  // Serial2 and Serial3. Four hardware ports is the Mega's main draw.
  additionalUarts: [
    { txPinId: "D16", rxPinId: "D17" },
    { txPinId: "D14", rxPinId: "D15" },
  ],
  cautionPins: {
    D0: "Digital 0 (RX0) is the USB serial console; using it breaks Serial output and uploading.",
    D1: "Digital 1 (TX0) is the USB serial console; using it breaks Serial output and uploading.",
    D13: "Digital 13 drives the on-board LED through a resistor, which loads the pin.",
  },
  firmware: {
    platformioEnvironment: "megaatmega2560",
    platformioBoard: "megaatmega2560",
    platformioPlatform: "atmelavr",
    framework: "arduino",
    arduinoBoardName: "Arduino Mega or Mega 2560",
    serialBaud: 9600,
  },
};

export const AVR_CONTROLLER_DEFINITIONS: ComponentDefinition[] = [arduinoNano, arduinoMega];
export const AVR_CONTROLLER_PROFILES: ControllerProfile[] = [
  arduinoNanoProfile,
  arduinoMegaProfile,
];
