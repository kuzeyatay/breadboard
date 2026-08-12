// Long-tail component coverage for the generic compiler paths.
//
// Parts with special wiring or firmware stay hand-written in the neighbouring
// files. These definitions cover standard I2C, SPI, UART, analog, digital and
// PWM modules, driven loads, and physical reference parts that belong in a BOM
// and enclosure even when they have no breadboard connection.

import type { ComponentDefinition, ComponentPin } from "../types.ts";
import { pin } from "./pin.ts";

type Mechanical = NonNullable<ComponentDefinition["mechanical"]>;

interface Common {
  id: string;
  name: string;
  alias: string;
  category: string;
  description: string;
  current?: number;
  maximumCurrent?: number;
  mechanical?: Mechanical;
  addresses?: string[];
  /** Active mechanical/BOM reference that is not electrically buildable. */
  electricalPlaceholder?: boolean;
}

function graphic(pins: ComponentPin[]): ComponentDefinition["visual"] {
  const width = Math.max(84, pins.length * 16 + 20);
  return {
    renderer: "generic",
    assetId: "module-generic",
    width,
    height: 62,
    pinAnchors: Object.fromEntries(
      pins.map((entry, index) => [
        entry.id,
        { x: 12 + index * ((width - 24) / Math.max(1, pins.length - 1)), y: 58 },
      ]),
    ),
  };
}

function make(
  entry: Common,
  pins: ComponentPin[],
  interfaces: string[],
  electrical: ComponentDefinition["electrical"],
  rules: ComponentDefinition["rules"] = {},
): ComponentDefinition {
  return {
    id: entry.id,
    aliases: [entry.id, entry.alias],
    name: entry.name,
    category: entry.category,
    description: entry.description,
    electrical,
    interfaces,
    pins,
    rules,
    firmware: { libraries: [] },
    visual: graphic(pins),
    ...(entry.mechanical ? { mechanical: entry.mechanical } : {}),
  };
}

function i2c(entry: Common): ComponentDefinition {
  const pins = [
    pin("VCC", "VCC", "power-input", ["supply-3v3"], { maximumVoltage: 3.6 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("SCL", "SCL", "digital-io", ["i2c-scl"], { maximumVoltage: 3.6 }),
    pin("SDA", "SDA", "digital-io", ["i2c-sda"], { maximumVoltage: 3.6 }),
  ];
  return make(
    entry,
    pins,
    ["i2c"],
    {
      minimumSupplyVoltage: 3,
      typicalSupplyVoltage: 3.3,
      maximumSupplyVoltage: 3.6,
      logicVoltage: 3.3,
      typicalCurrentMa: entry.current ?? 1,
      maximumCurrentMa: entry.maximumCurrent ?? Math.max(2, (entry.current ?? 1) * 2),
    },
    { requiresPullups: false, ...(entry.addresses ? { i2cAddresses: entry.addresses } : {}) },
  );
}

function analog(entry: Common): ComponentDefinition {
  const pins = [
    pin("VCC", "VCC", "power-input", ["supply-3v3", "supply-5v"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("OUT", "OUT", "analog-output", ["analog-out"], { maximumVoltage: 3.3 }),
  ];
  return make(entry, pins, ["analog"], {
    minimumSupplyVoltage: 3,
    typicalSupplyVoltage: 3.3,
    maximumSupplyVoltage: 5.5,
    logicVoltage: 3.3,
    typicalCurrentMa: entry.current ?? 5,
    maximumCurrentMa: entry.maximumCurrent ?? Math.max(10, (entry.current ?? 5) * 2),
  });
}

function digital(entry: Common): ComponentDefinition {
  const pins = [
    pin("VCC", "VCC", "power-input", ["supply-3v3", "supply-5v"], { maximumVoltage: 5.5 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("OUT", "OUT", "digital-output", ["digital-out"], { maximumVoltage: 3.3 }),
  ];
  return make(entry, pins, ["digital"], {
    minimumSupplyVoltage: 3,
    typicalSupplyVoltage: 3.3,
    maximumSupplyVoltage: 5.5,
    logicVoltage: 3.3,
    typicalCurrentMa: entry.current ?? 5,
    maximumCurrentMa: entry.maximumCurrent ?? Math.max(10, (entry.current ?? 5) * 2),
  });
}

function uart(entry: Common): ComponentDefinition {
  const pins = [
    pin("VCC", "VCC", "power-input", ["supply-3v3"], { maximumVoltage: 4.2 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("TX", "TX", "digital-output", ["uart-tx"], { maximumVoltage: 3.3 }),
    pin("RX", "RX", "digital-input", ["uart-rx"], { maximumVoltage: 3.3 }),
  ];
  return make(entry, pins, ["uart"], {
    minimumSupplyVoltage: 3,
    typicalSupplyVoltage: 3.3,
    maximumSupplyVoltage: 4.2,
    logicVoltage: 3.3,
    typicalCurrentMa: entry.current ?? 25,
    maximumCurrentMa: entry.maximumCurrent ?? Math.max(50, (entry.current ?? 25) * 2),
  });
}

function spi(entry: Common): ComponentDefinition {
  const pins = [
    pin("VCC", "VCC", "power-input", ["supply-3v3"], { maximumVoltage: 3.6 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("SCK", "SCK", "digital-input", ["spi-sck"], { maximumVoltage: 3.6 }),
    pin("MOSI", "MOSI", "digital-input", ["spi-mosi"], { maximumVoltage: 3.6 }),
    pin("MISO", "MISO", "digital-output", ["spi-miso"], { maximumVoltage: 3.3 }),
    pin("CS", "CS", "digital-input", ["spi-cs"], { maximumVoltage: 3.6 }),
  ];
  return make(entry, pins, ["spi"], {
    minimumSupplyVoltage: 3,
    typicalSupplyVoltage: 3.3,
    maximumSupplyVoltage: 3.6,
    logicVoltage: 3.3,
    typicalCurrentMa: entry.current ?? 15,
    maximumCurrentMa: entry.maximumCurrent ?? Math.max(30, (entry.current ?? 15) * 2),
  });
}

function pwm(entry: Common): ComponentDefinition {
  const pins = [
    pin("VCC", "VCC", "power-input", ["supply-5v"], { maximumVoltage: 6 }),
    pin("GND", "GND", "ground", ["ground"]),
    pin("SIG", "SIG", "digital-input", ["pwm", "digital-in"], { maximumVoltage: 5.5 }),
  ];
  return make(entry, pins, ["pwm"], {
    minimumSupplyVoltage: 4.8,
    typicalSupplyVoltage: 5,
    maximumSupplyVoltage: 6,
    logicVoltage: 3.3,
    typicalCurrentMa: entry.current ?? 150,
    maximumCurrentMa: entry.maximumCurrent ?? 900,
  });
}

function driven(entry: Common & { voltage: number; flyback?: boolean }): ComponentDefinition {
  const pins = [
    pin("POS", "+", "power-input", [entry.voltage <= 5.5 ? "supply-5v" : "external-supply"], {
      maximumVoltage: entry.voltage * 1.1,
    }),
    pin("NEG", "−", "passive", ["switched-return"]),
  ];
  return make(
    entry,
    pins,
    ["switched-load"],
    {
      minimumSupplyVoltage: entry.voltage * 0.9,
      typicalSupplyVoltage: entry.voltage,
      maximumSupplyVoltage: entry.voltage * 1.1,
      typicalCurrentMa: entry.current ?? 200,
      maximumCurrentMa: entry.maximumCurrent ?? 1_000,
    },
    { requiresDriver: true, ...(entry.flyback ? { requiresFlybackDiode: true } : {}) },
  );
}

function reference(entry: Common): ComponentDefinition {
  return {
    id: entry.id,
    aliases: [entry.id, entry.alias],
    name: entry.name,
    category: entry.category,
    description: entry.description,
    electrical: {},
    interfaces: [],
    pins: [],
    rules: entry.electricalPlaceholder ? { electricalPlaceholder: true } : {},
    visual: {
      renderer: "generic",
      assetId: "mechanical-reference",
      width: 96,
      height: 62,
      pinAnchors: {},
    },
    ...(entry.mechanical ? { mechanical: entry.mechanical } : {}),
  };
}

const I2C: Common[] = [
  { id: "sht31", name: "SHT31 temperature and humidity sensor", alias: "sht31-d", category: "sensor", description: "Digital temperature and relative-humidity breakout with a stable I2C interface and selectable address.", addresses: ["0x44", "0x45"], mechanical: { length: 18, width: 18, height: 3 } },
  { id: "shtc3", name: "SHTC3 low-power humidity sensor", alias: "shtc 3 breakout", category: "sensor", description: "Low-power I2C temperature and humidity module intended for compact battery-operated environmental products.", addresses: ["0x70"], mechanical: { length: 16, width: 16, height: 3 } },
  { id: "bme680", name: "BME680 environmental gas sensor", alias: "bme 680 breakout", category: "sensor", description: "I2C environmental module measuring temperature, pressure, humidity and gas resistance for indoor-air projects.", addresses: ["0x76", "0x77"], current: 12, mechanical: { length: 18, width: 16, height: 3 } },
  { id: "ccs811", name: "CCS811 indoor air quality sensor", alias: "ccs 811 breakout", category: "sensor", description: "I2C metal-oxide air-quality module reporting equivalent carbon dioxide and total volatile organic compounds.", addresses: ["0x5A", "0x5B"], current: 30, mechanical: { length: 20, width: 15, height: 4 } },
  { id: "sgp30", name: "SGP30 air quality sensor", alias: "sgp 30 breakout", category: "sensor", description: "Compact I2C multi-pixel gas sensor for equivalent carbon dioxide and total volatile-organic-compound readings.", addresses: ["0x58"], current: 48, mechanical: { length: 18, width: 18, height: 4 } },
  { id: "scd30", name: "SCD30 carbon dioxide sensor", alias: "scd30 co2", category: "sensor", description: "NDIR carbon-dioxide module with I2C measurements for CO2 concentration, temperature and relative humidity.", addresses: ["0x61"], current: 19, maximumCurrent: 75, mechanical: { length: 35, width: 23, height: 7 } },
  { id: "vl53l0x", name: "VL53L0X time-of-flight distance sensor", alias: "vl53 l0x breakout", category: "sensor", description: "Laser time-of-flight ranging breakout that measures short distances over I2C without ultrasonic transducers.", addresses: ["0x29"], current: 19, mechanical: { length: 13, width: 18, height: 4 } },
  { id: "tsl2561", name: "TSL2561 luminosity sensor", alias: "tsl 2561 breakout", category: "sensor", description: "Dual-diode digital luminosity module with a wide dynamic range and selectable I2C address.", addresses: ["0x29", "0x39", "0x49"], mechanical: { length: 19, width: 19, height: 3 } },
  { id: "veml7700", name: "VEML7700 ambient light sensor", alias: "veml 7700 breakout", category: "sensor", description: "High-resolution I2C ambient-light breakout for lux measurement in displays, wearables and data loggers.", addresses: ["0x10"], mechanical: { length: 18, width: 16, height: 3 } },
  { id: "ads1115", name: "ADS1115 16-bit ADC module", alias: "16 bit adc", category: "interface", description: "Four-channel 16-bit analog-to-digital converter breakout with programmable gain and selectable I2C address.", addresses: ["0x48", "0x49", "0x4A", "0x4B"], mechanical: { length: 28, width: 18, height: 4 } },
  { id: "mcp23017", name: "MCP23017 16-bit GPIO expander", alias: "mcp 23017 expander", category: "interface", description: "Sixteen-line digital input-output expander over I2C for controllers that need substantially more GPIO pins.", addresses: ["0x20", "0x21", "0x22", "0x23"], mechanical: { length: 38, width: 23, height: 4 } },
  { id: "pca9685", name: "PCA9685 16-channel PWM driver", alias: "pca 9685 servo driver", category: "interface", description: "I2C sixteen-channel PWM controller breakout commonly used to drive groups of servos or dimmable outputs.", addresses: ["0x40", "0x41", "0x42", "0x43"], current: 10, mechanical: { length: 63, width: 25, height: 4 } },
  { id: "ina219", name: "INA219 current and voltage monitor", alias: "ina 219 monitor", category: "sensor", description: "High-side DC current, bus-voltage and power monitor breakout with a programmable I2C address.", addresses: ["0x40", "0x41", "0x44", "0x45"], mechanical: { length: 26, width: 21, height: 4 } },
  { id: "mlx90614", name: "MLX90614 infrared thermometer", alias: "mlx 90614 thermometer", category: "sensor", description: "Non-contact infrared thermopile thermometer module exposing object and ambient temperature over I2C.", addresses: ["0x5A"], current: 2, mechanical: { length: 18, width: 18, height: 10 } },
  { id: "lis3dh", name: "LIS3DH 3-axis accelerometer", alias: "lis3 dh breakout", category: "sensor", description: "Low-power three-axis accelerometer breakout with configurable ranges, interrupts and an I2C data interface.", addresses: ["0x18", "0x19"], mechanical: { length: 20, width: 20, height: 4 } },
  { id: "adxl345", name: "ADXL345 3-axis accelerometer", alias: "adxl 345 breakout", category: "sensor", description: "Digital three-axis acceleration module with selectable range and bandwidth for motion and orientation sensing.", addresses: ["0x53", "0x1D"], mechanical: { length: 21, width: 16, height: 4 } },
  { id: "lsm6ds3", name: "LSM6DS3 accelerometer and gyroscope", alias: "lsm6 ds3 imu", category: "sensor", description: "Six-axis inertial measurement module combining a three-axis accelerometer and gyroscope over I2C.", addresses: ["0x6A", "0x6B"], mechanical: { length: 20, width: 20, height: 4 } },
  { id: "qmc5883l", name: "QMC5883L 3-axis magnetometer", alias: "qmc 5883l compass", category: "sensor", description: "Three-axis digital magnetic-field and compass breakout with an I2C measurement interface.", addresses: ["0x0D"], mechanical: { length: 18, width: 14, height: 3 } },
  { id: "ds3231-rtc", name: "DS3231 precision real-time clock", alias: "ds 3231 clock", category: "module", description: "Temperature-compensated battery-backed real-time clock module with alarms and a stable I2C interface.", addresses: ["0x68"], mechanical: { length: 38, width: 22, height: 14 } },
  { id: "mb85rc256v-fram", name: "MB85RC256V I2C FRAM module", alias: "mb85rc256v memory", category: "storage", description: "Non-volatile ferroelectric memory breakout with fast writes and much higher endurance than conventional EEPROM.", addresses: ["0x50", "0x51", "0x52", "0x53"], mechanical: { length: 20, width: 15, height: 3 } },
  { id: "at24c256-eeprom", name: "AT24C256 I2C EEPROM module", alias: "at24c256 memory", category: "storage", description: "Thirty-two-kilobyte serial EEPROM breakout for persistent settings, small records and calibration data.", addresses: ["0x50", "0x51", "0x52", "0x53"], mechanical: { length: 25, width: 14, height: 4 } },
  { id: "sh1106-oled", name: "SH1106 128×64 I2C OLED display", alias: "sh1106 screen", category: "display", description: "Compact monochrome 128 by 64 pixel OLED module using the SH1106 controller and an I2C connection.", addresses: ["0x3C", "0x3D"], current: 25, mechanical: { length: 27, width: 27, height: 4 } },
  { id: "lcd2004-i2c", name: "20×4 character LCD with I2C backpack", alias: "lcd2004", category: "display", description: "Twenty-column four-row character display module with an I2C backpack and adjustable LED backlight.", addresses: ["0x27", "0x3F"], current: 25, mechanical: { length: 98, width: 60, height: 14 } },
];

const ANALOG: Common[] = [
  { id: "tmp36", name: "TMP36 analog temperature sensor module", alias: "tmp 36 module", category: "sensor", description: "Linear analog temperature-sensor module whose output voltage is proportional to degrees Celsius.", current: 1 },
  { id: "lm35", name: "LM35 analog temperature sensor module", alias: "lm 35 module", category: "sensor", description: "Calibrated analog temperature-sensor module producing a voltage proportional to the Celsius temperature.", current: 1 },
  { id: "mq135-air", name: "MQ-135 air quality sensor module", alias: "mq 135 air", category: "sensor", description: "Heated metal-oxide gas-sensing module with an analog output for relative air-quality measurements.", current: 150, maximumCurrent: 180, mechanical: { length: 32, width: 20, height: 22 } },
  { id: "acs712-current", name: "ACS712 Hall current sensor module", alias: "acs 712 current", category: "sensor", description: "Isolated Hall-effect current transducer module producing an analog voltage centred around half the supply.", current: 10, mechanical: { length: 31, width: 14, height: 13 } },
  { id: "fsr-module", name: "Force-sensitive resistor interface module", alias: "fsr interface board", category: "sensor", description: "Voltage-divider interface for a force-sensitive resistor, presenting applied pressure as an analog level." },
  { id: "flex-sensor-module", name: "Flex sensor interface module", alias: "bend sensor interface", category: "sensor", description: "Voltage-divider interface for a resistive bend sensor, producing an analog level as the strip curves." },
  { id: "ml8511-uv", name: "ML8511 ultraviolet sensor module", alias: "ml 8511 uv", category: "sensor", description: "Analog ultraviolet-light intensity breakout intended for relative solar UV measurements and logging." },
  { id: "ph-interface", name: "Analog pH probe interface board", alias: "ph probe board", category: "sensor", description: "High-impedance analog conditioning board for a replaceable laboratory-style pH electrode probe.", current: 10, mechanical: { length: 43, width: 32, height: 15 } },
  { id: "turbidity-module", name: "Analog water turbidity sensor module", alias: "water clarity module", category: "sensor", description: "Optical water-turbidity interface reporting relative suspended-particle concentration as analog voltage.", current: 40 },
  { id: "capacitive-soil-v12", name: "Capacitive soil moisture sensor v1.2", alias: "capacitive moisture probe", category: "sensor", description: "Corrosion-resistant capacitive soil-moisture probe with an analog voltage output for plant monitoring.", current: 5, mechanical: { length: 98, width: 23, height: 7 } },
];

const DIGITAL: Common[] = [
  { id: "dht11-module", name: "DHT11 temperature and humidity module", alias: "dht 11 module", category: "sensor", description: "Entry-level digital temperature and humidity module with an onboard pull-up and single-wire output." },
  { id: "am312-pir", name: "AM312 mini PIR motion sensor", alias: "mini pir am312", category: "sensor", description: "Compact passive-infrared human-motion detector module with a clean digital trigger output.", mechanical: { length: 15, width: 15, height: 12 } },
  { id: "a3144-hall", name: "A3144 Hall-effect switch module", alias: "a3144 hall board", category: "sensor", description: "Magnetic-field switch breakout producing a digital state when a nearby magnet exceeds its threshold." },
  { id: "reed-switch-module", name: "Magnetic reed switch module", alias: "magnetic reed board", category: "sensor", description: "Glass reed contact on a small breakout that reports the presence of a nearby permanent magnet." },
  { id: "sw420-vibration", name: "SW-420 vibration switch module", alias: "sw 420 vibration", category: "sensor", description: "Adjustable vibration and shock detector module with a comparator-conditioned digital output." },
  { id: "flame-sensor-digital", name: "Infrared flame detector module", alias: "ir flame board", category: "sensor", description: "Infrared photodiode and comparator board producing a digital threshold signal near flame-like light." },
  { id: "ir-obstacle-module", name: "Infrared obstacle avoidance module", alias: "ir obstacle board", category: "sensor", description: "Short-range reflected-infrared proximity board with an adjustable digital detection threshold." },
  { id: "tcrt5000-line", name: "TCRT5000 line tracking module", alias: "tcrt5000 tracker", category: "sensor", description: "Reflective infrared emitter and receiver module for digital black-line and edge detection." },
  { id: "rain-sensor-module", name: "Rain detection comparator module", alias: "raindrop detector board", category: "sensor", description: "Conductive rain plate interface with an adjustable comparator and digital wet-state output." },
  { id: "float-switch-module", name: "Liquid level float switch module", alias: "float level board", category: "sensor", description: "Conditioned float-switch input module for detecting a fixed liquid level in a tank or vessel." },
];

const UART: Common[] = [
  { id: "sim800l", name: "SIM800L GSM/GPRS modem module", alias: "sim 800l modem", category: "communication", description: "Quad-band cellular modem controlled with AT commands over UART and requiring a high-current supply.", current: 350, maximumCurrent: 2_000, mechanical: { length: 25, width: 23, height: 4 } },
  { id: "sim7600", name: "SIM7600 LTE modem module", alias: "lte modem", category: "communication", description: "LTE cellular data and GNSS modem module with an AT-command UART control interface.", current: 500, maximumCurrent: 2_000, mechanical: { length: 55, width: 40, height: 8 } },
  { id: "pms5003", name: "PMS5003 particulate matter sensor", alias: "particulate matter sensor", category: "sensor", description: "Laser-scattering particulate sensor reporting PM1.0, PM2.5 and PM10 measurements over UART.", current: 80, maximumCurrent: 100, mechanical: { length: 50, width: 38, height: 21 } },
  { id: "mh-z19b", name: "MH-Z19B carbon dioxide sensor", alias: "mh z19b co2", category: "sensor", description: "NDIR carbon-dioxide measurement module with a documented UART command and response protocol.", current: 60, maximumCurrent: 150, mechanical: { length: 33, width: 20, height: 9 } },
  { id: "r503-fingerprint", name: "R503 capacitive fingerprint sensor", alias: "r503 fingerprint reader", category: "sensor", description: "Self-contained capacitive fingerprint reader with onboard matching and a packet-oriented UART interface.", current: 80, maximumCurrent: 120, mechanical: { length: 33, width: 28, height: 19 } },
  { id: "e32-lora-uart", name: "E32 LoRa UART radio module", alias: "ebyte e32 radio", category: "communication", description: "Long-range packet radio module that presents a transparent serial UART interface to the controller.", current: 35, maximumCurrent: 120, mechanical: { length: 36, width: 21, height: 4 } },
  { id: "ld2410-radar", name: "LD2410 presence radar module", alias: "ld 2410 radar", category: "sensor", description: "Twenty-four-gigahertz human-presence and motion radar module configured and read over UART.", current: 80, maximumCurrent: 120, mechanical: { length: 35, width: 7, height: 4 } },
  { id: "tfmini-s-lidar", name: "TFmini-S lidar range sensor", alias: "benewake tfmini", category: "sensor", description: "Compact infrared time-of-flight lidar module streaming centimetre-scale distance measurements over UART.", current: 140, maximumCurrent: 200, mechanical: { length: 42, width: 16, height: 15 } },
];

const SPI: Common[] = [
  { id: "w5500-ethernet", name: "W5500 Ethernet module", alias: "wiznet w5500", category: "communication", description: "Hardware TCP/IP Ethernet controller breakout with an SPI host interface and wired network connector.", current: 130, maximumCurrent: 180, mechanical: { length: 55, width: 28, height: 18 } },
  { id: "mcp2515-can", name: "MCP2515 CAN bus module", alias: "mcp 2515 can", category: "communication", description: "SPI CAN controller and transceiver breakout for connecting a microcontroller to a classic CAN bus.", current: 20, mechanical: { length: 40, width: 28, height: 8 } },
  { id: "nrf24l01-radio", name: "nRF24L01+ 2.4 GHz radio module", alias: "nrf24 radio", category: "communication", description: "Low-power 2.4 GHz packet-radio module with an SPI configuration and payload interface.", current: 12, maximumCurrent: 115, mechanical: { length: 29, width: 15, height: 13 } },
  { id: "sx1276-lora", name: "SX1276 LoRa radio module", alias: "lora radio", category: "communication", description: "Sub-gigahertz LoRa packet-radio module controlled over SPI for long-range low-data-rate links.", current: 12, maximumCurrent: 120, mechanical: { length: 17, width: 16, height: 3 } },
  { id: "max31855", name: "MAX31855 thermocouple amplifier", alias: "max 31855 thermocouple", category: "sensor", description: "Cold-junction-compensated thermocouple interface returning temperature measurements over SPI.", current: 2, mechanical: { length: 25, width: 20, height: 4 } },
  { id: "ads1256", name: "ADS1256 24-bit ADC module", alias: "ads 1256 converter", category: "interface", description: "High-resolution eight-channel delta-sigma analog-to-digital converter module controlled over SPI.", current: 40, mechanical: { length: 52, width: 30, height: 6 } },
  { id: "w25q64-flash", name: "W25Q64 SPI flash memory module", alias: "8mb spi flash", category: "storage", description: "Eight-megabyte serial NOR flash breakout for firmware assets, logs and other non-volatile binary data.", current: 4, maximumCurrent: 25, mechanical: { length: 14, width: 13, height: 3 } },
  { id: "st7789-tft", name: "ST7789 240×240 SPI TFT display", alias: "240x240 st7789", category: "display", description: "Colour 240 by 240 pixel IPS TFT module with an SPI display controller and LED backlight.", current: 45, maximumCurrent: 80, mechanical: { length: 35, width: 32, height: 5 } },
];

const PWM: Common[] = [
  { id: "mg996r-servo", name: "MG996R high-torque servo", alias: "mg 996r servo", category: "actuator", description: "Metal-geared high-torque hobby servo controlled by a standard pulse-width command signal.", current: 500, maximumCurrent: 2_500, mechanical: { length: 41, width: 20, height: 43 } },
  { id: "continuous-servo", name: "Continuous-rotation micro servo", alias: "360 micro servo", category: "actuator", description: "Compact continuous-rotation hobby servo whose PWM command controls direction and speed rather than angle.", current: 150, maximumCurrent: 800, mechanical: { length: 23, width: 13, height: 30 } },
  { id: "esc-brushless", name: "Brushless motor electronic speed controller", alias: "bldc esc", category: "actuator", description: "Three-phase brushless-motor power controller accepting a servo-style PWM throttle command.", current: 30, maximumCurrent: 60, mechanical: { length: 45, width: 25, height: 10 } },
];

const DRIVEN: Array<Common & { voltage: number; flyback?: boolean }> = [
  { id: "solenoid-12v", name: "12 V push-pull solenoid", alias: "12v linear solenoid", category: "actuator", description: "Twelve-volt linear electromagnetic actuator requiring a transistor driver and inductive flyback protection.", voltage: 12, current: 500, maximumCurrent: 1_000, flyback: true },
  { id: "fan-5v", name: "5 V brushless cooling fan", alias: "usb cooling fan", category: "actuator", description: "Small five-volt brushless cooling fan switched through a transistor when direct GPIO current is insufficient.", voltage: 5, current: 120, maximumCurrent: 250, flyback: true },
  { id: "fan-12v", name: "12 V brushless cooling fan", alias: "pc cooling fan", category: "actuator", description: "Twelve-volt brushless cooling fan requiring an external supply and a transistor switching stage.", voltage: 12, current: 180, maximumCurrent: 400, flyback: true },
  { id: "vibration-motor", name: "Coin vibration motor", alias: "haptic coin motor", category: "actuator", description: "Small eccentric rotating-mass haptic motor requiring a low-side driver and flyback protection.", voltage: 5, current: 80, maximumCurrent: 120, flyback: true },
  { id: "heater-cartridge-12v", name: "12 V heater cartridge", alias: "3d printer heater", category: "actuator", description: "Resistive twelve-volt heater cartridge requiring an external supply, MOSFET switching and temperature feedback.", voltage: 12, current: 3_300, maximumCurrent: 4_000 },
];

const REFERENCES: Common[] = [
  { id: "optical-combiner-waveguide", name: "Transparent optical waveguide combiner", alias: "waveguide combiner", category: "optical", description: "Transparent near-eye waveguide reference used to reserve its measured envelope and mounting edge in a wearable assembly.", mechanical: { length: 50, width: 35, height: 2, notes: "Optical prescription and eyebox require specialist design.", integration: ["Clamp only a protected edge; do not load or cover the clear viewing area.", "Provide angular and eye-relief adjustment before locking alignment."], functionalAxes: ["input optical axis from focusing optic", "eye-facing output axis and eyebox"], exposedRegions: ["clear viewing aperture", "optical input-coupling region"] } },
  { id: "optical-combiner-birdbath", name: "Birdbath near-eye optical combiner", alias: "birdbath optics", category: "optical", description: "Folded near-eye combiner reference for reserving optical volume while lens prescription and alignment remain specialist work.", mechanical: { length: 45, width: 35, height: 30, integration: ["Provide a light-tight folded optical cavity with adjustable mirror/combiner retention."], functionalAxes: ["display-to-mirror axis", "mirror-to-eye reflected axis"], exposedRegions: ["eye-side aperture"] } },
  { id: "micro-oled-display", name: "0.49-inch micro-OLED display module", alias: "near eye microdisplay", category: "display", description: "Compact high-pixel-density microdisplay reference for near-eye viewers where the exact vendor interface is selected separately.", electricalPlaceholder: true, mechanical: { length: 19, width: 15, height: 6, integration: ["Retain the module in a serviceable pocket without loading the active glass.", "Provide cable exit and bend clearance for the selected vendor module."], functionalAxes: ["active-display normal toward the focusing optic"], exposedRegions: ["active display area", "flex-cable exit"] } },
  { id: "ar-focusing-lens", name: "Near-eye focusing lens assembly", alias: "microdisplay collimator", category: "optical", description: "Adjustable focusing and collimation lens reference reserving the optical path between a microdisplay and combiner.", mechanical: { length: 24, width: 18, height: 18, integration: ["Use a retained carrier or barrel with axial focus adjustment and a lock."], functionalAxes: ["coaxial display-to-combiner optical axis"], exposedRegions: ["front and rear clear apertures"] } },
  { id: "eyeglass-temple-clip", name: "Adjustable eyeglass temple clip", alias: "glasses arm clip", category: "mechanical", description: "Parameterized clip reference for fastening a light electronics carrier to an eyeglass temple after measuring the frame.", mechanical: { length: 28, width: 12, height: 9, integration: ["Use compliant pads and positive retention across an editable temple width/thickness range.", "Spread load along the temple and keep the hinge unobstructed."], exposedRegions: ["adjustment and release control"] } },
  { id: "eyeglass-bridge-mount", name: "Adjustable eyeglass bridge mount", alias: "spectacle bridge bracket", category: "mechanical", description: "Bridge-mounted carrier reference with editable fit dimensions because eyeglass frames do not share one universal standard.", mechanical: { length: 32, width: 18, height: 12, integration: ["Use padded, symmetric contact and positive retention across an editable bridge range."], exposedRegions: ["adjustment and release control"] } },
  { id: "mipi-camera-module", name: "Compact MIPI camera module reference", alias: "mobile camera module", category: "module", description: "Small camera-board reference for mechanical layout when its high-speed MIPI interface is outside breadboard wiring scope.", electricalPlaceholder: true, mechanical: { length: 25, width: 24, height: 9, integration: ["Retain the PCB and give the lens barrel a non-vignetting aperture and cable bend clearance."], functionalAxes: ["camera optical axis"], exposedRegions: ["lens aperture", "MIPI flex-cable exit"] } },
  { id: "lipo-pouch-custom", name: "Custom-size single-cell LiPo pouch", alias: "flat lithium pouch", category: "power-source", description: "Mechanical battery-envelope reference for a protected single-cell lithium-polymer pouch whose capacity determines its size.", electricalPlaceholder: true, mechanical: { length: 60, width: 35, height: 6, integration: ["Support broad faces without puncture, crushing, tight bending, or sharp-edge contact.", "Provide strain-relieved lead routing and service access."], exposedRegions: ["lead exit"] } },
  { id: "speaker-28mm", name: "28 mm miniature loudspeaker", alias: "mini round speaker", category: "actuator", description: "Miniature dynamic loudspeaker reference requiring a suitable audio amplifier rather than direct controller connection.", electricalPlaceholder: true, mechanical: { length: 28, width: 28, height: 5, integration: ["Retain the rim and provide front acoustic openings plus rear volume."], functionalAxes: ["speaker acoustic axis"], exposedRegions: ["front diaphragm sound path"] } },
  { id: "wearable-flex-pcb", name: "Custom wearable flex PCB reference", alias: "flexible circuit board", category: "prototyping", description: "Flexible printed-circuit reference for wearable packaging whose outline and layer stack remain editable manufacturing inputs.", mechanical: { length: 70, width: 20, height: 0.3, integration: ["Respect the fabricator's dynamic/static bend radius and add rigidized connector zones.", "Provide strain relief and no sharp enclosure edges along bend regions."], exposedRegions: ["connector and rigidizer zones"] } },
];

export const EXPANDED_COMPONENT_DEFINITIONS: readonly ComponentDefinition[] = Object.freeze([
  ...I2C.map(i2c),
  ...ANALOG.map(analog),
  ...DIGITAL.map(digital),
  ...UART.map(uart),
  ...SPI.map(spi),
  ...PWM.map(pwm),
  ...DRIVEN.map(driven),
  ...REFERENCES.map(reference),
]);
