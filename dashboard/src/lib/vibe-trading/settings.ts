// What a Vibe Trading run uses for everything the prompt does not say.
//
// The values themselves live where every other agent's defaults live — the
// per-user agent-settings catalog and store. This module is only the vocabulary
// in between: the choices the catalog offers, and the translation from stored
// values into the environment the supervised service is started with.
//
// Every field here maps to a real environment variable the clone reads at boot
// (see agent/src/config/env_schema.py). Nothing is invented: a setting that the
// clone cannot honour would be a lie told in a settings dialog. That is also why
// there is no "steps per run" field — the session runtime pins the agent loop to
// 50 iterations in code, with no env override.

import type { AgentSettingValues } from "../agent-settings/catalog.ts";

/**
 * The clone's memory lifecycle presets, as its own .env documents them. Memory
 * is per-workspace and survives runs, which is why it is off by default: a
 * research agent that remembers last week's thesis is a different tool from one
 * that does not, and that should be the user's choice.
 */
export const MEMORY_PRESETS = [
  {
    value: "off",
    label: "Off",
    help: "Each run starts clean. No lifecycle management.",
  },
  {
    value: "on",
    label: "On",
    help: "Quality scoring, auto-decay and garbage collection across runs.",
  },
  {
    value: "full",
    label: "Full",
    help: "Adds hierarchy, semantic links, compression and full-text search.",
  },
] as const;

export type MemoryPreset = (typeof MEMORY_PRESETS)[number]["value"];

/**
 * The crypto exchange the clone's ccxt fallback reads when the OKX public API is
 * unreachable. OKX itself is always tried first and needs no configuration.
 */
export const CRYPTO_EXCHANGES = [
  { value: "binance", label: "Binance" },
  { value: "coinbase", label: "Coinbase" },
  { value: "kraken", label: "Kraken" },
  { value: "bybit", label: "Bybit" },
] as const;

export type CryptoExchange = (typeof CRYPTO_EXCHANGES)[number]["value"];

export interface VibeTradingSettings {
  /** Empty follows the chat's model. */
  model: string;
  /** The clone's own default is 0.0 — research answers should be reproducible. */
  temperature: number;
  memory: MemoryPreset;
  /** Cache settled historical bars so repeat backtests skip the network. */
  dataCache: boolean;
  cryptoExchange: CryptoExchange;
}

export const DEFAULT_VIBE_TRADING_SETTINGS: VibeTradingSettings = {
  model: "",
  temperature: 0,
  memory: "off",
  dataCache: true,
  cryptoExchange: "binance",
};

const MEMORY_SET = new Set<string>(MEMORY_PRESETS.map((preset) => preset.value));
const EXCHANGE_SET = new Set<string>(CRYPTO_EXCHANGES.map((exchange) => exchange.value));
const MAX_MODEL_LENGTH = 120;

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function clampTemperature(value: unknown, fallback: number): number {
  const temperature = Number(value);
  if (!Number.isFinite(temperature)) return fallback;
  // The clone forwards this to whichever provider is configured, and the
  // OpenAI-compatible range is the only one every relay accepts.
  return Math.min(Math.max(Math.round(temperature * 100) / 100, 0), 2);
}

/**
 * Read the catalog's stored values as run settings. The catalog already
 * normalised them, so this only maps names and applies the defaults for
 * anything an older stored row is missing.
 */
export function vibeTradingSettingsFrom(values: AgentSettingValues): VibeTradingSettings {
  const memory = typeof values.memory === "string" ? values.memory : "";
  const exchange = typeof values.cryptoExchange === "string" ? values.cryptoExchange : "";
  return {
    model: boundedText(values.model, MAX_MODEL_LENGTH),
    temperature: clampTemperature(values.temperature, DEFAULT_VIBE_TRADING_SETTINGS.temperature),
    memory: MEMORY_SET.has(memory) ? (memory as MemoryPreset) : "off",
    // An unset boolean has to read as the default rather than as false, or every
    // stored row written before this field existed would silently disable it.
    dataCache: typeof values.dataCache === "boolean" ? values.dataCache : true,
    cryptoExchange: EXCHANGE_SET.has(exchange) ? (exchange as CryptoExchange) : "binance",
  };
}

/**
 * The environment overrides these settings become. Read once by the clone at
 * boot, which is why ./service.ts restarts the service when they change.
 */
export function settingsEnv(settings: VibeTradingSettings): Record<string, string> {
  return {
    LANGCHAIN_TEMPERATURE: String(settings.temperature),
    VT_MEMORY: settings.memory,
    VIBE_TRADING_DATA_CACHE: settings.dataCache ? "1" : "0",
    CCXT_EXCHANGE: settings.cryptoExchange,
  };
}
