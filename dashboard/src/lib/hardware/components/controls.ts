// Things a person touches.
//
// Several of these are contact-only: every pin is a bare switch terminal, they
// consume nothing, and their current figures are what the contacts can carry
// rather than what they draw.

import type { ComponentDefinition } from "../types.ts";
import { pin } from "./pin.ts";

export const rotaryEncoder: ComponentDefinition = {
  id: "rotary-encoder",
  aliases: [
    "rotary encoder",
    "encoder",
    "ky-040",
    "click wheel",
    "scroll wheel",
    "turn knob",
  ],
  name: "KY-040 rotary encoder",
  category: "input",
  description:
    "A knob that turns without end, reporting direction through two out-of-phase contacts, plus a push switch under the shaft. Unlike a potentiometer it has no start or finish, so it suits menus and page turning.",
  manufacturerPartNumber: "KY-040",
  electrical: {
    minimumSupplyVoltage: 3.3,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.5,
    typicalCurrentMa: 1,
    maximumCurrentMa: 2,
  },
  interfaces: ["digital"],
  pins: [
    pin("VCC", "+", "power-input", ["supply-3v3", "supply-5v"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("CLK", "CLK (A)", "digital-output", ["digital-out", "quadrature"], {
      maximumVoltage: 5.5,
    }),
    pin("DT", "DT (B)", "digital-output", ["digital-out", "quadrature"], { maximumVoltage: 5.5 }),
    pin("SW", "SW (press)", "digital-output", ["digital-out", "button"], { maximumVoltage: 5.5 }),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-ky-040",
    width: 116,
    height: 70,
    pinAnchors: {
      CLK: { x: 116, y: 7.9 },
      DT: { x: 116, y: 17.4 },
      SW: { x: 116, y: 27 },
      VCC: { x: 116, y: 36.3 },
      GND: { x: 116, y: 45.5 },
    },
  },
  estimatedUnitPrice: 1.5,
  substitutes: ["EC11 bare encoder", "Two push buttons, for up and down only"],
};

export const analogJoystick: ComponentDefinition = {
  id: "analog-joystick",
  aliases: ["joystick", "thumbstick", "analog stick", "two axis joystick"],
  name: "Two-axis analog joystick",
  category: "input",
  description:
    "Two potentiometers at right angles with a push switch under the stick. Each axis reads about half scale at rest, so firmware needs a dead zone around centre.",
  electrical: {
    minimumSupplyVoltage: 3.3,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.5,
    typicalCurrentMa: 1,
    maximumCurrentMa: 2,
  },
  interfaces: ["analog", "digital"],
  pins: [
    pin("VCC", "+5V", "power-input", ["supply-3v3", "supply-5v"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("HORZ", "VRx (horizontal)", "analog-output", ["analog-out"], { maximumVoltage: 5.5 }),
    pin("VERT", "VRy (vertical)", "analog-output", ["analog-out"], { maximumVoltage: 5.5 }),
    pin("SEL", "SW (press)", "digital-output", ["digital-out", "button"], { maximumVoltage: 5.5 }),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-analog-joystick",
    width: 103,
    height: 120,
    pinAnchors: {
      VCC: { x: 33, y: 115.8 },
      VERT: { x: 42.6, y: 115.8 },
      HORZ: { x: 52.2, y: 115.8 },
      SEL: { x: 61.8, y: 115.8 },
      GND: { x: 71.4, y: 115.8 },
    },
  },
  estimatedUnitPrice: 2,
  substitutes: ["Two potentiometers", "Rotary encoder, for one axis"],
};

export const membraneKeypad: ComponentDefinition = {
  id: "membrane-keypad",
  aliases: ["keypad", "membrane keypad", "matrix keypad", "number pad", "4x3 keypad", "keys"],
  name: "4×3 membrane matrix keypad",
  category: "input",
  description:
    "Twelve keys wired as a matrix of four rows and three columns, so twelve buttons cost seven pins. It is entirely passive: the controller scans it by driving one row at a time.",
  electrical: { typicalCurrentMa: 0, maximumCurrentMa: 0 },
  interfaces: ["digital"],
  pins: [
    pin("R1", "Row 1", "passive", ["matrix-row"], { maximumCurrentMa: 20 }),
    pin("R2", "Row 2", "passive", ["matrix-row"], { maximumCurrentMa: 20 }),
    pin("R3", "Row 3", "passive", ["matrix-row"], { maximumCurrentMa: 20 }),
    pin("R4", "Row 4", "passive", ["matrix-row"], { maximumCurrentMa: 20 }),
    pin("C1", "Column 1", "passive", ["matrix-column"], { maximumCurrentMa: 20 }),
    pin("C2", "Column 2", "passive", ["matrix-column"], { maximumCurrentMa: 20 }),
    pin("C3", "Column 3", "passive", ["matrix-column"], { maximumCurrentMa: 20 }),
  ],
  rules: { requiresPullups: true },
  firmware: {
    libraries: ["chris--a/Keypad"],
    includeStatements: ["#include <Keypad.h>"],
  },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-membrane-keypad",
    width: 266,
    height: 344,
    pinAnchors: {
      R1: { x: 76.5, y: 338 },
      R2: { x: 86, y: 338 },
      R3: { x: 95.75, y: 338 },
      R4: { x: 105.25, y: 338 },
      C1: { x: 115, y: 338 },
      C2: { x: 124.5, y: 338 },
      C3: { x: 134, y: 338 },
    },
  },
  estimatedUnitPrice: 3,
  substitutes: ["4×4 keypad (one more column)", "Individual push buttons"],
};

export const slideSwitch: ComponentDefinition = {
  id: "slide-switch",
  aliases: [
    "slide switch",
    "spdt switch",
    "toggle switch",
    "on off switch",
    "power switch",
    "latching switch",
  ],
  name: "SPDT slide switch",
  category: "input",
  description:
    "A switch that stays where it is put, joining the common terminal to one side or the other. Unlike a push button it holds its state with no power, which is what a power switch needs.",
  mechanical: {
    length: 19,
    width: 6,
    height: 11,
    notes:
      "Representative miniature SPDT slide-switch envelope; verify the chosen switch body, actuator travel and mounting pattern.",
    integration: ["Provide actuator travel and a retained body or measured panel mounting feature."],
    exposedRegions: ["slide actuator"],
  },
  // Contacts carry current, they do not consume it.
  electrical: { typicalCurrentMa: 0, maximumCurrentMa: 0 },
  interfaces: ["digital"],
  pins: [
    pin("1", "Terminal 1", "passive", ["terminal"], { maximumCurrentMa: 300 }),
    pin("2", "Common", "passive", ["terminal", "common"], { maximumCurrentMa: 300 }),
    // Used as a plain on/off, one throw is left open on purpose.
    pin("3", "Terminal 3", "passive", ["terminal", "optional"], { maximumCurrentMa: 300 }),
  ],
  rules: { requiresPullups: true },
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-slide-switch",
    width: 32,
    height: 40,
    pinAnchors: {
      "1": { x: 6.5, y: 34 },
      "2": { x: 16, y: 34 },
      "3": { x: 25.5, y: 34 },
    },
  },
  estimatedUnitPrice: 0.4,
  substitutes: ["Rocker switch", "Latching push button"],
};

export const capacitiveTouch: ComponentDefinition = {
  id: "capacitive-touch",
  aliases: [
    "touch sensor",
    "capacitive touch",
    "touch button",
    "ttp223",
    "touch pad",
  ],
  name: "TTP223 capacitive touch button",
  category: "input",
  mechanical: {
    length: 24,
    width: 24,
    height: 4,
    notes:
      "Representative square TTP223 breakout envelope; module outlines and pad shapes vary, so measure the selected board.",
    integration: ["Place the sensing face behind a thin nonconductive touch wall and keep metal away from the active pad."],
    functionalAxes: ["touch direction normal to the sensing pad"],
    exposedRegions: ["capacitive sensing face", "header or cable exit"],
  },
  description:
    "A touch pad with no moving parts, reading as a plain digital high while a finger is on it. It works through a few millimetres of plastic, so it suits a sealed enclosure.",
  manufacturerPartNumber: "TTP223",
  electrical: {
    minimumSupplyVoltage: 2,
    typicalSupplyVoltage: 3.3,
    maximumSupplyVoltage: 5.5,
    typicalCurrentMa: 1.5,
    maximumCurrentMa: 3,
  },
  interfaces: ["digital"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-3v3", "supply-5v"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("OUT", "I/O", "digital-output", ["digital-out"], { maximumVoltage: 5.5 }),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "svg",
    assetId: "module-3pin",
    width: 74,
    height: 56,
    pinAnchors: {
      VCC: { x: 14, y: 52 },
      GND: { x: 37, y: 52 },
      OUT: { x: 60, y: 52 },
    },
  },
  estimatedUnitPrice: 1,
  substitutes: ["Tactile push button", "MPR121, for twelve touch pads over I²C"],
};

export const CONTROL_DEFINITIONS: ComponentDefinition[] = [
  rotaryEncoder,
  analogJoystick,
  membraneKeypad,
  slideSwitch,
  capacitiveTouch,
];
