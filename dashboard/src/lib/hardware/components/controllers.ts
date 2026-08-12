// Controller boards.
//
// Every figure here is source-controlled and comes from the board's own
// documentation. Where a defensible number does not exist the field is left
// undefined on purpose: the validator raises UNKNOWN_ELECTRICAL_VALUE rather
// than letting an invented number look authoritative.
//
// Pin anchors are in the same pixel space the wiring view draws in. For boards
// rendered with a Wokwi element the anchors are the element's own pin
// coordinates, so a wire endpoint lands exactly on the drawn header.

import type { ComponentDefinition, ComponentPin, ControllerProfile } from "../types.ts";

function pin(
  id: string,
  label: string,
  electricalType: ComponentPin["electricalType"],
  functions: string[],
  extra: Partial<Pick<ComponentPin, "maximumVoltage" | "maximumCurrentMa">> = {},
): ComponentPin {
  return { id, label, electricalType, functions, ...extra };
}

// ---------------------------------------------------------------------------
// Seeed Studio XIAO ESP32C3
// ---------------------------------------------------------------------------

/**
 * The XIAO labels are the stable Arduino-facing names printed on the board;
 * the GPIO number remains in the label so a wiring table does not hide which
 * ESP32-C3 pad is actually being used.
 */
const xiaoDigital = (
  id: string,
  gpio: number,
  extraFunctions: string[] = [],
  electricalType: ComponentPin["electricalType"] = "digital-io",
) =>
  pin(id, `${id} / GPIO${gpio}`, electricalType, ["gpio", "pwm", ...extraFunctions], {
    maximumVoltage: 3.3,
    // 20 mA is deliberately below the ESP32-C3's characterised high-drive
    // source/sink figures. Loads above this belong behind a driver anyway.
    maximumCurrentMa: 20,
  });

export const seeedXiaoEsp32C3: ComponentDefinition = {
  id: "seeed-xiao-esp32c3",
  aliases: [
    "xiao esp32c3",
    "xiao esp32 c3",
    "seeed xiao esp32c3",
    "seeed studio xiao esp32c3",
    "esp32-c3 xiao",
    "compact wifi bluetooth board",
  ],
  name: "Seeed Studio XIAO ESP32C3",
  category: "controller",
  description:
    "21 x 17.8 mm ESP32-C3 development board with USB-C, 2.4 GHz Wi-Fi, Bluetooth Low Energy 5, a single-cell lithium battery input and 3.3 V logic.",
  manufacturer: "Seeed Studio",
  electrical: {
    // Seeed documents 5 V at VBUS and a nominal 3.7 V lithium-cell input.
    minimumSupplyVoltage: 3.7,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5,
    logicVoltage: 3.3,
    // Seeed's board measurements give about 75 mA with Wi-Fi active. The
    // maximum is the ESP32-C3's documented 802.11b transmit peak, so power
    // sizing does not mistake an average for a worst case.
    typicalCurrentMa: 75,
    maximumCurrentMa: 335,
  },
  interfaces: ["i2c", "spi", "uart", "wifi", "bluetooth", "usb"],
  pins: [
    // BAT is a pair of underside pads rather than a castellated edge pin, but
    // it is the documented 3.7 V battery input and must be represented for a
    // portable design to connect its cell to the correct place.
    pin("BAT", "BAT (underside pad)", "power-input", ["supply-vin", "battery-input"], {
      maximumVoltage: 4.2,
    }),
    pin("5V", "5V / VBUS", "power-input", ["supply-vin", "supply-5v"], {
      maximumVoltage: 5,
      maximumCurrentMa: 500,
    }),
    pin("3V3", "3V3", "power-output", ["supply-3v3"], {
      maximumVoltage: 3.3,
      maximumCurrentMa: 500,
    }),
    pin("GND", "GND", "ground", ["ground"]),
    xiaoDigital("D0", 2, ["adc", "boot-strap"]),
    xiaoDigital("D1", 3, ["adc"]),
    xiaoDigital("D2", 4, ["adc"]),
    xiaoDigital("D3", 5, ["adc"]),
    xiaoDigital("D4", 6, ["i2c-sda"]),
    xiaoDigital("D5", 7, ["i2c-scl"]),
    xiaoDigital("D6", 21, ["uart-tx"]),
    xiaoDigital("D7", 20, ["uart-rx"]),
    xiaoDigital("D8", 8, ["spi-sck", "boot-strap"]),
    xiaoDigital("D9", 9, ["spi-miso", "boot-strap"]),
    xiaoDigital("D10", 10, ["spi-mosi", "spi-cs"]),
  ],
  rules: { requiresDecoupling: false },
  firmware: { libraries: [], includeStatements: ["#include <Arduino.h>"] },
  visual: {
    renderer: "svg",
    assetId: "board-dip",
    width: 100,
    height: 130,
    pinAnchors: {
      D0: { x: 5, y: 19 },
      D1: { x: 5, y: 34 },
      D2: { x: 5, y: 49 },
      D3: { x: 5, y: 64 },
      D4: { x: 5, y: 79 },
      D5: { x: 5, y: 94 },
      D6: { x: 5, y: 109 },
      D10: { x: 95, y: 19 },
      D9: { x: 95, y: 34 },
      D8: { x: 95, y: 49 },
      "3V3": { x: 95, y: 64 },
      GND: { x: 95, y: 79 },
      "5V": { x: 95, y: 94 },
      D7: { x: 95, y: 109 },
      BAT: { x: 50, y: 125 },
    },
  },
  mechanical: {
    length: 21,
    width: 17.8,
    height: 4,
    notes:
      "Seeed publishes the 21 x 17.8 mm plan size. The 4 mm height is a conservative enclosure allowance, not a published measured height.",
  },
  substitutes: ["Seeed Studio XIAO ESP32S3", "ESP32-C3 SuperMini"],
};

export const seeedXiaoEsp32C3Profile: ControllerProfile = {
  definitionId: seeedXiaoEsp32C3.id,
  logicVoltage: 3.3,
  rails: [
    { pinId: "3V3", voltage: 3.3, budgetMa: 500 },
    // VBUS is upstream of the regulator and is not energised by the BAT pads.
    { pinId: "5V", voltage: 5, budgetMa: 500, usbOnly: true },
  ],
  groundPinIds: ["GND"],
  maximumPinCurrentMa: 20,
  // Preserve the labelled buses until their dedicated allocators need them;
  // the three strapping pins come last for general-purpose use.
  digitalPinOrder: ["D1", "D2", "D3", "D6", "D7", "D10", "D4", "D5", "D0", "D8", "D9"],
  pwmPinOrder: ["D1", "D2", "D3", "D6", "D7", "D10", "D4", "D5", "D0", "D8", "D9"],
  analogPinOrder: ["D0", "D1", "D2", "D3"],
  i2c: { sdaPinId: "D4", sclPinId: "D5" },
  spi: { sckPinId: "D8", mosiPinId: "D10", misoPinId: "D9" },
  uart: { txPinId: "D6", rxPinId: "D7" },
  cautionPins: {
    D0: "D0 / GPIO2 is an ESP32-C3 strapping pin; an external level at reset can change the boot configuration.",
    D3: "D3 uses ESP32-C3 ADC2, which Seeed warns can give false samples; prefer D0, D1 or D2 for reliable analog readings.",
    D8: "D8 / GPIO8 is an ESP32-C3 strapping pin; an external level at reset can change the boot configuration.",
    D9: "D9 / GPIO9 is both a strapping pin and the board's Boot input; loading it can prevent uploading or normal startup.",
  },
  firmware: {
    platformioEnvironment: "seeed_xiao_esp32c3",
    platformioBoard: "seeed_xiao_esp32c3",
    platformioPlatform: "espressif32",
    framework: "arduino",
    arduinoBoardName: "XIAO_ESP32C3",
    serialBaud: 115200,
  },
};

// ---------------------------------------------------------------------------
// ESP32 DevKit V1 (30-pin)
// ---------------------------------------------------------------------------

const esp32Digital = (gpio: number, extraFunctions: string[] = []) =>
  pin(`GPIO${gpio}`, `D${gpio}`, "digital-io", ["gpio", "pwm", ...extraFunctions], {
    maximumVoltage: 3.3,
    maximumCurrentMa: 40,
  });

export const esp32DevkitV1: ComponentDefinition = {
  id: "esp32-devkit-v1",
  aliases: [
    "esp32",
    "esp32 board",
    "esp32 devkit",
    "esp32 dev board",
    "esp32 devkit v1",
    "esp32 wroom",
    "esp-wroom-32",
    "esp32 microcontroller",
    "wifi microcontroller",
  ],
  name: "ESP32 DevKit V1",
  category: "controller",
  description:
    "30-pin ESP32-WROOM-32 development board with USB, Wi-Fi and Bluetooth, a 3.3 V regulator and 3.3 V logic.",
  manufacturer: "Espressif (module)",
  manufacturerPartNumber: "ESP32-WROOM-32",
  electrical: {
    minimumSupplyVoltage: 5,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 12,
    logicVoltage: 3.3,
    typicalCurrentMa: 80,
    maximumCurrentMa: 260,
  },
  interfaces: ["i2c", "spi", "uart", "wifi", "bluetooth", "usb"],
  pins: [
    pin("VIN", "VIN", "power-input", ["supply-vin", "supply-5v"], { maximumVoltage: 12 }),
    pin("3V3", "3V3", "power-output", ["supply-3v3"], { maximumVoltage: 3.3, maximumCurrentMa: 500 }),
    pin("GND1", "GND", "ground", ["ground"]),
    pin("GND2", "GND", "ground", ["ground"]),
    pin("EN", "EN", "digital-input", ["reset", "optional"], { maximumVoltage: 3.3 }),
    esp32Digital(2, ["boot-strap"]),
    esp32Digital(4),
    esp32Digital(5, ["spi-cs", "boot-strap"]),
    esp32Digital(12, ["boot-strap"]),
    esp32Digital(13),
    esp32Digital(14),
    esp32Digital(15, ["boot-strap"]),
    pin("GPIO16", "RX2", "digital-io", ["gpio", "pwm", "uart-rx"], {
      maximumVoltage: 3.3,
      maximumCurrentMa: 40,
    }),
    pin("GPIO17", "TX2", "digital-io", ["gpio", "pwm", "uart-tx"], {
      maximumVoltage: 3.3,
      maximumCurrentMa: 40,
    }),
    esp32Digital(18, ["spi-sck"]),
    esp32Digital(19, ["spi-miso"]),
    pin("GPIO21", "D21", "digital-io", ["gpio", "pwm", "i2c-sda"], {
      maximumVoltage: 3.3,
      maximumCurrentMa: 40,
    }),
    pin("GPIO22", "D22", "digital-io", ["gpio", "pwm", "i2c-scl"], {
      maximumVoltage: 3.3,
      maximumCurrentMa: 40,
    }),
    esp32Digital(23, ["spi-mosi"]),
    esp32Digital(25, ["dac"]),
    esp32Digital(26, ["dac"]),
    esp32Digital(27),
    esp32Digital(32, ["adc"]),
    esp32Digital(33, ["adc"]),
    pin("GPIO34", "D34", "analog-input", ["adc", "input-only"], { maximumVoltage: 3.3 }),
    pin("GPIO35", "D35", "analog-input", ["adc", "input-only"], { maximumVoltage: 3.3 }),
    pin("GPIO36", "VP", "analog-input", ["adc", "input-only"], { maximumVoltage: 3.3 }),
    pin("GPIO39", "VN", "analog-input", ["adc", "input-only"], { maximumVoltage: 3.3 }),
    pin("GPIO1", "TX0", "digital-io", ["gpio", "uart-tx", "usb-console"], {
      maximumVoltage: 3.3,
      maximumCurrentMa: 40,
    }),
    pin("GPIO3", "RX0", "digital-io", ["gpio", "uart-rx", "usb-console"], {
      maximumVoltage: 3.3,
      maximumCurrentMa: 40,
    }),
  ],
  rules: { requiresDecoupling: false },
  firmware: { libraries: [], includeStatements: ["#include <Arduino.h>"] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-esp32-devkit-v1",
    width: 107,
    height: 204,
    pinAnchors: {
      VIN: { x: 5, y: 158.5 },
      GND2: { x: 5, y: 149 },
      GPIO13: { x: 5, y: 139.5 },
      GPIO12: { x: 5, y: 130.4 },
      GPIO14: { x: 5, y: 120 },
      GPIO27: { x: 5, y: 110.8 },
      GPIO26: { x: 5, y: 101 },
      GPIO25: { x: 5, y: 91.3 },
      GPIO33: { x: 5, y: 81.7 },
      GPIO32: { x: 5, y: 72.2 },
      GPIO35: { x: 5, y: 62.9 },
      GPIO34: { x: 5, y: 53.1 },
      GPIO39: { x: 5, y: 44 },
      GPIO36: { x: 5, y: 34 },
      EN: { x: 5, y: 24 },
      "3V3": { x: 101.3, y: 158.5 },
      GND1: { x: 101.3, y: 149 },
      GPIO15: { x: 101.3, y: 139.5 },
      GPIO2: { x: 101.3, y: 130.4 },
      GPIO4: { x: 101.3, y: 120 },
      GPIO16: { x: 101.3, y: 110.8 },
      GPIO17: { x: 101.3, y: 101 },
      GPIO5: { x: 101.3, y: 91.3 },
      GPIO18: { x: 101.3, y: 81.7 },
      GPIO19: { x: 101.3, y: 72.2 },
      GPIO21: { x: 101.3, y: 62.9 },
      GPIO3: { x: 101.3, y: 53.1 },
      GPIO1: { x: 101.3, y: 44 },
      GPIO22: { x: 101.3, y: 34 },
      GPIO23: { x: 101.3, y: 24 },
    },
  },
  estimatedUnitPrice: 8,
  substitutes: ["ESP32 NodeMCU-32S", "ESP32-WROOM-32D DevKit"],
};

export const esp32Profile: ControllerProfile = {
  definitionId: esp32DevkitV1.id,
  logicVoltage: 3.3,
  rails: [
    { pinId: "3V3", voltage: 3.3, budgetMa: 500 },
    { pinId: "VIN", voltage: 5, budgetMa: 500 },
  ],
  groundPinIds: ["GND1", "GND2"],
  maximumPinCurrentMa: 20,
  digitalPinOrder: [
    "GPIO4",
    "GPIO13",
    "GPIO14",
    "GPIO16",
    "GPIO17",
    "GPIO18",
    "GPIO19",
    "GPIO23",
    "GPIO25",
    "GPIO26",
    "GPIO27",
    "GPIO32",
    "GPIO33",
    "GPIO5",
    "GPIO2",
    "GPIO15",
    "GPIO12",
  ],
  pwmPinOrder: [
    "GPIO13",
    "GPIO14",
    "GPIO25",
    "GPIO26",
    "GPIO27",
    "GPIO32",
    "GPIO33",
    "GPIO4",
  ],
  analogPinOrder: ["GPIO32", "GPIO33", "GPIO34", "GPIO35", "GPIO36", "GPIO39"],
  i2c: { sdaPinId: "GPIO21", sclPinId: "GPIO22" },
  spi: { sckPinId: "GPIO18", mosiPinId: "GPIO23", misoPinId: "GPIO19" },
  uart: { txPinId: "GPIO17", rxPinId: "GPIO16" },
  // UART1's default pins are wired to the flash chip, so a second port is
  // remapped onto plain GPIO — which the ESP32's pin matrix allows.
  additionalUarts: [{ txPinId: "GPIO26", rxPinId: "GPIO27" }],
  cautionPins: {
    GPIO2: "GPIO 2 is a boot-strapping pin; an external pull-up can stop the board entering flash mode.",
    GPIO5: "GPIO 5 is a boot-strapping pin; it must be high at reset.",
    GPIO12: "GPIO 12 is a boot-strapping pin; pulling it high at reset selects the wrong flash voltage.",
    GPIO15: "GPIO 15 is a boot-strapping pin; pulling it low at reset silences the boot log.",
    GPIO1: "GPIO 1 (TX0) is the USB serial console; using it breaks Serial output and uploading.",
    GPIO3: "GPIO 3 (RX0) is the USB serial console; using it breaks Serial output and uploading.",
    GPIO34: "GPIO 34 is input-only and has no internal pull-up or pull-down.",
    GPIO35: "GPIO 35 is input-only and has no internal pull-up or pull-down.",
    GPIO36: "GPIO 36 (VP) is input-only and has no internal pull-up or pull-down.",
    GPIO39: "GPIO 39 (VN) is input-only and has no internal pull-up or pull-down.",
  },
  firmware: {
    platformioEnvironment: "esp32dev",
    platformioBoard: "esp32dev",
    platformioPlatform: "espressif32",
    framework: "arduino",
    arduinoBoardName: "ESP32 Dev Module",
    serialBaud: 115200,
  },
};

// ---------------------------------------------------------------------------
// Arduino Uno R3
// ---------------------------------------------------------------------------

const unoDigital = (number: number, functions: string[] = []) =>
  pin(`D${number}`, String(number), "digital-io", ["gpio", ...functions], {
    maximumVoltage: 5,
    maximumCurrentMa: 40,
  });

export const arduinoUno: ComponentDefinition = {
  id: "arduino-uno",
  aliases: [
    "arduino",
    "arduino uno",
    "uno",
    "arduino uno r3",
    "atmega328p board",
    "arduino board",
  ],
  name: "Arduino Uno R3",
  category: "controller",
  description:
    "ATmega328P board with 5 V logic, 14 digital pins, 6 analog inputs and a USB-B programming port.",
  manufacturer: "Arduino",
  manufacturerPartNumber: "A000066",
  electrical: {
    minimumSupplyVoltage: 7,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 12,
    logicVoltage: 5,
    typicalCurrentMa: 45,
    maximumCurrentMa: 200,
  },
  interfaces: ["i2c", "spi", "uart", "usb"],
  pins: [
    pin("VIN", "VIN", "power-input", ["supply-vin"], { maximumVoltage: 12 }),
    pin("5V", "5V", "power-output", ["supply-5v"], { maximumVoltage: 5, maximumCurrentMa: 500 }),
    pin("3V3", "3.3V", "power-output", ["supply-3v3"], { maximumVoltage: 3.3, maximumCurrentMa: 50 }),
    pin("GND1", "GND", "ground", ["ground"]),
    pin("GND2", "GND", "ground", ["ground"]),
    pin("GND3", "GND", "ground", ["ground"]),
    pin("RESET", "RESET", "digital-input", ["reset", "optional"], { maximumVoltage: 5 }),
    pin("IOREF", "IOREF", "power-output", ["reference", "optional"], { maximumVoltage: 5 }),
    pin("AREF", "AREF", "analog-input", ["reference", "optional"], { maximumVoltage: 5 }),
    pin("D0", "0", "digital-io", ["gpio", "uart-rx", "usb-console"], {
      maximumVoltage: 5,
      maximumCurrentMa: 40,
    }),
    pin("D1", "1", "digital-io", ["gpio", "uart-tx", "usb-console"], {
      maximumVoltage: 5,
      maximumCurrentMa: 40,
    }),
    unoDigital(2, ["interrupt"]),
    unoDigital(3, ["pwm", "interrupt"]),
    unoDigital(4),
    unoDigital(5, ["pwm"]),
    unoDigital(6, ["pwm"]),
    unoDigital(7),
    unoDigital(8),
    unoDigital(9, ["pwm"]),
    unoDigital(10, ["pwm", "spi-cs"]),
    unoDigital(11, ["pwm", "spi-mosi"]),
    unoDigital(12, ["spi-miso"]),
    unoDigital(13, ["spi-sck", "onboard-led"]),
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
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: ["#include <Arduino.h>"] },
  visual: {
    renderer: "wokwi-element",
    elementName: "wokwi-arduino-uno",
    width: 274,
    height: 202,
    pinAnchors: {
      D0: { x: 255.5, y: 9 },
      D1: { x: 246, y: 9 },
      D2: { x: 236.5, y: 9 },
      D3: { x: 227, y: 9 },
      D4: { x: 217.5, y: 9 },
      D5: { x: 208, y: 9 },
      D6: { x: 198.5, y: 9 },
      D7: { x: 189, y: 9 },
      D8: { x: 173, y: 9 },
      D9: { x: 163, y: 9 },
      D10: { x: 153.5, y: 9 },
      D11: { x: 144, y: 9 },
      D12: { x: 134.5, y: 9 },
      D13: { x: 125, y: 9 },
      AREF: { x: 106, y: 9 },
      GND1: { x: 115.5, y: 9 },
      IOREF: { x: 131, y: 191.5 },
      RESET: { x: 140.5, y: 191.5 },
      "3V3": { x: 150, y: 191.5 },
      "5V": { x: 160, y: 191.5 },
      GND2: { x: 169.5, y: 191.5 },
      GND3: { x: 179, y: 191.5 },
      VIN: { x: 188.5, y: 191.5 },
      A0: { x: 208, y: 191.5 },
      A1: { x: 217.5, y: 191.5 },
      A2: { x: 227, y: 191.5 },
      A3: { x: 236.5, y: 191.5 },
      A4: { x: 246, y: 191.5 },
      A5: { x: 255.5, y: 191.5 },
    },
  },
  estimatedUnitPrice: 24,
  substitutes: ["Arduino Nano", "Arduino Uno R4 Minima"],
};

export const arduinoUnoProfile: ControllerProfile = {
  definitionId: arduinoUno.id,
  logicVoltage: 5,
  rails: [
    { pinId: "5V", voltage: 5, budgetMa: 400 },
    { pinId: "3V3", voltage: 3.3, budgetMa: 50 },
  ],
  groundPinIds: ["GND1", "GND2", "GND3"],
  maximumPinCurrentMa: 20,
  digitalPinOrder: [
    "D2",
    "D3",
    "D4",
    "D5",
    "D6",
    "D7",
    "D8",
    "D9",
    "D10",
    "D11",
    "D12",
    "D13",
  ],
  pwmPinOrder: ["D9", "D10", "D11", "D3", "D5", "D6"],
  analogPinOrder: ["A0", "A1", "A2", "A3"],
  i2c: { sdaPinId: "A4", sclPinId: "A5" },
  spi: { sckPinId: "D13", mosiPinId: "D11", misoPinId: "D12" },
  uart: { txPinId: "D1", rxPinId: "D0" },
  cautionPins: {
    D0: "Digital 0 (RX) is the USB serial console; using it breaks Serial output and uploading.",
    D1: "Digital 1 (TX) is the USB serial console; using it breaks Serial output and uploading.",
    D13: "Digital 13 drives the on-board LED through a resistor, which loads the pin.",
  },
  firmware: {
    platformioEnvironment: "uno",
    platformioBoard: "uno",
    platformioPlatform: "atmelavr",
    framework: "arduino",
    arduinoBoardName: "Arduino Uno",
    serialBaud: 9600,
  },
};

// ---------------------------------------------------------------------------
// Raspberry Pi Pico
// ---------------------------------------------------------------------------

const picoAnchors: Record<string, { x: number; y: number }> = {};
const PICO_LEFT = ["GP0", "GP1", "GND1", "GP2", "GP3", "GP4", "GP5", "GND2", "GP6", "GP7",
  "GP8", "GP9", "GND3", "GP10", "GP11", "GP12", "GP13", "GND4", "GP14", "GP15"];
const PICO_RIGHT = ["VBUS", "VSYS", "GND5", "3V3EN", "3V3", "ADCVREF", "GP28", "AGND", "GP27",
  "GP26", "RUN", "GP22", "GND6", "GP21", "GP20", "GP19", "GP18", "GND7", "GP17", "GP16"];
PICO_LEFT.forEach((id, index) => {
  picoAnchors[id] = { x: 6, y: 24 + index * 12.5 };
});
PICO_RIGHT.forEach((id, index) => {
  picoAnchors[id] = { x: 104, y: 24 + index * 12.5 };
});

const picoDigital = (number: number, functions: string[] = []) =>
  pin(`GP${number}`, `GP${number}`, "digital-io", ["gpio", "pwm", ...functions], {
    maximumVoltage: 3.3,
    maximumCurrentMa: 12,
  });

export const raspberryPiPico: ComponentDefinition = {
  id: "raspberry-pi-pico",
  aliases: [
    "pico",
    "raspberry pi pico",
    "rp2040",
    "rp2040 board",
    "pi pico",
  ],
  name: "Raspberry Pi Pico",
  category: "controller",
  description:
    "RP2040 board with 3.3 V logic, 26 GPIO, three ADC channels and a micro-USB port with drag-and-drop UF2 flashing.",
  manufacturer: "Raspberry Pi",
  manufacturerPartNumber: "SC0915",
  electrical: {
    minimumSupplyVoltage: 1.8,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 5.5,
    logicVoltage: 3.3,
    typicalCurrentMa: 25,
    maximumCurrentMa: 100,
  },
  interfaces: ["i2c", "spi", "uart", "usb"],
  pins: [
    pin("VBUS", "VBUS", "power-output", ["supply-5v"], { maximumVoltage: 5, maximumCurrentMa: 500 }),
    pin("VSYS", "VSYS", "power-input", ["supply-vin"], { maximumVoltage: 5.5 }),
    pin("3V3", "3V3(OUT)", "power-output", ["supply-3v3"], {
      maximumVoltage: 3.3,
      maximumCurrentMa: 300,
    }),
    pin("3V3EN", "3V3_EN", "digital-input", ["enable", "optional"], { maximumVoltage: 3.3 }),
    pin("ADCVREF", "ADC_VREF", "power-output", ["reference", "optional"], { maximumVoltage: 3.3 }),
    pin("AGND", "AGND", "ground", ["ground", "optional"]),
    pin("RUN", "RUN", "digital-input", ["reset", "optional"], { maximumVoltage: 3.3 }),
    ...["GND1", "GND2", "GND3", "GND4", "GND5", "GND6", "GND7"].map((id) =>
      pin(id, "GND", "ground", ["ground"]),
    ),
    pin("GP0", "GP0", "digital-io", ["gpio", "pwm", "uart-tx"], {
      maximumVoltage: 3.3,
      maximumCurrentMa: 12,
    }),
    pin("GP1", "GP1", "digital-io", ["gpio", "pwm", "uart-rx"], {
      maximumVoltage: 3.3,
      maximumCurrentMa: 12,
    }),
    picoDigital(2),
    picoDigital(3),
    pin("GP4", "GP4", "digital-io", ["gpio", "pwm", "i2c-sda"], {
      maximumVoltage: 3.3,
      maximumCurrentMa: 12,
    }),
    pin("GP5", "GP5", "digital-io", ["gpio", "pwm", "i2c-scl"], {
      maximumVoltage: 3.3,
      maximumCurrentMa: 12,
    }),
    picoDigital(6),
    picoDigital(7),
    picoDigital(8),
    picoDigital(9),
    picoDigital(10),
    picoDigital(11),
    picoDigital(12),
    picoDigital(13),
    picoDigital(14),
    picoDigital(15),
    picoDigital(16, ["spi-miso"]),
    picoDigital(17, ["spi-cs"]),
    picoDigital(18, ["spi-sck"]),
    picoDigital(19, ["spi-mosi"]),
    picoDigital(20),
    picoDigital(21),
    picoDigital(22),
    pin("GP26", "GP26 / A0", "analog-input", ["gpio", "pwm", "adc"], {
      maximumVoltage: 3.3,
      maximumCurrentMa: 12,
    }),
    pin("GP27", "GP27 / A1", "analog-input", ["gpio", "pwm", "adc"], {
      maximumVoltage: 3.3,
      maximumCurrentMa: 12,
    }),
    pin("GP28", "GP28 / A2", "analog-input", ["gpio", "pwm", "adc"], {
      maximumVoltage: 3.3,
      maximumCurrentMa: 12,
    }),
  ],
  rules: {},
  firmware: { libraries: [], includeStatements: ["#include <Arduino.h>"] },
  visual: {
    renderer: "svg",
    assetId: "board-dip",
    width: 110,
    height: 275,
    pinAnchors: picoAnchors,
  },
  estimatedUnitPrice: 5,
  substitutes: ["Raspberry Pi Pico H", "Raspberry Pi Pico W"],
};

export const raspberryPiPicoProfile: ControllerProfile = {
  definitionId: raspberryPiPico.id,
  logicVoltage: 3.3,
  rails: [
    { pinId: "3V3", voltage: 3.3, budgetMa: 300 },
    // VBUS is the USB connector's own 5 V, upstream of everything. A cell on
    // VSYS powers the board and leaves this pin dead.
    { pinId: "VBUS", voltage: 5, budgetMa: 500, usbOnly: true },
  ],
  groundPinIds: ["GND1", "GND2", "GND3", "GND4", "GND5", "GND6", "GND7"],
  maximumPinCurrentMa: 12,
  digitalPinOrder: [
    "GP2",
    "GP3",
    "GP6",
    "GP7",
    "GP8",
    "GP9",
    "GP10",
    "GP11",
    "GP12",
    "GP13",
    "GP14",
    "GP15",
    "GP20",
    "GP21",
    "GP22",
    "GP16",
    "GP17",
    "GP18",
    "GP19",
  ],
  pwmPinOrder: ["GP2", "GP3", "GP6", "GP7", "GP8", "GP9", "GP10", "GP11"],
  analogPinOrder: ["GP26", "GP27", "GP28"],
  i2c: { sdaPinId: "GP4", sclPinId: "GP5" },
  spi: { sckPinId: "GP18", mosiPinId: "GP19", misoPinId: "GP16" },
  uart: { txPinId: "GP0", rxPinId: "GP1" },
  cautionPins: {
    GP26: "GP26 doubles as ADC0; using it as a plain digital pin loses that analog channel.",
    GP27: "GP27 doubles as ADC1; using it as a plain digital pin loses that analog channel.",
    GP28: "GP28 doubles as ADC2; using it as a plain digital pin loses that analog channel.",
  },
  firmware: {
    platformioEnvironment: "pico",
    platformioBoard: "pico",
    platformioPlatform: "raspberrypi",
    framework: "arduino",
    arduinoBoardName: "Raspberry Pi Pico",
    serialBaud: 115200,
  },
};

export const CONTROLLER_DEFINITIONS: ComponentDefinition[] = [
  seeedXiaoEsp32C3,
  esp32DevkitV1,
  arduinoUno,
  raspberryPiPico,
];

export const CONTROLLER_PROFILES: ControllerProfile[] = [
  seeedXiaoEsp32C3Profile,
  esp32Profile,
  arduinoUnoProfile,
  raspberryPiPicoProfile,
];
