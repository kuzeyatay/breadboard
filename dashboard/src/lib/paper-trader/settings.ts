// What the desk uses for everything a message does not say — which is all of it,
// because a message to this agent only starts, stops or shows the desk.
//
// The values live where every other agent's defaults live: the per-user
// agent-settings catalog and store. This module is the vocabulary in between,
// and the place the one setting with real consequences is explained.
//
// **Starting capital.** The arena opens an account with a fixed initial capital
// and every return figure on the card is measured against it. It cannot be
// changed underneath a running portfolio without making that history meaningless,
// and the clone's own account API has no field for it either. So a changed
// amount is applied the next time the desk is started, by retiring the old
// account and opening a new one — a fresh portfolio, from zero, on the new
// capital. The desk says so before it does it.

import type { AgentSettingValues } from "../agent-settings/catalog.ts";
import {
  instrumentsFor,
  PAPER_TRADER_SYMBOLS,
  parseStockTickers,
  type Instrument,
  type PaperTraderSymbol,
} from "./identity.ts";
import type { TradingAgentsAnalyst } from "../tradingagents/identity.ts";
import { parseAnalysts } from "../tradingagents/identity.ts";

export const MIN_STARTING_CAPITAL = 100;
export const MAX_STARTING_CAPITAL = 10_000_000;
export const DEFAULT_STARTING_CAPITAL = 10_000;

/** How often the arena asks for a decision, and therefore how often it trades. */
export const CYCLE_CHOICES = [5, 10, 15, 30, 60] as const;
export type CycleMinutes = (typeof CYCLE_CHOICES)[number];

export interface PaperTraderSettings {
  /** The capital a newly opened desk starts with, in USD. */
  startingCapital: number;
  /** The coins TradingAgents is allowed to look at. */
  symbols: PaperTraderSymbol[];
  /** Internal compatibility shape; the current settings UI never asks for tickers. */
  stocks: string[];
  /** Minutes between trading cycles. */
  cycleMinutes: CycleMinutes;
  /** Hard ceiling for new-position notional, measured against available cash. */
  positionSize: number;
  /** Leverage a new position is opened with. 1 is spot. */
  leverage: number;
  /** Whether a bearish verdict on a coin with no position opens a short. */
  allowShorts: boolean;
  /** The TradingAgents analysts each cycle runs. */
  analysts: TradingAgentsAnalyst[];
  /** Bull/bear debate rounds per analysis. */
  researchDepth: number;
  /** Rounds of the risk discussion per analysis. */
  riskRounds: number;

  // ---- the committee (see ./committee.ts and ./risk.ts) --------------------

  /** Ask Vibe Trading's quant loop what regime the desk's coins are in. */
  consultVibeTrading: boolean;
  /** Ask the Stock Analyst what the equity markets say about risk appetite. */
  consultStockAnalyst: boolean;
  /** How many cycles an adviser's note is kept before it is asked again. */
  adviceEveryCycles: number;
  /** Weigh the seats against each other rather than acting on the firm alone. */
  harmonise: boolean;
  /** Below this the committee's verdict is not acted on. */
  minConfidence: number;
  /** How many coins the desk may hold at once. */
  maxOpenPositions: number;
  /** Fraction of starting capital that may be lost before it only closes. */
  maxDrawdown: number;
  /** Consecutive losing closes on one coin before it is left alone. */
  losingStreakLimit: number;
}

export const DEFAULT_PAPER_TRADER_SETTINGS: PaperTraderSettings = {
  startingCapital: DEFAULT_STARTING_CAPITAL,
  symbols: ["BTC", "ETH", "SOL"],
  // The current desk discovers company shares automatically. This field stays
  // in the internal shape so older callers do not break; the settings catalog
  // deliberately does not expose or persist manual stock tickers.
  stocks: [],
  cycleMinutes: 15,
  positionSize: 0.2,
  leverage: 2,
  allowShorts: true,
  // Fundamentals is deliberately absent: the analyst reads company financials
  // and insider filings, and a coin has neither.
  analysts: ["market", "social", "news"],
  researchDepth: 1,
  riskRounds: 1,
  consultVibeTrading: true,
  // Off by default: it is the one seat whose answer is about a different asset
  // class, so it is worth having on purpose rather than by accident.
  consultStockAnalyst: false,
  adviceEveryCycles: 8,
  harmonise: true,
  minConfidence: 0.5,
  maxOpenPositions: 3,
  maxDrawdown: 0.25,
  losingStreakLimit: 3,
};

const SYMBOL_SET = new Set<string>(PAPER_TRADER_SYMBOLS.map((symbol) => symbol.value));

/**
 * The analysts a coin can actually be looked at by. TradingAgents' own parser
 * accepts `fundamentals` — it is a real analyst, for equities — and a settings
 * row written before this list existed, or by hand, can still carry it. Reading
 * it back through the framework's parser alone would send an analyst off to read
 * company financials for Bitcoin, so the desk's own list is applied on top.
 */
const DESK_ANALYSTS = new Set<string>(["market", "social", "news"]);

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function parseSymbols(value: unknown): PaperTraderSymbol[] {
  if (!Array.isArray(value)) return [];
  const chosen = new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toUpperCase())
      .filter((item) => SYMBOL_SET.has(item)),
  );
  // Keep the catalog's own order so the rotation is stable regardless of how the
  // settings page listed them.
  return PAPER_TRADER_SYMBOLS.map((symbol) => symbol.value).filter((symbol) =>
    chosen.has(symbol),
  ) as PaperTraderSymbol[];
}

/**
 * Read the catalog's stored values as desk settings. The catalog already
 * normalised them, so this only maps names and applies the defaults for anything
 * an older stored row is missing.
 */
export function paperTraderSettingsFrom(values: AgentSettingValues): PaperTraderSettings {
  const symbols = parseSymbols(values.symbols);
  const stocks = parseStockTickers(values.stocks);
  const analysts = parseAnalysts(values.analysts).filter((analyst) =>
    DESK_ANALYSTS.has(analyst),
  );
  const cycle = clampNumber(values.cycleMinutes, 5, 60, DEFAULT_PAPER_TRADER_SETTINGS.cycleMinutes);
  return {
    startingCapital: Math.round(
      clampNumber(
        values.startingCapital,
        MIN_STARTING_CAPITAL,
        MAX_STARTING_CAPITAL,
        DEFAULT_STARTING_CAPITAL,
      ),
    ),
    // Only the finite coin rotation is stored. Company candidates come from the
    // exchange directory and therefore do not need a settings value.
    symbols: symbols.length || stocks.length ? symbols : [...DEFAULT_PAPER_TRADER_SETTINGS.symbols],
    stocks,
    cycleMinutes: (CYCLE_CHOICES.find((choice) => choice === cycle) ??
      DEFAULT_PAPER_TRADER_SETTINGS.cycleMinutes) as CycleMinutes,
    // The settings page asks for a percentage because "20" reads better than
    // "0.2"; the arena wants the fraction.
    positionSize:
      clampNumber(values.positionSize, 1, 100, DEFAULT_PAPER_TRADER_SETTINGS.positionSize * 100) /
      100,
    leverage: Math.round(clampNumber(values.leverage, 1, 10, DEFAULT_PAPER_TRADER_SETTINGS.leverage)),
    allowShorts: values.allowShorts !== false,
    analysts: analysts.length ? analysts : [...DEFAULT_PAPER_TRADER_SETTINGS.analysts],
    researchDepth: Math.round(
      clampNumber(values.researchDepth, 1, 3, DEFAULT_PAPER_TRADER_SETTINGS.researchDepth),
    ),
    riskRounds: Math.round(
      clampNumber(values.riskRounds, 1, 3, DEFAULT_PAPER_TRADER_SETTINGS.riskRounds),
    ),
    consultVibeTrading: values.consultVibeTrading !== false,
    // The one toggle read the other way round, because its default is off.
    consultStockAnalyst: values.consultStockAnalyst === true,
    adviceEveryCycles: Math.round(
      clampNumber(values.adviceEveryCycles, 1, 48, DEFAULT_PAPER_TRADER_SETTINGS.adviceEveryCycles),
    ),
    harmonise: values.harmonise !== false,
    // Percent on the page, fraction in the runtime — the same translation the
    // position size gets, for the same reason.
    minConfidence:
      clampNumber(values.minConfidence, 0, 100, DEFAULT_PAPER_TRADER_SETTINGS.minConfidence * 100) /
      100,
    maxOpenPositions: Math.round(
      clampNumber(values.maxOpenPositions, 1, 6, DEFAULT_PAPER_TRADER_SETTINGS.maxOpenPositions),
    ),
    maxDrawdown:
      clampNumber(values.maxDrawdown, 5, 90, DEFAULT_PAPER_TRADER_SETTINGS.maxDrawdown * 100) / 100,
    losingStreakLimit: Math.round(
      clampNumber(
        values.losingStreakLimit,
        1,
        10,
        DEFAULT_PAPER_TRADER_SETTINGS.losingStreakLimit,
      ),
    ),
  };
}

/**
 * Everything the desk may trade, which is what the arena is handed at boot. Kept
 * here rather than at the call sites so the register and the settings can never
 * disagree about what is in play.
 */
export function instrumentsOf(settings: PaperTraderSettings): Instrument[] {
  return instrumentsFor({ symbols: settings.symbols, stocks: settings.stocks });
}
