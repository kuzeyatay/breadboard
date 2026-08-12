// Wire styling shared by the wiring diagram, the schematic and their legend.
//
// Colour is never the only signal: every role also carries a dash pattern and a
// written label, so the diagram still reads when colour does not.

import type { NetRole } from "./types.ts";

export interface NetStyle {
  role: NetRole;
  label: string;
  color: string;
  /** SVG stroke-dasharray, or null for a solid line. */
  dash: string | null;
  description: string;
}

const STYLES: Record<NetRole, NetStyle> = {
  power: {
    role: "power",
    label: "Power",
    color: "#d1453b",
    dash: null,
    description: "Positive supply rail.",
  },
  ground: {
    role: "ground",
    label: "Ground",
    color: "#2f3437",
    dash: null,
    description: "Common ground. Everything returns here.",
  },
  "i2c-scl": {
    role: "i2c-scl",
    label: "I²C clock",
    color: "#c99000",
    dash: "7 4",
    description: "Shared I²C clock line.",
  },
  "i2c-sda": {
    role: "i2c-sda",
    label: "I²C data",
    color: "#2b6cb0",
    dash: "2 4",
    description: "Shared I²C data line.",
  },
  "spi-clock": {
    role: "spi-clock",
    label: "SPI clock",
    color: "#c99000",
    dash: "7 4",
    description: "Shared SPI clock line.",
  },
  "spi-data": {
    role: "spi-data",
    label: "SPI data",
    color: "#2b6cb0",
    dash: "2 4",
    description: "Shared SPI data line (MOSI or MISO).",
  },
  "chip-select": {
    role: "chip-select",
    label: "Chip select",
    color: "#d2691e",
    dash: "10 3 2 3",
    description: "One per SPI device; selects which chip is being addressed.",
  },
  "uart-tx": {
    role: "uart-tx",
    label: "UART TX",
    color: "#d2691e",
    dash: "10 3",
    description: "Controller transmit, wired to the device's receive pin.",
  },
  "uart-rx": {
    role: "uart-rx",
    label: "UART RX",
    color: "#d2691e",
    dash: "3 3",
    description: "Controller receive, wired to the device's transmit pin.",
  },
  analog: {
    role: "analog",
    label: "Analog",
    color: "#7b4fb5",
    dash: "6 3",
    description: "Analog voltage read by an ADC input.",
  },
  digital: {
    role: "digital",
    label: "Signal",
    color: "#2f855a",
    dash: null,
    description: "General digital signal.",
  },
  other: {
    role: "other",
    label: "Other",
    color: "#6b7280",
    dash: "4 4",
    description: "Anything that does not fit the roles above.",
  },
};

export function netStyle(role: NetRole): NetStyle {
  return STYLES[role] ?? STYLES.other;
}

/** The legend for a design: one row per role actually present. */
export function netLegend(roles: NetRole[]): NetStyle[] {
  const seen = new Set<string>();
  const legend: NetStyle[] = [];
  for (const role of roles) {
    const style = netStyle(role);
    if (seen.has(style.label)) continue;
    seen.add(style.label);
    legend.push(style);
  }
  return legend;
}
