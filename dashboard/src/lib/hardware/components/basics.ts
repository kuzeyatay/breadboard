// Discrete parts and prototyping hardware.
//
// These are the parts the compiler inserts on its own (a current-limiting
// resistor, a pull-up, a decoupling capacitor) as well as the ones a user asks
// for by name.

import type { ComponentDefinition, ComponentPin } from "../types.ts";

function pin(
  id: string,
  label: string,
  electricalType: ComponentPin["electricalType"],
  functions: string[],
  extra: Partial<Pick<ComponentPin, "maximumVoltage" | "maximumCurrentMa">> = {},
): ComponentPin {
  return { id, label, electricalType, functions, ...extra };
}

export const led5mm: ComponentDefinition = {
  id: "led-5mm",
  aliases: ["led", "leds", "indicator led", "5mm led", "status led", "light", "lamp"],
  name: "5 mm LED",
  category: "indicator",
  description:
    "Standard 5 mm through-hole LED. It has no internal current limiting, so it always needs a series resistor.",
  electrical: {
    // A red LED's forward drop; other colours differ, which is why the
    // compiler picks a resistor from a conservative table rather than a
    // computed value that would only hold for one colour.
    typicalSupplyVoltage: 2,
    typicalCurrentMa: 10,
    maximumCurrentMa: 20,
  },
  interfaces: ["digital"],
  pins: [
    pin("A", "Anode (+, long leg)", "passive", ["anode"], { maximumCurrentMa: 20 }),
    pin("C", "Cathode (−, flat side)", "passive", ["cathode"], { maximumCurrentMa: 20 }),
  ],
  rules: { requiresCurrentLimiting: true },
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-led",
    width: 40,
    height: 50,
    pinAnchors: {
      A: { x: 25, y: 42 },
      C: { x: 15, y: 42 },
    },
  },
  estimatedUnitPrice: 0.1,
  substitutes: ["3 mm LED", "LED with integrated resistor (skip the series resistor)"],
};

export const resistor: ComponentDefinition = {
  id: "resistor",
  aliases: ["resistor", "resistors", "current limiting resistor", "pull-up resistor", "pullup"],
  name: "Resistor",
  category: "passive",
  description: "Through-hole 1/4 W resistor. Its value is set per instance by the compiler.",
  electrical: {},
  interfaces: [],
  pins: [
    pin("1", "Lead 1", "passive", ["terminal"]),
    pin("2", "Lead 2", "passive", ["terminal"]),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-resistor",
    width: 59,
    height: 12,
    pinAnchors: {
      "1": { x: 0, y: 5.65 },
      "2": { x: 58.8, y: 5.65 },
    },
  },
  estimatedUnitPrice: 0.05,
  substitutes: ["Any 1/4 W resistor of the stated value"],
};

export const capacitor: ComponentDefinition = {
  id: "capacitor",
  aliases: ["capacitor", "capacitors", "decoupling capacitor", "bypass capacitor"],
  name: "Capacitor",
  category: "passive",
  description:
    "Decoupling or bulk capacitor. Its value and type are set per instance by the compiler.",
  electrical: {},
  interfaces: [],
  pins: [
    pin("1", "Lead 1 (+ if polarised)", "passive", ["terminal"]),
    pin("2", "Lead 2 (− if polarised)", "passive", ["terminal"]),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "svg",
    assetId: "capacitor",
    width: 44,
    height: 44,
    pinAnchors: {
      "1": { x: 10, y: 42 },
      "2": { x: 34, y: 42 },
    },
  },
  estimatedUnitPrice: 0.1,
  substitutes: ["Any capacitor of the stated value and voltage rating or higher"],
};

export const pushButton: ComponentDefinition = {
  id: "push-button",
  aliases: ["button", "push button", "pushbutton", "tactile switch", "momentary switch", "switch"],
  name: "Tactile push button",
  category: "input",
  description:
    "Momentary 6 mm tactile switch. It carries no pull-up of its own, so the compiler either enables the controller's internal pull-up or adds an external one.",
  // A switch consumes nothing: the 50 mA is what its contacts can carry, which
  // belongs on the pins, not on the part. Reading a contact rating as a draw
  // makes a plain button look like it is overloading the pin it sits on.
  electrical: { typicalCurrentMa: 0, maximumCurrentMa: 0 },
  interfaces: ["digital"],
  pins: [
    pin("1", "Terminal 1", "passive", ["terminal"], { maximumCurrentMa: 50 }),
    pin("2", "Terminal 2", "passive", ["terminal"], { maximumCurrentMa: 50 }),
  ],
  rules: { requiresPullups: true },
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-pushbutton",
    width: 68,
    height: 46,
    pinAnchors: {
      "1": { x: 0, y: 13 },
      "2": { x: 0, y: 32 },
    },
  },
  estimatedUnitPrice: 0.15,
  substitutes: ["12 mm tactile switch", "Panel-mount momentary switch"],
};

export const potentiometer: ComponentDefinition = {
  id: "potentiometer",
  aliases: ["potentiometer", "pot", "knob", "rotary potentiometer", "variable resistor", "dial"],
  name: "10 kΩ potentiometer",
  category: "input",
  description:
    "Rotary 10 kΩ potentiometer wired as a voltage divider between a supply rail and ground, with the wiper read by an analog input.",
  electrical: { maximumCurrentMa: 1 },
  interfaces: ["analog"],
  pins: [
    pin("VCC", "VCC (end 1)", "power-input", ["supply-3v3", "supply-5v"]),
    pin("SIG", "Wiper", "analog-output", ["analog-out"]),
    pin("GND", "GND (end 2)", "ground", ["ground"]),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-potentiometer",
    width: 76,
    height: 76,
    pinAnchors: {
      GND: { x: 29, y: 68.5 },
      SIG: { x: 39, y: 68.5 },
      VCC: { x: 49, y: 68.5 },
    },
  },
  estimatedUnitPrice: 0.6,
  substitutes: ["10 kΩ slide potentiometer", "Rotary encoder (different firmware)"],
};

export const breadboard: ComponentDefinition = {
  id: "breadboard-830",
  aliases: ["breadboard", "solderless breadboard", "protoboard", "830 point breadboard"],
  name: "830-point solderless breadboard",
  category: "prototyping",
  description:
    "Full-size solderless breadboard with two power rails down each side and 63 five-hole terminal rows either side of the centre channel.",
  electrical: {},
  interfaces: [],
  pins: [],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "svg",
    assetId: "breadboard",
    width: 560,
    height: 190,
    pinAnchors: {},
  },
  estimatedUnitPrice: 5,
  substitutes: ["400-point half breadboard", "Perfboard (soldered)"],
};

export const powerRails: ComponentDefinition = {
  id: "power-rails",
  aliases: ["power rails", "power rail", "supply rails", "bus strips"],
  name: "Breadboard power rails",
  category: "prototyping",
  description:
    "The positive and ground bus strips a breadboard build distributes supply through. Every module's supply and ground lands here rather than on a controller pin.",
  electrical: {},
  interfaces: [],
  pins: [
    pin("POS", "+ rail", "power-output", ["supply-rail"]),
    pin("NEG", "− rail", "ground", ["ground"]),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "svg",
    assetId: "power-rails",
    width: 320,
    height: 54,
    pinAnchors: {
      POS: { x: 12, y: 14 },
      NEG: { x: 12, y: 40 },
    },
  },
  estimatedUnitPrice: 0,
  substitutes: [],
};

export const logicLevelMosfet: ComponentDefinition = {
  id: "mosfet-logic-level",
  aliases: [
    "mosfet",
    "n-channel mosfet",
    "logic level mosfet",
    "irlz44n",
    "transistor",
    "low side switch",
    "motor driver",
  ],
  name: "IRLZ44N logic-level N-channel MOSFET",
  category: "semiconductor",
  description:
    "Logic-level N-channel MOSFET used as a low-side switch: the load sits between the supply and the drain, and a controller pin drives the gate. It switches in one direction only — it cannot reverse a motor. Above a couple of amps it needs a heatsink.",
  manufacturerPartNumber: "IRLZ44N",
  electrical: {
    // The gate turns on from 3.3 V or 5 V logic, which is what "logic level"
    // means here. The 10 A figure is the part's rating, not what a breadboard or
    // a bare TO-220 without a heatsink can actually carry.
    logicVoltage: 3.3,
    maximumCurrentMa: 10_000,
  },
  interfaces: ["digital"],
  pins: [
    pin("G", "Gate (pin 1)", "digital-input", ["gate", "digital-in"], { maximumVoltage: 20 }),
    pin("D", "Drain (pin 2, tab)", "passive", ["drain", "switched-return"], {
      maximumCurrentMa: 10_000,
    }),
    pin("S", "Source (pin 3)", "ground", ["ground", "source"]),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "svg",
    assetId: "to220",
    width: 48,
    height: 62,
    pinAnchors: {
      G: { x: 11, y: 58 },
      D: { x: 24, y: 58 },
      S: { x: 37, y: 58 },
    },
  },
  estimatedUnitPrice: 0.8,
  substitutes: ["IRLB8721", "AO3400 (surface mount)", "A ready-made MOSFET switch module"],
};

export const flybackDiode: ComponentDefinition = {
  id: "diode-1n4007",
  aliases: [
    "diode",
    "flyback diode",
    "freewheeling diode",
    "1n4007",
    "rectifier diode",
    "snubber diode",
  ],
  name: "1N4007 rectifier diode",
  category: "semiconductor",
  description:
    "General-purpose 1 A rectifier. Fitted across an inductive load it gives the collapsing coil current somewhere to go instead of driving a spike back into the switch.",
  manufacturerPartNumber: "1N4007",
  electrical: { maximumCurrentMa: 1_000 },
  interfaces: [],
  pins: [
    pin("A", "Anode (plain end)", "passive", ["anode"], { maximumCurrentMa: 1_000 }),
    pin("K", "Cathode (banded end)", "passive", ["cathode"], { maximumCurrentMa: 1_000 }),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "svg",
    assetId: "diode",
    width: 52,
    height: 22,
    pinAnchors: {
      A: { x: 2, y: 11 },
      K: { x: 50, y: 11 },
    },
  },
  estimatedUnitPrice: 0.1,
  substitutes: ["1N4001 (lower voltage rating)", "SS34 Schottky, for faster switching"],
};

export const BASIC_DEFINITIONS: ComponentDefinition[] = [
  led5mm,
  resistor,
  capacitor,
  pushButton,
  potentiometer,
  logicLevelMosfet,
  flybackDiode,
  breadboard,
  powerRails,
];
