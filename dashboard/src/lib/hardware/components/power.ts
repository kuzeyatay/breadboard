// Sources and conditioning.
//
// These are the only parts that feed the board rather than being fed by it, so
// their supply pins are power-outputs. The compiler treats a `power-source`
// part as what the controller's input rail hangs off, not as a load.

import type { ComponentDefinition } from "../types.ts";
import { pin } from "./pin.ts";

export const lipoBattery: ComponentDefinition = {
  id: "lipo-battery-1200mah",
  aliases: [
    "lipo",
    "lipo battery",
    "lithium battery",
    "rechargeable battery",
    "li-ion",
    "battery",
    "single cell battery",
  ],
  name: "1200 mAh single-cell LiPo battery",
  category: "power-source",
  description:
    "One lithium polymer cell with a protection board, nominally 3.7 V and running from 4.2 V full to about 3.0 V empty. It must be charged by a proper charger, never straight from a supply pin.",
  mechanical: {
    length: 60,
    width: 35,
    height: 7,
    notes:
      "Conservative representative envelope for a protected 1200 mAh pouch, not a universal cell size; measure the selected vendor cell before making the battery pocket.",
    integration: [
      "Support the broad faces without puncture, crushing, tight bending, or sharp-edge contact.",
      "Provide strain-relieved lead routing and service access.",
    ],
    exposedRegions: ["lead exit"],
  },
  electrical: {
    minimumSupplyVoltage: 3,
    typicalSupplyVoltage: 3.7,
    maximumSupplyVoltage: 4.2,
    // What the cell can deliver, not what it consumes.
    maximumCurrentMa: 1200,
  },
  interfaces: [],
  pins: [
    pin("POS", "+ (red)", "power-output", ["supply-battery"], { maximumVoltage: 4.2 }),
    pin("NEG", "− (black)", "ground", ["ground"]),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "svg",
    assetId: "battery",
    width: 120,
    height: 62,
    pinAnchors: {
      POS: { x: 116, y: 22 },
      NEG: { x: 116, y: 42 },
    },
  },
  estimatedUnitPrice: 9,
  substitutes: ["18650 cell in a holder", "A USB power bank, for no wiring at all"],
};

export const aaBatteryHolder: ComponentDefinition = {
  id: "battery-holder-4aa",
  aliases: [
    "battery holder",
    "aa batteries",
    "battery pack",
    "alkaline batteries",
    "4xaa",
    "disposable batteries",
  ],
  name: "4×AA battery holder",
  category: "power-source",
  description:
    "Four alkaline cells in series, 6 V fresh and falling to about 4 V as they run down. Simple and safe, and unlike a lithium cell it needs no charging circuit.",
  mechanical: {
    length: 63,
    width: 58,
    height: 17,
    notes:
      "Conservative envelope for a common enclosed 4×AA holder; holder styles vary and the selected part must be measured before final CAD.",
    integration: ["Retain the holder positively while leaving its cell cover or cells serviceable."],
    exposedRegions: ["wire exit", "battery service face"],
  },
  electrical: {
    minimumSupplyVoltage: 4,
    typicalSupplyVoltage: 6,
    maximumSupplyVoltage: 6.5,
    maximumCurrentMa: 2000,
  },
  interfaces: [],
  pins: [
    pin("POS", "+ (red)", "power-output", ["supply-battery"], { maximumVoltage: 6.5 }),
    pin("NEG", "− (black)", "ground", ["ground"]),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "svg",
    assetId: "battery",
    width: 160,
    height: 70,
    pinAnchors: {
      POS: { x: 156, y: 26 },
      NEG: { x: 156, y: 48 },
    },
  },
  estimatedUnitPrice: 2,
  substitutes: ["3×AA, for 4.5 V", "LiPo cell with a charger, for rechargeable"],
};

export const tp4056Charger: ComponentDefinition = {
  id: "tp4056-charger",
  aliases: [
    "charger",
    "lipo charger",
    "battery charger",
    "tp4056",
    "usb charging module",
    "charging board",
  ],
  name: "TP4056 lithium charging module",
  category: "power-source",
  description:
    "Charges one lithium cell from USB at up to 1 A and, on the protected version, cuts the cell off before it is over-discharged. It is a charger, not a regulator: its output follows the cell's voltage.",
  manufacturerPartNumber: "TP4056",
  electrical: {
    minimumSupplyVoltage: 4,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 8,
    maximumCurrentMa: 1000,
  },
  interfaces: ["usb"],
  pins: [
    pin("IN+", "IN+ (5 V in)", "power-input", ["supply-5v"], { maximumVoltage: 8 }),
    pin("IN-", "IN−", "ground", ["ground"]),
    pin("BAT+", "BAT+", "power-output", ["supply-battery"], { maximumVoltage: 4.2 }),
    pin("BAT-", "BAT−", "ground", ["ground"]),
    pin("OUT+", "OUT+", "power-output", ["supply-battery"], { maximumVoltage: 4.2 }),
    pin("OUT-", "OUT−", "ground", ["ground"]),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "svg",
    assetId: "module-6pin",
    width: 120,
    height: 74,
    pinAnchors: {
      "IN+": { x: 10, y: 12 },
      "IN-": { x: 10, y: 34 },
      "BAT+": { x: 116, y: 12 },
      "BAT-": { x: 116, y: 34 },
      "OUT+": { x: 116, y: 52 },
      "OUT-": { x: 116, y: 68 },
    },
  },
  estimatedUnitPrice: 1.5,
  substitutes: ["A LiPo charger with a boost converter built in", "Adafruit PowerBoost"],
};

export const ams1117Regulator: ComponentDefinition = {
  id: "ams1117-3v3",
  aliases: [
    "voltage regulator",
    "3.3v regulator",
    "ldo",
    "ams1117",
    "step down regulator",
    "linear regulator",
  ],
  name: "AMS1117-3.3 linear regulator module",
  category: "power-source",
  description:
    "Drops a higher rail to a steady 3.3 V. It burns the difference as heat, so it wants at least 4.75 V in and is wasteful from a battery — a switching converter is kinder there.",
  manufacturerPartNumber: "AMS1117-3.3",
  electrical: {
    minimumSupplyVoltage: 4.75,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 15,
    maximumCurrentMa: 800,
  },
  interfaces: [],
  pins: [
    pin("IN", "IN", "power-input", ["supply-5v"], { maximumVoltage: 15 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("OUT", "OUT (3.3 V)", "power-output", ["supply-3v3"], { maximumVoltage: 3.3 }),
  ],
  rules: { requiresDecoupling: true },
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "svg",
    assetId: "module-3pin",
    width: 82,
    height: 56,
    pinAnchors: {
      IN: { x: 14, y: 52 },
      GND: { x: 41, y: 52 },
      OUT: { x: 68, y: 52 },
    },
  },
  estimatedUnitPrice: 1,
  substitutes: ["MP1584 buck converter, far more efficient", "The board's own regulator"],
};

export const POWER_DEFINITIONS: ComponentDefinition[] = [
  lipoBattery,
  aaBatteryHolder,
  tp4056Charger,
  ams1117Regulator,
];
