/**
 * Company shares for the arena — Breadboard's file, compiled into the clone.
 *
 * Written to the same three-function contract as the clone's own
 * `hyperliquid.ts`, so `marketData.ts` can pick between them by symbol and
 * nothing downstream knows the difference.
 *
 * **No API key, anywhere.** The source is Yahoo Finance through
 * `yahoo-finance2`, which needs no account, no key and no signup — it handles
 * the cookie-and-crumb handshake Yahoo requires internally. That was the
 * requirement this whole module exists to satisfy: every other equity feed worth
 * having (Alpha Vantage, Finnhub, Polygon, Alpaca, IEX) starts with "create an
 * account and paste a key".
 *
 * **Dollars only, on purpose.** The arena keeps one cash balance and no FX. A
 * position in a share quoted in euros or yen would be added to a dollar balance
 * at face value, and every return figure on the desk would quietly be wrong. So
 * a non-USD quote is refused with a reason rather than silently mis-booked.
 * Supporting them properly means an FX layer, not a unit change.
 *
 * **The market being shut is a real answer, not an error.** Crypto never closes,
 * which is why the clone's market-status call is a formality. A stock exchange
 * closes every night and all weekend, and a desk that keeps "trading" at
 * Friday's close all weekend is not a simulation of anything. `marketState` from
 * the quote is passed through so the desk can hold instead.
 */

import YahooFinance from 'yahoo-finance2'
import { getLogger } from '../utils/logger.js'
import type { Kline, MarketStatus } from './hyperliquid.js'

const logger = getLogger('services.equity')

/**
 * One client for the process. The library keeps the Yahoo cookie and crumb on
 * the instance, so a fresh client per call would redo that handshake every time
 * and get itself rate-limited.
 */
const yahoo = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
})

/** How many failures in a row before the desk is told the feed is down. */
const RETRIES = 3

/** Yahoo's own intervals, keyed by the arena's period vocabulary. */
const INTERVAL_MAP: Record<string, '1m' | '5m' | '15m' | '30m' | '1h' | '1d'> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '1d': '1d',
}

/** Roughly how far back to ask for, so `count` candles come back. */
const LOOKBACK_DAYS: Record<string, number> = {
  '1m': 5,
  '5m': 12,
  '15m': 30,
  '30m': 45,
  '1h': 90,
  '1d': 400,
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * How long any one call to Yahoo may take before it is abandoned.
 *
 * This bound is not politeness, it is the thing that keeps the desk alive. The
 * arena's scheduler runs its trading job behind a `max_instances=1` flag it
 * clears in a `finally`, so the flag is only ever released when the job's
 * promise settles. A single request that hangs — no error, no response, just an
 * open socket — therefore does not delay one cycle: it ends trading altogether,
 * silently, until the process is restarted. A price is worthless by the time it
 * is a minute old anyway, so there is nothing to lose by giving up early.
 */
const CALL_TIMEOUT_MS = 20_000

function withTimeout<T>(what: string, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what} did not answer within ${CALL_TIMEOUT_MS / 1000}s`)),
      CALL_TIMEOUT_MS,
    )
    run().then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

async function withRetry<T>(what: string, run: () => Promise<T>): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    try {
      return await withTimeout(what, run)
    } catch (error) {
      last = error
      // Yahoo rate-limits by IP rather than by key, so backing off is the only
      // thing that helps; there is no quota to raise.
      if (attempt < RETRIES - 1) await sleep(500 * 2 ** attempt)
    }
  }
  throw new Error(`${what} failed: ${last instanceof Error ? last.message : String(last)}`)
}

interface Quote {
  price: number
  currency: string
  state: string
  name: string
  exchange: string
  previousClose: number | null
}

async function quote(symbol: string): Promise<Quote> {
  const result = await withRetry(`Quote for ${symbol}`, () => yahoo.quote(symbol))
  if (!result) throw new Error(`No quote for ${symbol}`)
  const price = Number(result.regularMarketPrice)
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Yahoo returned no usable price for ${symbol}`)
  }
  const currency = String(result.currency ?? '').toUpperCase()
  if (currency && currency !== 'USD') {
    // See the note at the top of the file: one cash balance, no FX.
    throw new Error(
      `${symbol} is quoted in ${currency}. The desk's book is in dollars, so only USD-quoted listings can be traded.`,
    )
  }
  return {
    price,
    currency: currency || 'USD',
    // Missing session metadata is not evidence that the exchange is open. A
    // stale quote without `marketState` must fail closed instead of paper-filling
    // at a price the user could not actually trade.
    state: String(result.marketState ?? 'UNKNOWN').toUpperCase(),
    name: String(result.shortName ?? result.longName ?? symbol),
    exchange: String(result.fullExchangeName ?? result.exchange ?? ''),
    previousClose: Number.isFinite(Number(result.regularMarketPreviousClose))
      ? Number(result.regularMarketPreviousClose)
      : null,
  }
}

export async function getLastPriceFromEquity(symbol: string): Promise<number> {
  const result = await quote(symbol)
  return result.price
}

export async function getKlineDataFromEquity(
  symbol: string,
  period = '1d',
  count = 100,
): Promise<Kline[]> {
  const interval = INTERVAL_MAP[period] ?? '1d'
  const days = LOOKBACK_DAYS[period] ?? 400
  const period1 = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const chart = await withRetry(`K-lines for ${symbol}`, () =>
    yahoo.chart(symbol, { period1, interval }),
  )
  const rows = Array.isArray(chart?.quotes) ? chart.quotes : []

  const klines: Kline[] = []
  let previousClose: number | null = null
  for (const row of rows) {
    const close = row.close === null || row.close === undefined ? null : Number(row.close)
    // Yahoo emits placeholder rows for halted or not-yet-open intervals; a
    // candle with no close is not a candle.
    if (close === null || !Number.isFinite(close)) continue
    const timestamp = new Date(row.date).getTime()
    const change = previousClose === null ? 0 : close - previousClose
    const percent = previousClose ? (change / previousClose) * 100 : 0
    const volume = row.volume === null || row.volume === undefined ? null : Number(row.volume)
    klines.push({
      timestamp: Math.trunc(timestamp / 1000),
      datetime_str: new Date(timestamp).toISOString(),
      open: row.open === null || row.open === undefined ? null : Number(row.open),
      high: row.high === null || row.high === undefined ? null : Number(row.high),
      low: row.low === null || row.low === undefined ? null : Number(row.low),
      close,
      volume,
      // The clone's "amount" is turnover; Yahoo does not publish it, so it is
      // approximated the way its own crypto path does.
      amount: volume === null ? null : volume * close,
      change,
      percent,
    })
    previousClose = close
  }

  logger.info(`Got ${klines.length} ${interval} candles for ${symbol} from Yahoo Finance`)
  return klines.slice(-Math.max(1, count))
}

/**
 * Whether the exchange is open right now.
 *
 * `REGULAR` is the only state the desk trades in. Pre- and post-market sessions
 * exist and Yahoo reports prices for them, but they are thin, and a paper fill
 * at a pre-market print is the kind of thing that makes a backtest look clever
 * and a live account look foolish.
 */
export async function getMarketStatusFromEquity(symbol: string): Promise<MarketStatus> {
  try {
    const result = await quote(symbol)
    const open = result.state === 'REGULAR'
    return {
      market_status: open ? 'OPEN' : result.state || 'CLOSED',
      is_trading: open,
      symbol,
      exchange: result.exchange,
      market_type: 'equity',
      base_currency: symbol,
      quote_currency: result.currency,
      active: open,
    }
  } catch (error) {
    return {
      market_status: 'ERROR',
      is_trading: false,
      symbol,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Confirm a ticker exists and is tradable by this desk, for the settings page.
 * Returns the company's own name so the desk's rows read as a person would
 * write them rather than as the ticker repeated twice.
 */
export async function describeEquity(
  symbol: string,
): Promise<{ ok: true; name: string; exchange: string; price: number } | { ok: false; reason: string }> {
  try {
    const result = await quote(symbol)
    return { ok: true, name: result.name, exchange: result.exchange, price: result.price }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : `${symbol} could not be looked up.`,
    }
  }
}
