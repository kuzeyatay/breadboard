// What actually decides: one TradingAgents analysis per cycle, and the
// translation of its verdict into the arena's own decision object.
//
// The shape of this file is forced by one number. The arena asks its configured
// model for a decision with a 30-second timeout — reasonable, for the single
// chat completion it was written against. A TradingAgents run is four analysts,
// a bull/bear debate, a trader, a three-way risk discussion and a portfolio
// manager: minutes, not seconds. So a cycle cannot both run the analysis and
// answer with it.
//
// Instead each cycle does two things: it answers immediately with whatever the
// *previous* cycle's analysis concluded, and it starts the next one. On a
// fifteen-minute cycle that means every verdict is acted on one cycle after it
// was reached, which for a multi-round debate about a position held for hours is
// the right trade — and it is the only arrangement in which the real framework,
// rather than a single-shot prompt, is the thing making the call.
//
// The verdict is BUY / SELL / HOLD on one coin. Turning that into an order is
// deliberately mechanical and happens at serve time, against the position as it
// is *then*: a BUY reached fifteen minutes ago must not reopen a long that was
// liquidated in the meantime.

import { spawn } from "node:child_process";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { credentialEnv } from "../tradingagents/credentials.ts";
import { todayIso } from "../tradingagents/identity.ts";
import {
  bridgeScriptPath,
  resolveTradingAgentsRoot,
  tradingAgentsEnv,
  venvPython,
} from "../tradingagents/runtime.ts";
import { kindOf, tickerFor, type Instrument } from "./identity.ts";
import type { ArenaPosition } from "./arena.ts";
import { instrumentsOf, type PaperTraderSettings } from "./settings.ts";
import { anthropicFallbackModel, isUsageExhausted } from "./providers.ts";

/** The framework's own signal vocabulary. */
export type Verdict = "BUY" | "SELL" | "HOLD";

export interface AnalysisResult {
  /**
   * The framework's own word, on its five-point scale — not flattened to three.
   * What the desk does about it is decided at serve time, against the position
   * as it stands then; see `ratingAction`.
   */
  rating: Rating;
  /** The portfolio manager's decision text, kept for the decision log. */
  reasoning: string;
}

export interface AnalysisContext {
  /** ChatMock's OpenAI-compatible base URL. */
  baseUrl: string;
  /** The model both TradingAgents roles run on. */
  model: string;
  reasoningEffort: string;
}

// Long enough for three analysts and two debates, short enough that a wedged
// run does not block the next cycle forever.
const ANALYSIS_TIMEOUT_MS = 30 * 60 * 1000;

interface AnalysisGlobals {
  __breadboardPaperTraderAnalysisCancels?: Set<() => void>;
}

const analysisGlobals = globalThis as unknown as AnalysisGlobals;
const activeAnalysisCancels =
  analysisGlobals.__breadboardPaperTraderAnalysisCancels ?? new Set<() => void>();
analysisGlobals.__breadboardPaperTraderAnalysisCancels = activeAnalysisCancels;

/** Stop model work that belongs to a desk which is no longer running. */
export function stopActivePaperTraderAnalyses(): void {
  for (const cancel of [...activeAnalysisCancels]) cancel();
}

/** Crypto has no fundamentals to read; the vendor chain is the keyless default. */
const DATA_VENDORS = {
  core_stock_apis: "yfinance",
  technical_indicators: "yfinance",
  fundamental_data: "yfinance",
  news_data: "yfinance",
};

/**
 * Attach the useful part of a traceback to a failure message.
 *
 * Python's traceback puts the exception last, and that final line is the one
 * that says `RateLimitError: 429` or `ModuleNotFoundError`. Everything above it
 * is frames from inside the framework, which tell a reader nothing they can act
 * on, so only the tail is kept and only once.
 */
export function withDetail(message: string, detail: string, limit = 300): string {
  const lines = detail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("File \"") && line !== "Traceback (most recent call last):");
  const cause = lines.at(-1) ?? "";
  if (!cause || message.includes(cause)) return message;
  return `${message} ${cause.slice(0, limit)}`.trim();
}

/**
 * The framework speaks a five-point scale, and the desk has to hear all of it.
 *
 * `process_signal` returns one of Buy / Overweight / Hold / Underweight / Sell —
 * a portfolio manager's vocabulary, not a trader's. Reading it as three points
 * by looking for the words "buy" and "sell" throws away the two middle ratings,
 * and those are the ones it actually uses: three consecutive analyses came back
 * **Underweight** — genuinely bearish, each one recommending a trim — and every
 * one was recorded as HOLD. A desk that cannot hear "underweight" holds nothing,
 * sells nothing and buys nothing, forever, while looking like it is working.
 */
export type Rating = "BUY" | "OVERWEIGHT" | "HOLD" | "UNDERWEIGHT" | "SELL";

export function parseRating(value: string): Rating {
  const upper = value.trim().toUpperCase();
  // Order matters: "overweight" and "underweight" must be recognised before the
  // bare words, and "underweight" before "overweight" would be wrong the other
  // way round only if one contained the other, which they do not — but checking
  // the compounds first keeps that true if the vocabulary ever grows.
  if (upper.includes("OVERWEIGHT")) return "OVERWEIGHT";
  if (upper.includes("UNDERWEIGHT")) return "UNDERWEIGHT";
  if (upper.includes("BUY")) return "BUY";
  if (upper.includes("SELL")) return "SELL";
  return "HOLD";
}

/** How strongly the desk should act on a rating. */
export type Conviction = "strong" | "mild";

/**
 * A rating, as a direction and a strength.
 *
 * Conviction controls size. This is an absolute-return paper portfolio, so both
 * intermediate ratings are actionable: Overweight opens a smaller long and
 * Underweight opens a smaller short when shorting is enabled. Treating the
 * latter as trim-only lets an empty portfolio remain empty forever even while
 * its analysts are consistently bearish.
 */
export function ratingAction(rating: Rating): { verdict: Verdict; conviction: Conviction } {
  switch (rating) {
    case "BUY":
      return { verdict: "BUY", conviction: "strong" };
    case "OVERWEIGHT":
      return { verdict: "BUY", conviction: "mild" };
    case "SELL":
      return { verdict: "SELL", conviction: "strong" };
    case "UNDERWEIGHT":
      return { verdict: "SELL", conviction: "mild" };
    default:
      return { verdict: "HOLD", conviction: "strong" };
  }
}

/**
 * The coin this cycle looks at: whichever of the coins in play has been waiting
 * longest. Held coins are always in play even when the settings no longer list
 * them, because a position nobody is allowed to look at is a position nobody can
 * close.
 */
export function chooseSymbol(
  settings: PaperTraderSettings,
  held: string[],
  recentlyAnalysed: string[],
  automaticEquities: readonly string[] = [],
): string | null {
  const registered = instrumentsOf(settings).map((instrument) => instrument.symbol);
  const inPlay = [
    ...new Set([
      ...held.map((s) => s.toUpperCase()),
      ...registered,
      ...automaticEquities.map((s) => s.toUpperCase()),
    ]),
  ];
  if (!inPlay.length) return null;
  // `recentlyAnalysed` is newest-first, so a symbol's index is how recently it
  // was looked at, and one that never appears sorts ahead of all of them.
  const staleness = (symbol: string) => {
    const index = recentlyAnalysed.indexOf(symbol);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  };
  return [...inPlay].sort((left, right) => staleness(right) - staleness(left))[0] ?? null;
}

/**
 * Run one analysis, and try again on Anthropic when ChatGPT has run out.
 *
 * The desk trades on these verdicts and on nothing else, so an analysis that
 * cannot run is a desk that cannot trade — which is exactly what a usage limit
 * produced: every run died on its first model call, no verdict was ever ready,
 * and the desk held every cycle for hours while looking perfectly healthy. The
 * adviser seat already falls back for the same reason; this is the seat where
 * it actually decides whether anything happens at all.
 *
 * Only exhaustion is retried. Anything else — a bad ticker, an unreachable
 * vendor, a broken environment — fails identically on any model, and burning a
 * second provider on it would only make the failure slower.
 */
export async function runAnalysis(
  symbol: string,
  settings: PaperTraderSettings,
  context: AnalysisContext,
): Promise<AnalysisResult> {
  try {
    return await runAnalysisOn(symbol, settings, context);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!isUsageExhausted(reason)) throw error;
    const fallback = await anthropicFallbackModel();
    if (!fallback) {
      throw new Error(`${reason} No Anthropic model was available to fall back to.`.trim());
    }
    return runAnalysisOn(symbol, settings, { ...context, model: fallback });
  }
}

function runAnalysisOn(
  symbol: string,
  settings: PaperTraderSettings,
  context: AnalysisContext,
): Promise<AnalysisResult> {
  const runtime = resolveTradingAgentsRoot();
  if (!runtime) {
    return Promise.reject(
      new Error("The tradingagents clone was not found next to the dashboard."),
    );
  }
  const python = venvPython(runtime.root);
  if (!python) {
    return Promise.reject(
      new Error(
        "TradingAgents has no Python environment yet. Build it from the Trading Agent settings.",
      ),
    );
  }
  const bridge = bridgeScriptPath();
  if (!bridge) {
    return Promise.reject(new Error("Breadboard's TradingAgents bridge script is missing."));
  }

  const kind = kindOf(symbol, instrumentsOf(settings));
  const job = {
    ticker: tickerFor(symbol, kind),
    tradeDate: todayIso(),
    // A company has financials and filings to read; a coin does not, so the
    // fundamentals analyst is offered only where there is something to analyse.
    analysts:
      kind === "EQUITY" ? [...settings.analysts, "fundamentals"] : settings.analysts,
    assetType: kind === "EQUITY" ? "stock" : "crypto",
    researchDepth: settings.researchDepth,
    riskRounds: settings.riskRounds,
    // The standalone TradingAgents workflow is long-only by default. Paper
    // Trader opts its Portfolio Manager into symmetric long/short ratings only
    // when the user has explicitly enabled shorting for this desk.
    paperTraderAllowShorts: settings.allowShorts,
    backendUrl: context.baseUrl.replace(/\/$/, ""),
    deepModel: context.model,
    quickModel: context.model,
    reasoningEffort: context.reasoningEffort,
    outputLanguage: "English",
    dataVendors: DATA_VENDORS,
  };

  return new Promise<AnalysisResult>((resolve, reject) => {
    const child = spawn(python, [bridge], {
      cwd: runtime.root,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: tradingAgentsEnv({
        TRADINGAGENTS_CLONE_ROOT: runtime.root,
        // The framework's generic OpenAI-compatible provider reads this; ChatMock
        // ignores the value but the SDK refuses to start without one.
        OPENAI_COMPATIBLE_API_KEY: chatmockApiKeyValue(),
        ...credentialEnv(),
      }),
    });

    let settled = false;
    let buffer = "";
    let stderrTail = "";
    // The framework's own final decision text, which is the only part of the
    // report a trading log has room for.
    let finalDecision = "";

    const cancel = () => finish(new Error("The analysis was stopped with the trading desk."));
    function finish(result: AnalysisResult | Error) {
      if (settled) return;
      settled = true;
      activeAnalysisCancels.delete(cancel);
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // Already gone.
      }
      if (result instanceof Error) reject(result);
      else resolve(result);
    }

    activeAnalysisCancels.add(cancel);
    const timer = setTimeout(() => {
      finish(new Error("The analysis ran past its time limit and was stopped."));
    }, ANALYSIS_TIMEOUT_MS);
    timer.unref?.();

    const handleLine = (line: string) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return; // Library chatter on stdout, not an event.
      }
      const type = typeof event.type === "string" ? event.type : "";
      if (type === "report" && event.section === "final_trade_decision") {
        finalDecision = typeof event.content === "string" ? event.content : finalDecision;
        return;
      }
      if (type === "completed") {
        const sections = Array.isArray(event.sections) ? event.sections : [];
        for (const item of sections) {
          const record = (item ?? {}) as Record<string, unknown>;
          if (record.section === "final_trade_decision" && typeof record.content === "string") {
            finalDecision = record.content;
          }
        }
        finish({
          rating: parseRating(typeof event.rating === "string" ? event.rating : ""),
          reasoning: finalDecision,
        });
        return;
      }
      if (type === "failed") {
        const message =
          typeof event.error === "string" ? event.error : "The analysis failed.";
        // The bridge's own message is a sentence for a person; the reason the
        // analysis actually died is in `detail`, as an exception and a
        // traceback. Dropping it is how a desk ends up holding for hours with
        // "The analysis stopped before it finished." as the only record — true,
        // and useless. The first line of the traceback is the part that names a
        // rate limit, a missing vendor key or an unreachable model.
        finish(new Error(withDetail(message, typeof event.detail === "string" ? event.detail : "")));
      }
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) handleLine(line);
        newline = buffer.indexOf("\n");
      }
      if (buffer.length > 4_000_000) buffer = "";
    });
    child.stderr?.on("data", (chunk: string) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-4_000);
    });

    child.on("error", (error) => finish(new Error(`The analysis could not start: ${error.message}`)));
    child.on("exit", (code) => {
      const detail = stderrTail.split(/\r?\n/).filter(Boolean).slice(-4).join(" · ");
      finish(
        new Error(
          code === 0
            ? "The analysis ended without reaching a decision."
            : `The analysis stopped unexpectedly (exit ${code ?? "unknown"}). ${detail}`.trim(),
        ),
      );
    });

    try {
      child.stdin?.write(`${JSON.stringify(job)}\n`);
      child.stdin?.end();
    } catch (error) {
      finish(
        new Error(
          error instanceof Error ? error.message : "The analysis request could not be sent.",
        ),
      );
    }
  });
}

/** The arena's own decision object, exactly as its AI decision path expects it. */
export interface ArenaDecisionPayload extends Record<string, unknown> {
  operation: "open" | "close" | "hold";
  symbol?: string;
  direction?: "long" | "short";
  target_portion_of_balance: number;
  leverage: number;
  reason: string;
}

function hold(reason: string): ArenaDecisionPayload {
  return { operation: "hold", target_portion_of_balance: 0, leverage: 1, reason };
}

export interface DynamicPositionSizeInput {
  /** The chair's 0-1 confidence in acting on this verdict. */
  confidence: number;
  /** Confidence below this value is not actionable. */
  minConfidence: number;
  /** Hard upper bound from the user's settings, as a fraction of available cash. */
  ceiling: number;
  /** TradingAgents' five-point rating reduced to its directional strength. */
  conviction: Conviction;
}

/**
 * Choose an opening allocation continuously rather than treating every
 * intermediate rating as exactly half a trade.
 *
 * Crossing the user's confidence gate earns a cautious allocation (45% of the
 * configured ceiling for a mild rating, 60% for a strong one). From there the
 * chair's own confidence scales smoothly to the ceiling. The ceiling is never
 * exceeded, and an invalid or sub-threshold signal cannot open a position.
 */
export function dynamicPositionSize(input: DynamicPositionSizeInput): number {
  const ceiling = Number.isFinite(input.ceiling)
    ? Math.min(Math.max(input.ceiling, 0), 1)
    : 0;
  const confidence = Number.isFinite(input.confidence)
    ? Math.min(Math.max(input.confidence, 0), 1)
    : 0;
  const threshold = Number.isFinite(input.minConfidence)
    ? Math.min(Math.max(input.minConfidence, 0), 1)
    : 1;
  if (ceiling === 0 || confidence < threshold) return 0;

  const progress = threshold >= 1 ? 1 : (confidence - threshold) / (1 - threshold);
  const cautiousFloor = input.conviction === "mild" ? 0.45 : 0.6;
  const shareOfCeiling = cautiousFloor + (1 - cautiousFloor) * progress;
  return Math.round(Math.min(ceiling, ceiling * shareOfCeiling) * 10_000) / 10_000;
}

/**
 * Turn a verdict into an order, against the position as it stands right now.
 *
 * The rules are the arena's own constraints written out: one position per coin,
 * a close has to name the side it is closing, and a portion is a fraction of
 * available cash when opening and of the position when closing.
 */
export function decisionFor(input: {
  verdict: Verdict;
  /**
   * How strongly the primary framework rated the opportunity. This provides a
   * cautious floor; the chair's numeric confidence chooses the actual size.
   */
  conviction?: Conviction;
  /** The chair's confidence, used to size an opening continuously. */
  confidence?: number;
  symbol: string;
  reasoning: string;
  positions: ArenaPosition[];
  settings: PaperTraderSettings;
  /** Defaults to the settings' own register; passed in by tests. */
  instruments?: Instrument[];
}): ArenaDecisionPayload {
  const symbol = input.symbol.toUpperCase();
  const instruments = input.instruments ?? instrumentsOf(input.settings);
  const kind = kindOf(symbol, instruments);
  // Shares are bought outright. The arena's leverage path is a crypto perpetual
  // desk — hourly interest on borrowed notional, a 50x ceiling, a taker fee — and
  // none of that describes a margin account at an equity broker. Modelling it
  // badly would be worse than not modelling it.
  const leverage = kind === "EQUITY" ? 1 : input.settings.leverage;
  const position = input.positions.find(
    (candidate) => candidate.symbol.toUpperCase() === symbol && candidate.quantity > 0,
  );
  const side = position ? position.side.toUpperCase() : null;
  const conviction = input.conviction ?? "strong";
  const openingPortion = dynamicPositionSize({
    confidence: input.confidence ?? 1,
    minConfidence: input.settings.minConfidence,
    ceiling: input.settings.positionSize,
    conviction,
  });
  // The log column is 2,000-odd characters of debate; the first paragraph is
  // what a row in the decisions table can actually show.
  const reason = summarise(input.reasoning, input.verdict, symbol);

  if (input.verdict === "HOLD") {
    return hold(reason);
  }
  if (openingPortion <= 0) {
    return hold(`${reason} Confidence was below the desk's action threshold.`);
  }

  if (input.verdict === "BUY") {
    if (side === "SHORT") {
      return {
        operation: "close",
        symbol,
        direction: "short",
        target_portion_of_balance: 1,
        leverage: position?.leverage ?? 1,
        reason,
      };
    }
    if (side === "LONG") return hold(`${reason} Already long ${symbol}.`);
    return {
      operation: "open",
      symbol,
      direction: "long",
      target_portion_of_balance: openingPortion,
      leverage,
      reason,
    };
  }

  // SELL
  if (side === "LONG") {
    return {
      operation: "close",
      symbol,
      direction: "long",
      target_portion_of_balance: 1,
      leverage: position?.leverage ?? 1,
      reason,
    };
  }
  if (side === "SHORT") return hold(`${reason} Already short ${symbol}.`);
  if (!input.settings.allowShorts) {
    return hold(`${reason} Shorting is turned off, so no position was opened.`);
  }
  return {
    operation: "open",
    symbol,
    direction: "short",
    target_portion_of_balance: openingPortion,
    leverage,
    reason,
  };
}

const MAX_REASON_CHARS = 600;

/**
 * The one-line reason a decision row carries. The framework's decision text
 * opens with its own summary, so the leading prose is the useful part; the
 * verdict is prefixed because the text does not always name it in the first
 * sentence.
 */
function summarise(reasoning: string, verdict: Verdict, symbol: string): string {
  const body = reasoning
    .replace(/^#+\s.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
  const prefix = `TradingAgents: ${verdict} ${symbol}.`;
  if (!body) return `${prefix} No decision text was produced.`;
  const room = MAX_REASON_CHARS - prefix.length - 1;
  const trimmed = body.length > room ? `${body.slice(0, room - 1).trimEnd()}…` : body;
  return `${prefix} ${trimmed}`;
}
