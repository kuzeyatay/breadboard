// Automatic company-share discovery for Paper Trader.
//
// The exchange symbol directory is the allowlist. It is public, keyless, and
// maintained throughout the trading day by Nasdaq for Nasdaq-listed and other
// US-exchange-listed securities. We cache it for a day because a five-minute
// paper-trading cycle must not download two directory files every time it asks
// what to analyse next.
//
// The arena never receives this whole list at boot. Doing so would make its
// startup prefetch thousands of quotes. Instead one company candidate is chosen
// for a cycle; the patched arena accepts any safe ticker and validates it by
// obtaining a live USD Yahoo quote before it can create a simulated order.

import fs from "node:fs";
import path from "node:path";
import { isStockTicker } from "./identity.ts";
import { stateHome } from "./runtime.ts";

export interface EquityListing {
  symbol: string;
  name: string;
}

const DIRECTORY_URLS = [
  "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt",
  "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt",
] as const;

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_DIRECTORY_BYTES = 2_000_000;

// A network outage must not turn an otherwise healthy desk into a crypto-only
// one. These are only the cold-cache fallback; the exchange directory replaces
// them as soon as it can be reached.
export const FALLBACK_EQUITY_UNIVERSE: EquityListing[] = [
  { symbol: "AAPL", name: "Apple" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "AMZN", name: "Amazon" },
  { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "META", name: "Meta Platforms" },
  { symbol: "TSLA", name: "Tesla" },
  { symbol: "AVGO", name: "Broadcom" },
  { symbol: "JPM", name: "JPMorgan Chase" },
  { symbol: "V", name: "Visa" },
  { symbol: "LLY", name: "Eli Lilly" },
  { symbol: "WMT", name: "Walmart" },
  { symbol: "MA", name: "Mastercard" },
  { symbol: "ORCL", name: "Oracle" },
  { symbol: "XOM", name: "Exxon Mobil" },
  { symbol: "COST", name: "Costco" },
  { symbol: "NFLX", name: "Netflix" },
  { symbol: "AMD", name: "AMD" },
  { symbol: "KO", name: "Coca-Cola" },
  { symbol: "DIS", name: "Walt Disney" },
];

interface UniverseCache {
  refreshedAt: number;
  listings: EquityListing[];
}

const universeGlobal = globalThis as typeof globalThis & {
  __breadboardPaperTraderEquityUniverse?: {
    expiresAt: number;
    promise: Promise<EquityListing[]>;
  } | null;
};

function cacheFile(): string {
  return path.join(stateHome(), "equity-universe.json");
}

function normalizeListing(symbolValue: string, nameValue: string): EquityListing | null {
  // Yahoo spells share classes with a dash (BRK-B), while the exchange files
  // commonly use a dot. Keep one spelling all the way into the arena.
  const symbol = symbolValue.trim().toUpperCase().replace(/\./g, "-");
  const name = nameValue.trim().replace(/\s+/g, " ");
  if (!isStockTicker(symbol) || !name) return null;
  return { symbol, name: name.slice(0, 180) };
}

// These are exchange-traded securities, but not company shares. The ETF and
// test-issue columns cover the common cases; the name filter removes warrants,
// rights, preferreds and debt without excluding ordinary/ADR company shares.
const NON_COMPANY_ISSUE =
  /\b(?:warrants?|rights?|units?|preferred|notes?|bonds?|debentures?|etns?|funds?)\b/i;

/** Parse either Nasdaq symbol-directory shape by reading its header names. */
export function parseEquityDirectory(contents: string): EquityListing[] {
  if (contents.length > MAX_DIRECTORY_BYTES) return [];
  const lines = contents.split(/\r?\n/).filter(Boolean);
  const headerLine = lines.shift();
  if (!headerLine) return [];
  const headers = headerLine.split("|").map((value) => value.trim().toLowerCase());
  const indexOf = (...names: string[]) => names.map((name) => headers.indexOf(name)).find((i) => i >= 0) ?? -1;
  const symbolAt = indexOf("symbol", "act symbol");
  const nameAt = indexOf("security name");
  const etfAt = indexOf("etf");
  const testAt = indexOf("test issue");
  if (symbolAt < 0 || nameAt < 0 || etfAt < 0 || testAt < 0) return [];

  const listings: EquityListing[] = [];
  for (const line of lines) {
    if (line.startsWith("File Creation Time")) continue;
    const fields = line.split("|");
    if ((fields[etfAt] ?? "").trim().toUpperCase() !== "N") continue;
    if ((fields[testAt] ?? "").trim().toUpperCase() !== "N") continue;
    const name = fields[nameAt] ?? "";
    if (NON_COMPANY_ISSUE.test(name)) continue;
    const listing = normalizeListing(fields[symbolAt] ?? "", name);
    if (listing) listings.push(listing);
  }
  return listings;
}

function validListings(value: unknown): EquityListing[] {
  if (!Array.isArray(value)) return [];
  const deduped = new Map<string, EquityListing>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.symbol !== "string" || typeof record.name !== "string") continue;
    const listing = normalizeListing(record.symbol, record.name);
    if (listing) deduped.set(listing.symbol, listing);
  }
  return [...deduped.values()];
}

function readCache(): UniverseCache | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile(), "utf8")) as Record<string, unknown>;
    const refreshedAt = Number(parsed.refreshedAt);
    const listings = validListings(parsed.listings);
    return Number.isFinite(refreshedAt) && listings.length ? { refreshedAt, listings } : null;
  } catch {
    return null;
  }
}

function writeCache(cache: UniverseCache): void {
  try {
    const file = cacheFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(cache)}\n`, "utf8");
  } catch {
    // The in-memory result still serves this process. A read-only runtime only
    // loses the cross-restart speed-up, never the stock universe itself.
  }
}

async function fetchDirectory(url: string): Promise<EquityListing[]> {
  const response = await fetch(url, {
    headers: { accept: "text/plain" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`symbol directory returned ${response.status}`);
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_DIRECTORY_BYTES) {
    throw new Error("symbol directory was unexpectedly large");
  }
  return parseEquityDirectory(await response.text());
}

async function loadUniverse(now: number): Promise<EquityListing[]> {
  const cached = readCache();
  if (cached && now - cached.refreshedAt < CACHE_MAX_AGE_MS) return cached.listings;

  const fetched = await Promise.allSettled(DIRECTORY_URLS.map((url) => fetchDirectory(url)));
  // These two files are complementary, not mirrors. Never replace a complete
  // cache with whichever exchange happened to answer during a partial outage.
  const complete = fetched.every(
    (result) => result.status === "fulfilled" && result.value.length > 0,
  );
  const listings = complete
    ? validListings(
        fetched.flatMap((result) => (result.status === "fulfilled" ? result.value : [])),
      )
    : [];
  if (complete && listings.length) {
    const next = { refreshedAt: now, listings };
    writeCache(next);
    return listings;
  }
  return cached?.listings.length ? cached.listings : [...FALLBACK_EQUITY_UNIVERSE];
}

/** Current US company-share universe, cached in memory and on disk. */
export function equityUniverse(now = Date.now()): Promise<EquityListing[]> {
  const current = universeGlobal.__breadboardPaperTraderEquityUniverse;
  if (current && now < current.expiresAt) return current.promise;

  const next = {
    expiresAt: now + CACHE_MAX_AGE_MS,
    promise: loadUniverse(now),
  };
  universeGlobal.__breadboardPaperTraderEquityUniverse = next;
  return next.promise;
}

function mix(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

/**
 * Pick one company for this cycle without making the first alphabetic listings
 * permanent favourites. Over time every directory entry is eligible; recent
 * analyses are probed past so restarts do not immediately repeat themselves.
 */
export function chooseAutomaticEquity(
  listings: readonly EquityListing[],
  recentlyAnalysed: readonly string[],
  slot: number,
): EquityListing | null {
  if (!listings.length) return null;
  const recent = new Set(recentlyAnalysed.map((symbol) => symbol.toUpperCase()));
  const start = mix(Math.trunc(slot)) % listings.length;
  for (let offset = 0; offset < listings.length; offset += 1) {
    const candidate = listings[(start + offset) % listings.length];
    if (candidate && !recent.has(candidate.symbol)) return candidate;
  }
  return listings[start] ?? null;
}

export async function automaticEquityForCycle(
  recentlyAnalysed: readonly string[],
  cycleMinutes: number,
  now = Date.now(),
): Promise<EquityListing | null> {
  const slot = Math.floor(now / (Math.max(1, cycleMinutes) * 60_000));
  return chooseAutomaticEquity(await equityUniverse(), recentlyAnalysed, slot);
}
