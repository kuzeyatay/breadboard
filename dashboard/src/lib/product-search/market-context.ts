import type { CurrentLocationSnapshot } from "../current-location.ts";
import { mapReverse } from "../map/service.ts";

const MARKET_CONTEXT_TTL_MS = 30 * 60 * 1_000;
const MARKET_LOOKUP_TTL_MS = 15 * 60 * 1_000;

export interface ProductSearchMarket {
  /** DuckDuckGo's country-language market shape, for example nl-nl. */
  locale: string;
  /** ISO 3166-1 alpha-2 country code. */
  countryCode: string;
  /** Human-readable country name used to constrain discovery queries. */
  countryName: string;
}

interface StoredProductSearchMarket extends ProductSearchMarket {
  expiresAt: number;
}

type MarketReverse = (
  input: { lat: number; lon: number; signal?: AbortSignal },
) => Promise<{ address?: { countryCode?: string } } | null>;

// Keep only the latest coarse lookup, not a location history. Sharing it avoids
// a geocoding round trip on every turn while the device stays in the same area.
let latestLookup: {
  latitude: number;
  longitude: number;
  reverse: MarketReverse;
  expiresAt: number;
  promise: Promise<ProductSearchMarket | null>;
} | null = null;

declare global {
  // Kept on globalThis so Next.js development reloads do not detach a live
  // Hermes tool call from the turn that established its market.
  var __breadboardProductSearchMarkets:
    | Map<number, StoredProductSearchMarket>
    | undefined;
}

const markets =
  globalThis.__breadboardProductSearchMarkets ??=
    new Map<number, StoredProductSearchMarket>();

const LANGUAGE_BY_COUNTRY: Readonly<Record<string, string>> = {
  AT: "de",
  AU: "en",
  BE: "nl",
  BR: "pt",
  CA: "en",
  CH: "de",
  CN: "zh",
  DE: "de",
  DK: "da",
  ES: "es",
  FI: "fi",
  FR: "fr",
  GB: "en",
  GR: "el",
  HK: "zh",
  IE: "en",
  IN: "en",
  IT: "it",
  JP: "ja",
  KR: "ko",
  LU: "fr",
  MX: "es",
  NL: "nl",
  NO: "no",
  NZ: "en",
  PL: "pl",
  PT: "pt",
  SE: "sv",
  SG: "en",
  TR: "tr",
  US: "en",
};

function normalizedCountryCode(value: unknown): string {
  return typeof value === "string" && /^[a-z]{2}$/i.test(value.trim())
    ? value.trim().toUpperCase()
    : "";
}

function marketForCountry(countryCode: string): ProductSearchMarket | null {
  const normalized = normalizedCountryCode(countryCode);
  if (!normalized) return null;
  const language = LANGUAGE_BY_COUNTRY[normalized] ?? "en";
  let countryName = normalized;
  try {
    countryName =
      new Intl.DisplayNames(["en"], { type: "region" }).of(normalized) ??
      normalized;
  } catch {
    // The ISO code remains a safe, unambiguous search constraint.
  }
  return {
    locale: `${normalized.toLowerCase()}-${language}`,
    countryCode: normalized,
    countryName,
  };
}

/**
 * Resolve a fresh, validated device fix to a country-level shopping market.
 * Precise coordinates never enter the stored context; only the country does.
 */
export async function resolveProductSearchMarket(
  location: CurrentLocationSnapshot,
  options: {
    reverse?: MarketReverse;
  } = {},
): Promise<ProductSearchMarket | null> {
  // A device can keep any time zone while travelling. Only the measured
  // coordinates determine its market; failed geocoding leaves it unknown.
  const reverse = options.reverse ?? mapReverse;
  if (
    latestLookup?.latitude === location.latitude &&
    latestLookup.longitude === location.longitude &&
    latestLookup.reverse === reverse &&
    latestLookup.expiresAt > Date.now()
  ) {
    return latestLookup.promise;
  }
  const promise = (async () => {
    try {
      const place = await reverse({
        lat: location.latitude,
        lon: location.longitude,
        signal: AbortSignal.timeout(5_000),
      });
      return marketForCountry(place?.address?.countryCode ?? "");
    } catch {
      return null;
    }
  })();
  latestLookup = {
    latitude: location.latitude,
    longitude: location.longitude,
    reverse,
    expiresAt: Date.now() + MARKET_LOOKUP_TTL_MS,
    promise,
  };
  const market = await promise;
  if (!market && latestLookup?.promise === promise) latestLookup = null;
  return market;
}

/** Replace, rather than accumulate, the market attached to a runtime session. */
export function setProductSearchMarketContext(
  runtimeSessionId: number,
  market: ProductSearchMarket | null,
  now = Date.now(),
): void {
  markets.delete(runtimeSessionId);
  if (!market) return;
  markets.set(runtimeSessionId, {
    ...market,
    expiresAt: now + MARKET_CONTEXT_TTL_MS,
  });
}

export function productSearchMarketContext(
  runtimeSessionId: number,
  now = Date.now(),
): ProductSearchMarket | null {
  const stored = markets.get(runtimeSessionId);
  if (!stored) return null;
  if (stored.expiresAt <= now) {
    markets.delete(runtimeSessionId);
    return null;
  }
  return {
    locale: stored.locale,
    countryCode: stored.countryCode,
    countryName: stored.countryName,
  };
}
