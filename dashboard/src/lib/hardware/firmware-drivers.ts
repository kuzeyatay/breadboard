// Per-part firmware templates.
//
// A driver turns one compiled placement into declarations, initialisation with
// a real failure message, and a one-line description of the API the generated
// application logic may call. Everything a driver emits is deterministic and
// references only pin constants the compiler produced.

export interface DriverContext {
  reference: string;
  /** Object name in the generated source, e.g. `bmeU2`. */
  variable: string;
  /** Pin constants for this part, keyed by its own pin id. */
  pinConstants: Record<string, string>;
  i2cAddress?: string;
  logicVoltage: number;
}

export interface FirmwareDriver {
  variablePrefix: string;
  libraries: string[];
  includes: string[];
  declarations(context: DriverContext): string[];
  /** Runs inside setup(). Must set `ok` to false when a part does not answer. */
  setup(context: DriverContext): string[];
  /** What the loop body may call, handed to the model as a contract. */
  api(context: DriverContext): string[];
  /** Deterministic loop lines used when no model logic is available. */
  fallbackLoop(context: DriverContext): string[];
}

const drivers: Record<string, FirmwareDriver> = {
  bme280: {
    variablePrefix: "bme",
    libraries: ["adafruit/Adafruit BME280 Library", "adafruit/Adafruit Unified Sensor"],
    includes: ["#include <Wire.h>", "#include <Adafruit_Sensor.h>", "#include <Adafruit_BME280.h>"],
    declarations: (context) => [`Adafruit_BME280 ${context.variable};`],
    setup: (context) => [
      `if (!${context.variable}.begin(I2C_ADDR_${context.reference})) {`,
      `  Serial.println(F("FAIL ${context.reference} BME280 did not answer at its I2C address. Check SDA, SCL, 3V3 and GND."));`,
      "  ok = false;",
      "} else {",
      `  Serial.println(F("OK   ${context.reference} BME280 ready"));`,
      "}",
    ],
    api: (context) => [
      `${context.variable}.readTemperature() -> float degrees Celsius`,
      `${context.variable}.readHumidity() -> float percent`,
      `${context.variable}.readPressure() -> float pascals`,
    ],
    fallbackLoop: (context) => [
      `Serial.print(F("${context.reference} temperature "));`,
      `Serial.print(${context.variable}.readTemperature(), 1);`,
      `Serial.print(F(" C, humidity "));`,
      `Serial.print(${context.variable}.readHumidity(), 1);`,
      `Serial.print(F(" %, pressure "));`,
      `Serial.print(${context.variable}.readPressure() / 100.0F, 1);`,
      `Serial.println(F(" hPa"));`,
    ],
  },

  "ssd1306-oled-128x64": {
    variablePrefix: "display",
    libraries: ["adafruit/Adafruit SSD1306", "adafruit/Adafruit GFX Library"],
    includes: ["#include <Wire.h>", "#include <Adafruit_GFX.h>", "#include <Adafruit_SSD1306.h>"],
    declarations: (context) => [
      "static const uint8_t OLED_WIDTH = 128;",
      "static const uint8_t OLED_HEIGHT = 64;",
      `Adafruit_SSD1306 ${context.variable}(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);`,
    ],
    setup: (context) => [
      `if (!${context.variable}.begin(SSD1306_SWITCHCAPVCC, I2C_ADDR_${context.reference})) {`,
      `  Serial.println(F("FAIL ${context.reference} SSD1306 did not answer at its I2C address. Check SDA, SCL, VCC and GND."));`,
      "  ok = false;",
      "} else {",
      `  ${context.variable}.clearDisplay();`,
      `  ${context.variable}.setTextSize(1);`,
      `  ${context.variable}.setTextColor(SSD1306_WHITE);`,
      `  ${context.variable}.setCursor(0, 0);`,
      `  ${context.variable}.println(F("Breadboard"));`,
      `  ${context.variable}.display();`,
      `  Serial.println(F("OK   ${context.reference} SSD1306 ready"));`,
      "}",
    ],
    api: (context) => [
      `${context.variable}.clearDisplay(), .setCursor(x, y), .println(text), .display()`,
    ],
    fallbackLoop: (context) => [
      `${context.variable}.clearDisplay();`,
      `${context.variable}.setCursor(0, 0);`,
      `${context.variable}.println(F("Running"));`,
      `${context.variable}.display();`,
    ],
  },

  dht22: {
    variablePrefix: "dht",
    libraries: ["adafruit/DHT sensor library", "adafruit/Adafruit Unified Sensor"],
    includes: ["#include <DHT.h>"],
    declarations: (context) => [
      `DHT ${context.variable}(${context.pinConstants.DATA}, DHT22);`,
    ],
    setup: (context) => [
      `${context.variable}.begin();`,
      `if (isnan(${context.variable}.readTemperature())) {`,
      `  Serial.println(F("FAIL ${context.reference} DHT22 returned no reading. Check the data pin and its 10k pull-up."));`,
      "  ok = false;",
      "} else {",
      `  Serial.println(F("OK   ${context.reference} DHT22 ready"));`,
      "}",
    ],
    api: (context) => [
      `${context.variable}.readTemperature() -> float degrees Celsius (NaN on failure)`,
      `${context.variable}.readHumidity() -> float percent (NaN on failure)`,
    ],
    fallbackLoop: (context) => [
      `Serial.print(F("${context.reference} temperature "));`,
      `Serial.print(${context.variable}.readTemperature(), 1);`,
      `Serial.print(F(" C, humidity "));`,
      `Serial.print(${context.variable}.readHumidity(), 1);`,
      `Serial.println(F(" %"));`,
    ],
  },

  "hc-sr04": {
    variablePrefix: "sonar",
    libraries: [],
    includes: [],
    declarations: (context) => [
      `// ${context.reference}: HC-SR04 read helper, generated from the compiled pins.`,
      `float ${context.variable}ReadCm() {`,
      `  digitalWrite(${context.pinConstants.TRIG}, LOW);`,
      "  delayMicroseconds(2);",
      `  digitalWrite(${context.pinConstants.TRIG}, HIGH);`,
      "  delayMicroseconds(10);",
      `  digitalWrite(${context.pinConstants.TRIG}, LOW);`,
      `  const unsigned long echoUs = pulseIn(${context.pinConstants.ECHO}, HIGH, 30000UL);`,
      "  return echoUs == 0 ? -1.0F : echoUs / 58.0F;",
      "}",
    ],
    setup: (context) => [
      `pinMode(${context.pinConstants.TRIG}, OUTPUT);`,
      `pinMode(${context.pinConstants.ECHO}, INPUT);`,
      `digitalWrite(${context.pinConstants.TRIG}, LOW);`,
      `Serial.println(F("OK   ${context.reference} HC-SR04 pins configured"));`,
    ],
    api: (context) => [
      `${context.variable}ReadCm() -> float centimetres, or -1 when nothing echoed back`,
    ],
    fallbackLoop: (context) => [
      `const float ${context.variable}Cm = ${context.variable}ReadCm();`,
      `Serial.print(F("${context.reference} distance "));`,
      `if (${context.variable}Cm < 0) { Serial.println(F("out of range")); }`,
      `else { Serial.print(${context.variable}Cm, 1); Serial.println(F(" cm")); }`,
    ],
  },

  "sg90-servo": {
    variablePrefix: "servo",
    libraries: ["arduino-libraries/Servo"],
    includes: ["#include <Servo.h>"],
    declarations: (context) => [`Servo ${context.variable};`],
    setup: (context) => [
      `${context.variable}.attach(${context.pinConstants.PWM});`,
      `${context.variable}.write(90);`,
      `Serial.println(F("OK   ${context.reference} servo centred at 90 degrees"));`,
    ],
    api: (context) => [`${context.variable}.write(angle) with angle between 0 and 180`],
    fallbackLoop: (context) => [
      `${context.variable}.write(0);`,
      "delay(600);",
      `${context.variable}.write(180);`,
      "delay(600);",
    ],
  },

  "relay-module-5v": {
    variablePrefix: "relay",
    libraries: [],
    includes: [],
    declarations: (context) => [
      `// ${context.reference}: most 5 V relay boards switch on when the input is pulled LOW.`,
      `static const uint8_t ${context.variable}OnLevel = LOW;`,
    ],
    setup: (context) => [
      `pinMode(${context.pinConstants.IN}, OUTPUT);`,
      `digitalWrite(${context.pinConstants.IN}, !${context.variable}OnLevel);`,
      `Serial.println(F("OK   ${context.reference} relay held open at start-up"));`,
    ],
    api: (context) => [
      `digitalWrite(${context.pinConstants.IN}, ${context.variable}OnLevel) closes the relay; the inverse opens it`,
    ],
    fallbackLoop: (context) => [
      `digitalWrite(${context.pinConstants.IN}, !${context.variable}OnLevel);`,
    ],
  },

  "led-5mm": {
    variablePrefix: "led",
    libraries: [],
    includes: [],
    declarations: () => [],
    setup: (context) => [
      `pinMode(${context.pinConstants.A}, OUTPUT);`,
      `digitalWrite(${context.pinConstants.A}, LOW);`,
      `Serial.println(F("OK   ${context.reference} LED pin configured"));`,
    ],
    api: (context) => [
      `digitalWrite(${context.pinConstants.A}, HIGH) turns ${context.reference} on, LOW turns it off`,
    ],
    fallbackLoop: (context) => [
      `digitalWrite(${context.pinConstants.A}, HIGH);`,
      "delay(500);",
      `digitalWrite(${context.pinConstants.A}, LOW);`,
      "delay(500);",
    ],
  },

  "push-button": {
    variablePrefix: "button",
    libraries: [],
    includes: [],
    declarations: () => [],
    setup: (context) => [
      `pinMode(${context.pinConstants["1"]}, INPUT_PULLUP);`,
      `Serial.println(F("OK   ${context.reference} button uses the internal pull-up"));`,
    ],
    api: (context) => [
      `digitalRead(${context.pinConstants["1"]}) == LOW while ${context.reference} is pressed`,
    ],
    fallbackLoop: (context) => [
      `if (digitalRead(${context.pinConstants["1"]}) == LOW) {`,
      `  Serial.println(F("${context.reference} pressed"));`,
      "}",
    ],
  },

  "dc-motor-5v": {
    variablePrefix: "motor",
    libraries: [],
    includes: [],
    declarations: (context) => [
      `// ${context.reference} is switched on the low side; the pin drives the gate.`,
      `static const uint8_t ${context.variable}Gate = ${context.pinConstants.GATE};`,
    ],
    setup: (context) => [
      `pinMode(${context.variable}Gate, OUTPUT);`,
      `digitalWrite(${context.variable}Gate, LOW);`,
      `Serial.println(F("OK   ${context.reference} motor driver held off"));`,
    ],
    api: (context) => [
      `digitalWrite(${context.variable}Gate, HIGH) runs ${context.reference}, LOW stops it; the pin is PWM-capable if you add speed control`,
    ],
    fallbackLoop: (context) => [
      `Serial.println(F("${context.reference} on"));`,
      `digitalWrite(${context.variable}Gate, HIGH);`,
      "delay(1000);",
      `Serial.println(F("${context.reference} off"));`,
      `digitalWrite(${context.variable}Gate, LOW);`,
      "delay(3000);",
    ],
  },

  "lcd1602-i2c": {
    variablePrefix: "lcd",
    libraries: ["marcoschwartz/LiquidCrystal_I2C"],
    includes: ["#include <Wire.h>", "#include <LiquidCrystal_I2C.h>"],
    declarations: (context) => [
      `LiquidCrystal_I2C ${context.variable}(I2C_ADDR_${context.reference}, 16, 2);`,
    ],
    setup: (context) => [
      `${context.variable}.init();`,
      `${context.variable}.backlight();`,
      `${context.variable}.setCursor(0, 0);`,
      `${context.variable}.print(F("Breadboard"));`,
      `Serial.println(F("OK   ${context.reference} LCD ready"));`,
    ],
    api: (context) => [
      `${context.variable}.clear(), .setCursor(column, row), .print(text) — 16 columns by 2 rows`,
    ],
    fallbackLoop: (context) => [
      `${context.variable}.setCursor(0, 1);`,
      `${context.variable}.print(millis() / 1000);`,
      `${context.variable}.print(F(" s   "));`,
    ],
  },

  "epaper-2in9": {
    variablePrefix: "epd",
    libraries: ["zinggjm/GxEPD2", "adafruit/Adafruit GFX Library"],
    includes: ["#include <GxEPD2_BW.h>"],
    declarations: (context) => [
      "// A full refresh takes about two seconds and the panel keeps its image",
      "// with no power, so redraw only when something actually changes.",
      `GxEPD2_BW<GxEPD2_290_T94, GxEPD2_290_T94::HEIGHT> ${context.variable}(`,
      `  GxEPD2_290_T94(${context.pinConstants.CS}, ${context.pinConstants.DC}, ${context.pinConstants.RST}, ${context.pinConstants.BUSY}));`,
    ],
    setup: (context) => [
      `${context.variable}.init(SERIAL_BAUD);`,
      `${context.variable}.setRotation(1);`,
      `${context.variable}.setTextColor(GxEPD_BLACK);`,
      `${context.variable}.setFullWindow();`,
      `${context.variable}.firstPage();`,
      "do {",
      `  ${context.variable}.fillScreen(GxEPD_WHITE);`,
      `  ${context.variable}.setCursor(10, 30);`,
      `  ${context.variable}.print(F("Breadboard"));`,
      `} while (${context.variable}.nextPage());`,
      `${context.variable}.hibernate();`,
      `Serial.println(F("OK   ${context.reference} e-paper drew its first page"));`,
    ],
    api: (context) => [
      `${context.variable}.setFullWindow(), .firstPage()/.nextPage() to draw a page, .hibernate() afterwards`,
    ],
    fallbackLoop: (context) => [
      `Serial.println(F("${context.reference} holding its page"));`,
      "delay(10000);",
    ],
  },

  "ds1307-rtc": {
    variablePrefix: "rtc",
    libraries: ["adafruit/RTClib"],
    includes: ["#include <Wire.h>", "#include <RTClib.h>"],
    declarations: (context) => [`RTC_DS1307 ${context.variable};`],
    setup: (context) => [
      `if (!${context.variable}.begin()) {`,
      `  Serial.println(F("FAIL ${context.reference} clock did not answer. Check SDA, SCL and its coin cell."));`,
      "  ok = false;",
      `} else if (!${context.variable}.isrunning()) {`,
      `  ${context.variable}.adjust(DateTime(F(__DATE__), F(__TIME__)));`,
      `  Serial.println(F("OK   ${context.reference} clock set from this build's time"));`,
      "} else {",
      `  Serial.println(F("OK   ${context.reference} clock running"));`,
      "}",
    ],
    api: (context) => [
      `${context.variable}.now() -> DateTime with .year(), .hour(), .minute(), .second()`,
    ],
    fallbackLoop: (context) => [
      `const DateTime ${context.variable}Now = ${context.variable}.now();`,
      `Serial.print(F("${context.reference} time "));`,
      `Serial.print(${context.variable}Now.hour());`,
      `Serial.print(F(":"));`,
      `Serial.println(${context.variable}Now.minute());`,
    ],
  },

  mpu6050: {
    variablePrefix: "imu",
    libraries: ["adafruit/Adafruit MPU6050", "adafruit/Adafruit Unified Sensor"],
    includes: ["#include <Wire.h>", "#include <Adafruit_MPU6050.h>"],
    declarations: (context) => [`Adafruit_MPU6050 ${context.variable};`],
    setup: (context) => [
      `if (!${context.variable}.begin(I2C_ADDR_${context.reference})) {`,
      `  Serial.println(F("FAIL ${context.reference} MPU-6050 did not answer. Check SDA, SCL and AD0."));`,
      "  ok = false;",
      "} else {",
      `  ${context.variable}.setAccelerometerRange(MPU6050_RANGE_8_G);`,
      `  ${context.variable}.setGyroRange(MPU6050_RANGE_500_DEG);`,
      `  Serial.println(F("OK   ${context.reference} MPU-6050 ready"));`,
      "}",
    ],
    api: (context) => [
      `${context.variable}.getEvent(&accel, &gyro, &temp) with sensors_event_t values`,
    ],
    fallbackLoop: (context) => [
      "sensors_event_t accel, gyro, temp;",
      `${context.variable}.getEvent(&accel, &gyro, &temp);`,
      `Serial.print(F("${context.reference} accel "));`,
      "Serial.print(accel.acceleration.x, 2);",
      `Serial.print(F(" "));`,
      "Serial.print(accel.acceleration.y, 2);",
      `Serial.print(F(" "));`,
      "Serial.println(accel.acceleration.z, 2);",
    ],
  },

  bmp280: {
    variablePrefix: "baro",
    libraries: ["adafruit/Adafruit BMP280 Library", "adafruit/Adafruit Unified Sensor"],
    includes: ["#include <Wire.h>", "#include <Adafruit_BMP280.h>"],
    declarations: (context) => [`Adafruit_BMP280 ${context.variable};`],
    setup: (context) => [
      `if (!${context.variable}.begin(I2C_ADDR_${context.reference})) {`,
      `  Serial.println(F("FAIL ${context.reference} BMP280 did not answer at its I2C address."));`,
      "  ok = false;",
      "} else {",
      `  Serial.println(F("OK   ${context.reference} BMP280 ready"));`,
      "}",
    ],
    api: (context) => [
      `${context.variable}.readTemperature() -> float Celsius`,
      `${context.variable}.readPressure() -> float pascals`,
    ],
    fallbackLoop: (context) => [
      `Serial.print(F("${context.reference} pressure "));`,
      `Serial.print(${context.variable}.readPressure() / 100.0F, 1);`,
      `Serial.println(F(" hPa"));`,
    ],
  },

  bh1750: {
    variablePrefix: "lux",
    libraries: ["claws/BH1750"],
    includes: ["#include <Wire.h>", "#include <BH1750.h>"],
    declarations: (context) => [`BH1750 ${context.variable}(I2C_ADDR_${context.reference});`],
    setup: (context) => [
      `if (!${context.variable}.begin()) {`,
      `  Serial.println(F("FAIL ${context.reference} light sensor did not answer."));`,
      "  ok = false;",
      "} else {",
      `  Serial.println(F("OK   ${context.reference} light sensor ready"));`,
      "}",
    ],
    api: (context) => [`${context.variable}.readLightLevel() -> float lux`],
    fallbackLoop: (context) => [
      `Serial.print(F("${context.reference} light "));`,
      `Serial.print(${context.variable}.readLightLevel(), 1);`,
      `Serial.println(F(" lx"));`,
    ],
  },

  ds18b20: {
    variablePrefix: "probe",
    libraries: ["paulstoffregen/OneWire", "milesburton/DallasTemperature"],
    includes: ["#include <OneWire.h>", "#include <DallasTemperature.h>"],
    declarations: (context) => [
      `OneWire ${context.variable}Bus(${context.pinConstants.DQ});`,
      `DallasTemperature ${context.variable}(&${context.variable}Bus);`,
    ],
    setup: (context) => [
      `${context.variable}.begin();`,
      `if (${context.variable}.getDeviceCount() == 0) {`,
      `  Serial.println(F("FAIL ${context.reference} no 1-Wire device answered. Check the data pin and its 4.7k pull-up."));`,
      "  ok = false;",
      "} else {",
      `  Serial.println(F("OK   ${context.reference} DS18B20 found"));`,
      "}",
    ],
    api: (context) => [
      `${context.variable}.requestTemperatures() then ${context.variable}.getTempCByIndex(0) -> float Celsius`,
    ],
    fallbackLoop: (context) => [
      `${context.variable}.requestTemperatures();`,
      `Serial.print(F("${context.reference} temperature "));`,
      `Serial.print(${context.variable}.getTempCByIndex(0), 1);`,
      `Serial.println(F(" C"));`,
    ],
  },

  "microsd-module": {
    variablePrefix: "card",
    libraries: [],
    includes: ["#include <SPI.h>", "#include <SD.h>"],
    declarations: () => [],
    setup: (context) => [
      `if (!SD.begin(${context.pinConstants.CS})) {`,
      `  Serial.println(F("FAIL ${context.reference} no card. Check it is formatted FAT32 and fully inserted."));`,
      "  ok = false;",
      "} else {",
      `  Serial.println(F("OK   ${context.reference} card mounted"));`,
      "}",
    ],
    api: () => [
      "SD.open(path, FILE_READ or FILE_WRITE), file.read(), file.println(), file.close()",
    ],
    fallbackLoop: (context) => [
      `File ${context.variable}Root = SD.open("/");`,
      `File ${context.variable}Entry = ${context.variable}Root.openNextFile();`,
      `Serial.print(F("${context.reference} first entry "));`,
      `Serial.println(${context.variable}Entry ? ${context.variable}Entry.name() : "(empty)");`,
      `if (${context.variable}Entry) ${context.variable}Entry.close();`,
      `${context.variable}Root.close();`,
    ],
  },

  "ws2812b-pixel": {
    variablePrefix: "pixels",
    libraries: ["adafruit/Adafruit NeoPixel"],
    includes: ["#include <Adafruit_NeoPixel.h>"],
    declarations: (context) => [
      "// Raise the count to match how many pixels are chained from DOUT.",
      `static const uint16_t ${context.variable}Count = 1;`,
      `Adafruit_NeoPixel ${context.variable}(${context.variable}Count, ${context.pinConstants.DIN}, NEO_GRB + NEO_KHZ800);`,
    ],
    setup: (context) => [
      `${context.variable}.begin();`,
      `${context.variable}.setBrightness(40);`,
      `${context.variable}.clear();`,
      `${context.variable}.show();`,
      `Serial.println(F("OK   ${context.reference} pixels cleared"));`,
    ],
    api: (context) => [
      `${context.variable}.setPixelColor(index, ${context.variable}.Color(r, g, b)) then ${context.variable}.show()`,
    ],
    fallbackLoop: (context) => [
      `${context.variable}.setPixelColor(0, ${context.variable}.Color(0, 40, 0));`,
      `${context.variable}.show();`,
      "delay(500);",
      `${context.variable}.clear();`,
      `${context.variable}.show();`,
      "delay(500);",
    ],
  },

  "rgb-led": {
    variablePrefix: "rgb",
    libraries: [],
    includes: [],
    declarations: (context) => [
      "// Common cathode: a higher value is a brighter channel.",
      `void ${context.variable}Set(uint8_t red, uint8_t green, uint8_t blue) {`,
      `  analogWrite(${context.pinConstants.R}, red);`,
      `  analogWrite(${context.pinConstants.G}, green);`,
      `  analogWrite(${context.pinConstants.B}, blue);`,
      "}",
    ],
    setup: (context) => [
      `pinMode(${context.pinConstants.R}, OUTPUT);`,
      `pinMode(${context.pinConstants.G}, OUTPUT);`,
      `pinMode(${context.pinConstants.B}, OUTPUT);`,
      `${context.variable}Set(0, 0, 0);`,
      `Serial.println(F("OK   ${context.reference} RGB LED off"));`,
    ],
    api: (context) => [`${context.variable}Set(red, green, blue) with each channel 0 to 255`],
    fallbackLoop: (context) => [
      `${context.variable}Set(60, 0, 0);`,
      "delay(400);",
      `${context.variable}Set(0, 60, 0);`,
      "delay(400);",
      `${context.variable}Set(0, 0, 60);`,
      "delay(400);",
    ],
  },

  "rotary-encoder": {
    variablePrefix: "knob",
    libraries: [],
    includes: [],
    declarations: (context) => [
      `// Quadrature read without interrupts: call ${context.variable}Read() often.`,
      `int ${context.variable}Position = 0;`,
      `uint8_t ${context.variable}LastClk = HIGH;`,
      `int ${context.variable}Read() {`,
      `  const uint8_t clk = digitalRead(${context.pinConstants.CLK});`,
      `  if (clk != ${context.variable}LastClk && clk == LOW) {`,
      `    ${context.variable}Position += digitalRead(${context.pinConstants.DT}) == clk ? 1 : -1;`,
      "  }",
      `  ${context.variable}LastClk = clk;`,
      `  return ${context.variable}Position;`,
      "}",
    ],
    setup: (context) => [
      `pinMode(${context.pinConstants.CLK}, INPUT_PULLUP);`,
      `pinMode(${context.pinConstants.DT}, INPUT_PULLUP);`,
      `pinMode(${context.pinConstants.SW}, INPUT_PULLUP);`,
      `${context.variable}LastClk = digitalRead(${context.pinConstants.CLK});`,
      `Serial.println(F("OK   ${context.reference} encoder ready"));`,
    ],
    api: (context) => [
      `${context.variable}Read() -> int position, counting up clockwise`,
      `digitalRead(${context.pinConstants.SW}) == LOW while the knob is pressed`,
    ],
    fallbackLoop: (context) => [
      `const int ${context.variable}Now = ${context.variable}Read();`,
      `static int ${context.variable}Shown = 0;`,
      `if (${context.variable}Now != ${context.variable}Shown) {`,
      `  ${context.variable}Shown = ${context.variable}Now;`,
      `  Serial.print(F("${context.reference} position "));`,
      `  Serial.println(${context.variable}Now);`,
      "}",
    ],
  },

  "membrane-keypad": {
    variablePrefix: "keys",
    libraries: ["chris--a/Keypad"],
    includes: ["#include <Keypad.h>"],
    declarations: (context) => [
      "const byte KEYPAD_ROWS = 4;",
      "const byte KEYPAD_COLS = 3;",
      "char keypadLayout[KEYPAD_ROWS][KEYPAD_COLS] = {",
      `  { '1', '2', '3' },`,
      `  { '4', '5', '6' },`,
      `  { '7', '8', '9' },`,
      `  { '*', '0', '#' },`,
      "};",
      `byte ${context.variable}Rows[KEYPAD_ROWS] = { ${context.pinConstants.R1}, ${context.pinConstants.R2}, ${context.pinConstants.R3}, ${context.pinConstants.R4} };`,
      `byte ${context.variable}Cols[KEYPAD_COLS] = { ${context.pinConstants.C1}, ${context.pinConstants.C2}, ${context.pinConstants.C3} };`,
      `Keypad ${context.variable} = Keypad(makeKeymap(keypadLayout), ${context.variable}Rows, ${context.variable}Cols, KEYPAD_ROWS, KEYPAD_COLS);`,
    ],
    setup: (context) => [`Serial.println(F("OK   ${context.reference} keypad scanning"));`],
    api: (context) => [
      `${context.variable}.getKey() -> char, or NO_KEY when nothing is pressed`,
    ],
    fallbackLoop: (context) => [
      `const char ${context.variable}Pressed = ${context.variable}.getKey();`,
      `if (${context.variable}Pressed) {`,
      `  Serial.print(F("${context.reference} key "));`,
      `  Serial.println(${context.variable}Pressed);`,
      "}",
    ],
  },

  "passive-buzzer": {
    variablePrefix: "buzzer",
    libraries: [],
    includes: [],
    declarations: (context) => [
      `static const uint8_t ${context.variable}Pin = ${context.pinConstants["1"]};`,
    ],
    setup: (context) => [
      `pinMode(${context.variable}Pin, OUTPUT);`,
      `noTone(${context.variable}Pin);`,
      `Serial.println(F("OK   ${context.reference} buzzer silent"));`,
    ],
    api: (context) => [
      `tone(${context.variable}Pin, hertz) starts a note, noTone(${context.variable}Pin) stops it`,
    ],
    fallbackLoop: (context) => [
      `tone(${context.variable}Pin, 880);`,
      "delay(150);",
      `noTone(${context.variable}Pin);`,
      "delay(1850);",
    ],
  },

  "stepper-28byj48": {
    variablePrefix: "stepper",
    libraries: ["arduino-libraries/Stepper"],
    includes: ["#include <Stepper.h>"],
    declarations: (context) => [
      "// 2048 steps per turn through the 28BYJ-48's internal gearbox.",
      "static const int STEPS_PER_REVOLUTION = 2048;",
      `Stepper ${context.variable}(STEPS_PER_REVOLUTION, ${context.pinConstants.IN1}, ${context.pinConstants.IN3}, ${context.pinConstants.IN2}, ${context.pinConstants.IN4});`,
    ],
    setup: (context) => [
      `${context.variable}.setSpeed(10);`,
      `Serial.println(F("OK   ${context.reference} stepper ready"));`,
    ],
    api: (context) => [
      `${context.variable}.step(steps) turns the shaft; negative steps go the other way`,
    ],
    fallbackLoop: (context) => [
      `${context.variable}.step(STEPS_PER_REVOLUTION / 4);`,
      "delay(1000);",
    ],
  },

  potentiometer: {
    variablePrefix: "pot",
    libraries: [],
    includes: [],
    declarations: () => [],
    setup: (context) => [
      `Serial.println(F("OK   ${context.reference} analog input ready"));`,
    ],
    api: (context) => [
      `analogRead(${context.pinConstants.SIG}) -> raw ADC counts from ${context.reference}`,
    ],
    fallbackLoop: (context) => [
      `Serial.print(F("${context.reference} raw "));`,
      `Serial.println(analogRead(${context.pinConstants.SIG}));`,
    ],
  },
};


/**
 * The driver for a part with no hand-written template. It is built from the
 * pins the compiler actually assigned, so a part the library knows about but
 * has no library binding for still gets configured and read — rather than being
 * silently missing while the firmware reports that everything initialised.
 */
export function genericDriver(input: {
  definitionId: string;
  /** Peripheral pins that reached a controller pin, with their kinds. */
  signals: Array<{ pinId: string; label: string; kind: "in" | "out" | "analog" }>;
}): FirmwareDriver {
  const { signals } = input;
  const readable = signals.filter((signal) => signal.kind !== "out");

  return {
    variablePrefix: "part",
    libraries: [],
    includes: [],
    declarations: () => [],
    setup: (context) => [
      ...signals.flatMap((signal) => {
        const constant = context.pinConstants[signal.pinId];
        if (!constant) return [];
        if (signal.kind === "out") {
          return [`pinMode(${constant}, OUTPUT);`, `digitalWrite(${constant}, LOW);`];
        }
        if (signal.kind === "analog") return [];
        return [`pinMode(${constant}, INPUT_PULLUP);`];
      }),
      `Serial.println(F("OK   ${context.reference} pins configured"));`,
    ],
    api: (context) =>
      signals.flatMap((signal) => {
        const constant = context.pinConstants[signal.pinId];
        if (!constant) return [];
        if (signal.kind === "out") {
          return [`digitalWrite(${constant}, HIGH or LOW) drives ${context.reference} ${signal.label}`];
        }
        if (signal.kind === "analog") {
          return [`analogRead(${constant}) reads ${context.reference} ${signal.label}`];
        }
        return [`digitalRead(${constant}) reads ${context.reference} ${signal.label}`];
      }),
    fallbackLoop: (context) =>
      readable.flatMap((signal) => {
        const constant = context.pinConstants[signal.pinId];
        if (!constant) return [];
        const read = signal.kind === "analog" ? "analogRead" : "digitalRead";
        return [
          `Serial.print(F("${context.reference} ${signal.label} "));`,
          `Serial.println(${read}(${constant}));`,
        ];
      }),
  };
}

export function firmwareDriver(definitionId: string): FirmwareDriver | null {
  return drivers[definitionId] ?? null;
}
