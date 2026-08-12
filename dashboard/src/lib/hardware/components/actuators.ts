// Things that move, make noise, or switch something else.

import type { ComponentDefinition } from "../types.ts";
import { pin } from "./pin.ts";

export const passiveBuzzer: ComponentDefinition = {
  id: "passive-buzzer",
  aliases: [
    "buzzer",
    "piezo",
    "piezo buzzer",
    "beeper",
    "speaker",
    "tone generator",
    "alarm sounder",
  ],
  name: "Passive piezo buzzer",
  category: "actuator",
  description:
    "A piezo disc that makes whatever tone the controller drives it at, so it can play notes rather than only beep. An active buzzer, by contrast, has its own oscillator and only ever makes one sound.",
  electrical: {
    minimumSupplyVoltage: 3,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.5,
    typicalCurrentMa: 5,
    maximumCurrentMa: 15,
  },
  interfaces: ["pwm"],
  pins: [
    pin("1", "Signal", "digital-input", ["pwm", "digital-in"], { maximumVoltage: 5.5 }),
    pin("2", "GND", "ground", ["ground"]),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-buzzer",
    width: 64,
    height: 90,
    pinAnchors: {
      "1": { x: 27, y: 84 },
      "2": { x: 37, y: 84 },
    },
  },
  estimatedUnitPrice: 0.5,
  substitutes: ["Active buzzer, for one fixed beep", "DFPlayer Mini, for speech and music"],
};

export const stepper28byj48: ComponentDefinition = {
  id: "stepper-28byj48",
  aliases: [
    "stepper",
    "stepper motor",
    "28byj-48",
    "uln2003",
    "precise motor",
    "positioning motor",
  ],
  name: "28BYJ-48 stepper motor with ULN2003 driver",
  category: "actuator",
  description:
    "Geared unipolar stepper sold with its ULN2003 driver board, moving in exact steps rather than simply spinning. The driver already carries the transistors and their flyback diodes, so the controller only sequences four inputs.",
  manufacturerPartNumber: "28BYJ-48",
  electrical: {
    minimumSupplyVoltage: 4.5,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.5,
    logicVoltage: 5,
    typicalCurrentMa: 240,
    maximumCurrentMa: 320,
  },
  interfaces: ["digital"],
  pins: [
    pin("VCC", "+ (5 V)", "power-input", ["supply-5v"], { maximumVoltage: 5.5 }),
    pin("GND", "−", "ground", ["ground"]),
    pin("IN1", "IN1", "digital-input", ["digital-in"], { maximumVoltage: 5.5 }),
    pin("IN2", "IN2", "digital-input", ["digital-in"], { maximumVoltage: 5.5 }),
    pin("IN3", "IN3", "digital-input", ["digital-in"], { maximumVoltage: 5.5 }),
    pin("IN4", "IN4", "digital-input", ["digital-in"], { maximumVoltage: 5.5 }),
  ],
  // The driver board carries its own transistors and diodes.
  rules: { requiresDriver: false, requiresFlybackDiode: false },
  firmware: {
    libraries: ["arduino-libraries/Stepper"],
    includeStatements: ["#include <Stepper.h>"],
  },
  visual: {
    renderer: "svg",
    assetId: "module-4pin",
    width: 130,
    height: 96,
    pinAnchors: {
      IN1: { x: 14, y: 92 },
      IN2: { x: 36, y: 92 },
      IN3: { x: 58, y: 92 },
      IN4: { x: 80, y: 92 },
      VCC: { x: 102, y: 92 },
      GND: { x: 124, y: 92 },
    },
  },
  estimatedUnitPrice: 4,
  substitutes: ["NEMA 17 with an A4988 driver, for real torque", "SG90 servo, for 0–180°"],
};

export const waterPump: ComponentDefinition = {
  id: "water-pump-5v",
  aliases: [
    "pump",
    "water pump",
    "submersible pump",
    "watering pump",
    "liquid pump",
  ],
  name: "5 V submersible water pump",
  category: "actuator",
  description:
    "Small submersible pump of the kind used for automatic plant watering. It is a brushed motor in a housing, so it is inductive and needs the same driver and flyback path any motor does.",
  electrical: {
    minimumSupplyVoltage: 3,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 6,
    typicalCurrentMa: 220,
    maximumCurrentMa: 700,
  },
  interfaces: [],
  pins: [
    pin("1", "+ terminal", "power-input", ["supply-5v"], { maximumVoltage: 6 }),
    pin("2", "− terminal", "passive", ["switched-return"]),
  ],
  rules: { requiresDriver: true, requiresFlybackDiode: true },
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "svg",
    assetId: "motor",
    width: 86,
    height: 90,
    pinAnchors: {
      "1": { x: 30, y: 86 },
      "2": { x: 56, y: 86 },
    },
  },
  estimatedUnitPrice: 4,
  substitutes: ["12 V pump with its own supply", "Solenoid valve on a mains-pressure line"],
};

export const ACTUATOR_DEFINITIONS: ComponentDefinition[] = [
  passiveBuzzer,
  stepper28byj48,
  waterPump,
];
