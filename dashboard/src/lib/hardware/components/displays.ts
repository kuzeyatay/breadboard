// Displays and light output.
//
// Every figure comes from the module's own documentation. Where a module varies
// by variant — an OLED that takes 3.3 V or 5 V, a TFT with an on-board
// regulator — the entry says which variant it describes.

import type { ComponentDefinition } from "../types.ts";
import { pin } from "./pin.ts";

export const lcd1602I2c: ComponentDefinition = {
  id: "lcd1602-i2c",
  aliases: [
    "lcd",
    "lcd display",
    "16x2 lcd",
    "1602 lcd",
    "character display",
    "text display",
    "hd44780",
    "i2c lcd",
  ],
  name: "16×2 character LCD with I²C backpack",
  category: "display",
  description:
    "Two lines of sixteen characters behind a PCF8574 I²C backpack, so it needs two signal wires instead of the bare panel's six. The backlight is most of its current draw.",
  manufacturerPartNumber: "HD44780 + PCF8574",
  electrical: {
    minimumSupplyVoltage: 4.7,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.5,
    logicVoltage: 5,
    typicalCurrentMa: 25,
    maximumCurrentMa: 40,
  },
  interfaces: ["i2c"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-5v"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("SDA", "SDA", "digital-io", ["i2c-sda"], { maximumVoltage: 5.5 }),
    pin("SCL", "SCL", "digital-io", ["i2c-scl"], { maximumVoltage: 5.5 }),
  ],
  rules: { requiresPullups: false, i2cAddresses: ["0x27", "0x3F"] },
  firmware: {
    libraries: ["marcoschwartz/LiquidCrystal_I2C"],
    includeStatements: ["#include <LiquidCrystal_I2C.h>"],
  },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-lcd1602",
    width: 302,
    height: 136,
    pinAnchors: {
      GND: { x: 4, y: 32 },
      VCC: { x: 4, y: 41.5 },
      SDA: { x: 4, y: 51 },
      SCL: { x: 4, y: 60.5 },
    },
  },
  estimatedUnitPrice: 5,
  substitutes: ["20×4 character LCD with the same backpack", "SSD1306 OLED"],
};

export const ws2812bPixel: ComponentDefinition = {
  id: "ws2812b-pixel",
  aliases: [
    "neopixel",
    "ws2812b",
    "ws2812",
    "addressable led",
    "rgb led strip",
    "led strip",
    "smart led",
  ],
  name: "WS2812B addressable RGB LED",
  category: "indicator",
  description:
    "One addressable RGB LED with its controller built in. Chained through DOUT to the next pixel's DIN, so a strip is this part repeated. Its data input expects a high above 0.7 × VDD, which a 3.3 V board does not reach at 5 V supply.",
  manufacturerPartNumber: "WS2812B",
  electrical: {
    minimumSupplyVoltage: 3.5,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.5,
    logicVoltage: 5,
    // Full white on all three channels is 60 mA; a typical mixed colour at
    // moderate brightness is nearer 20.
    typicalCurrentMa: 20,
    maximumCurrentMa: 60,
  },
  interfaces: ["digital"],
  pins: [
    pin("VDD", "VDD (5 V)", "power-input", ["supply-5v"], { maximumVoltage: 5.5 }),
    pin("VSS", "VSS (GND)", "ground", ["ground"]),
    pin("DIN", "DIN", "digital-input", ["digital-in", "data"], { maximumVoltage: 5.5 }),
    pin("DOUT", "DOUT (to next pixel)", "digital-output", ["digital-out", "optional"], {
      maximumVoltage: 5.5,
    }),
  ],
  // A bulk capacitor across the supply is what stops the first pixel latching
  // up when the strip switches on.
  rules: { requiresDecoupling: true },
  firmware: {
    libraries: ["adafruit/Adafruit NeoPixel"],
    includeStatements: ["#include <Adafruit_NeoPixel.h>"],
  },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-neopixel",
    width: 21,
    height: 19,
    pinAnchors: {
      VDD: { x: 1, y: 3.5 },
      DOUT: { x: 1, y: 14 },
      VSS: { x: 21, y: 14 },
      DIN: { x: 21, y: 3.5 },
    },
  },
  estimatedUnitPrice: 0.4,
  substitutes: ["SK6812 (adds a white channel)", "APA102, if you would rather use SPI"],
};

export const rgbLed: ComponentDefinition = {
  id: "rgb-led",
  aliases: ["rgb led", "colour led", "color led", "tricolour led", "multicolour led"],
  name: "5 mm common-cathode RGB LED",
  category: "indicator",
  description:
    "Three LEDs in one package sharing a cathode. Each colour needs its own series resistor, and each has a different forward voltage, so they are not interchangeable in one calculation.",
  electrical: {
    // The red die's forward drop. Green and blue sit near 3.0 V, which is why
    // the same resistor gives a different brightness on each channel.
    typicalSupplyVoltage: 2,
    typicalCurrentMa: 20,
    maximumCurrentMa: 60,
  },
  interfaces: ["digital"],
  pins: [
    pin("R", "Red anode", "passive", ["anode"], { maximumCurrentMa: 20 }),
    pin("G", "Green anode", "passive", ["anode"], { maximumCurrentMa: 20 }),
    pin("B", "Blue anode", "passive", ["anode"], { maximumCurrentMa: 20 }),
    pin("COM", "Common cathode", "passive", ["cathode"], { maximumCurrentMa: 60 }),
  ],
  rules: { requiresCurrentLimiting: true },
  firmware: { libraries: [], includeStatements: [] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-rgb-led",
    width: 46,
    height: 62,
    pinAnchors: {
      R: { x: 8.5, y: 44 },
      COM: { x: 18, y: 54 },
      G: { x: 26.4, y: 44 },
      B: { x: 35.7, y: 44 },
    },
  },
  estimatedUnitPrice: 0.3,
  substitutes: ["Common-anode RGB LED (inverted firmware)", "WS2812B, for one data wire"],
};

export const ili9341Tft: ComponentDefinition = {
  id: "ili9341-tft",
  aliases: [
    "tft",
    "tft display",
    "colour display",
    "color screen",
    "ili9341",
    "2.4 tft",
    "spi display",
    "graphical display",
  ],
  name: "2.8\" 240×320 SPI TFT (ILI9341)",
  category: "display",
  description:
    "Colour graphical display on the SPI bus. The board carries a regulator so it accepts 5 V, but its logic and its backlight pin are 3.3 V.",
  manufacturerPartNumber: "ILI9341",
  electrical: {
    minimumSupplyVoltage: 3.3,
    typicalSupplyVoltage: 3.3,
    maximumSupplyVoltage: 5.5,
    logicVoltage: 3.3,
    typicalCurrentMa: 80,
    maximumCurrentMa: 120,
  },
  interfaces: ["spi"],
  pins: [
    pin("VCC", "VCC", "power-input", ["supply-3v3", "supply-5v"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("CS", "CS", "digital-input", ["spi-cs"], { maximumVoltage: 3.6 }),
    pin("RST", "RESET", "digital-input", ["reset", "optional"], { maximumVoltage: 3.6 }),
    pin("DC", "D/C", "digital-input", ["digital-in", "data-command"], { maximumVoltage: 3.6 }),
    pin("MOSI", "MOSI", "digital-input", ["spi-mosi"], { maximumVoltage: 3.6 }),
    pin("SCK", "SCK", "digital-input", ["spi-sck"], { maximumVoltage: 3.6 }),
    pin("MISO", "MISO", "digital-output", ["spi-miso"], { maximumVoltage: 3.6 }),
    // Tie the backlight anode to 3.3 V for an always-on screen, or drive it
    // from a PWM pin to dim it.
    pin("LED", "LED (backlight)", "passive", ["backlight", "optional"], {
      maximumVoltage: 3.6,
    }),
  ],
  rules: {},
  firmware: {
    libraries: ["adafruit/Adafruit ILI9341", "adafruit/Adafruit GFX Library"],
    includeStatements: ["#include <Adafruit_ILI9341.h>", "#include <Adafruit_GFX.h>"],
  },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-ili9341",
    width: 176,
    height: 293,
    pinAnchors: {
      VCC: { x: 48.3, y: 287.2 },
      GND: { x: 57.9, y: 287.2 },
      CS: { x: 67.5, y: 287.2 },
      RST: { x: 77.1, y: 287.2 },
      DC: { x: 86.7, y: 287.2 },
      MOSI: { x: 96.3, y: 287.2 },
      SCK: { x: 105.9, y: 287.2 },
      LED: { x: 115.5, y: 287.2 },
      MISO: { x: 125.1, y: 287.2 },
    },
  },
  estimatedUnitPrice: 9,
  substitutes: ["ST7735 1.8\" TFT", "SSD1306 OLED, for text only"],
};

export const epaper29: ComponentDefinition = {
  id: "epaper-2in9",
  aliases: [
    "e-paper",
    "epaper",
    "e-ink",
    "eink",
    "electronic paper",
    "e paper display",
    "eink screen",
    "reader display",
  ],
  name: "2.9\" e-paper display (SSD1680)",
  category: "display",
  description:
    "Monochrome electrophoretic panel on SPI. It draws current only while the image changes and nothing at all once the page is on screen, which is what makes it right for a battery-powered reader. A full refresh takes about two seconds.",
  manufacturer: "Waveshare (module)",
  manufacturerPartNumber: "SSD1680",
  electrical: {
    minimumSupplyVoltage: 2.3,
    typicalSupplyVoltage: 3.3,
    maximumSupplyVoltage: 3.6,
    logicVoltage: 3.3,
    // While refreshing. Holding an image costs effectively nothing.
    typicalCurrentMa: 26,
    maximumCurrentMa: 40,
  },
  interfaces: ["spi"],
  pins: [
    pin("VCC", "VCC (3.3 V)", "power-input", ["supply-3v3"], { maximumVoltage: 3.6 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("DIN", "DIN (MOSI)", "digital-input", ["spi-mosi"], { maximumVoltage: 3.6 }),
    pin("CLK", "CLK (SCK)", "digital-input", ["spi-sck"], { maximumVoltage: 3.6 }),
    pin("CS", "CS", "digital-input", ["spi-cs"], { maximumVoltage: 3.6 }),
    pin("DC", "D/C", "digital-input", ["digital-in", "data-command"], { maximumVoltage: 3.6 }),
    pin("RST", "RESET", "digital-input", ["reset"], { maximumVoltage: 3.6 }),
    pin("BUSY", "BUSY", "digital-output", ["digital-out", "status"], { maximumVoltage: 3.6 }),
  ],
  rules: {},
  firmware: {
    libraries: ["zinggjm/GxEPD2", "adafruit/Adafruit GFX Library"],
    includeStatements: ["#include <GxEPD2_BW.h>"],
  },
  visual: {
    renderer: "svg",
    assetId: "epaper",
    width: 190,
    height: 120,
    pinAnchors: {
      VCC: { x: 10, y: 114 },
      GND: { x: 32, y: 114 },
      DIN: { x: 54, y: 114 },
      CLK: { x: 76, y: 114 },
      CS: { x: 98, y: 114 },
      DC: { x: 120, y: 114 },
      RST: { x: 142, y: 114 },
      BUSY: { x: 164, y: 114 },
    },
  },
  estimatedUnitPrice: 18,
  substitutes: ["4.2\" e-paper (same interface)", "2.13\" e-paper"],
};

export const DISPLAY_DEFINITIONS: ComponentDefinition[] = [
  lcd1602I2c,
  ws2812bPixel,
  rgbLed,
  ili9341Tft,
  epaper29,
];
