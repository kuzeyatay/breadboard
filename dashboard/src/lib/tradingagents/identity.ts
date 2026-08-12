// The TradingAgents agent's chat identity and its request model.
//
// Every other runtime agent in Breadboard takes a sentence. This one does not:
// the cloned framework analyses one instrument on one date with a chosen set of
// analysts and a chosen debate depth, and there is no prompt anywhere in its
// graph that free text could reach. So the request is a typed object, the
// composer refuses free typing while the agent is selected (see
// assistant-composer.tsx), and the chat message is rendered FROM the object
// rather than parsed into one.
//
// `parseTradingAgentsCommand` still exists for the reverse direction: a pasted
// or historical `/agents:trading-agent NVDA 2026-08-04` selects the agent and
// pre-fills the form. It never becomes a prompt — anything it cannot recognise
// is dropped rather than forwarded.

export const TRADINGAGENTS_COMMAND = "/agents:trading-agent";
export const TRADINGAGENTS_AGENT_ID = "trading-agent";
export const TRADINGAGENTS_AGENT_NAME = "Trading Agent";

/** The analyst keys the graph knows. The wire key for sentiment is "social". */
export const TRADINGAGENTS_ANALYSTS = [
  { key: "market", label: "Market", detail: "Price action and technical indicators" },
  { key: "social", label: "Sentiment", detail: "News tone, StockTwits and Reddit chatter" },
  { key: "news", label: "News", detail: "Company and macroeconomic headlines" },
  { key: "fundamentals", label: "Fundamentals", detail: "Financials, valuation and insider activity" },
] as const;

export type TradingAgentsAnalyst = (typeof TRADINGAGENTS_ANALYSTS)[number]["key"];

const ANALYST_KEYS = TRADINGAGENTS_ANALYSTS.map((analyst) => analyst.key) as TradingAgentsAnalyst[];
const ANALYST_SET = new Set<string>(ANALYST_KEYS);

export type TradingAgentsAssetType = "stock" | "crypto";

export interface TradingAgentsRequest {
  /** Instrument symbol as the data vendors spell it (NVDA, ASML.AS, BTC-USD). */
  ticker: string;
  /** The date the analysis is anchored to, YYYY-MM-DD. */
  tradeDate: string;
  analysts: TradingAgentsAnalyst[];
  /** Bull/bear debate rounds. Upstream calls this the research depth. */
  researchDepth: number;
  /** Rounds of the aggressive/conservative/neutral risk discussion. */
  riskRounds: number;
  assetType: TradingAgentsAssetType;
}

export const TRADINGAGENTS_DEPTHS = [
  { value: 1, label: "Shallow", detail: "One debate round — fastest" },
  { value: 2, label: "Medium", detail: "Two rounds of argument" },
  { value: 3, label: "Deep", detail: "Three rounds — slowest, most thorough" },
] as const;

export const MAX_TRADINGAGENTS_ROUNDS = 5;

export const DEFAULT_TRADINGAGENTS_REQUEST: Omit<TradingAgentsRequest, "ticker" | "tradeDate"> = {
  analysts: [...ANALYST_KEYS],
  researchDepth: 1,
  riskRounds: 1,
  assetType: "stock",
};

/**
 * Symbols reach the data vendors as path components and as URL query values, so
 * the shape is pinned here rather than trusted: letters, digits, and the
 * separators real tickers use (BRK.B, BTC-USD, 7203.T) plus the leading caret
 * that names an index (^GSPC, ^N225 — the framework's own benchmark map).
 */
const TICKER_PATTERN = /^\^?[A-Za-z0-9][A-Za-z0-9.\-^]{0,14}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidTicker(value: string): boolean {
  return TICKER_PATTERN.test(value.trim());
}

/** A real calendar date, not merely a well-shaped string ("2026-02-31" is not). */
export function isValidTradeDate(value: string): boolean {
  if (!DATE_PATTERN.test(value.trim())) return false;
  const [year, month, day] = value.trim().split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clampRounds(value: unknown, fallback: number): number {
  const rounds = Math.trunc(Number(value));
  if (!Number.isFinite(rounds)) return fallback;
  return Math.min(Math.max(rounds, 1), MAX_TRADINGAGENTS_ROUNDS);
}

export function parseAnalysts(value: unknown): TradingAgentsAnalyst[] {
  if (!Array.isArray(value)) return [];
  const chosen = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    // "sentiment" is the label the UI and upstream docs use; "social" is the
    // wire key the graph indexes its nodes by.
    .map((item) => (item === "sentiment" ? "social" : item))
    .filter((item) => ANALYST_SET.has(item)) as TradingAgentsAnalyst[];
  // Keep the graph's own order regardless of how the caller listed them: the
  // analysts run in sequence and the first one is the graph's entry node.
  return ANALYST_KEYS.filter((key) => chosen.includes(key));
}

export type TradingAgentsRequestResult =
  | { ok: true; request: TradingAgentsRequest }
  | { ok: false; error: string };

/**
 * Validate an untrusted request from the browser. Shared by the form and the
 * route so the two can never disagree about what a runnable request is.
 */
export function validateTradingAgentsRequest(
  value: unknown,
  options: { today?: string } = {},
): TradingAgentsRequestResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "The analysis request was not readable." };
  }
  const candidate = value as Record<string, unknown>;

  const rawTicker = typeof candidate.ticker === "string" ? candidate.ticker.trim() : "";
  if (!rawTicker) return { ok: false, error: "Enter the symbol you want analysed." };
  if (!isValidTicker(rawTicker)) {
    return {
      ok: false,
      error: "That symbol is not one the data vendors can look up (letters, digits, . - ^ only).",
    };
  }

  const tradeDate = typeof candidate.tradeDate === "string" ? candidate.tradeDate.trim() : "";
  if (!isValidTradeDate(tradeDate)) {
    return { ok: false, error: "Choose an analysis date in YYYY-MM-DD form." };
  }
  const today = options.today ?? todayIso();
  if (tradeDate > today) {
    // The framework filters look-ahead data by this date; a future one has no
    // prices to read and produces an empty analysis rather than an error.
    return { ok: false, error: "The analysis date cannot be in the future." };
  }

  const analysts = parseAnalysts(candidate.analysts);
  if (!analysts.length) return { ok: false, error: "Choose at least one analyst." };

  const assetType: TradingAgentsAssetType = candidate.assetType === "crypto" ? "crypto" : "stock";

  return {
    ok: true,
    request: {
      ticker: normalizeTicker(rawTicker),
      tradeDate,
      analysts,
      researchDepth: clampRounds(candidate.researchDepth, 1),
      riskRounds: clampRounds(candidate.riskRounds, 1),
      assetType,
    },
  };
}

function analystLabel(key: TradingAgentsAnalyst): string {
  return TRADINGAGENTS_ANALYSTS.find((analyst) => analyst.key === key)?.label ?? key;
}

/** How the request reads as the user half of the chat turn. */
export function tradingAgentsUserMessage(request: TradingAgentsRequest): string {
  const analysts = request.analysts.map(analystLabel).join(", ");
  const parts = [
    `${request.ticker} on ${request.tradeDate}`,
    `analysts: ${analysts}`,
    `research depth ${request.researchDepth}`,
    `risk rounds ${request.riskRounds}`,
  ];
  if (request.assetType === "crypto") parts.push("crypto");
  return `${TRADINGAGENTS_COMMAND} ${parts.join(" · ")}`;
}

/** A short label for the run card and the conversation list. */
export function tradingAgentsRunLabel(request: TradingAgentsRequest): string {
  return `${request.ticker} · ${request.tradeDate}`;
}

/**
 * Recognise the command at the head of a message, and recover whatever of the
 * request it carries. Returns null when the command is not there at all.
 *
 * Anything unrecognised is discarded: this is a form pre-fill, never a prompt.
 */
export function parseTradingAgentsCommand(
  value: string,
): { partial: Partial<TradingAgentsRequest> } | null {
  let remaining = value.trim();
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:trading-agent") selected = true;
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;

  const partial: Partial<TradingAgentsRequest> = {};
  const date = /\b(\d{4}-\d{2}-\d{2})\b/.exec(remaining);
  if (date && isValidTradeDate(date[1])) partial.tradeDate = date[1];

  // A symbol has to look like one, not merely fit the character set: "tell me
  // whether to buy" would otherwise pre-fill the form with TELL. Tickers are
  // written in caps, or carry a digit or an exchange separator.
  const withoutDate = date ? remaining.replace(date[1], " ") : remaining;
  const ticker = /(?:^|\s)([A-Z0-9^][A-Z0-9.\-^]{0,14}|[A-Za-z]{1,6}[.\-^][A-Za-z0-9]{1,6})(?=\s|$)/
    .exec(withoutDate);
  if (ticker && isValidTicker(ticker[1]) && !/^(ON|ANALYSTS?|DEPTH|RISK|CRYPTO)$/i.test(ticker[1])) {
    partial.ticker = normalizeTicker(ticker[1]);
  }

  const analysts = parseAnalysts(
    (/analysts?:\s*([^·|]+)/i.exec(remaining)?.[1] ?? "").split(","),
  );
  if (analysts.length) partial.analysts = analysts;

  const depth = /(?:research\s+)?depth\s+(\d+)/i.exec(remaining);
  if (depth) partial.researchDepth = clampRounds(depth[1], 1);
  const risk = /risk(?:\s+rounds)?\s+(\d+)/i.exec(remaining);
  if (risk) partial.riskRounds = clampRounds(risk[1], 1);
  if (/\bcrypto\b/i.test(remaining)) partial.assetType = "crypto";

  return { partial };
}
