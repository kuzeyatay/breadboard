// The Paper Trader agent's chat identity, and the small vocabulary of things a
// message to it can mean.
//
// Every other runtime agent answers a question and finishes. This one does not:
// it starts a trading desk that keeps running after the turn ends while
// Breadboard is open. Closing Breadboard ends its processes; reopening resumes a
// desk whose durable intent is still enabled. So the message is not a prompt, it is an instruction to the
// desk, and there are only three of those: start it, stop it, or show it.
//
// The decisions themselves come from [[trading-agent]]: the cloned TradingAgents
// graph analyses one coin per cycle and its verdict is what the arena trades on.
// Nothing the user types reaches that graph, which is why free text is folded
// down to an intent here rather than forwarded.

export const PAPER_TRADER_COMMAND = "/agents:paper-trader";
export const PAPER_TRADER_AGENT_ID = "paper-trader";
export const PAPER_TRADER_AGENT_NAME = "Paper Trader";

/** What a message to the desk can ask for. */
export type PaperTraderIntent = "start" | "stop" | "status";

const STOP_WORDS = /\b(stop|halt|pause|shut\s*down|shutdown|turn\s*off|kill|end)\b/i;
const STATUS_WORDS = /\b(status|how(?:'s| is| are)|show|check|report|doing|progress|update|open)\b/i;

/**
 * Read the instruction out of a message. Unrecognised text means "start",
 * because typing the command at all is how the desk is opened — and starting an
 * already-running desk shows it rather than restarting it.
 */
export function paperTraderIntent(task: string): PaperTraderIntent {
  const text = task.trim();
  if (!text) return "start";
  if (STOP_WORDS.test(text)) return "stop";
  if (STATUS_WORDS.test(text)) return "status";
  return "start";
}

/**
 * Extract the instruction, preserving any other slash tokens the user stacked in
 * front of the command so the capability resolver still sees them.
 *
 * Returns null when the command is not there at all.
 */
export function taskFromPaperTraderCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:paper-trader") {
      selected = true;
    } else {
      precedingTokens.push(`/${match[1]}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

export function paperTraderUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${PAPER_TRADER_COMMAND} ${trimmed}` : PAPER_TRADER_COMMAND;
}

/** A short label for the run card and the conversation list. */
export function paperTraderRunLabel(task: string): string {
  const intent = paperTraderIntent(task);
  if (intent === "stop") return "Stop the desk";
  if (intent === "status") return "Desk status";
  return "Trading desk";
}

/**
 * The coins the arena knows how to price and trade. Taken from the clone's own
 * `SUPPORTED_SYMBOLS`, so a symbol can never be offered here that its order
 * path would then reject.
 */
export const PAPER_TRADER_SYMBOLS = [
  { value: "BTC", label: "Bitcoin", ticker: "BTC-USD" },
  { value: "ETH", label: "Ethereum", ticker: "ETH-USD" },
  { value: "SOL", label: "Solana", ticker: "SOL-USD" },
  { value: "BNB", label: "Binance Coin", ticker: "BNB-USD" },
  { value: "XRP", label: "Ripple", ticker: "XRP-USD" },
  { value: "DOGE", label: "Dogecoin", ticker: "DOGE-USD" },
] as const;

export type PaperTraderSymbol = (typeof PAPER_TRADER_SYMBOLS)[number]["value"];

const SYMBOL_SET = new Set<string>(PAPER_TRADER_SYMBOLS.map((symbol) => symbol.value));

export function isPaperTraderSymbol(value: unknown): value is PaperTraderSymbol {
  return typeof value === "string" && SYMBOL_SET.has(value.toUpperCase());
}

/**
 * What the desk can hold. Coins come from the fixed list above. Company shares
 * are discovered from the US exchange directories at runtime, so an equity no
 * longer has to be copied into a settings allowlist before the desk may use it.
 */
export type InstrumentKind = "CRYPTO" | "EQUITY";

export interface Instrument {
  /** As the arena stores it: BTC, NVDA. */
  symbol: string;
  kind: InstrumentKind;
  /** What the desk calls it in a sentence. */
  label: string;
}

/**
 * A ticker as Yahoo spells one: letters and digits, plus the separators real
 * listings use (BRK.B, RDS-A) and the caret that names an index. Pinned rather
 * than trusted because it reaches a data vendor as a URL path component.
 */
const STOCK_TICKER = /^[A-Za-z][A-Za-z0-9.\-]{0,13}$/;

export function isStockTicker(value: string): boolean {
  return STOCK_TICKER.test(value.trim());
}

/**
 * Read the stock list out of the settings text field. Commas, spaces and
 * newlines all separate, because people paste watchlists in every one of those
 * shapes. Anything that is not a plausible ticker is dropped rather than sent to
 * a vendor.
 */
export function parseStockTickers(value: unknown, limit = 12): string[] {
  if (typeof value !== "string") return [];
  const seen = new Set<string>();
  for (const raw of value.split(/[\s,;]+/)) {
    const ticker = raw.trim().toUpperCase();
    if (!ticker || !isStockTicker(ticker)) continue;
    // A coin and a company must not collide: the arena keys a position by symbol
    // alone, so one register entry per symbol is the whole invariant.
    if (SYMBOL_SET.has(ticker)) continue;
    seen.add(ticker);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

/** Everything the desk may trade this session, coins first. */
export function instrumentsFor(input: {
  symbols: readonly string[];
  stocks: readonly string[];
}): Instrument[] {
  const coins: Instrument[] = input.symbols.map((symbol) => ({
    symbol: symbol.toUpperCase(),
    kind: "CRYPTO" as const,
    label: symbolLabel(symbol),
  }));
  const shares: Instrument[] = input.stocks.map((ticker) => ({
    symbol: ticker.toUpperCase(),
    kind: "EQUITY" as const,
    // The company's own name is not known until a vendor is asked, and a ticker
    // is what a trader reads anyway.
    label: ticker.toUpperCase(),
  }));
  return [...coins, ...shares];
}

export function kindOf(symbol: string, instruments: readonly Instrument[]): InstrumentKind {
  const upper = symbol.trim().toUpperCase();
  const found = instruments.find((instrument) => instrument.symbol === upper);
  if (found) return found.kind;
  // The crypto universe is deliberately closed; every other safe ticker shape
  // is an equity candidate. The arena still asks Yahoo for a real USD quote
  // before it can book anything, so a syntactically valid but nonexistent symbol
  // fails closed at the market-data boundary.
  return SYMBOL_SET.has(upper) || !isStockTicker(upper) ? "CRYPTO" : "EQUITY";
}

/**
 * How the data vendors spell a symbol the arena calls "BTC" or "NVDA". Coins
 * carry their quote currency; a listed company is just its ticker.
 */
export function tickerFor(symbol: string, kind: InstrumentKind = "CRYPTO"): string {
  const upper = symbol.trim().toUpperCase();
  if (kind === "EQUITY") return upper;
  const found = PAPER_TRADER_SYMBOLS.find((entry) => entry.value === upper);
  return found ? found.ticker : `${upper}-USD`;
}

export function symbolLabel(symbol: string): string {
  return (
    PAPER_TRADER_SYMBOLS.find((entry) => entry.value === symbol.toUpperCase())?.label ??
    symbol.toUpperCase()
  );
}
