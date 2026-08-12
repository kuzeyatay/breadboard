// Radios, storage and other modules a project talks to over a bus.
//
// Several of these are 3.3 V parts sold with a 5 V-friendly supply pin, which
// is exactly the case that decides whether a level converter is needed. Their
// supply window and their logic level are therefore recorded separately.

import type { ComponentDefinition } from "../types.ts";
import { pin } from "./pin.ts";

export const microSdModule: ComponentDefinition = {
  id: "microsd-module",
  aliases: [
    "sd card",
    "micro sd",
    "microsd",
    "sd card module",
    "card reader",
    "storage",
    "memory card",
  ],
  name: "microSD card module",
  category: "storage",
  description:
    "SPI card socket on a carrier with its own 3.3 V regulator and a 74LVC125 buffer on the signals. The buffer takes 3.3 V or 5 V logic, so the same module works on either kind of board. Cards are read and written as a FAT filesystem.",
  electrical: {
    minimumSupplyVoltage: 4.5,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.5,
    // The buffer's inputs are low-voltage CMOS: 3.3 V is a solid high for it
    // even while the socket itself runs from 5 V.
    logicVoltage: 3.3,
    typicalCurrentMa: 30,
    maximumCurrentMa: 100,
  },
  interfaces: ["spi"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-5v"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("CS", "CS", "digital-input", ["spi-cs"], { maximumVoltage: 5.5 }),
    pin("SCK", "SCK", "digital-input", ["spi-sck"], { maximumVoltage: 5.5 }),
    pin("DI", "MOSI", "digital-input", ["spi-mosi"], { maximumVoltage: 5.5 }),
    pin("DO", "MISO", "digital-output", ["spi-miso"], { maximumVoltage: 5.5 }),
    pin("CD", "CD (card detect)", "digital-output", ["digital-out", "optional"], {
      maximumVoltage: 5.5,
    }),
  ],
  rules: {},
  firmware: {
    libraries: [],
    includeStatements: ["#include <SPI.h>", "#include <SD.h>"],
  },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-microsd-card",
    width: 82,
    height: 77,
    pinAnchors: {
      CD: { x: 76.7, y: 9.4 },
      DO: { x: 76.7, y: 18.9 },
      GND: { x: 76.7, y: 28.5 },
      SCK: { x: 76.7, y: 38.2 },
      VCC: { x: 76.7, y: 47.6 },
      DI: { x: 76.7, y: 57.5 },
      CS: { x: 76.7, y: 66.9 },
    },
  },
  estimatedUnitPrice: 3,
  substitutes: ["A 3.3 V-only microSD breakout", "SPI flash chip, for smaller storage"],
};

export const rc522Rfid: ComponentDefinition = {
  id: "rc522-rfid",
  aliases: ["rfid", "rc522", "nfc reader", "card reader rfid", "tag reader", "mifare"],
  name: "MFRC522 RFID reader",
  category: "sensor",
  description:
    "13.56 MHz reader for MIFARE cards and tags, on SPI. It is 3.3 V only — its supply pin has no regulator behind it, so 5 V destroys it.",
  manufacturer: "NXP",
  manufacturerPartNumber: "MFRC522",
  electrical: {
    minimumSupplyVoltage: 2.5,
    typicalSupplyVoltage: 3.3,
    maximumSupplyVoltage: 3.6,
    logicVoltage: 3.3,
    typicalCurrentMa: 26,
    maximumCurrentMa: 100,
  },
  interfaces: ["spi"],
  pins: [
    pin("VCC", "3.3V", "power-input", ["supply-3v3"], { maximumVoltage: 3.6 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("SDA", "SDA (CS)", "digital-input", ["spi-cs"], { maximumVoltage: 3.6 }),
    pin("SCK", "SCK", "digital-input", ["spi-sck"], { maximumVoltage: 3.6 }),
    pin("MOSI", "MOSI", "digital-input", ["spi-mosi"], { maximumVoltage: 3.6 }),
    pin("MISO", "MISO", "digital-output", ["spi-miso"], { maximumVoltage: 3.6 }),
    pin("RST", "RST", "digital-input", ["reset"], { maximumVoltage: 3.6 }),
    pin("IRQ", "IRQ", "digital-output", ["interrupt", "optional"], { maximumVoltage: 3.6 }),
  ],
  rules: {},
  firmware: {
    libraries: ["miguelbalboa/MFRC522"],
    includeStatements: ["#include <SPI.h>", "#include <MFRC522.h>"],
  },
  visual: {
    renderer: "svg",
    assetId: "module-8pin",
    width: 150,
    height: 96,
    pinAnchors: {
      VCC: { x: 12, y: 92 },
      RST: { x: 31, y: 92 },
      GND: { x: 50, y: 92 },
      IRQ: { x: 69, y: 92 },
      MISO: { x: 88, y: 92 },
      MOSI: { x: 107, y: 92 },
      SCK: { x: 126, y: 92 },
      SDA: { x: 143, y: 92 },
    },
  },
  estimatedUnitPrice: 3,
  substitutes: ["PN532 (adds NFC phone support)", "125 kHz RDM6300 reader"],
};

export const hc05Bluetooth: ComponentDefinition = {
  id: "hc-05-bluetooth",
  aliases: [
    "bluetooth",
    "bluetooth module",
    "hc-05",
    "hc05",
    "serial bluetooth",
    "wireless serial",
  ],
  name: "HC-05 Bluetooth serial module",
  category: "communication",
  description:
    "Classic Bluetooth acting as a wireless serial cable, so a phone or laptop appears as a serial port. Its supply pin takes 5 V through an on-board regulator, but its receive pin is 3.3 V only.",
  manufacturerPartNumber: "HC-05",
  electrical: {
    minimumSupplyVoltage: 3.6,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 6,
    logicVoltage: 3.3,
    typicalCurrentMa: 30,
    maximumCurrentMa: 40,
  },
  interfaces: ["uart", "bluetooth"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-5v"], { maximumVoltage: 6 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("RXD", "RXD", "digital-input", ["uart-rx"], { maximumVoltage: 3.6 }),
    pin("TXD", "TXD", "digital-output", ["uart-tx"], { maximumVoltage: 3.6 }),
    pin("EN", "EN / KEY", "digital-input", ["enable", "optional"], { maximumVoltage: 3.6 }),
    pin("STATE", "STATE", "digital-output", ["status", "optional"], { maximumVoltage: 3.6 }),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "svg",
    assetId: "module-6pin",
    width: 130,
    height: 88,
    pinAnchors: {
      STATE: { x: 12, y: 84 },
      RXD: { x: 34, y: 84 },
      TXD: { x: 56, y: 84 },
      GND: { x: 78, y: 84 },
      VCC: { x: 100, y: 84 },
      EN: { x: 122, y: 84 },
    },
  },
  estimatedUnitPrice: 5,
  substitutes: ["HC-06 (slave only)", "An ESP32's built-in Bluetooth, with no extra part"],
};

export const neo6mGps: ComponentDefinition = {
  id: "neo-6m-gps",
  aliases: ["gps", "gps module", "neo-6m", "location module", "gnss", "satellite positioning"],
  name: "NEO-6M GPS receiver",
  category: "sensor",
  description:
    "Satellite positioning receiver that streams NMEA sentences over serial once a second. It needs a clear view of the sky and takes a minute or so to get a first fix from cold.",
  manufacturer: "u-blox",
  manufacturerPartNumber: "NEO-6M",
  electrical: {
    minimumSupplyVoltage: 3.3,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.5,
    logicVoltage: 3.3,
    typicalCurrentMa: 45,
    maximumCurrentMa: 67,
  },
  interfaces: ["uart"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-3v3", "supply-5v"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("TX", "TX", "digital-output", ["uart-tx"], { maximumVoltage: 3.6 }),
    pin("RX", "RX", "digital-input", ["uart-rx"], { maximumVoltage: 3.6 }),
    pin("PPS", "PPS", "digital-output", ["status", "optional"], { maximumVoltage: 3.6 }),
  ],
  rules: {},
  firmware: {
    libraries: ["mikalhart/TinyGPSPlus"],
    includeStatements: ["#include <TinyGPSPlus.h>"],
  },
  visual: {
    renderer: "svg",
    assetId: "module-5pin",
    width: 120,
    height: 90,
    pinAnchors: {
      VCC: { x: 14, y: 86 },
      RX: { x: 38, y: 86 },
      TX: { x: 62, y: 86 },
      GND: { x: 86, y: 86 },
      PPS: { x: 110, y: 86 },
    },
  },
  estimatedUnitPrice: 12,
  substitutes: ["NEO-M8N (faster fix)", "A phone's GPS over Bluetooth"],
};

export const dfPlayerMini: ComponentDefinition = {
  id: "dfplayer-mini",
  aliases: [
    "mp3 player",
    "dfplayer",
    "audio module",
    "sound player",
    "music module",
    "voice module",
  ],
  name: "DFPlayer Mini MP3 module",
  category: "actuator",
  description:
    "Plays MP3 and WAV files from its own microSD card, driven by short serial commands, and has an amplifier on board for a small speaker. Its receive pin is 3.3 V and normally wants a resistor in series even from a 3.3 V board.",
  manufacturerPartNumber: "DFPlayer Mini",
  electrical: {
    minimumSupplyVoltage: 3.2,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.5,
    logicVoltage: 3.3,
    typicalCurrentMa: 20,
    maximumCurrentMa: 200,
  },
  interfaces: ["uart"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-5v"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("RX", "RX", "digital-input", ["uart-rx"], { maximumVoltage: 3.6 }),
    pin("TX", "TX", "digital-output", ["uart-tx"], { maximumVoltage: 3.6 }),
    pin("SPK1", "SPK1", "analog-output", ["speaker", "optional"]),
    pin("SPK2", "SPK2", "analog-output", ["speaker", "optional"]),
  ],
  rules: {},
  firmware: {
    libraries: ["dfrobot/DFRobotDFPlayerMini"],
    includeStatements: ["#include <DFRobotDFPlayerMini.h>"],
  },
  visual: {
    renderer: "svg",
    assetId: "module-6pin",
    width: 120,
    height: 84,
    pinAnchors: {
      VCC: { x: 12, y: 80 },
      RX: { x: 33, y: 80 },
      TX: { x: 54, y: 80 },
      GND: { x: 75, y: 80 },
      SPK1: { x: 96, y: 80 },
      SPK2: { x: 116, y: 80 },
    },
  },
  estimatedUnitPrice: 5,
  substitutes: ["A passive buzzer, for tones rather than speech", "I²S DAC with an amplifier"],
};

export const COMMS_DEFINITIONS: ComponentDefinition[] = [
  microSdModule,
  rc522Rfid,
  hc05Bluetooth,
  neo6mGps,
  dfPlayerMini,
];
