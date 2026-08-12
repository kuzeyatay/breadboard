// Teaching the cloned arena about company shares, without touching the clone.
//
// The arena is a crypto product: six hard-coded coins, and every price call ends
// at Hyperliquid over ccxt. Trading shares in it needs real changes to its
// source. Editing the user's checkout to make them is not acceptable — the next
// `git pull` there would conflict on files Breadboard rewrote — so the build
// happens somewhere else entirely: the clone's sources are copied into
// `.runtime/paper-trader/backend`, patched there, and compiled there. The
// checkout is only ever read.
//
// The patches themselves are anchored replacements rather than replacement
// files, for the reason that decides everything about how a fork ages. A
// replacement file silently reverts whatever upstream changed around it; an
// anchor that no longer matches stops the build with the name of the patch that
// needs rewriting. Every anchor below must match exactly once, and `applyPatch`
// refuses on zero or many.
//
// The set is deliberately tiny — four edits across three files — and it is small
// because of one decision worth stating. The clone writes `market: 'CRYPTO'` on
// every order, position and trade, hard-coded in five places across the two
// files that also own fills, margin and liquidation. Threading a real market
// through them would mean patching the trading core. It would buy nothing: the
// engine uses that column only as part of a position key, and hands it to a
// price lookup that these patches route by *symbol* instead. So the column keeps
// its one value, the desk's own registry (scripts/paper-trader-overlay/
// deskSymbols.ts) is the authority on what a symbol is, and the trading core is
// left exactly as its authors wrote it.

import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

export interface Patch {
  /** Path inside the backend's `src`, POSIX-style. */
  file: string;
  /** Named so a failure says which patch to look at. */
  name: string;
  /** Must appear exactly once in the file. */
  anchor: string;
  replacement: string;
}

/** Files Breadboard adds rather than edits. Copied into `src/services`. */
export const OVERLAY_FILES = ["deskSymbols.ts", "equity.ts"] as const;

/** The dependency the equity feed needs, and the reason it needs no key. */
export const OVERLAY_DEPENDENCY = "yahoo-finance2@^4.0.2";

const ROUTER_IMPORT = `import { getLogger } from '../utils/logger.js'`;

export const PATCHES: Patch[] = [
  {
    file: "services/marketData.ts",
    name: "market-data-imports",
    anchor: ROUTER_IMPORT,
    replacement: `${ROUTER_IMPORT}
// -- Breadboard: the desk trades shares as well as coins. See overlay.ts.
import { isEquity } from './deskSymbols.js'
import {
  getKlineDataFromEquity,
  getLastPriceFromEquity,
  getMarketStatusFromEquity,
} from './equity.js'`,
  },
  {
    file: "services/marketData.ts",
    name: "market-data-price",
    anchor: `    const price = await getLastPriceFromHyperliquid(symbol)`,
    replacement: `    const price = isEquity(symbol)
      ? await getLastPriceFromEquity(symbol)
      : await getLastPriceFromHyperliquid(symbol)`,
  },
  {
    file: "services/marketData.ts",
    name: "market-data-klines",
    anchor: `    const data = await getKlineDataFromHyperliquid(symbol, period, count)`,
    replacement: `    const data = isEquity(symbol)
      ? await getKlineDataFromEquity(symbol, period, count)
      : await getKlineDataFromHyperliquid(symbol, period, count)`,
  },
  {
    file: "services/marketData.ts",
    name: "market-data-status",
    anchor: `    const status = await getMarketStatusFromHyperliquid(symbol)`,
    replacement: `    const status = isEquity(symbol)
      ? await getMarketStatusFromEquity(symbol)
      : await getMarketStatusFromHyperliquid(symbol)`,
  },
  {
    // The whitelist the clone validates an AI decision against, and the source
    // of the name written onto every order row.
    file: "services/aiDecision.ts",
    name: "supported-symbols",
    anchor: `export const SUPPORTED_SYMBOLS: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SOL: 'Solana',
  DOGE: 'Dogecoin',
  XRP: 'Ripple',
  BNB: 'Binance Coin',
}`,
    replacement: `// -- Breadboard: the tradable list is the desk's register, not a fixed six.
export const SUPPORTED_SYMBOLS: Record<string, string> = new Proxy(
  {} as Record<string, string>,
  {
    get: (_target, key) =>
      typeof key === 'string' ? deskSymbolName(key) : undefined,
    has: (_target, key) => typeof key === 'string' && isSupportedSymbol(key),
    ownKeys: () => Reflect.ownKeys(deskSymbolNames()),
    getOwnPropertyDescriptor: (_target, key) => {
      const name = typeof key === 'string' ? deskSymbolName(key) : undefined
      return name
        ? { value: name, enumerable: true, configurable: true, writable: false }
        : undefined
    },
  },
)`,
  },
  {
    file: "services/aiDecision.ts",
    name: "ai-decision-imports",
    anchor: `import { getLogger } from '../utils/logger.js'`,
    replacement: `import { getLogger } from '../utils/logger.js'
import {
  deskSymbolName,
  deskSymbolNames,
  isSupportedSymbol,
} from './deskSymbols.js'`,
  },
  {
    // The clone calls leveraged notional "total assets" and persists it as the
    // decision balance. Cash plus margin/P&L is equity; cash plus notional is
    // exposure and made a flat $10k portfolio appear to be worth nearly $13k.
    file: "services/aiDecision.ts",
    name: "decision-equity-import",
    anchor: `import { calcPositionsValue } from './assetCalculator.js'`,
    replacement: `// -- Breadboard: decisions record equity, never leveraged exposure.
import { calcPositionsMarketValue } from './assetCalculator.js'`,
  },
  {
    file: "services/aiDecision.ts",
    name: "decision-equity-total",
    anchor: `    total_assets: account.currentCash + (await calcPositionsValue(account.id)),`,
    replacement: `    total_assets: account.currentCash + (await calcPositionsMarketValue(account.id)),`,
  },
  {
    // Missing marks must not make posted margin disappear from equity. At cost
    // is the honest fallback until live pricing returns; unrealised P/L remains
    // unknown, but the account cannot suddenly fall to available cash alone.
    file: "services/assetCalculator.ts",
    name: "position-equity-cost-fallback",
    anchor: `      total += positionEquity
    } catch (e) {
      logger.warning(
        \`Cannot get price for \${p.symbol}.\${p.market}, skipping position value calculation: \${e}\`,
      )
    }`,
    replacement: `      total += positionEquity
    } catch (e) {
      const leverage = p.leverage && p.leverage > 0 ? p.leverage : 1
      const bookValue = p.quantity * p.avgCost
      total += leverage > 1 ? bookValue / leverage : bookValue
      logger.warning(
        \`Cannot get price for \${p.symbol}.\${p.market}; using cost basis for position equity: \${e}\`,
      )
    }`,
  },
  {
    // The list the scheduler prefetches and the AI cycle prices.
    file: "services/tradingCommands.ts",
    name: "ai-trading-symbols",
    anchor: `export const AI_TRADING_SYMBOLS: string[] = [
  'BTC',
  'ETH',
  'SOL',
  'BNB',
  'XRP',
  'DOGE',
]`,
    replacement: `// -- Breadboard: the desk's register decides what is in play, coins or shares.
export const AI_TRADING_SYMBOLS: string[] = deskSymbolList()`,
  },
  {
    file: "services/tradingCommands.ts",
    name: "trading-commands-imports",
    anchor: `import { getLogger } from '../utils/logger.js'

const logger = getLogger('services.tradingCommands')`,
    replacement: `import { getLogger } from '../utils/logger.js'
import { deskSymbolList, roundQuantity } from './deskSymbols.js'

const logger = getLogger('services.tradingCommands')`,
  },
  {
    // Six decimal places is right for a coin and wrong for a share. See the note
    // on roundQuantity in deskSymbols.ts.
    file: "services/tradingCommands.ts",
    name: "whole-shares",
    anchor: `/** Round to 6 decimal places, matching Python's \`round(x, 6)\` for crypto. */
function round6(value: number): number {
  return Number(value.toFixed(6))
}`,
    replacement: `/**
 * -- Breadboard: coins round to 6 places, shares round down to whole units.
 * The symbol is what decides, so the caller passes it through.
 */
function round6(value: number, symbol = ''): number {
  return symbol ? roundQuantity(symbol, value) : Number(value.toFixed(6))
}`,
  },
  {
    file: "services/tradingCommands.ts",
    name: "size-open-by-symbol",
    anchor: `          const orderValue = account.currentCash * targetPortion
          quantity = round6(orderValue / price)`,
    replacement: `          const orderValue = account.currentCash * targetPortion
          quantity = round6(orderValue / price, symbol)`,
  },
  {
    file: "services/tradingCommands.ts",
    name: "size-close-by-symbol",
    anchor: `          quantity = round6(positionQuantity * targetPortion)`,
    replacement: `          quantity = round6(positionQuantity * targetPortion, symbol)`,
  },
  {
    // The prompt is built from the small boot register, but Breadboard's
    // decision endpoint may return an automatically discovered company ticker.
    // Price that candidate on demand before the ordinary validation/execution
    // path sees it.
    file: "services/tradingCommands.ts",
    name: "dynamic-equity-price",
    anchor: `        const price = prices[symbol]`,
    replacement: `        let price = prices[symbol]
        if (!price || price <= 0) {
          try {
            price = await getLastPrice(symbol, 'CRYPTO')
            if (price > 0) prices[symbol] = price
          } catch (err) {
            logger.warning(\`Failed to get decision price for \${symbol}: \${err}\`)
          }
        }`,
  },
  {
    file: "services/scheduler.ts",
    name: "configured-cycle-interval",
    anchor: `    const AI_TRADE_INTERVAL_SECONDS = 300 // 5 minutes`,
    replacement: `    const configuredCycle = Number(process.env.DESK_CYCLE_SECONDS)
    const AI_TRADE_INTERVAL_SECONDS = Number.isFinite(configuredCycle)
      ? Math.max(60, Math.round(configuredCycle))
      : 300`,
  },
];

export class PatchError extends Error {}

/** Apply one anchored replacement, refusing anything but a single match. */
export function applyPatch(source: string, patch: Patch): string {
  const occurrences = source.split(patch.anchor).length - 1;
  if (occurrences !== 1) {
    throw new PatchError(
      `The Paper Trader patch "${patch.name}" expected exactly one match in ${patch.file} but found ${occurrences}. The open-alpha-arena clone has changed; the patch in lib/paper-trader/overlay.ts needs updating.`,
    );
  }
  return source.replace(patch.anchor, patch.replacement);
}

/** Where Breadboard's own arena-side sources live. */
export function overlayDirectory(): string {
  return path.join(repositoryRoot(), "scripts", "paper-trader-overlay");
}

export function overlayFilesPresent(): boolean {
  const directory = overlayDirectory();
  return OVERLAY_FILES.every((file) => fs.existsSync(path.join(directory, file)));
}

/**
 * Patch a copied source tree in place. Throws on the first anchor that no longer
 * matches, which is the whole point: a silent half-applied patch would be an
 * arena that compiles and then cannot price a share.
 */
export function applyPatches(sourceRoot: string): string[] {
  const applied: string[] = [];
  const byFile = new Map<string, Patch[]>();
  for (const patch of PATCHES) {
    byFile.set(patch.file, [...(byFile.get(patch.file) ?? []), patch]);
  }
  for (const [file, patches] of byFile) {
    const target = path.join(sourceRoot, ...file.split("/"));
    if (!fs.existsSync(target)) {
      throw new PatchError(
        `The Paper Trader patch set expects ${file} in the open-alpha-arena clone, and it is not there.`,
      );
    }
    // Normalised before matching: git checks the clone out with the platform's
    // line endings, so on Windows every anchor here would miss by a carriage
    // return. The workspace is Breadboard's own copy, so rewriting it with LF
    // costs nothing and makes the anchors mean the same thing everywhere.
    let contents = fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n");
    for (const patch of patches) {
      contents = applyPatch(contents, patch);
      applied.push(patch.name);
    }
    fs.writeFileSync(target, contents, "utf8");
  }
  return applied;
}

/** Copy Breadboard's own arena-side modules in beside the clone's. */
export function copyOverlayFiles(sourceRoot: string): void {
  const directory = overlayDirectory();
  for (const file of OVERLAY_FILES) {
    const from = path.join(directory, file);
    if (!fs.existsSync(from)) {
      throw new PatchError(`Breadboard's arena overlay file ${file} is missing.`);
    }
    fs.copyFileSync(from, path.join(sourceRoot, "services", file));
  }
}

/**
 * The register handed to the arena at boot, in the form deskSymbols.ts parses.
 */
export function deskSymbolsEnv(
  symbols: { symbol: string; kind: "CRYPTO" | "EQUITY"; name: string }[],
): string {
  return symbols
    .map((entry) => `${entry.symbol.toUpperCase()}|${entry.kind}|${entry.name.replace(/[,|]/g, " ")}`)
    .join(",");
}
