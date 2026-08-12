// Sensors beyond the original three.
//
// A module's supply window and its logic level are recorded separately: several
// of these carry an on-board regulator that accepts 5 V while their signals stay
// at 3.3 V, and that difference is what decides whether a level converter is
// needed on a given board.

import type { ComponentDefinition } from "../types.ts";
import { pin } from "./pin.ts";

export const bmp280: ComponentDefinition = {
  id: "bmp280",
  aliases: ["bmp280", "bmp 280", "pressure sensor", "barometer", "altitude sensor"],
  name: "BMP280 pressure and temperature sensor",
  category: "sensor",
  description:
    "I²C barometric pressure and temperature sensor. The same family as the BME280 without the humidity channel, and cheaper for it.",
  manufacturer: "Bosch Sensortec",
  manufacturerPartNumber: "BMP280",
  electrical: {
    minimumSupplyVoltage: 3,
    typicalSupplyVoltage: 3.3,
    maximumSupplyVoltage: 3.6,
    logicVoltage: 3.3,
    typicalCurrentMa: 0.5,
    maximumCurrentMa: 1,
  },
  interfaces: ["i2c", "spi"],
  pins: [
    pin("VIN", "VIN", "power-input", ["supply-3v3"], { maximumVoltage: 3.6 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("SCL", "SCL", "digital-io", ["i2c-scl"], { maximumVoltage: 3.6 }),
    pin("SDA", "SDA", "digital-io", ["i2c-sda"], { maximumVoltage: 3.6 }),
  ],
  rules: { requiresPullups: false, i2cAddresses: ["0x76", "0x77"] },
  firmware: {
    libraries: ["adafruit/Adafruit BMP280 Library", "adafruit/Adafruit Unified Sensor"],
    includeStatements: ["#include <Adafruit_BMP280.h>"],
  },
  visual: {
    renderer: "svg",
    assetId: "module-4pin",
    width: 84,
    height: 58,
    pinAnchors: {
      VIN: { x: 12, y: 54 },
      GND: { x: 32, y: 54 },
      SCL: { x: 52, y: 54 },
      SDA: { x: 72, y: 54 },
    },
  },
  estimatedUnitPrice: 4,
  substitutes: ["BME280 (adds humidity)", "BMP180 (older, lower resolution)"],
};

export const mpu6050: ComponentDefinition = {
  id: "mpu6050",
  aliases: [
    "mpu6050",
    "imu",
    "accelerometer",
    "gyroscope",
    "gyro",
    "orientation sensor",
    "6 axis sensor",
  ],
  name: "MPU-6050 6-axis accelerometer and gyroscope",
  category: "sensor",
  mechanical: {
    length: 21,
    width: 16,
    height: 4,
    notes:
      "Representative GY-521 MPU-6050 breakout envelope; measure the selected module and header stack before final CAD.",
    integration: ["Retain the PCB rigidly so enclosure movement is coupled to the measured motion."],
    functionalAxes: ["sensor-board X/Y/Z axes"],
    exposedRegions: ["header or cable exit"],
  },
  description:
    "Three axes of acceleration and three of rotation over I²C. The breakout regulates 5 V down for the chip, but its bus pins are 3.3 V.",
  manufacturer: "InvenSense",
  manufacturerPartNumber: "MPU-6050",
  electrical: {
    minimumSupplyVoltage: 3.3,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.5,
    logicVoltage: 3.3,
    typicalCurrentMa: 4,
    maximumCurrentMa: 6,
  },
  interfaces: ["i2c"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-3v3", "supply-5v"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("SDA", "SDA", "digital-io", ["i2c-sda"], { maximumVoltage: 3.6 }),
    pin("SCL", "SCL", "digital-io", ["i2c-scl"], { maximumVoltage: 3.6 }),
    pin("INT", "INT", "digital-output", ["interrupt", "optional"], { maximumVoltage: 3.6 }),
    pin("AD0", "AD0 (address select)", "digital-input", ["i2c-address-select", "optional"], {
      maximumVoltage: 3.6,
    }),
    pin("XCL", "XCL (aux clock)", "digital-io", ["optional"], { maximumVoltage: 3.6 }),
    pin("XDA", "XDA (aux data)", "digital-io", ["optional"], { maximumVoltage: 3.6 }),
  ],
  rules: { requiresPullups: false, i2cAddresses: ["0x68", "0x69"] },
  firmware: {
    libraries: ["adafruit/Adafruit MPU6050", "adafruit/Adafruit Unified Sensor"],
    includeStatements: ["#include <Adafruit_MPU6050.h>"],
  },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-mpu6050",
    width: 82,
    height: 61,
    pinAnchors: {
      INT: { x: 7.28, y: 5.78 },
      AD0: { x: 16.9, y: 5.78 },
      XCL: { x: 26.4, y: 5.78 },
      XDA: { x: 36, y: 5.78 },
      SDA: { x: 45.6, y: 5.78 },
      SCL: { x: 55.2, y: 5.78 },
      GND: { x: 64.8, y: 5.78 },
      VCC: { x: 74.4, y: 5.78 },
    },
  },
  estimatedUnitPrice: 3,
  substitutes: ["MPU-9250 (adds a magnetometer)", "LSM6DS3"],
};

export const bh1750: ComponentDefinition = {
  id: "bh1750",
  aliases: ["bh1750", "light sensor", "lux sensor", "ambient light sensor", "illuminance sensor"],
  name: "BH1750 ambient light sensor",
  category: "sensor",
  description:
    "I²C light sensor reading directly in lux, so no calibration curve is needed the way a bare photoresistor demands one.",
  manufacturer: "Rohm",
  manufacturerPartNumber: "BH1750FVI",
  electrical: {
    minimumSupplyVoltage: 2.4,
    typicalSupplyVoltage: 3.3,
    maximumSupplyVoltage: 3.6,
    logicVoltage: 3.3,
    typicalCurrentMa: 0.12,
    maximumCurrentMa: 0.19,
  },
  interfaces: ["i2c"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-3v3"], { maximumVoltage: 3.6 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("SDA", "SDA", "digital-io", ["i2c-sda"], { maximumVoltage: 3.6 }),
    pin("SCL", "SCL", "digital-io", ["i2c-scl"], { maximumVoltage: 3.6 }),
    pin("ADDR", "ADDR", "digital-input", ["i2c-address-select", "optional"], {
      maximumVoltage: 3.6,
    }),
  ],
  rules: { requiresPullups: false, i2cAddresses: ["0x23", "0x5C"] },
  firmware: {
    libraries: ["claws/BH1750"],
    includeStatements: ["#include <BH1750.h>"],
  },
  visual: {
    renderer: "svg",
    assetId: "module-4pin",
    width: 84,
    height: 58,
    pinAnchors: {
      VCC: { x: 12, y: 54 },
      GND: { x: 32, y: 54 },
      SDA: { x: 52, y: 54 },
      SCL: { x: 72, y: 54 },
      ADDR: { x: 80, y: 28 },
    },
  },
  estimatedUnitPrice: 3,
  substitutes: ["TSL2561", "VEML7700"],
};

export const ds1307Rtc: ComponentDefinition = {
  id: "ds1307-rtc",
  aliases: [
    "rtc",
    "real time clock",
    "clock module",
    "ds1307",
    "time keeping",
    "timekeeper",
  ],
  name: "DS1307 real-time clock",
  category: "sensor",
  description:
    "Battery-backed clock and calendar over I²C. It keeps time across power cuts from its own coin cell, which is what a project needs when it must know the date after being switched off.",
  manufacturer: "Maxim",
  manufacturerPartNumber: "DS1307",
  electrical: {
    minimumSupplyVoltage: 4.5,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.5,
    logicVoltage: 5,
    typicalCurrentMa: 1.5,
    maximumCurrentMa: 2,
  },
  interfaces: ["i2c"],
  pins: [
    pin("VCC", "5V", "power-input", ["supply-5v"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("SDA", "SDA", "digital-io", ["i2c-sda"], { maximumVoltage: 5.5 }),
    pin("SCL", "SCL", "digital-io", ["i2c-scl"], { maximumVoltage: 5.5 }),
    pin("SQW", "SQW", "digital-output", ["interrupt", "optional"], { maximumVoltage: 5.5 }),
  ],
  rules: { requiresPullups: false, i2cAddresses: ["0x68"] },
  firmware: {
    libraries: ["adafruit/RTClib"],
    includeStatements: ["#include <RTClib.h>"],
  },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-ds1307",
    width: 98,
    height: 84,
    pinAnchors: {
      GND: { x: 9.5, y: 15 },
      VCC: { x: 9.5, y: 25 },
      SDA: { x: 9.5, y: 34.5 },
      SCL: { x: 9.5, y: 44 },
      SQW: { x: 9.5, y: 54 },
    },
  },
  estimatedUnitPrice: 3,
  substitutes: ["DS3231 (far better drift, same wiring)", "PCF8523"],
};

export const ds18b20: ComponentDefinition = {
  id: "ds18b20",
  aliases: [
    "ds18b20",
    "one wire temperature sensor",
    "1-wire temperature",
    "waterproof temperature sensor",
    "probe temperature sensor",
  ],
  name: "DS18B20 1-Wire temperature sensor",
  category: "sensor",
  description:
    "Digital temperature sensor on a single data wire, sold bare or on a waterproof lead. Several can share one pin because each carries a unique address. The data line needs a pull-up.",
  manufacturer: "Maxim",
  manufacturerPartNumber: "DS18B20",
  electrical: {
    minimumSupplyVoltage: 3,
    typicalSupplyVoltage: 3.3,
    maximumSupplyVoltage: 5.5,
    typicalCurrentMa: 1.5,
    maximumCurrentMa: 1.5,
  },
  interfaces: ["one-wire"],
  pins: [
    pin("VDD", "VDD", "power-input", ["supply-3v3", "supply-5v"], { maximumVoltage: 5.5 }),
    pin("DQ", "DQ (data)", "open-drain", ["digital-data", "one-wire"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
  ],
  rules: { requiresPullups: true },
  firmware: {
    libraries: ["paulstoffregen/OneWire", "milesburton/DallasTemperature"],
    includeStatements: ["#include <OneWire.h>", "#include <DallasTemperature.h>"],
  },
  visual: {
    renderer: "svg",
    assetId: "to92",
    width: 46,
    height: 60,
    pinAnchors: {
      GND: { x: 11, y: 56 },
      DQ: { x: 24, y: 56 },
      VDD: { x: 37, y: 56 },
    },
  },
  estimatedUnitPrice: 2,
  substitutes: ["DHT22 (adds humidity, one reading every 2 s)", "LM35 (analog)"],
};

export const photoresistorModule: ComponentDefinition = {
  id: "photoresistor-module",
  aliases: [
    "photoresistor",
    "ldr",
    "light dependent resistor",
    "brightness sensor",
    "light level sensor",
  ],
  name: "Photoresistor light module",
  category: "sensor",
  description:
    "Light-dependent resistor on a carrier with a divider and a comparator, giving both a raw analog level and a threshold output set by its trimmer.",
  electrical: {
    minimumSupplyVoltage: 3.3,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.5,
    typicalCurrentMa: 3,
    maximumCurrentMa: 5,
  },
  interfaces: ["analog", "digital"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-3v3", "supply-5v"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("AO", "AO (analog)", "analog-output", ["analog-out"], { maximumVoltage: 5.5 }),
    pin("DO", "DO (threshold)", "digital-output", ["digital-out", "optional"], {
      maximumVoltage: 5.5,
    }),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-photoresistor-sensor",
    width: 174,
    height: 61,
    pinAnchors: {
      VCC: { x: 172, y: 16 },
      GND: { x: 172, y: 26 },
      DO: { x: 172, y: 35.8 },
      AO: { x: 172, y: 45.5 },
    },
  },
  estimatedUnitPrice: 1.5,
  substitutes: ["BH1750, for a reading in real units", "Bare LDR with a 10 kΩ divider"],
};

export const ntcThermistorModule: ComponentDefinition = {
  id: "ntc-thermistor-module",
  aliases: ["thermistor", "ntc", "analog temperature sensor", "temperature probe"],
  name: "NTC thermistor temperature module",
  category: "sensor",
  description:
    "Thermistor on a divider, read as an analog voltage. Cheap and fast, but the reading needs a Steinhart-Hart conversion in firmware rather than arriving in degrees.",
  electrical: {
    minimumSupplyVoltage: 3.3,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.5,
    typicalCurrentMa: 1,
    maximumCurrentMa: 2,
  },
  interfaces: ["analog"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-3v3", "supply-5v"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("OUT", "OUT", "analog-output", ["analog-out"], { maximumVoltage: 5.5 }),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-ntc-temperature-sensor",
    width: 135,
    height: 72,
    pinAnchors: {
      GND: { x: 135, y: 26.2 },
      VCC: { x: 135, y: 35.8 },
      OUT: { x: 135, y: 45.5 },
    },
  },
  estimatedUnitPrice: 1,
  substitutes: ["DS18B20, for a digital reading", "BME280"],
};

export const pirMotionSensor: ComponentDefinition = {
  id: "pir-motion",
  aliases: [
    "pir",
    "motion sensor",
    "movement sensor",
    "presence sensor",
    "hc-sr501",
    "occupancy sensor",
  ],
  name: "HC-SR501 PIR motion sensor",
  category: "sensor",
  description:
    "Passive infrared movement detector. Its output is a plain high while motion is seen, held for a time its own trimmer sets. The output swings to 3.3 V whatever the supply.",
  manufacturerPartNumber: "HC-SR501",
  electrical: {
    minimumSupplyVoltage: 4.5,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 12,
    logicVoltage: 3.3,
    typicalCurrentMa: 0.05,
    maximumCurrentMa: 1,
  },
  interfaces: ["digital"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-5v"], { maximumVoltage: 12 }),
    pin("OUT", "OUT", "digital-output", ["digital-out"], { maximumVoltage: 3.3 }),
    pin("GND", "GND", "ground", ["ground"]),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-pir-motion-sensor",
    width: 91,
    height: 92,
    pinAnchors: {
      VCC: { x: 36.2, y: 92 },
      OUT: { x: 45.9, y: 92 },
      GND: { x: 55.6, y: 92 },
    },
  },
  estimatedUnitPrice: 2,
  substitutes: ["RCWL-0516 microwave sensor", "HC-SR04, for distance instead of motion"],
};

export const irReceiver: ComponentDefinition = {
  id: "ir-receiver",
  aliases: [
    "ir receiver",
    "infrared receiver",
    "remote control receiver",
    "vs1838b",
    "tsop",
    "ir sensor",
  ],
  name: "VS1838B infrared receiver",
  category: "sensor",
  description:
    "Demodulating 38 kHz infrared receiver, the part that lets a project take orders from an ordinary remote control. Its output idles high and pulses low.",
  manufacturerPartNumber: "VS1838B",
  electrical: {
    minimumSupplyVoltage: 2.7,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.5,
    typicalCurrentMa: 1.5,
    maximumCurrentMa: 3,
  },
  interfaces: ["digital"],
  pins: [
    pin("DAT", "OUT", "digital-output", ["digital-out"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("VCC", "VCC", "power-input", ["supply-3v3", "supply-5v"], { maximumVoltage: 5.5 }),
  ],
  rules: {},
  firmware: {
    libraries: ["z3t0/IRremote"],
    includeStatements: ["#include <IRremote.hpp>"],
  },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-ir-receiver",
    width: 61,
    height: 89,
    pinAnchors: {
      GND: { x: 21, y: 87.75 },
      VCC: { x: 30.6, y: 87.75 },
      DAT: { x: 40.2, y: 87.75 },
    },
  },
  estimatedUnitPrice: 1,
  substitutes: ["TSOP4838", "Any 38 kHz IR receiver module"],
};

export const mq2GasSensor: ComponentDefinition = {
  id: "mq2-gas-sensor",
  aliases: [
    "gas sensor",
    "smoke sensor",
    "mq2",
    "mq-2",
    "lpg sensor",
    "combustible gas sensor",
  ],
  name: "MQ-2 gas and smoke sensor",
  category: "sensor",
  description:
    "Heated metal-oxide sensor for smoke, LPG and other combustible gases. The heater is most of its current draw and it needs several minutes to settle before its reading means anything.",
  manufacturerPartNumber: "MQ-2",
  electrical: {
    minimumSupplyVoltage: 4.9,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.1,
    logicVoltage: 5,
    // The heater alone is 150 mA and runs continuously.
    typicalCurrentMa: 150,
    maximumCurrentMa: 180,
  },
  interfaces: ["analog", "digital"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-5v"], { maximumVoltage: 5.1 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("AOUT", "AOUT", "analog-output", ["analog-out"], { maximumVoltage: 5 }),
    pin("DOUT", "DOUT (threshold)", "digital-output", ["digital-out", "optional"], {
      maximumVoltage: 5,
    }),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-gas-sensor",
    width: 137,
    height: 63,
    pinAnchors: {
      AOUT: { x: 137, y: 16.5 },
      DOUT: { x: 137, y: 26.4 },
      GND: { x: 137, y: 36.5 },
      VCC: { x: 137, y: 46.2 },
    },
  },
  estimatedUnitPrice: 3,
  substitutes: ["MQ-135 for air quality", "A certified smoke alarm, if life safety matters"],
};

export const soundSensor: ComponentDefinition = {
  id: "sound-sensor",
  aliases: ["sound sensor", "microphone module", "noise sensor", "clap sensor", "audio sensor"],
  name: "Electret sound level module",
  category: "sensor",
  description:
    "Electret microphone with an amplifier and a comparator. It reports loudness, not audio: it is right for clap detection and noise thresholds, not for recording.",
  electrical: {
    minimumSupplyVoltage: 3.3,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.5,
    typicalCurrentMa: 5,
    maximumCurrentMa: 8,
  },
  interfaces: ["analog", "digital"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-3v3", "supply-5v"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("AOUT", "AOUT", "analog-output", ["analog-out"], { maximumVoltage: 5.5 }),
    pin("DOUT", "DOUT (threshold)", "digital-output", ["digital-out", "optional"], {
      maximumVoltage: 5.5,
    }),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-small-sound-sensor",
    width: 133,
    height: 50,
    pinAnchors: {
      AOUT: { x: 0, y: 11 },
      GND: { x: 0, y: 20.5 },
      VCC: { x: 0, y: 30.5 },
      DOUT: { x: 0, y: 40.5 },
    },
  },
  estimatedUnitPrice: 2,
  substitutes: ["MAX9814 with AGC", "INMP441 I²S microphone, for real audio"],
};

export const hx711LoadCell: ComponentDefinition = {
  id: "hx711-load-cell",
  aliases: [
    "load cell",
    "weight sensor",
    "scale",
    "hx711",
    "strain gauge",
    "force sensor",
  ],
  name: "HX711 load cell amplifier",
  category: "sensor",
  description:
    "24-bit amplifier for a strain-gauge load cell, read over its own two-wire clock and data protocol. A scale needs this board plus a load cell, and a calibration factor found by weighing something known.",
  manufacturerPartNumber: "HX711",
  electrical: {
    minimumSupplyVoltage: 2.7,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.5,
    typicalCurrentMa: 1.5,
    maximumCurrentMa: 2,
  },
  interfaces: ["digital"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-3v3", "supply-5v"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("DT", "DT (data)", "digital-output", ["digital-out"], { maximumVoltage: 5.5 }),
    pin("SCK", "SCK (clock)", "digital-input", ["digital-in", "clock"], { maximumVoltage: 5.5 }),
  ],
  rules: {},
  firmware: {
    libraries: ["bogde/HX711"],
    includeStatements: ["#include <HX711.h>"],
  },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-hx711",
    width: 57,
    height: 62,
    pinAnchors: {
      GND: { x: 7, y: 26.5 },
      DT: { x: 7, y: 36.3 },
      SCK: { x: 7, y: 46.2 },
      VCC: { x: 7, y: 55 },
    },
  },
  estimatedUnitPrice: 3,
  substitutes: ["NAU7802 (I²C)", "A finished digital scale module"],
};

export const tiltSwitchModule: ComponentDefinition = {
  id: "tilt-switch-module",
  aliases: ["tilt switch", "tilt sensor", "vibration switch", "shake sensor"],
  name: "Ball tilt switch module",
  category: "sensor",
  description:
    "A rolling ball closing a contact when the board is tipped, buffered into a clean digital output. It reports tipped or not, never an angle.",
  electrical: {
    minimumSupplyVoltage: 3.3,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.5,
    typicalCurrentMa: 3,
    maximumCurrentMa: 5,
  },
  interfaces: ["digital"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-3v3", "supply-5v"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("OUT", "OUT", "digital-output", ["digital-out"], { maximumVoltage: 5.5 }),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-tilt-switch",
    width: 88,
    height: 56,
    pinAnchors: {
      GND: { x: 88, y: 18 },
      VCC: { x: 88, y: 27.8 },
      OUT: { x: 88, y: 37.5 },
    },
  },
  estimatedUnitPrice: 1,
  substitutes: ["MPU-6050, for a real angle", "SW-420 vibration module"],
};

export const SENSOR_DEFINITIONS: ComponentDefinition[] = [
  bmp280,
  mpu6050,
  bh1750,
  ds1307Rtc,
  ds18b20,
  photoresistorModule,
  ntcThermistorModule,
  pirMotionSensor,
  irReceiver,
  mq2GasSensor,
  soundSensor,
  hx711LoadCell,
  tiltSwitchModule,
];
