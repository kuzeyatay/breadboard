// The desk committee: every trading capability Breadboard already has, sitting
// around one decision.
//
// Breadboard has four things that know something about markets, and until this
// module they had nothing to do with each other — four agents you could ask four
// separate questions and then reconcile in your head. The desk is where that
// reconciliation becomes the product.
//
//   Trading Agent   the cloned TradingAgents firm: analysts, a bull/bear debate,
//                   a trader, a risk discussion, a portfolio manager. It looks at
//                   one coin per cycle and returns BUY / SELL / HOLD. This is the
//                   primary seat and its verdict is the thing being harmonised.
//   Vibe Trading    the cloned quant research service: factors, backtests,
//                   hypotheses. It is asked about the regime the desk's coins are
//                   in, not about a single trade.
//   Stock Analyst   the cloned daily-analysis backend. Its data sources are
//                   equity markets, so it is never asked about a coin — it is
//                   asked about risk appetite, which is the thing equities can
//                   tell you about crypto that crypto cannot tell you about
//                   itself.
//   Risk officer    arithmetic, not a model. See ./risk.ts.
//
// Two design rules make this a committee rather than a pile of prompts.
//
// **The advisers run on their own clock.** Each is an entire cloned runtime with
// a service behind it, and neither answers a question whose answer changes in
// fifteen minutes. Their notes live on a noticeboard in the store and refresh on
// a slow cadence; a cycle reads the board rather than waiting on it. A seat that
// has never answered, or whose clone is not installed, abstains — the desk keeps
// trading with the seats it has.
//
// **The harmoniser cannot invent a trade.** It weighs the seats and returns a
// verdict, which is then turned into an order by the same deterministic mapping
// that has always done it, and then passed through the risk officer, who can
// only ever reduce. So the worst a confused harmoniser can do is hold.

import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { localChatmockBaseUrl } from "../chatmock-server.ts";
import { GLOBAL_MODEL_SENTINEL } from "../ai-models.ts";
import type { ArenaPosition } from "./arena.ts";
import type { Rating, Verdict } from "./decisions.ts";
import { symbolLabel } from "./identity.ts";
import { getPaperTraderStore } from "./instance.ts";
import { anthropicFallbackModel, isUsageExhausted } from "./providers.ts";
import type { AdviceRecord } from "./store.ts";
import type { DeskHistory, RiskAssessment } from "./risk.ts";
import type { PaperTraderSettings } from "./settings.ts";

/** The seats, in the order the card lists them. */
export const SEATS = [
  {
    id: "trading-agent",
    label: "Trading Agent",
    blurb: "Multi-agent debate on one coin per cycle.",
  },
  {
    id: "vibe-trading",
    label: "Vibe Trading",
    blurb: "Quant read on the regime the desk's coins are in.",
  },
  {
    id: "stock-analyst",
    label: "Stock Analyst",
    blurb: "Risk appetite from the equity markets.",
  },
  { id: "risk", label: "Risk officer", blurb: "Drawdown, exposure and losing streaks." },
] as const;

export type SeatId = (typeof SEATS)[number]["id"];

/** The seats that are consulted asynchronously and keep a standing note. */
export type AdvisorySeat = "vibe-trading" | "stock-analyst";

/**
 * How long an adviser is given before the cycle stops waiting for it. It is not
 * waited on at all in practice — the consultation runs in the background and
 * lands on the noticeboard — but a seat that never answers must eventually be
 * released rather than blocking its own next consultation forever.
 */
const ADVISER_TIMEOUT_MS = 25 * 60 * 1000;
const HARMONISER_TIMEOUT_MS = 90_000;

function truncate(value: string, limit: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

// ---- the advisers -----------------------------------------------------------

/**
 * What Vibe Trading is asked. Not "should I buy" — it is a research loop over
 * factors and backtests, and the useful thing it can say on a fifteen-minute
 * schedule is what kind of market this is.
 */
function quantBrief(settings: PaperTraderSettings): string {
  // Use the one canonical Yahoo identity the Vibe tools resolve. Mixing BTC/USD
  // in prose with BTC-USD from symbol_search leaves its grounding ledger with
  // two plausible identities and blocks every market-data tool that follows.
  const coins = settings.symbols.map((symbol) => `${symbol}-USD`).join(", ");
  return [
    `Assess the current market regime for ${coins}.`,
    "Report, in under 150 words: whether the regime is trending or mean-reverting, which of these coins currently has the strongest and the weakest momentum, and whether volatility is high enough that leveraged positions are dangerous right now.",
    "Answer in English. Do not recommend a specific trade. End with exactly one line of the form: REGIME: trend | chop | unclear",
  ].join(" ");
}

/**
 * What the Stock Analyst is asked. Deliberately not about a coin: its data
 * sources are equity markets across six exchanges, and asking it about Bitcoin
 * would get an answer with nothing behind it.
 */
function regimeBrief(): string {
  return [
    "Give a short read on global risk appetite today, using the US indices and the broad sector rotation you can see.",
    "In under 120 words: are investors adding risk or reducing it, and is the tone improving or deteriorating over the last week?",
    "Answer in English. Do not mention cryptocurrency. End with exactly one line of the form: RISK APPETITE: risk-on | risk-off | mixed",
  ].join(" ");
}

/**
 * Both advisers answer with a one-line summary the brief asks for — `REGIME:` or
 * `RISK APPETITE:` — and it is pulled out for the card, where a sentence fits
 * and a paragraph does not.
 */
export function tailLine(note: string, key: RegExp): string {
  const match = note
    .split(/\r?\n/)
    .reverse()
    .find((line) => key.test(line));
  return match ? match.replace(key, "").trim().toLowerCase() : "";
}

export interface AdviserContext {
  userId: number;
  settings: PaperTraderSettings;
}

/**
 * Consult the advisory seats whose notes have gone stale. Returns immediately:
 * each consultation runs in the background and updates the noticeboard when it
 * lands, which is the whole reason the noticeboard exists.
 */
export function refreshAdvisers(context: AdviserContext): void {
  const store = getPaperTraderStore();
  store.releaseStaleAdvice(Math.round(ADVISER_TIMEOUT_MS / 60_000) + 5);

  const maxAge = context.settings.adviceEveryCycles * context.settings.cycleMinutes;

  if (context.settings.consultVibeTrading && store.claimAdvice("vibe-trading", maxAge)) {
    void consultVibeTrading(context).catch(() => {
      // consultVibeTrading records its own failure; this only stops an unhandled
      // rejection from a background consultation taking the process with it.
    });
  }
  if (context.settings.consultStockAnalyst && store.claimAdvice("stock-analyst", maxAge)) {
    void consultStockAnalyst(context).catch(() => {
      // Same.
    });
  }
}

/**
 * Drive one of Breadboard's own agent run managers to completion, headlessly.
 *
 * These managers were written for a chat card: they start a run and publish
 * events, and the card watches. There is no card here, so the terminal event is
 * polled for instead. That is the whole adaptation — the run itself is the same
 * one a person would get by typing the agent's command.
 */
async function awaitRunSummary(
  runId: string,
  userId: number,
  poll: {
    events: (userId: number, runId: string, since: number) => { type: string; payload: Record<string, unknown> }[];
    terminal: (userId: number, runId: string) => boolean;
  },
): Promise<string> {
  const deadline = Date.now() + ADVISER_TIMEOUT_MS;
  let cursor = 0;
  let summary = "";
  let failure = "";
  while (Date.now() < deadline) {
    for (const event of poll.events(userId, runId, cursor)) {
      cursor += 1;
      if (event.type === "run.completed") {
        summary = typeof event.payload.summary === "string" ? event.payload.summary : "";
      }
      if (event.type === "run.failed" || event.type === "run.aborted") {
        failure =
          typeof event.payload.error === "string"
            ? event.payload.error
            : "The adviser stopped before answering.";
      }
    }
    if (poll.terminal(userId, runId)) break;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if (summary.trim()) return summary;
  throw new Error(failure || "The adviser did not answer in time.");
}

async function consultVibeTrading(context: AdviserContext): Promise<void> {
  const store = getPaperTraderStore();
  try {
    const [{ startRun, getEventsSince, isTerminal }, { vibeTradingSettingsFrom, DEFAULT_VIBE_TRADING_SETTINGS }, { agentSettingsFor }] =
      await Promise.all([
        import("../vibe-trading/run-manager.ts"),
        import("../vibe-trading/settings.ts"),
        import("../agent-settings/store.ts"),
      ]);
    const { VIBE_TRADING_AGENT_ID } = await import("../vibe-trading/identity.ts");
    const settings = (() => {
      try {
        return vibeTradingSettingsFrom(agentSettingsFor(context.userId, VIBE_TRADING_AGENT_ID));
      } catch {
        return DEFAULT_VIBE_TRADING_SETTINGS;
      }
    })();
    const brief = quantBrief(context.settings);
    const ask = async (model: string, pin: boolean) => {
      const run = startRun({
        userId: context.userId,
        task: brief,
        model,
        reasoningEffort: "medium",
        baseUrl: localChatmockBaseUrl(),
        // A model pinned in Vibe Trading's own settings normally wins, and on
        // the first attempt it should: it is the user's choice. On the fallback
        // it is exactly what has run out, so the pin is overridden rather than
        // obeyed into a second failure.
        settings: pin ? { ...settings, model } : settings,
      });
      return awaitRunSummary(run.runId, context.userId, {
        events: getEventsSince,
        terminal: isTerminal,
      });
    };

    let usedModel = GLOBAL_MODEL_SENTINEL;
    let summary: string;
    try {
      summary = await ask(GLOBAL_MODEL_SENTINEL, false);
    } catch (error) {
      // ChatGPT first, Anthropic only when ChatGPT has nothing left to give.
      // Any other failure is not a provider problem — a broken brief or an
      // unreachable service fails identically everywhere — so it is reported
      // rather than retried somewhere more expensive.
      const reason = error instanceof Error ? error.message : String(error);
      if (!isUsageExhausted(reason)) throw error;
      const fallback = await anthropicFallbackModel();
      if (!fallback) {
        throw new Error(
          `${reason} No Anthropic model was available to fall back to.`.trim(),
        );
      }
      usedModel = fallback;
      summary = await ask(fallback, true);
    }

    // A regime is not a direction, so the stance stays "note": this seat informs
    // how much weight a directional call deserves, it does not cast one.
    store.recordAdvice({
      seat: "vibe-trading",
      stance: "note",
      // Which model answered is worth keeping: a note written by the fallback
      // was written because the usual one was out, and that is context for
      // whoever reads it later wondering why the desk sounded different.
      note: truncate(
        usedModel === GLOBAL_MODEL_SENTINEL ? summary : `[via ${usedModel}] ${summary}`,
        2_000,
      ),
    });
  } catch (error) {
    store.failAdvice(
      "vibe-trading",
      error instanceof Error ? error.message : "Vibe Trading could not be reached.",
    );
  }
}

async function consultStockAnalyst(context: AdviserContext): Promise<void> {
  const store = getPaperTraderStore();
  try {
    const [{ startRun, getEventsSince, isTerminal }, { stockAnalystSettingsFrom, DEFAULT_STOCK_ANALYST_SETTINGS }, { agentSettingsFor }] =
      await Promise.all([
        import("../stock-analyst/run-manager.ts"),
        import("../stock-analyst/settings.ts"),
        import("../agent-settings/store.ts"),
      ]);
    const { STOCK_ANALYST_AGENT_ID } = await import("../stock-analyst/identity.ts");
    const settings = (() => {
      try {
        return stockAnalystSettingsFrom(agentSettingsFor(context.userId, STOCK_ANALYST_AGENT_ID));
      } catch {
        return DEFAULT_STOCK_ANALYST_SETTINGS;
      }
    })();
    const run = startRun({
      userId: context.userId,
      task: regimeBrief(),
      model: GLOBAL_MODEL_SENTINEL,
      baseUrl: localChatmockBaseUrl(),
      settings,
      // The desk is not a person and has no durable memory of its own to bring.
      memoryContext: "",
    });
    const summary = await awaitRunSummary(run.runId, context.userId, {
      events: getEventsSince,
      terminal: isTerminal,
    });
    store.recordAdvice({
      seat: "stock-analyst",
      stance: "note",
      note: truncate(summary, 2_000),
    });
  } catch (error) {
    store.failAdvice(
      "stock-analyst",
      error instanceof Error ? error.message : "The Stock Analyst could not be reached.",
    );
  }
}

// ---- the harmoniser ---------------------------------------------------------

export interface HarmonisedVerdict {
  verdict: Verdict;
  /** 0–1. Below the settings' threshold the desk holds instead of acting. */
  confidence: number;
  rationale: string;
  /** Set when the harmoniser moved off the primary seat's verdict. */
  overrode: boolean;
}

function describeAdvice(advice: AdviceRecord[]): string {
  const usable = advice.filter((entry) => entry.note.trim() && entry.stance !== "abstain");
  if (!usable.length) return "No adviser has reported yet.";
  return usable
    .map((entry) => {
      const seat = SEATS.find((candidate) => candidate.id === entry.seat);
      return `${seat?.label ?? entry.seat} (as of ${entry.updatedAt} UTC): ${truncate(entry.note, 900)}`;
    })
    .join("\n\n");
}

function describeHistory(history: DeskHistory, symbol: string): string {
  const own = history.bySymbol[symbol.toUpperCase()];
  const lines = [
    `Across the whole desk: ${history.fills} fill${history.fills === 1 ? "" : "s"}, realised ${history.realised >= 0 ? "+" : ""}$${history.realised.toFixed(2)}.`,
  ];
  if (own) {
    lines.push(
      `On ${symbol}: realised ${own.realised >= 0 ? "+" : ""}$${own.realised.toFixed(2)} over ${own.fills} fill${own.fills === 1 ? "" : "s"}${
        own.losingStreak ? `, ${own.losingStreak} losing close${own.losingStreak === 1 ? "" : "s"} in a row` : ""
      }.`,
    );
  } else {
    lines.push(`${symbol} has not been traded by this desk yet.`);
  }
  return lines.join(" ");
}

function describePositions(positions: ArenaPosition[]): string {
  const open = positions.filter((position) => position.quantity > 0);
  if (!open.length) return "The desk holds nothing.";
  return open
    .map(
      (position) =>
        `${position.symbol} ${position.side} ${position.leverage}× at ${position.avgCost.toFixed(2)}${
          position.unrealisedPnl === null
            ? ""
            : ` (${position.unrealisedPnl >= 0 ? "+" : ""}$${position.unrealisedPnl.toFixed(2)} unrealised)`
        }`,
    )
    .join("; ");
}

/**
 * Weigh the seats. Returns the primary verdict unchanged when there is nothing
 * to weigh it against, or when the model call fails — a broken harmoniser must
 * not silently become a third opinion nobody asked for.
 */
export async function harmonise(input: {
  primary: { verdict: Verdict; rating: Rating; reasoning: string };
  symbol: string;
  advice: AdviceRecord[];
  history: DeskHistory;
  assessment: RiskAssessment;
  positions: ArenaPosition[];
  settings: PaperTraderSettings;
}): Promise<HarmonisedVerdict> {
  const fallback: HarmonisedVerdict = {
    verdict: input.primary.verdict,
    confidence: 1,
    rationale: "",
    overrode: false,
  };
  if (!input.settings.harmonise) return fallback;

  const usableAdvice = input.advice.filter(
    (entry) => entry.note.trim() && entry.stance !== "abstain",
  );
  // With no adviser reporting there is one opinion in the room, and asking a
  // model to reconcile it with itself only adds a way to be wrong.
  if (!usableAdvice.length) return fallback;

  const prompt = [
    `You are the chair of a small absolute-return paper-trading desk. One asset is on the table: ${symbolLabel(input.symbol)} (${input.symbol.toUpperCase()}).`,
    "",
    `The analyst framework rated it ${input.primary.rating}; for this desk that maps to ${input.primary.verdict}. Their reasoning:`,
    truncate(input.primary.reasoning, 2_500) || "(no reasoning was recorded)",
    "",
    "Standing notes from the desk's other advisers:",
    describeAdvice(input.advice),
    "",
    `Position book: ${describePositions(input.positions)}`,
    `Track record: ${describeHistory(input.history, input.symbol)}`,
    `Maximum new-position allocation: ${Math.round(input.settings.positionSize * 100)}% of available cash. The execution layer will choose the exact amount continuously from your confidence and will never exceed this ceiling.`,
    input.assessment.reasons.length
      ? `Risk officer: ${input.assessment.reasons.join(" ")}`
      : "Risk officer: no constraints in force.",
    "",
    input.settings.allowShorts
      ? "This desk may hold either direction. BUY is a full long, OVERWEIGHT a smaller long, UNDERWEIGHT a smaller short, and SELL a full short when the book is flat; against an opposite position the action closes it first."
      : "Shorting is disabled. BUY and OVERWEIGHT may open a long; UNDERWEIGHT and SELL may reduce or close a long but cannot open a short.",
    "Decide what the desk does about this asset. Keep the analyst team's mapped verdict unless an adviser or the track record gives a concrete, current reason not to — the analyst team examined this asset in detail and the advisers did not. Do not turn UNDERWEIGHT into HOLD merely because a long-only portfolio would describe it as reducing exposure.",
    "Answer with ONLY a JSON object:",
    '{"verdict": "BUY" | "SELL" | "HOLD", "confidence": 0.0-1.0, "rationale": "one sentence"}',
    "",
    `confidence is how strongly the desk should act. Below ${input.settings.minConfidence.toFixed(2)} the desk will hold. Above it, confidence also determines the money allocated: a barely actionable call is cautious and 1.0 uses the full configured ceiling. Do not default to 1.0.`,
  ].join("\n");

  try {
    const response = await fetch(`${localChatmockBaseUrl().replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${chatmockApiKeyValue()}`,
      },
      body: JSON.stringify({
        model: GLOBAL_MODEL_SENTINEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(HARMONISER_TIMEOUT_MS),
    });
    if (!response.ok) return fallback;
    const body = (await response.json()) as Record<string, unknown>;
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const message = ((choices[0] ?? {}) as Record<string, unknown>).message as
      | Record<string, unknown>
      | undefined;
    const content = typeof message?.content === "string" ? message.content : "";
    const parsed = parseVerdict(content);
    if (!parsed) return fallback;
    return {
      ...parsed,
      overrode: parsed.verdict !== input.primary.verdict,
    };
  } catch {
    return fallback;
  }
}

/** Read the chair's answer, tolerating the code fence a model sometimes adds. */
export function parseVerdict(content: string): Omit<HarmonisedVerdict, "overrode"> | null {
  let text = content.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) text = fence[1].trim();
  const brace = text.indexOf("{");
  const close = text.lastIndexOf("}");
  if (brace >= 0 && close > brace) text = text.slice(brace, close + 1);
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const raw = typeof value.verdict === "string" ? value.verdict.toUpperCase() : "";
    const verdict: Verdict = raw.includes("BUY") ? "BUY" : raw.includes("SELL") ? "SELL" : "HOLD";
    const confidence = Number(value.confidence);
    return {
      verdict,
      confidence: Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0.5,
      rationale: typeof value.rationale === "string" ? truncate(value.rationale, 300) : "",
    };
  } catch {
    return null;
  }
}
