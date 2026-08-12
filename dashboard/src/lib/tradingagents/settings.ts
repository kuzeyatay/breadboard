// What a TradingAgents run uses for everything the request form does not ask.
//
// The values themselves live where every other agent's defaults live — the
// per-user agent-settings catalog and store. This module is only the vocabulary
// in between: the vendor chains the framework accepts, and the translation from
// catalog values into the shape the bridge is handed.
//
// Two of the fields deserve a note. TradingAgents runs a "deep think" model (the
// research manager, the trader, the portfolio manager) and a "quick think" model
// (the analysts and their tool loops). Empty means "follow this chat's model",
// which is the default so the agent behaves like every other Breadboard surface;
// naming a model pins that role to it instead.

import type { AgentSettingValues } from "../agent-settings/catalog.ts";
import {
  DEFAULT_TRADINGAGENTS_REQUEST,
  MAX_TRADINGAGENTS_ROUNDS,
  parseAnalysts,
  type TradingAgentsAnalyst,
  type TradingAgentsAssetType,
} from "./identity.ts";

/**
 * The vendor chains offered for price and news data. The framework treats the
 * configured value as the exact chain — it never silently falls back to a vendor
 * that was not chosen — so a chain has to be spelled out to exist.
 */
export const VENDOR_CHOICES = [
  {
    value: "yfinance",
    label: "Yahoo Finance",
    help: "No account needed. The default for every category.",
    needsKey: null,
  },
  {
    value: "alpha_vantage",
    label: "Alpha Vantage",
    help: "Needs a free API key. Rate-limited, but an independent source.",
    needsKey: "alphaVantage" as const,
  },
  {
    value: "yfinance,alpha_vantage",
    label: "Yahoo Finance, then Alpha Vantage",
    help: "Falls back to Alpha Vantage when Yahoo returns nothing.",
    needsKey: "alphaVantage" as const,
  },
] as const;

export type VendorChoice = (typeof VENDOR_CHOICES)[number]["value"];

export const REASONING_EFFORTS = ["", "low", "medium", "high", "xhigh"] as const;
export type TradingAgentsEffort = (typeof REASONING_EFFORTS)[number];

export interface TradingAgentsSettings {
  analysts: TradingAgentsAnalyst[];
  researchDepth: number;
  riskRounds: number;
  assetType: TradingAgentsAssetType;
  /** Empty follows the chat's model. */
  deepModel: string;
  quickModel: string;
  /** Empty follows the chat's reasoning effort. */
  reasoningEffort: TradingAgentsEffort;
  outputLanguage: string;
  marketVendor: VendorChoice;
  newsVendor: VendorChoice;
}

export const DEFAULT_TRADINGAGENTS_SETTINGS: TradingAgentsSettings = {
  analysts: [...DEFAULT_TRADINGAGENTS_REQUEST.analysts],
  researchDepth: DEFAULT_TRADINGAGENTS_REQUEST.researchDepth,
  riskRounds: DEFAULT_TRADINGAGENTS_REQUEST.riskRounds,
  assetType: DEFAULT_TRADINGAGENTS_REQUEST.assetType,
  deepModel: "",
  quickModel: "",
  reasoningEffort: "",
  outputLanguage: "English",
  marketVendor: "yfinance",
  newsVendor: "yfinance",
};

const VENDOR_SET = new Set<string>(VENDOR_CHOICES.map((choice) => choice.value));
const MAX_MODEL_LENGTH = 120;
const MAX_LANGUAGE_LENGTH = 40;

function clampRounds(value: unknown, fallback: number): number {
  const rounds = Math.trunc(Number(value));
  if (!Number.isFinite(rounds)) return fallback;
  return Math.min(Math.max(rounds, 1), MAX_TRADINGAGENTS_ROUNDS);
}

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function vendor(value: unknown, fallback: VendorChoice): VendorChoice {
  return typeof value === "string" && VENDOR_SET.has(value) ? (value as VendorChoice) : fallback;
}

/**
 * Read the catalog's stored values as run settings. The catalog already
 * normalised them, so this only maps names and applies the defaults for
 * anything an older stored row is missing.
 */
export function tradingAgentsSettingsFrom(values: AgentSettingValues): TradingAgentsSettings {
  const analysts = parseAnalysts(values.analysts);
  const effort = typeof values.reasoningEffort === "string" ? values.reasoningEffort : "";
  return {
    analysts: analysts.length ? analysts : [...DEFAULT_TRADINGAGENTS_SETTINGS.analysts],
    researchDepth: clampRounds(values.researchDepth, DEFAULT_TRADINGAGENTS_SETTINGS.researchDepth),
    riskRounds: clampRounds(values.riskRounds, DEFAULT_TRADINGAGENTS_SETTINGS.riskRounds),
    assetType: values.assetType === "crypto" ? "crypto" : "stock",
    deepModel: boundedText(values.deepModel, MAX_MODEL_LENGTH),
    quickModel: boundedText(values.quickModel, MAX_MODEL_LENGTH),
    // "chat" is the catalog's way of spelling "follow the chat", because a
    // select cannot offer an empty option that reads as anything.
    reasoningEffort:
      effort && effort !== "chat" && (REASONING_EFFORTS as readonly string[]).includes(effort)
        ? (effort as TradingAgentsEffort)
        : "",
    outputLanguage: boundedText(values.outputLanguage, MAX_LANGUAGE_LENGTH) || "English",
    marketVendor: vendor(values.marketVendor, "yfinance"),
    newsVendor: vendor(values.newsVendor, "yfinance"),
  };
}

/**
 * The `data_vendors` override the bridge passes into the framework's config.
 * Only the categories the settings expose are sent; macro data and prediction
 * markets keep upstream's own defaults.
 */
export function dataVendorsFor(settings: TradingAgentsSettings): Record<string, string> {
  return {
    core_stock_apis: settings.marketVendor,
    technical_indicators: settings.marketVendor,
    fundamental_data: settings.marketVendor,
    news_data: settings.newsVendor,
  };
}
