import type { CurrentLocationSnapshot } from "../current-location.ts";
import { mapReverse } from "../map/service.ts";

const MARKET_CONTEXT_TTL_MS = 30 * 60 * 1_000;

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

// These zones identify one shopping market without another network request.
// Everything else falls through to Breadboard's reverse-geocoder rather than
// guessing a country from a GMT offset or browser language.
const COUNTRY_BY_TIME_ZONE: Readonly<Record<string, string>> = {
  "America/Los_Angeles": "US",
  "America/Denver": "US",
  "America/Chicago": "US",
  "America/New_York": "US",
  "America/Toronto": "CA",
  "America/Vancouver": "CA",
  "America/Mexico_City": "MX",
  "America/Sao_Paulo": "BR",
  "Asia/Hong_Kong": "HK",
  "Asia/Istanbul": "TR",
  "Asia/Kolkata": "IN",
  "Asia/Seoul": "KR",
  "Asia/Shanghai": "CN",
  "Asia/Singapore": "SG",
  "Asia/Tokyo": "JP",
  "Australia/Brisbane": "AU",
  "Australia/Melbourne": "AU",
  "Australia/Perth": "AU",
  "Australia/Sydney": "AU",
  "Europe/Amsterdam": "NL",
  "Europe/Athens": "GR",
  "Europe/Berlin": "DE",
  "Europe/Brussels": "BE",
  "Europe/Copenhagen": "DK",
  "Europe/Dublin": "IE",
  "Europe/Helsinki": "FI",
  "Europe/Istanbul": "TR",
  "Europe/Lisbon": "PT",
  "Europe/London": "GB",
  "Europe/Luxembourg": "LU",
  "Europe/Madrid": "ES",
  "Europe/Oslo": "NO",
  "Europe/Paris": "FR",
  "Europe/Rome": "IT",
  "Europe/Stockholm": "SE",
  "Europe/Vienna": "AT",
  "Europe/Warsaw": "PL",
  "Europe/Zurich": "CH",
  "Pacific/Auckland": "NZ",
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

export function productSearchMarketFromTimeZone(
  timeZone: string,
): ProductSearchMarket | null {
  const countryCode = COUNTRY_BY_TIME_ZONE[timeZone];
  return countryCode ? marketForCountry(countryCode) : null;
}

/**
 * Resolve a fresh, validated device fix to a country-level shopping market.
 * Precise coordinates never enter the stored context; only the country does.
 */
export async function resolveProductSearchMarket(
  location: CurrentLocationSnapshot,
  options: {
    reverse?: (
      input: { lat: number; lon: number; signal?: AbortSignal },
    ) => Promise<{ address?: { countryCode?: string } } | null>;
  } = {},
): Promise<ProductSearchMarket | null> {
  const timeZoneMarket = productSearchMarketFromTimeZone(location.timeZone);
  if (timeZoneMarket) return timeZoneMarket;
  try {
    const place = await (options.reverse ?? mapReverse)({
      lat: location.latitude,
      lon: location.longitude,
      signal: AbortSignal.timeout(5_000),
    });
    return marketForCountry(place?.address?.countryCode ?? "");
  } catch {
    return null;
  }
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
