// The endpoint the arena calls when it wants a trading decision.
//
// It answers OpenAI's chat-completions shape because that is what the clone's AI
// path speaks, and speaking it is what lets the whole of the clone — its
// position sizing, its leverage arithmetic, its one-position-per-coin rule, its
// order matching and its decision log — do the work unchanged. What comes back
// is not a model's answer, though. It is the verdict a TradingAgents run reached
// on a previous cycle, translated into an order against the position as it
// stands right now.
//
// Two things this route does that a chat completion would not.
//
// It **starts the next analysis** before returning. The arena's request is on a
// 30-second budget and a run takes minutes, so a cycle serves the last verdict
// and kicks off the next one. The spawn is deliberately not awaited.
//
// It **authenticates with a bearer token, not a session**. The caller is a local
// process, not a browser: there is no cookie to read. The token is the desk's
// own, minted into its runtime directory (see lib/paper-trader/token.ts).
// Loopback alone is not a permission — this endpoint moves a portfolio.

import { NextResponse } from "next/server";
import {
  livePrices,
  marketStatus,
  pricePositions,
  readTables,
  readTradeHistory,
  type ArenaPosition,
} from "@/lib/paper-trader/arena.ts";
import { harmonise, refreshAdvisers } from "@/lib/paper-trader/committee.ts";
import { assessRisk, constrain, readHistory } from "@/lib/paper-trader/risk.ts";
import { automaticEquityForCycle } from "@/lib/paper-trader/equity-universe.ts";
import { deskBaseUrl } from "@/lib/paper-trader/supervisor.ts";
import {
  chooseSymbol,
  decisionFor,
  parseRating,
  ratingAction,
  runAnalysis,
  type ArenaDecisionPayload,
  type Verdict,
} from "@/lib/paper-trader/decisions.ts";
import { kindOf, PAPER_TRADER_AGENT_ID } from "@/lib/paper-trader/identity.ts";
import { getPaperTraderStore } from "@/lib/paper-trader/instance.ts";
import {
  DEFAULT_PAPER_TRADER_SETTINGS,
  instrumentsOf,
  paperTraderSettingsFrom,
} from "@/lib/paper-trader/settings.ts";
import { analysisContext } from "@/lib/paper-trader/supervisor.ts";
import { bearerFrom, tokenMatches } from "@/lib/paper-trader/token.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The chat-completions envelope the clone reads `choices[0].message.content` out of. */
function completion(decision: ArenaDecisionPayload) {
  return {
    id: `paper-trader-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "tradingagents",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: JSON.stringify(decision) },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function holding(reason: string): ArenaDecisionPayload {
  return { operation: "hold", target_portion_of_balance: 0, leverage: 1, reason };
}

/**
 * Live prices for whatever is held, so the risk officer is measuring the desk's
 * actual equity rather than its cost basis. If even one held symbol cannot be
 * marked, the desk holds: zero is not a safe estimate for an unknown loss.
 */
interface LivePriceBook {
  prices: Record<string, number>;
  missing: string[];
}

async function priceBook(positions: ArenaPosition[]): Promise<LivePriceBook> {
  const base = deskBaseUrl();
  const symbols = [...new Set(positions.map((position) => position.symbol.toUpperCase()))];
  if (!symbols.length) return { prices: {}, missing: [] };
  if (!base) return { prices: {}, missing: symbols };
  try {
    const prices = await livePrices(base, symbols);
    const missing = symbols.filter((symbol) => {
      const price = prices[symbol];
      return !Number.isFinite(price) || price <= 0;
    });
    return { prices, missing };
  } catch {
    return { prices: {}, missing: symbols };
  }
}

function unrealised(positions: ArenaPosition[]): number {
  return positions.reduce((total, position) => total + (position.unrealisedPnl ?? 0), 0);
}

/**
 * The one route in this integration that must never fail.
 *
 * The arena treats a non-200 as "the model is broken", logs it and trades
 * nothing — so any bug in here does not degrade the desk, it stops it, silently
 * and for as long as nobody reads a server log. That is not hypothetical: a
 * method added to a cached singleton turned every one of these calls into a 500
 * for half a day while the desk sat idle looking healthy.
 *
 * So the whole handler is wrapped, and a failure becomes an explicit hold with
 * the reason attached. The desk does not trade on a broken cycle either way;
 * the difference is that it keeps its loop, and the reason reaches the card
 * instead of a log file.
 */
export async function POST(request: Request) {
  try {
    return await decide(request);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The decision could not be made.";
    try {
      getPaperTraderStore().recordError(reason);
    } catch {
      // If even the store is unreachable the hold below is all that is left.
    }
    return NextResponse.json(completion(holding(`The desk could not decide: ${reason}`)));
  }
}

async function decide(request: Request) {
  if (!tokenMatches(bearerFrom(request))) {
    return NextResponse.json(
      { error: { message: "Invalid API key.", type: "invalid_request_error" } },
      { status: 401 },
    );
  }

  // The body is the clone's prompt. It is read only to keep the connection
  // honest — nothing in it is used, because everything it describes is available
  // first-hand from the portfolio the desk owns.
  await request.text().catch(() => "");

  const store = getPaperTraderStore();
  // The arena's trading loop reaches nothing else, so this call is the only
  // evidence that it is still running. Stamped before any early return, because
  // a loop that is alive and being told the desk is off is still alive.
  try {
    store.recordCycle();
  } catch {
    // A pulse is diagnostics. It has no business stopping a trading cycle —
    // and as the missing column proved, it is exactly the kind of write that
    // can fail after a schema change while everything else is fine.
  }
  const state = store.state();

  if (!state.enabled) {
    return NextResponse.json(completion(holding("The desk is not running.")));
  }

  const settings =
    state.runSettings ??
    (state.ownerUserId === null
      ? DEFAULT_PAPER_TRADER_SETTINGS
      : paperTraderSettingsFrom(agentSettingsFor(state.ownerUserId, PAPER_TRADER_AGENT_ID)));

  // Account creation immediately triggers the arena's first cycle before its
  // HTTP response reaches Breadboard. The durable account id is therefore not
  // guaranteed to be recorded yet. That first cycle can still start the next
  // TradingAgents analysis safely against an empty book instead of being wasted
  // as "desk not running".
  const tables =
    state.accountId === null
      ? { positions: [], orders: [], trades: [], decisions: [] }
      : readTables(state.accountId, 100);
  const livePriceBook = await priceBook(tables.positions);
  const positions = pricePositions(tables.positions, livePriceBook.prices);
  if (livePriceBook.missing.length) {
    return NextResponse.json(
      completion(
        holding(
          `Live pricing is unavailable for ${livePriceBook.missing.join(", ")}; the desk will not act on an incomplete risk picture.`,
        ),
      ),
    );
  }
  // Orders and decisions are capped for display, but risk is lifetime
  // arithmetic. Truncating fills can discard opening legs and make a losing
  // desk appear healthy once enough trades have accumulated.
  const lifetimeTrades = state.accountId === null ? [] : readTradeHistory(state.accountId);
  const history = readHistory(lifetimeTrades);
  const capital = state.accountCapital ?? settings.startingCapital;
  const equity = capital + history.realised + unrealised(positions);
  const assessment = assessRisk({ equity, capital, positions, settings });

  // 1. Serve whatever the last completed analysis concluded, after the rest of
  //    the committee has had its say about it.
  const ready = store.takeReadyDecision();
  let served: ArenaDecisionPayload;
  if (ready) {
    // The stored rating is the framework's own word — Buy, Overweight, Hold,
    // Underweight or Sell — kept rather than flattened, so the five-point scale
    // survives to the point where the desk decides what to do about it.
    const rating = parseRating(ready.rating);
    const action = ratingAction(rating);
    const primary: { verdict: Verdict; rating: typeof rating; reasoning: string } = {
      verdict: action.verdict,
      rating,
      reasoning: ready.reasoning,
    };
    const chair = await harmonise({
      primary,
      symbol: ready.symbol,
      advice: store.advice(),
      history,
      assessment,
      positions,
      settings,
    });
    // A committee that cannot agree does not act. The threshold is the whole
    // point of asking more than one seat.
    const acted = chair.confidence >= settings.minConfidence ? chair.verdict : "HOLD";
    const reasoning = [
      primary.reasoning,
      chair.rationale ? `Chair: ${chair.rationale}` : "",
      chair.confidence < settings.minConfidence
        ? `The committee was only ${Math.round(chair.confidence * 100)}% confident, below the ${Math.round(settings.minConfidence * 100)}% the desk acts on.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");

    // An exchange that is shut is a hard no, whatever the committee concluded.
    // Yahoo keeps quoting the last close all weekend, so without this the desk
    // would spend two days filling at Friday's price against a market that
    // cannot move — the most convincing way there is to make a paper record
    // meaningless. Coins never close, so this only ever stops a share.
    const instruments = instrumentsOf(settings);
    const base = deskBaseUrl();
    const shut =
      kindOf(ready.symbol, instruments) === "EQUITY" && base
        ? await marketStatus(base, ready.symbol)
        : null;

    const proposed =
      shut && !shut.open
        ? holding(
            `${reasoning} The market for ${ready.symbol} is ${shut.state.toLowerCase()}, so nothing was traded.`,
          )
        : decisionFor({
            verdict: acted,
            // A chair that overrode the analysts gets the cautious reading: it
            // may close a position, but it may not open a leveraged short the
            // analysts never called for.
            conviction: chair.overrode ? "mild" : action.conviction,
            confidence: chair.confidence,
            symbol: ready.symbol,
            reasoning,
            positions,
            settings,
            instruments,
          });
    // The risk officer sees the order last and can only ever reduce it.
    const constrained = constrain({
      decision: proposed,
      symbol: ready.symbol,
      assessment,
      history,
      settings,
    });
    served = constrained.decision;
    // The arena only needs the final order-shaped payload. Breadboard keeps the
    // path that produced it alongside that payload so the card can explain why
    // an analyst's BUY/SELL became a smaller position, a hold, or no fill at
    // all. This is audit metadata in Breadboard's database; it is never sent to
    // the arena as part of the model response.
    store.recordServedDecision(ready.id, {
      ...served,
      audit: {
        mappedVerdict: action.verdict,
        mappedConviction: action.conviction,
        chairVerdict: chair.verdict,
        chairConfidence: chair.confidence,
        chairOverrode: chair.overrode,
        chairRationale: chair.rationale,
        minimumConfidence: settings.minConfidence,
        sizingCeiling: settings.positionSize,
        selectedAllocation:
          served.operation === "open" ? served.target_portion_of_balance : null,
        marketState: shut?.state ?? null,
        marketBlocked: Boolean(shut && !shut.open),
        riskStance: assessment.stance,
        riskIntervention: constrained.intervention,
      },
    });
  } else {
    const pending = store.pendingDecision();
    served = holding(
      pending
        ? `TradingAgents is still analysing ${pending.symbol}. Holding until it reports.`
        : "No analysis has finished yet. Holding this cycle.",
    );
  }

  // 2. Refresh whichever advisers have gone stale. Returns at once: each
  //    consultation is a whole cloned runtime and lands on the noticeboard when
  //    it is done, for a later cycle to read.
  if (state.ownerUserId !== null) {
    refreshAdvisers({ userId: state.ownerUserId, settings });
  }

  // 3. Start the next analysis, unless one is already running.
  const recentlyAnalysed = store.recentlyAnalysedSymbols();
  const instruments = instrumentsOf(settings);
  // Alternate the open-ended company universe with the configured coins. A
  // fresh company candidate every cycle would otherwise always look "stalest"
  // and starve the finite crypto rotation. Held symbols remain eligible on both
  // sides, so the desk never loses the ability to close a position.
  const lastWasEquity = Boolean(
    recentlyAnalysed[0] && kindOf(recentlyAnalysed[0], instruments) === "EQUITY",
  );
  let automaticEquity = lastWasEquity
    ? null
    : await automaticEquityForCycle(recentlyAnalysed, settings.cycleMinutes);
  if (automaticEquity) {
    const base = deskBaseUrl();
    const session = base ? await marketStatus(base, automaticEquity.symbol) : null;
    // The company universe is broad, but a closed exchange cannot produce an
    // honest fill. Do not spend an overnight cycle analysing a stock whose
    // eventual decision must be discarded; let the always-open crypto side run
    // and return to companies automatically during their regular session.
    if (!session?.open) automaticEquity = null;
  }
  const symbol = chooseSymbol(
    settings,
    positions.map((position) => position.symbol),
    recentlyAnalysed,
    automaticEquity ? [automaticEquity.symbol] : [],
  );
  if (symbol) {
    const claimed = store.claimAnalysisIfEnabled(symbol);
    if (claimed !== null) {
      const context = analysisContext();
      // Deliberately not awaited: the arena is waiting on this response, and the
      // analysis it starts is for the cycle after next.
      void runAnalysis(symbol, settings, context)
        .then((result) => {
          store.settleAnalysis({
            id: claimed,
            rating: result.rating,
            // The order is worked out when the verdict is served, against the
            // position as it stands then; this is only the audit trail.
            decision: { verdict: result.rating, symbol },
            reasoning: result.reasoning,
          });
        })
        .catch((error: unknown) => {
          store.failAnalysis(
            claimed,
            error instanceof Error ? error.message : "The analysis failed.",
          );
        });
    }
  }

  return NextResponse.json(completion(served));
}
