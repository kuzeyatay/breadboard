// Sensor and actuator modules.
//
// Each entry describes one specific, commonly sold module — not a family. The
// electrical figures come from the module's datasheet; where a module variant
// changes a figure (a 3.3 V-only BME280 board versus a regulated one) the entry
// documents the variant it models rather than averaging them away.

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

export const bme280: ComponentDefinition = {
  id: "bme280",
  aliases: [
    "bme280",
    "bme 280",
    "temperature sensor",
    "environment sensor",
    "environmental sensor",
    "weather sensor",
    "humidity sensor",
    "pressure sensor",
    "barometric sensor",
    "temperature humidity pressure sensor",
  ],
  name: "BME280 environmental sensor",
  category: "sensor",
  mechanical: {
    length: 18,
    width: 16,
    height: 4,
    notes:
      "Representative GY-BME280 breakout envelope; clone PCB outlines and header orientation vary, so measure the selected board before finalizing its pocket.",
    integration: ["Expose the sensor vent to ambient air without placing it in a stagnant sealed cavity."],
    exposedRegions: ["environmental sensor vent", "header or cable exit"],
  },
  description:
    "I²C temperature, humidity and barometric pressure sensor on the common 3.3 V GY-BME280 breakout, which carries its own bus pull-ups.",
  manufacturer: "Bosch Sensortec (sensor)",
  manufacturerPartNumber: "BME280",
  electrical: {
    minimumSupplyVoltage: 3,
    typicalSupplyVoltage: 3.3,
    maximumSupplyVoltage: 3.6,
    logicVoltage: 3.3,
    typicalCurrentMa: 0.6,
    maximumCurrentMa: 1,
  },
  interfaces: ["i2c", "spi"],
  pins: [
    pin("VIN", "VIN", "power-input", ["supply-3v3"], { maximumVoltage: 3.6 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("SCL", "SCL", "digital-io", ["i2c-scl"], { maximumVoltage: 3.6 }),
    pin("SDA", "SDA", "digital-io", ["i2c-sda"], { maximumVoltage: 3.6 }),
    pin("CSB", "CSB", "digital-input", ["spi-cs", "optional"], { maximumVoltage: 3.6 }),
    pin("SDO", "SDO", "digital-io", ["i2c-address-select", "spi-miso", "optional"], {
      maximumVoltage: 3.6,
    }),
  ],
  rules: {
    requiresPullups: false,
    i2cAddresses: ["0x76", "0x77"],
  },
  firmware: {
    libraries: ["adafruit/Adafruit BME280 Library", "adafruit/Adafruit Unified Sensor"],
    includeStatements: ["#include <Adafruit_BME280.h>", "#include <Adafruit_Sensor.h>"],
  },
  visual: {
    renderer: "svg",
    assetId: "module-4pin",
    width: 96,
    height: 62,
    pinAnchors: {
      VIN: { x: 10, y: 58 },
      GND: { x: 28, y: 58 },
      SCL: { x: 46, y: 58 },
      SDA: { x: 64, y: 58 },
      CSB: { x: 82, y: 58 },
      SDO: { x: 92, y: 30 },
    },
  },
  estimatedUnitPrice: 6,
  substitutes: ["BMP280 (pressure and temperature only)", "BME680"],
};

export const dht22: ComponentDefinition = {
  id: "dht22",
  aliases: [
    "dht22",
    "dht-22",
    "am2302",
    "digital temperature humidity sensor",
    "one wire temperature sensor",
  ],
  name: "DHT22 temperature and humidity sensor",
  category: "sensor",
  description:
    "Single-wire digital temperature and humidity sensor. The bare sensor needs an external pull-up on its data line.",
  manufacturer: "Aosong",
  manufacturerPartNumber: "AM2302",
  electrical: {
    minimumSupplyVoltage: 3.3,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 6,
    typicalCurrentMa: 1.5,
    maximumCurrentMa: 2.5,
  },
  interfaces: ["one-wire"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-3v3", "supply-5v"], { maximumVoltage: 6 }),
    pin("DATA", "DATA", "open-drain", ["digital-data", "one-wire"], { maximumVoltage: 6 }),
    pin("NC", "NC", "passive", ["optional", "not-connected"]),
    pin("GND", "GND", "ground", ["ground"]),
  ],
  rules: { requiresPullups: true },
  firmware: {
    libraries: ["adafruit/DHT sensor library", "adafruit/Adafruit Unified Sensor"],
    includeStatements: ["#include <DHT.h>"],
  },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-dht22",
    width: 57,
    height: 117,
    pinAnchors: {
      VCC: { x: 15, y: 114.9 },
      DATA: { x: 24.5, y: 114.9 },
      NC: { x: 34.1, y: 114.9 },
      GND: { x: 43.8, y: 114.9 },
    },
  },
  estimatedUnitPrice: 5,
  substitutes: ["DHT11 (lower accuracy)", "SHT31"],
};

export const hcSr04: ComponentDefinition = {
  id: "hc-sr04",
  aliases: [
    "hc-sr04",
    "hcsr04",
    "hc sr04",
    "distance sensor",
    "ultrasonic sensor",
    "ultrasonic distance sensor",
    "range sensor",
    "proximity sensor",
  ],
  name: "HC-SR04 ultrasonic distance sensor",
  category: "sensor",
  description:
    "5 V ultrasonic rangefinder with a trigger input and an echo output. The echo pin drives a 5 V signal regardless of the controller's logic level.",
  manufacturerPartNumber: "HC-SR04",
  electrical: {
    minimumSupplyVoltage: 4.5,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.5,
    logicVoltage: 5,
    typicalCurrentMa: 15,
    maximumCurrentMa: 20,
  },
  interfaces: ["digital"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-5v"], { maximumVoltage: 5.5 }),
    pin("TRIG", "TRIG", "digital-input", ["digital-in", "trigger"], { maximumVoltage: 5.5 }),
    pin("ECHO", "ECHO", "digital-output", ["digital-out", "echo"], { maximumVoltage: 5 }),
    pin("GND", "GND", "ground", ["ground"]),
  ],
  rules: { requiresLevelShifter: true },
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-hc-sr04",
    width: 170,
    height: 95,
    pinAnchors: {
      VCC: { x: 71.3, y: 94.5 },
      TRIG: { x: 81.3, y: 94.5 },
      ECHO: { x: 91.3, y: 94.5 },
      GND: { x: 101.3, y: 94.5 },
    },
  },
  estimatedUnitPrice: 3,
  substitutes: ["HC-SR04P (3.3 V tolerant)", "VL53L0X time-of-flight sensor"],
};

export const ssd1306Oled: ComponentDefinition = {
  id: "ssd1306-oled-128x64",
  aliases: [
    "ssd1306",
    "oled",
    "oled display",
    "oled screen",
    "128x64 oled",
    "0.96 oled",
    "i2c oled",
    "display",
    "screen",
    "monochrome display",
  ],
  name: "SSD1306 128×64 I²C OLED display",
  category: "display",
  mechanical: {
    length: 27.8,
    width: 27.3,
    height: 5,
    notes:
      "Representative 0.96-inch four-pin SSD1306 breakout envelope; verify the chosen PCB and mounting-hole pattern.",
    integration: ["Support the PCB without loading the OLED glass and provide cable/header clearance."],
    functionalAxes: ["display normal through the viewing aperture"],
    exposedRegions: ["active display area", "header or cable exit"],
  },
  description:
    "0.96\" monochrome OLED on the four-pin I²C breakout, with an on-board regulator that accepts 3.3 V or 5 V and integrated bus pull-ups.",
  manufacturerPartNumber: "SSD1306",
  electrical: {
    minimumSupplyVoltage: 3.3,
    typicalSupplyVoltage: 3.3,
    maximumSupplyVoltage: 5.5,
    logicVoltage: 3.3,
    typicalCurrentMa: 8,
    maximumCurrentMa: 20,
  },
  interfaces: ["i2c"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-3v3", "supply-5v"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("SCL", "SCL", "digital-io", ["i2c-scl"], { maximumVoltage: 5.5 }),
    pin("SDA", "SDA", "digital-io", ["i2c-sda"], { maximumVoltage: 5.5 }),
  ],
  rules: { requiresPullups: false, i2cAddresses: ["0x3C", "0x3D"] },
  firmware: {
    libraries: ["adafruit/Adafruit SSD1306", "adafruit/Adafruit GFX Library"],
    includeStatements: ["#include <Adafruit_SSD1306.h>", "#include <Adafruit_GFX.h>"],
  },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-ssd1306",
    width: 150,
    height: 116,
    pinAnchors: {
      SDA: { x: 36.5, y: 12.5 },
      SCL: { x: 45.5, y: 12.5 },
      VCC: { x: 93.5, y: 12.5 },
      GND: { x: 103.5, y: 12 },
    },
  },
  estimatedUnitPrice: 7,
  substitutes: ["SH1106 1.3\" I²C OLED", "SSD1306 128×32"],
};

export const sg90Servo: ComponentDefinition = {
  id: "sg90-servo",
  aliases: [
    "sg90",
    "servo",
    "servo motor",
    "micro servo",
    "hobby servo",
    "sg90 servo",
  ],
  name: "SG90 micro servo",
  category: "actuator",
  description:
    "9 g hobby servo driven by a 50 Hz PWM signal. Its stall current is far beyond what a controller pin or a USB-powered board rail can supply.",
  manufacturerPartNumber: "SG90",
  electrical: {
    minimumSupplyVoltage: 4.8,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 6,
    logicVoltage: 3.3,
    typicalCurrentMa: 250,
    maximumCurrentMa: 700,
  },
  interfaces: ["pwm"],
  pins: [
    pin("VCC", "V+ (red)", "power-input", ["supply-5v"], { maximumVoltage: 6 }),
    pin("GND", "GND (brown)", "ground", ["ground"]),
    pin("PWM", "Signal (orange)", "digital-input", ["pwm", "digital-in"], { maximumVoltage: 5 }),
  ],
  rules: { requiresDriver: false },
  firmware: {
    libraries: ["arduino-libraries/Servo"],
    includeStatements: ["#include <Servo.h>"],
  },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-servo",
    width: 170,
    height: 120,
    pinAnchors: {
      GND: { x: 0, y: 50 },
      VCC: { x: 0, y: 59.5 },
      PWM: { x: 0, y: 69 },
    },
  },
  estimatedUnitPrice: 4,
  substitutes: ["MG90S (metal gear)", "SG92R"],
};

export const relayModule5v: ComponentDefinition = {
  id: "relay-module-5v",
  aliases: [
    "relay",
    "relay module",
    "5v relay",
    "5v relay module",
    "opto relay",
    "switch mains",
    "single channel relay",
  ],
  name: "5 V single-channel relay module",
  category: "actuator",
  description:
    "Opto-isolated relay board with its own driver transistor and flyback diode. The coil draws far more current than a controller pin can supply, so the module is powered from a 5 V rail and only signalled by the controller.",
  electrical: {
    minimumSupplyVoltage: 4.75,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.25,
    logicVoltage: 5,
    typicalCurrentMa: 70,
    maximumCurrentMa: 90,
  },
  interfaces: ["digital"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-5v"], { maximumVoltage: 5.25 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("IN", "IN", "digital-input", ["digital-in"], { maximumVoltage: 5.25 }),
    pin("COM", "COM", "passive", ["switched-load", "optional"]),
    pin("NO", "NO", "passive", ["switched-load", "optional"]),
    pin("NC", "NC", "passive", ["switched-load", "optional"]),
  ],
  rules: { requiresFlybackDiode: false, requiresDriver: false },
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "svg",
    assetId: "module-relay",
    width: 130,
    height: 90,
    pinAnchors: {
      VCC: { x: 12, y: 86 },
      GND: { x: 34, y: 86 },
      IN: { x: 56, y: 86 },
      COM: { x: 126, y: 24 },
      NO: { x: 126, y: 44 },
      NC: { x: 126, y: 64 },
    },
  },
  estimatedUnitPrice: 3,
  substitutes: ["2-channel 5 V relay module", "Solid-state relay module"],
};

export const logicLevelConverter: ComponentDefinition = {
  id: "logic-level-converter",
  aliases: [
    "level shifter",
    "logic level converter",
    "logic level shifter",
    "level converter",
    "bidirectional level shifter",
    "voltage level shifter",
    "bss138 level shifter",
    "3.3v to 5v converter",
  ],
  name: "4-channel bidirectional logic level converter",
  category: "interface",
  description:
    "BSS138-based board that translates four signals between a low-voltage and a high-voltage domain in either direction, including I²C. Each channel carries its own pull-ups, so it also serves as the bus pull-up.",
  manufacturerPartNumber: "BSS138",
  electrical: {
    minimumSupplyVoltage: 1.8,
    typicalSupplyVoltage: 3.3,
    maximumSupplyVoltage: 5.5,
    typicalCurrentMa: 1,
    maximumCurrentMa: 3,
  },
  interfaces: ["digital", "i2c"],
  pins: [
    pin("LV", "LV", "power-input", ["supply-3v3", "low-side-reference"], { maximumVoltage: 5 }),
    pin("HV", "HV", "power-input", ["supply-5v", "high-side-reference"], { maximumVoltage: 5.5 }),
    pin("GNDL", "GND (LV side)", "ground", ["ground"]),
    pin("GNDH", "GND (HV side)", "ground", ["ground", "optional"]),
    ...[1, 2, 3, 4].flatMap((channel) => [
      pin(`LV${channel}`, `LV${channel}`, "digital-io", ["channel", "optional"], {
        maximumVoltage: 5,
      }),
      pin(`HV${channel}`, `HV${channel}`, "digital-io", ["channel", "optional"], {
        maximumVoltage: 5.5,
      }),
    ]),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "svg",
    assetId: "module-level-shifter",
    width: 110,
    height: 100,
    pinAnchors: {
      LV: { x: 6, y: 20 },
      GNDL: { x: 6, y: 34 },
      LV1: { x: 6, y: 48 },
      LV2: { x: 6, y: 62 },
      LV3: { x: 6, y: 76 },
      LV4: { x: 6, y: 90 },
      HV: { x: 104, y: 20 },
      GNDH: { x: 104, y: 34 },
      HV1: { x: 104, y: 48 },
      HV2: { x: 104, y: 62 },
      HV3: { x: 104, y: 76 },
      HV4: { x: 104, y: 90 },
    },
  },
  estimatedUnitPrice: 2,
  substitutes: ["TXS0108E 8-channel converter", "A resistor divider, for one 5 V output only"],
};

export const dcMotor5v: ComponentDefinition = {
  id: "dc-motor-5v",
  aliases: [
    "motor",
    "dc motor",
    "brushed motor",
    "hobby motor",
    "tt motor",
    "gear motor",
    "fan",
    "small motor",
  ],
  name: "5 V brushed DC motor",
  category: "actuator",
  description:
    "Small brushed DC motor of the kind found in hobby gearboxes and fans. It is an inductive load and draws far more than a controller pin can supply, so it is switched by a driver and needs a flyback path.",
  electrical: {
    minimumSupplyVoltage: 3,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 6,
    typicalCurrentMa: 200,
    maximumCurrentMa: 800,
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
  estimatedUnitPrice: 3,
  substitutes: ["N20 gear motor", "5 V computer fan (same wiring)"],
};

export const MODULE_DEFINITIONS: ComponentDefinition[] = [
  bme280,
  dht22,
  hcSr04,
  ssd1306Oled,
  sg90Servo,
  relayModule5v,
  logicLevelConverter,
  dcMotor5v,
];
