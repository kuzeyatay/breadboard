// Reading and steering the arena from Breadboard's side.
//
// The clone publishes two surfaces and the card needs both, which is why this
// module is not simply an HTTP client.
//
// Its REST API owns everything that needs a live price: the account list, the
// per-account overview, and the asset curve behind the chart. Those are fetched.
//
// Its per-account tables — positions, orders, trades, and the AI decision log
// that is the most interesting thing on the card — are published only over the
// WebSocket its own React frontend connects to. Breadboard draws that frontend
// itself and has no socket to hold open across a page reload, so those four are
// read straight out of the SQLite file the backend writes, opened read-only.
// The clone runs SQLite in WAL mode, so a reader never blocks the writer.
//
// The schema those reads depend on is the clone's own `ensureSchema()` DDL,
// which it describes as a verbatim copy of what its predecessor emitted and does
// not migrate. Column names are therefore stable, and a read that fails anyway
// degrades to an empty table rather than breaking the card.

import fs from "node:fs";
import Database from "better-sqlite3";
import { databasePath } from "./runtime.ts";

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Writes to the account API get their own, far longer budget.
 *
 * Creating or updating an account is not a database write in this clone: both
 * handlers `await resetAutoTradingJob()` before answering, which prefetches a
 * live price for every registered symbol — one ccxt round trip to Hyperliquid
 * each, ten to thirty seconds apiece on a cold cache. A read timeout applied to
 * those would abort a request the arena then completes anyway, which is exactly
 * how the desk once ended up running with an account it did not know it had.
 */
const WRITE_TIMEOUT_MS = 180_000;

/**
 * Whether a failure was this side giving up rather than the arena refusing.
 * A write that timed out has almost certainly landed, so the caller re-reads
 * instead of treating it as a failure.
 */
export function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    /abort|timed? ?out/i.test(error.message)
  );
}

export interface ArenaAccount {
  id: number;
  name: string;
  accountType: string;
  initialCapital: number;
  currentCash: number;
  frozenCash: number;
  model: string | null;
  baseUrl: string | null;
  apiKey: string | null;
}

/** The account fields a browser is allowed to see. */
export interface PublicArenaAccount {
  id: number;
  name: string;
  initialCapital: number;
  currentCash: number;
}

/**
 * Strip the model callback address and bearer token before an arena account
 * crosses an API boundary. The card only needs the live cash balance and the
 * identity needed to associate it with the desk.
 */
export function publicArenaAccounts(accounts: readonly ArenaAccount[]): PublicArenaAccount[] {
  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    initialCapital: account.initialCapital,
    currentCash: account.currentCash,
  }));
}

export interface ArenaOverview {
  totalAssets: number;
  positionsValue: number;
  positionsCount: number;
  pendingOrders: number;
}

export interface CurvePoint {
  timestamp: number;
  datetime: string;
  accountName: string;
  totalAssets: number;
  initialCapital: number;
  profit: number;
  profitPercentage: number;
  cash: number;
  positionsValue: number;
}

export interface ArenaPosition {
  id: number;
  symbol: string;
  name: string;
  quantity: number;
  availableQuantity: number;
  avgCost: number;
  leverage: number;
  side: string;
  lastPrice: number | null;
  marketValue: number | null;
  unrealisedPnl: number | null;
}

export interface ArenaOrder {
  id: number;
  orderNo: string;
  symbol: string;
  side: string;
  orderType: string;
  price: number | null;
  quantity: number;
  leverage: number;
  filledQuantity: number;
  status: string;
  orderTime: string;
}

export interface ArenaTrade {
  id: number;
  symbol: string;
  side: string;
  price: number;
  quantity: number;
  /** One execution fee. The arena mirrors its taker fee into `commission`. */
  commission: number;
  /** Borrowing interest settled by this fill. */
  interestCharged: number;
  tradeTime: string;
}

export interface ArenaDecision {
  id: number;
  decisionTime: string;
  operation: string;
  symbol: string | null;
  prevPortion: number;
  targetPortion: number;
  totalBalance: number;
  leverage: number;
  executed: boolean;
  reason: string;
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

async function call(
  base: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  return fetch(new URL(path, base), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  });
}

async function json(
  base: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const response = await call(base, path, init, timeoutMs);
  if (!response.ok) {
    throw new Error(`The trading desk refused ${path} (${response.status}).`);
  }
  return response.json();
}

// ---- REST -------------------------------------------------------------------

export async function listAccounts(base: string): Promise<ArenaAccount[]> {
  const body = await json(base, "/api/account/list");
  if (!Array.isArray(body)) return [];
  return body.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return {
      id: num(row.id),
      name: str(row.name),
      accountType: str(row.account_type, "AI"),
      initialCapital: num(row.initial_capital),
      currentCash: num(row.current_cash),
      frozenCash: num(row.frozen_cash),
      model: typeof row.model === "string" ? row.model : null,
      baseUrl: typeof row.base_url === "string" ? row.base_url : null,
      apiKey: typeof row.api_key === "string" ? row.api_key : null,
    };
  });
}

export async function accountOverview(base: string, accountId: number): Promise<ArenaOverview> {
  const body = (await json(base, `/api/account/${accountId}/overview`)) as Record<string, unknown>;
  const portfolio = (body.portfolio ?? {}) as Record<string, unknown>;
  return {
    totalAssets: num(portfolio.total_assets),
    positionsValue: num(portfolio.positions_value),
    positionsCount: num(portfolio.positions_count),
    pendingOrders: num(portfolio.pending_orders),
  };
}

/** The equity curve behind the chart. `timeframe` is the clone's own vocabulary. */
export async function assetCurve(base: string, timeframe: string): Promise<CurvePoint[]> {
  const body = await json(
    base,
    `/api/account/asset-curve/timeframe?timeframe=${encodeURIComponent(timeframe)}`,
  );
  if (!Array.isArray(body)) return [];
  return body.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return {
      timestamp: num(row.timestamp),
      datetime: str(row.datetime_str),
      // The clone labels each series with the account name under the key
      // `username`, which is what its own legend renders.
      accountName: str(row.username),
      totalAssets: num(row.total_assets),
      initialCapital: num(row.initial_capital),
      profit: num(row.profit),
      profitPercentage: num(row.profit_percentage),
      cash: num(row.cash),
      positionsValue: num(row.positions_value),
    };
  });
}

export async function createAccount(
  base: string,
  input: { name: string; initialCapital: number; model: string; baseUrl: string; apiKey: string },
): Promise<ArenaAccount> {
  // No trailing slash: the clone mounts these routes at `/api/account` and
  // registers the creator as `/`, which Hono resolves to the bare path. Asking
  // for `/api/account/` is a 404.
  const body = (await json(
    base,
    "/api/account",
    {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        account_type: "AI",
        initial_capital: input.initialCapital,
        model: input.model,
        base_url: input.baseUrl,
        api_key: input.apiKey,
      }),
    },
    WRITE_TIMEOUT_MS,
  )) as Record<string, unknown>;
  return {
    id: num(body.id),
    name: str(body.name),
    accountType: str(body.account_type, "AI"),
    initialCapital: num(body.initial_capital),
    currentCash: num(body.current_cash),
    frozenCash: num(body.frozen_cash),
    model: typeof body.model === "string" ? body.model : null,
    baseUrl: typeof body.base_url === "string" ? body.base_url : null,
    apiKey: typeof body.api_key === "string" ? body.api_key : null,
  };
}

export async function updateAccount(
  base: string,
  accountId: number,
  input: { name?: string; model?: string; baseUrl?: string; apiKey?: string },
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.model !== undefined) payload.model = input.model;
  if (input.baseUrl !== undefined) payload.base_url = input.baseUrl;
  if (input.apiKey !== undefined) payload.api_key = input.apiKey;
  await json(
    base,
    `/api/account/${accountId}`,
    { method: "PUT", body: JSON.stringify(payload) },
    WRITE_TIMEOUT_MS,
  );
}

/** Retire an account. The clone deactivates rather than deletes, keeping history. */
export async function deactivateAccount(base: string, accountId: number): Promise<void> {
  await json(base, `/api/account/${accountId}`, { method: "DELETE" }, WRITE_TIMEOUT_MS);
}

export async function livePrices(
  base: string,
  symbols: string[],
): Promise<Record<string, number>> {
  if (!symbols.length) return {};
  const body = await json(
    base,
    `/api/market/prices?symbols=${encodeURIComponent(symbols.join(","))}`,
  );
  const prices: Record<string, number> = {};
  if (Array.isArray(body)) {
    for (const entry of body) {
      const row = (entry ?? {}) as Record<string, unknown>;
      const symbol = str(row.symbol).toUpperCase();
      const price = num(row.price);
      // The clone answers for both the logical market and the exchange it read
      // from, so the same symbol arrives twice; either price is the same number.
      if (symbol && price > 0) prices[symbol] = price;
    }
  }
  return prices;
}

// ---- the portfolio tables, read from the file the backend writes -------------

interface TableReads {
  positions: ArenaPosition[];
  orders: ArenaOrder[];
  trades: ArenaTrade[];
  decisions: ArenaDecision[];
}

const EMPTY_TABLES: TableReads = { positions: [], orders: [], trades: [], decisions: [] };

function presentTrade(row: Record<string, unknown>): ArenaTrade {
  // The leverage executor writes one taker fee into *both* columns. The older
  // spot executor writes commission and leaves taker_fee at zero. They are
  // alternate representations in this schema, not independent charges.
  const commission = Math.max(0, num(row.commission), num(row.taker_fee));
  return {
    id: num(row.id),
    symbol: str(row.symbol),
    side: str(row.side),
    price: num(row.price),
    quantity: num(row.quantity),
    commission,
    interestCharged: Math.max(0, num(row.interest_charged)),
    tradeTime: str(row.trade_time),
  };
}

/**
 * Read the four per-account tables. Opened read-only per call rather than held
 * open: these reads happen a few times a minute while a card is on screen, and a
 * long-lived handle on a file another process owns is the thing that makes a
 * `Remove build` fail on Windows.
 */
export function readTables(accountId: number, limit = 20): TableReads {
  const file = databasePath();
  if (!fs.existsSync(file)) return EMPTY_TABLES;
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const rows = <T>(sql: string, ...params: unknown[]): T[] =>
      db!.prepare(sql).all(...(params as never[])) as T[];

    const positions = rows<Record<string, unknown>>(
      `SELECT * FROM positions WHERE account_id = ? AND quantity > 0 ORDER BY symbol`,
      accountId,
    ).map((row) => ({
      id: num(row.id),
      symbol: str(row.symbol),
      name: str(row.name),
      quantity: num(row.quantity),
      availableQuantity: num(row.available_quantity),
      avgCost: num(row.avg_cost),
      leverage: num(row.leverage, 1),
      side: str(row.side, "LONG").toUpperCase(),
      lastPrice: null,
      marketValue: null,
      unrealisedPnl: null,
    }));

    const orders = rows<Record<string, unknown>>(
      `SELECT * FROM orders WHERE account_id = ? ORDER BY id DESC LIMIT ?`,
      accountId,
      limit,
    ).map((row) => ({
      id: num(row.id),
      orderNo: str(row.order_no),
      symbol: str(row.symbol),
      side: str(row.side),
      orderType: str(row.order_type),
      price: row.price === null || row.price === undefined ? null : num(row.price),
      quantity: num(row.quantity),
      leverage: num(row.leverage, 1),
      filledQuantity: num(row.filled_quantity),
      status: str(row.status),
      orderTime: str(row.order_time) || str(row.created_at),
    }));

    const trades = rows<Record<string, unknown>>(
      `SELECT * FROM trades WHERE account_id = ? ORDER BY id DESC LIMIT ?`,
      accountId,
      limit,
    ).map(presentTrade);

    const decisions = rows<Record<string, unknown>>(
      `SELECT * FROM ai_decision_logs WHERE account_id = ? ORDER BY id DESC LIMIT ?`,
      accountId,
      limit,
    ).map((row) => ({
      id: num(row.id),
      decisionTime: str(row.decision_time) || str(row.created_at),
      operation: str(row.operation),
      symbol: typeof row.symbol === "string" ? row.symbol : null,
      prevPortion: num(row.prev_portion),
      targetPortion: num(row.target_portion),
      totalBalance: num(row.total_balance),
      leverage: num(row.leverage, 1),
      // The column is a string, because the clone's schema predates a boolean.
      executed: String(row.executed ?? "").toLowerCase() === "true",
      reason: str(row.reason),
    }));

    return { positions, orders, trades, decisions };
  } catch {
    // A read that fails — the file is mid-checkpoint, the desk has never run —
    // costs an empty table on the card, never the card itself.
    return EMPTY_TABLES;
  } finally {
    try {
      db?.close();
    } catch {
      // Nothing left to close.
    }
  }
}

/**
 * Every fill in an account's lifetime, for P&L and risk arithmetic.
 *
 * `readTables` is deliberately capped because its rows are rendered in the
 * polling card. Risk cannot use that cap: once the twenty-first fill arrived,
 * dropping the opening legs of older positions changed both realised P&L and
 * the drawdown stance.
 */
export function readTradeHistory(accountId: number): ArenaTrade[] {
  const file = databasePath();
  if (!fs.existsSync(file)) return [];
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const rows = db
      .prepare(`SELECT * FROM trades WHERE account_id = ? ORDER BY id DESC`)
      .all(accountId) as Record<string, unknown>[];
    return rows.map(presentTrade);
  } catch {
    return [];
  } finally {
    try {
      db?.close();
    } catch {
      // Nothing left to close.
    }
  }
}

/** Fill in what a position is worth right now, from one price lookup per symbol. */
export function pricePositions(
  positions: ArenaPosition[],
  prices: Record<string, number>,
): ArenaPosition[] {
  return positions.map((position) => {
    const price = prices[position.symbol.toUpperCase()];
    if (!price || price <= 0) return position;
    const direction = position.side === "SHORT" ? -1 : 1;
    return {
      ...position,
      lastPrice: price,
      marketValue: price * position.quantity,
      unrealisedPnl: direction * (price - position.avgCost) * position.quantity,
    };
  });
}

export interface MarketStatus {
  open: boolean;
  state: string;
  error: string;
}

/**
 * Whether a symbol can be traded right now.
 *
 * Only equities can answer "no": crypto is continuous, which is why the clone
 * treats this call as a formality. A stock exchange is shut every night and all
 * weekend, and a desk that keeps filling at Friday's close through Sunday is not
 * simulating anything.
 */
export async function marketStatus(base: string, symbol: string): Promise<MarketStatus> {
  try {
    const body = (await json(
      base,
      `/api/market/status/${encodeURIComponent(symbol)}?market=CRYPTO`,
    )) as Record<string, unknown>;
    return {
      open: body.is_trading === true,
      state: str(body.market_status, "UNKNOWN"),
      error: str(body.error),
    };
  } catch (error) {
    // A feed that cannot be reached is not the same as a closed market, but the
    // safe reading of both is the same: do not open a position on it.
    return {
      open: false,
      state: "UNREACHABLE",
      error: error instanceof Error ? error.message : "The market feed did not answer.",
    };
  }
}
