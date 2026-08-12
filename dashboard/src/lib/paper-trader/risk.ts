// The risk officer: the one seat on the desk that is not a model.
//
// Everything else about this agent is a judgement — the debate, the quant note,
// the harmonised verdict. This is the part that is arithmetic, and it has the
// last word, because the failure modes it exists to catch are exactly the ones a
// confident argument produces. A model that has just reasoned its way to a
// conviction is the least likely thing in the system to notice that the desk is
// down a third of its capital, or that it has now lost on this coin three times
// running.
//
// The rules are deliberately few, and all of them are one-directional: the risk
// officer can refuse a position, shrink one, or insist the desk only closes. It
// can never open one, raise leverage, or turn a HOLD into a trade. A safety
// layer that can also add risk is not a safety layer.
//
// Note where the numbers come from. Realised profit is read from the arena's own
// trades table rather than tracked separately, because the arena is the only
// thing that knows what actually filled — a decision the desk made and the arena
// then refused (no cash, position already open, quantity rounded to zero) must
// not count as a trade that happened.

import type { ArenaPosition, ArenaTrade } from "./arena.ts";
import type { ArenaDecisionPayload } from "./decisions.ts";
import type { PaperTraderSettings } from "./settings.ts";

export interface SymbolHistory {
  symbol: string;
  /** Realised profit across every closed leg, in dollars. */
  realised: number;
  fills: number;
  /** How many closes in a row lost money, most recent first. */
  losingStreak: number;
  lastExitAt: string | null;
}

export interface DeskHistory {
  bySymbol: Record<string, SymbolHistory>;
  realised: number;
  fills: number;
}

/**
 * What the desk is allowed to do at all, before any particular coin is
 * considered.
 */
export type RiskStance =
  /** Anything the committee decides. */
  | "open"
  /** Existing positions may be closed; nothing new may be opened. */
  | "reduce-only"
  /** Close everything and stop. */
  | "flat";

export interface RiskAssessment {
  stance: RiskStance;
  /** Plain sentences, shown on the card and passed to the harmoniser. */
  reasons: string[];
  /** Equity as a fraction of the capital the desk opened with. */
  drawdown: number;
  openPositions: number;
}

/**
 * Realised profit per coin, reconstructed from the fills.
 *
 * The leverage executor's wire vocabulary is directional for entries and
 * transactional for exits: LONG/SHORT open, while SELL closes a long and BUY
 * closes a short. Older spot rows use BUY/SELL throughout. Reducing all four to
 * a signed direction lets one running average-cost book understand both shapes.
 * Fees and settled borrowing interest are subtracted where they fall, which is
 * what makes a string of small round trips read as the loss it actually is
 * rather than as breaking even.
 */
export function readHistory(trades: ArenaTrade[]): DeskHistory {
  const bySymbol: Record<string, SymbolHistory> = {};
  // The arena hands back newest-first; profit has to be walked forwards.
  const ordered = [...trades].sort((left, right) => left.id - right.id);

  const books = new Map<string, { quantity: number; cost: number; direction: 1 | -1 }>();
  let realised = 0;
  let fills = 0;

  for (const trade of ordered) {
    const symbol = trade.symbol.toUpperCase();
    const history =
      bySymbol[symbol] ??
      (bySymbol[symbol] = {
        symbol,
        realised: 0,
        fills: 0,
        losingStreak: 0,
        lastExitAt: null,
      });
    history.fills += 1;
    fills += 1;

    const book = books.get(symbol) ?? { quantity: 0, cost: 0, direction: 1 as 1 | -1 };
    const wireSide = trade.side.trim().toUpperCase();
    const side: 1 | -1 | null =
      wireSide === "LONG" || wireSide === "BUY"
        ? 1
        : wireSide === "SHORT" || wireSide === "SELL"
          ? -1
          : null;
    const costs =
      Math.max(0, trade.commission) + Math.max(0, trade.interestCharged ?? 0);

    // A malformed historical row must not be guessed into a long. Its known
    // costs still happened, so retain those while leaving the position book
    // untouched.
    if (side === null) {
      history.realised -= costs;
      realised -= costs;
      continue;
    }

    if (book.quantity === 0) {
      // Opening leg: BUY opens a long, SELL opens a short.
      book.direction = side === 1 ? 1 : -1;
      book.quantity = trade.quantity;
      book.cost = trade.price;
      books.set(symbol, book);
      history.realised -= costs;
      realised -= costs;
      continue;
    }

    if (side === book.direction) {
      // Adding to the position: a new weighted average cost.
      const total = book.quantity + trade.quantity;
      book.cost = (book.cost * book.quantity + trade.price * trade.quantity) / (total || 1);
      book.quantity = total;
      books.set(symbol, book);
      history.realised -= costs;
      realised -= costs;
      continue;
    }

    // Closing leg, whole or partial.
    const closed = Math.min(book.quantity, trade.quantity);
    const profit = book.direction * (trade.price - book.cost) * closed - costs;
    history.realised += profit;
    realised += profit;
    book.quantity -= closed;
    if (book.quantity <= 1e-12) {
      book.quantity = 0;
      book.cost = 0;
    }
    books.set(symbol, book);
    history.lastExitAt = trade.tradeTime;
    history.losingStreak = profit < 0 ? history.losingStreak + 1 : 0;
  }

  return { bySymbol, realised, fills };
}

/**
 * The desk-wide stance. Two conditions, both about the whole book rather than
 * any one coin.
 */
export function assessRisk(input: {
  equity: number;
  capital: number;
  positions: ArenaPosition[];
  settings: PaperTraderSettings;
}): RiskAssessment {
  const reasons: string[] = [];
  const capital = input.capital > 0 ? input.capital : 1;
  const drawdown = Math.max(0, 1 - input.equity / capital);
  const openPositions = input.positions.filter((position) => position.quantity > 0).length;

  let stance: RiskStance = "open";

  if (drawdown >= input.settings.maxDrawdown) {
    stance = "flat";
    reasons.push(
      `The desk is down ${(drawdown * 100).toFixed(1)}% against its starting capital, past the ${(input.settings.maxDrawdown * 100).toFixed(0)}% limit. Closing only.`,
    );
  } else if (openPositions >= input.settings.maxOpenPositions) {
    stance = "reduce-only";
    reasons.push(
      `${openPositions} position${openPositions === 1 ? "" : "s"} open, which is the limit. Nothing new until one closes.`,
    );
  }

  return { stance, reasons, drawdown, openPositions };
}

export interface ConstrainedDecision {
  decision: ArenaDecisionPayload;
  /** Set when the risk officer changed what the committee asked for. */
  intervention: string | null;
}

/**
 * Apply the desk stance and the per-coin cooldown to a decision. Only ever
 * downgrades: an `open` can become a `hold`, and nothing else moves.
 */
export function constrain(input: {
  decision: ArenaDecisionPayload;
  symbol: string;
  assessment: RiskAssessment;
  history: DeskHistory;
  settings: PaperTraderSettings;
}): ConstrainedDecision {
  const { decision, assessment, settings } = input;
  if (decision.operation !== "open") {
    return { decision, intervention: null };
  }

  const refuse = (why: string): ConstrainedDecision => ({
    decision: {
      operation: "hold",
      target_portion_of_balance: 0,
      leverage: 1,
      reason: `${decision.reason} Risk officer: ${why}`,
    },
    intervention: why,
  });

  if (assessment.stance === "flat") {
    return refuse(
      `the desk is past its drawdown limit and may only close positions.`,
    );
  }
  if (assessment.stance === "reduce-only") {
    return refuse(`the desk already holds its maximum number of positions.`);
  }

  const symbol = input.symbol.toUpperCase();
  const history = input.history.bySymbol[symbol];
  if (history && history.losingStreak >= settings.losingStreakLimit) {
    return refuse(
      `${symbol} has closed at a loss ${history.losingStreak} times in a row, so it is being left alone.`,
    );
  }

  return { decision, intervention: null };
}
