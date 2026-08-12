/**
 * The desk's symbol registry — Breadboard's file, compiled into the arena.
 *
 * The cloned arena is a crypto product: its symbol list is a hard-coded map of
 * six coins, and every price call ends at Hyperliquid. This module is the one
 * place that knows a symbol might be a company instead, and it is deliberately
 * the *only* thing the rest of the patch consults, so "what can this desk
 * trade" has a single answer rather than one per file.
 *
 * The register is handed over as an environment variable rather than a config
 * file because the arena reads it once at boot and Breadboard restarts the
 * process whenever the list changes anyway:
 *
 *     DESK_SYMBOLS=BTC|CRYPTO|Bitcoin,NVDA|EQUITY|NVIDIA Corporation
 *
 * Pipes rather than colons: a ticker can carry a dot, a dash and a caret, and a
 * company name can carry almost anything, so the separator has to be a character
 * neither of them uses.
 *
 * **Why the arena's own `market` column is left alone.** Every position, order
 * and trade row in the clone carries `market: 'CRYPTO'`, hard-coded in five
 * places across two files that also own the fill logic, the margin arithmetic
 * and the liquidation path. Threading a real market through them would mean
 * patching the trading core of a repository the user pulls. It buys nothing: the
 * engine uses that column only as part of the position key, and passes it to a
 * price lookup that this patch routes by *symbol* instead. So the column keeps
 * its single value, this registry is the authority on what a symbol actually is,
 * and the trading core is untouched.
 */

export type DeskAssetKind = 'CRYPTO' | 'EQUITY'

export interface DeskSymbol {
  /** As the arena stores it: BTC, NVDA. */
  symbol: string
  kind: DeskAssetKind
  /** What a person calls it, shown in the arena's own order and trade rows. */
  name: string
}

function parse(raw: string): Map<string, DeskSymbol> {
  const register = new Map<string, DeskSymbol>()
  for (const entry of raw.split(',')) {
    const [symbol, kind, ...rest] = entry.split('|')
    const ticker = (symbol ?? '').trim().toUpperCase()
    if (!ticker) continue
    register.set(ticker, {
      symbol: ticker,
      kind: (kind ?? '').trim().toUpperCase() === 'EQUITY' ? 'EQUITY' : 'CRYPTO',
      name: rest.join('|').trim() || ticker,
    })
  }
  return register
}

/**
 * The clone's original six coins, used when nothing is registered. Without this
 * an arena started outside Breadboard — by the user, from the checkout — would
 * boot with no tradable symbols at all.
 */
const FALLBACK = 'BTC|CRYPTO|Bitcoin,ETH|CRYPTO|Ethereum,SOL|CRYPTO|Solana,BNB|CRYPTO|Binance Coin,XRP|CRYPTO|Ripple,DOGE|CRYPTO|Dogecoin'
const KNOWN_CRYPTO = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'])
const SAFE_EQUITY_TICKER = /^[A-Z][A-Z0-9.-]{0,13}$/

let register: Map<string, DeskSymbol> | null = null

export function deskSymbols(): Map<string, DeskSymbol> {
  if (!register) {
    const raw = process.env.DESK_SYMBOLS?.trim()
    register = parse(raw && raw.length > 0 ? raw : FALLBACK)
    if (register.size === 0) register = parse(FALLBACK)
  }
  return register
}

export function deskSymbol(symbol: string): DeskSymbol | null {
  const ticker = symbol.trim().toUpperCase()
  const registered = deskSymbols().get(ticker)
  if (registered) return registered
  // Company candidates are selected from the exchange directory after this
  // process has started, so they cannot all be enumerated in DESK_SYMBOLS.
  // Unknown safe tickers are routed to Yahoo as equities; a nonexistent or
  // non-USD listing fails there before the simulated engine can place an order.
  if (SAFE_EQUITY_TICKER.test(ticker) && !KNOWN_CRYPTO.has(ticker)) {
    return { symbol: ticker, kind: 'EQUITY', name: ticker }
  }
  return null
}

export function isSupportedSymbol(symbol: string): boolean {
  return deskSymbol(symbol) !== null
}

export function deskSymbolName(symbol: string): string | undefined {
  return deskSymbol(symbol)?.name
}

export function isEquity(symbol: string): boolean {
  return deskSymbol(symbol)?.kind === 'EQUITY'
}

/** The tradable list, in the order it was registered. */
export function deskSymbolList(): string[] {
  return [...deskSymbols().keys()]
}

/** `{ BTC: 'Bitcoin', NVDA: 'NVIDIA Corporation' }`, the shape the clone wants. */
export function deskSymbolNames(): Record<string, string> {
  const names: Record<string, string> = {}
  for (const entry of deskSymbols().values()) names[entry.symbol] = entry.name
  return names
}

/**
 * How much of a symbol may be bought.
 *
 * The paper book supports fractional shares. That keeps every eligible company
 * tradable even when one whole share costs more than the configured allocation;
 * opens and closes use this same six-decimal rule, so fractions settle cleanly.
 */
export function roundQuantity(symbol: string, quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0
  return Number(quantity.toFixed(6))
}
