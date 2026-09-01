import crypto from "node:crypto";

import { assertPublicHost } from "../get-doc/download.ts";
import {
  PRODUCT_CAROUSEL_RENDERER,
  PRODUCT_RESOURCE_ACTIONS,
  PRODUCT_SEARCH_RESOURCE_KIND,
  PRODUCT_SEARCH_SCHEMA_VERSION,
  normalizeGenerativeUiResource,
  safeProductUrl,
  type ProductAttribute,
  type ProductPrice,
  type ProductSearchItem,
  type ProductSearchResource,
  type ProductSearchSource,
} from "../generative-ui/contracts.ts";

const SEARCH_TIMEOUT_MS = 15_000;
const PAGE_TIMEOUT_MS = 10_000;
const MAX_PAGE_BYTES = 1_500_000;
const MAX_REDIRECTS = 4;
const MAX_RESULTS = 10;
const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  referer: "https://duckduckgo.com/",
} as const;

export class ProductSearchError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProductSearchError";
    this.code = code;
  }
}

export interface ProductSearchInput {
  query: string;
  count?: number;
  country?: string;
}

interface NormalizedProductSearchInput {
  query: string;
  count: number;
  country: string;
}

export interface SearchCandidate {
  title: string;
  pageUrl: string;
  imageUrl?: string;
  /** Price quoted by the product-specific discovery result for this exact URL. */
  priceHint?: ProductPrice;
  /** Discovery explicitly tied this direct product page to the requested market. */
  marketEvidence?: boolean;
}

interface JsonRecord {
  [key: string]: unknown;
}

export interface ProductSearchResult {
  query: string;
  productsReturned: number;
  sources: ProductSearchSource[];
  uiResources: ProductSearchResource[];
  summary: string;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function stringValue(value: unknown, maximum = 1_000): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maximum)
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : "";
}

function normalizeInput(input: ProductSearchInput): NormalizedProductSearchInput {
  const query = stringValue(input.query, 300);
  if (!query) {
    throw new ProductSearchError(
      "product_search_invalid_arguments",
      "Product search needs a non-empty query of at most 300 characters.",
    );
  }
  const count = input.count === undefined ? 8 : Number(input.count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_RESULTS) {
    throw new ProductSearchError(
      "product_search_invalid_arguments",
      `Product search count must be an integer between 1 and ${MAX_RESULTS}.`,
    );
  }
  const country = input.country === undefined
    ? "us-en"
    : stringValue(input.country, 12).toLowerCase();
  if (!/^[a-z]{2}-[a-z]{2}$/.test(country)) {
    throw new ProductSearchError(
      "product_search_invalid_arguments",
      "Product search country must use a locale such as us-en or nl-nl.",
    );
  }
  return { query, count, country };
}

function marketCountryCode(locale: string): string {
  return locale.split("-")[0]?.toUpperCase() ?? "US";
}

function marketCountryName(locale: string): string {
  const countryCode = marketCountryCode(locale);
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode) ?? countryCode;
  } catch {
    return countryCode;
  }
}

function marketAliases(locale: string): string[] {
  const countryCode = marketCountryCode(locale);
  const localized = ({
    BE: ["Belgium", "Belgie", "Belgique"],
    DE: ["Germany", "Deutschland"],
    ES: ["Spain", "Espana"],
    FR: ["France"],
    GB: ["United Kingdom", "UK", "Britain"],
    NL: ["Netherlands", "Nederland"],
    TR: ["Turkey", "Turkiye"],
    US: ["United States", "USA", "US"],
  } as Readonly<Record<string, string[]>>)[countryCode] ?? [];
  return [...new Set([marketCountryName(locale), countryCode, ...localized])];
}

function marketSearchSuffix(locale: string): string {
  const countryCode = marketCountryCode(locale);
  const localized = ({
    DE: "Deutschland kaufen Preis auf Lager",
    ES: "Espana comprar precio disponible",
    FR: "France acheter prix en stock",
    NL: "Nederland kopen prijs op voorraad",
    TR: "Turkiye satin al fiyat stokta",
  } as Readonly<Record<string, string>>)[countryCode];
  const words = localized ?? `${marketCountryName(locale)} buy price in stock`;
  const country = marketCountryCode(locale).toLowerCase();
  const domain = country === "us" ? "" : country === "gb" ? "uk" : country;
  return domain ? `${words} site:.${domain}` : words;
}

/**
 * Direct merchant detail pages only. Search/category/editorial URLs can quote a
 * price but are not safe Visit destinations for a product card.
 */
export function isBuyableProductUrl(value: unknown): boolean {
  const safe = safeProductUrl(value);
  if (!safe) return false;
  const url = new URL(safe);
  const path = decodeURIComponent(url.pathname);
  if (
    /\/(?:search|s|browse|b|category|categories|collections?|catalog|shop-all)(?:\/|$)/i.test(path) ||
    /[?&](?:q|query|search|keyword)=/i.test(`${url.search}`) ||
    /\/(?:open-product|redirect|out|go|click|affiliate|track)(?:\.php)?(?:\/|$)/i.test(path)
  ) {
    return false;
  }
  return (
    /\/(?:dp|gp\/product)\/[A-Z0-9]{8,}(?:[/?]|$)/i.test(path) ||
    /\/(?:products?|product-detail|p|items?|itm|ip|listing)\/[^/?#]{2,}/i.test(path) ||
    /\/site\/[^/]+\/\d+\.p(?:[/?]|$)/i.test(path) ||
    /\/shop\/buy-[^/?#]+/i.test(path) ||
    /-[pi]\d+(?:\.html)?(?:[/?]|$)/i.test(path)
  );
}

function isIntermediaryProductUrl(value: string): boolean {
  try {
    return /\/(?:open-product|redirect|out|go|click|affiliate|track)(?:\.php)?(?:\/|$)/i.test(
      new URL(value).pathname,
    );
  } catch {
    return true;
  }
}

function urlMatchesMarket(rawUrl: string, locale: string): boolean {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const country = marketCountryCode(locale).toLowerCase();
  const labels = host.split(".");
  if (labels.at(-1) === country) return true;
  if (
    country === "us" &&
    /^(?:amazon|walmart|target|bestbuy|newegg)\.com$/.test(host)
  ) {
    return true;
  }
  if (
    /(?:^|[/?&=_-])(nl|netherlands|nederland)(?:$|[/?&=_-])/i.test(
      `${url.pathname}${url.search}`,
    ) &&
    country === "nl"
  ) {
    return true;
  }
  return false;
}

function textMatchesMarket(value: string, locale: string): boolean {
  const folded = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return marketAliases(locale).some((alias) => {
    const candidate = alias.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    return new RegExp(`\\b${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(folded);
  });
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function duckDuckGoToken(query: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
    {
      headers: BROWSER_HEADERS,
      cache: "no-store",
      signal: combinedSignal(signal, SEARCH_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new ProductSearchError(
      "product_search_upstream_error",
      `The product discovery provider answered ${response.status}.`,
    );
  }
  const html = await response.text();
  const token = html.match(/vqd=["']([^"']+)["']/)?.[1] ??
    html.match(/vqd=([\d-]+)/)?.[1];
  if (!token) {
    throw new ProductSearchError(
      "product_search_upstream_error",
      "The product discovery provider changed its response format.",
    );
  }
  return token;
}

async function discoverCandidates(
  input: NormalizedProductSearchInput,
  signal?: AbortSignal,
): Promise<SearchCandidate[]> {
  const discoveryQuery = `${input.query} product ${marketSearchSuffix(input.country)}`;
  const [token, pricedCandidates] = await Promise.all([
    duckDuckGoToken(discoveryQuery, signal),
    discoverPricedCandidates(input, signal).catch(() => []),
  ]);
  const params = new URLSearchParams({
    l: input.country,
    o: "json",
    q: discoveryQuery,
    vqd: token,
    f: ",,,",
    p: "1",
  });
  const response = await fetch(`https://duckduckgo.com/i.js?${params.toString()}`, {
    headers: BROWSER_HEADERS,
    cache: "no-store",
    signal: combinedSignal(signal, SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new ProductSearchError(
      "product_search_upstream_error",
      `The product discovery provider answered ${response.status}.`,
    );
  }
  const payload = (await response.json()) as { results?: unknown };
  const results = Array.isArray(payload.results) ? payload.results : [];
  const candidates = results.flatMap((entry): SearchCandidate[] => {
    const candidate = record(entry);
    if (!candidate) return [];
    const pageUrl = safeProductUrl(candidate.url);
    const title = stringValue(candidate.title, 300);
    if (!pageUrl || !title || !isMerchantProductCandidate({ title, pageUrl })) return [];
    const imageUrl = safeProductUrl(candidate.image);
    return [{ title, pageUrl, ...(imageUrl ? { imageUrl } : {}) }];
  });
  const merged = new Map<string, SearchCandidate>();
  for (const candidate of [...pricedCandidates, ...candidates]) {
    const current = merged.get(candidate.pageUrl);
    merged.set(candidate.pageUrl, current
      ? {
          ...current,
          ...candidate,
          imageUrl: candidate.imageUrl ?? current.imageUrl,
          priceHint: current.priceHint ?? candidate.priceHint,
          ...(current.marketEvidence || candidate.marketEvidence
            ? { marketEvidence: true }
            : {}),
        }
      : candidate);
  }
  return [...merged.values()]
    .slice(0, Math.min(18, Math.max(input.count * 2, 10)));
}

function decodedSearchText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchResultUrl(rawHref: string): string {
  try {
    const parsed = new URL(rawHref, "https://duckduckgo.com");
    const destination = /(?:^|\.)duckduckgo\.com$/i.test(parsed.hostname)
      ? parsed.searchParams.get("uddg") ?? ""
      : parsed.toString();
    return safeProductUrl(destination);
  } catch {
    return "";
  }
}

/** Exported so the price-search projection is deterministic in tests. */
export function pricedCandidatesFromSearchHtml(
  html: string,
  country = "us-en",
): SearchCandidate[] {
  const links = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi)]
    .filter((match) => /(?:^|\s)result__a(?:\s|$)/i.test(htmlAttribute(match[0], "class")));
  return links.flatMap((match, index): SearchCandidate[] => {
    const pageUrl = searchResultUrl(htmlAttribute(match[0], "href"));
    const title = stringValue(decodedSearchText(match[1] ?? ""), 300);
    if (!pageUrl || !title) return [];
    const start = (match.index ?? 0) + match[0].length;
    const end = links[index + 1]?.index ?? Math.min(html.length, start + 4_000);
    const resultText = decodedSearchText(html.slice(start, end));
    const priceHint = productPriceFromText(`${title} ${resultText}`, country);
    const marketEvidence = pageUrl
      ? urlMatchesMarket(pageUrl, country) || textMatchesMarket(resultText, country)
      : false;
    return priceHint && isMerchantProductCandidate({ title, pageUrl })
      ? [{ title, pageUrl, priceHint, ...(marketEvidence ? { marketEvidence: true } : {}) }]
      : [];
  });
}

/**
 * A separate text search is intentional: image discovery supplies good product
 * photography but commonly omits the merchant's quoted price. Text snippets
 * frequently carry that price even when the merchant blocks page inspection.
 */
async function discoverPricedCandidates(
  input: NormalizedProductSearchInput,
  signal?: AbortSignal,
): Promise<SearchCandidate[]> {
  const query = `${input.query} ${marketSearchSuffix(input.country)}`;
  const response = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=${encodeURIComponent(input.country)}`,
    {
      headers: { ...BROWSER_HEADERS, accept: "text/html,application/xhtml+xml;q=0.9" },
      cache: "no-store",
      signal: combinedSignal(signal, SEARCH_TIMEOUT_MS),
    },
  );
  if (!response.ok) return [];
  const html = await readBoundedText(response);
  return pricedCandidatesFromSearchHtml(html, input.country);
}

async function readBoundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_PAGE_BYTES) {
    throw new ProductSearchError("product_page_too_large", "The product page is too large to inspect.");
  }
  if (!response.body) return (await response.text()).slice(0, MAX_PAGE_BYTES);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PAGE_BYTES) {
        throw new ProductSearchError("product_page_too_large", "The product page is too large to inspect.");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function fetchPublicProductPage(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<{ html: string; finalUrl: string }> {
  let current = new URL(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (current.protocol !== "https:" || current.username || current.password) {
      throw new ProductSearchError("product_page_insecure", "Only public HTTPS product pages are supported.");
    }
    await assertPublicHost(current.hostname);
    const response = await fetch(current, {
      redirect: "manual",
      cache: "no-store",
      signal: combinedSignal(signal, PAGE_TIMEOUT_MS),
      headers: {
        ...BROWSER_HEADERS,
        accept: "text/html,application/xhtml+xml;q=0.9",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new ProductSearchError("product_page_redirect", "A product page redirected nowhere.");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) {
      throw new ProductSearchError("product_page_unavailable", `A product page answered ${response.status}.`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!/html|xhtml/i.test(contentType)) {
      throw new ProductSearchError("product_page_not_html", "A product result did not return an HTML page.");
    }
    return { html: await readBoundedText(response), finalUrl: current.toString() };
  }
  throw new ProductSearchError("product_page_redirect", "A product page redirected too many times.");
}

function decodeJsonScript(value: string): string {
  return value
    .replace(/^\s*<!--|-->\s*$/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&");
}

/** Exported for deterministic contract tests against real-world JSON-LD shapes. */
export function jsonLdProductsFromHtml(html: string): JsonRecord[] {
  const products: JsonRecord[] = [];
  const scripts = html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  );
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const candidate = record(value);
    if (!candidate) return;
    const types = Array.isArray(candidate["@type"])
      ? candidate["@type"]
      : [candidate["@type"]];
    if (types.some((type) => stringValue(type, 80).toLowerCase() === "product")) {
      products.push(candidate);
    }
    if (Array.isArray(candidate["@graph"])) visit(candidate["@graph"]);
    if (Array.isArray(candidate.itemListElement)) visit(candidate.itemListElement);
    const item = record(candidate.item);
    if (item) visit(item);
  };
  for (const match of scripts) {
    try {
      visit(JSON.parse(decodeJsonScript(match[1] ?? "")));
    } catch {
      // Malformed third-party structured data is ignored, never repaired by
      // guessing. Another candidate page may still provide a valid product.
    }
  }
  return products.slice(0, 20);
}

function typeIncludes(value: unknown, expected: string): boolean {
  const values = Array.isArray(value) ? value : [value];
  return values.some((entry) => stringValue(entry, 80).toLowerCase() === expected);
}

function firstOffer(product: JsonRecord): JsonRecord | null {
  const raw = product.offers;
  const offers = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const records = offers.map(record).filter((offer): offer is JsonRecord => Boolean(offer));
  return records.find((offer) => typeIncludes(offer["@type"], "offer")) ?? records[0] ?? null;
}

function formattedProductPrice(
  rawAmount: unknown,
  rawCurrency: unknown,
): ProductPrice | undefined {
  const raw = stringValue(rawAmount, 48);
  const currency = stringValue(rawCurrency, 3).toUpperCase();
  if (!raw || !/^[A-Z]{3}$/.test(currency)) return undefined;
  let numericText = raw.replace(/\s+/g, "").replace(/[^0-9.,]/g, "");
  if (numericText.includes(",") && numericText.includes(".")) {
    const decimal = Math.max(numericText.lastIndexOf(","), numericText.lastIndexOf("."));
    numericText = `${numericText.slice(0, decimal).replace(/[.,]/g, "")}.${numericText.slice(decimal + 1)}`;
  } else if (/,[0-9]{1,2}$/.test(numericText)) {
    numericText = numericText.replace(/,/g, ".");
  } else {
    numericText = numericText.replace(/,/g, "");
  }
  const numeric = Number(numericText);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100_000_000) return undefined;
  const amount = numericText;
  let display: string;
  try {
    display = new Intl.NumberFormat("en", { style: "currency", currency }).format(numeric);
  } catch {
    display = `${currency} ${amount}`;
  }
  return { amount, currency, display };
}

function dollarCurrency(country: string): string {
  const region = country.split("-")[0]?.toLowerCase();
  return ({ ca: "CAD", au: "AUD", nz: "NZD", sg: "SGD", hk: "HKD" } as const)[
    region as "ca" | "au" | "nz" | "sg" | "hk"
  ] ?? "USD";
}

/** Price quoted in a product-specific search result title or snippet. */
export function productPriceFromText(
  value: string,
  country = "us-en",
): ProductPrice | undefined {
  const text = decodedSearchText(value).slice(0, 8_000);
  const codeBefore = /\b(USD|EUR|GBP|CAD|AUD|NZD|SGD|HKD|JPY|CNY|INR)\s*(?:[$€£¥₹])?\s*([0-9][0-9.,]{0,15})\b/i.exec(text);
  if (codeBefore) return formattedProductPrice(codeBefore[2], codeBefore[1]);
  const codeAfter = /(?:^|\s)([0-9][0-9.,]{0,15})\s*(USD|EUR|GBP|CAD|AUD|NZD|SGD|HKD|JPY|CNY|INR)\b/i.exec(text);
  if (codeAfter) return formattedProductPrice(codeAfter[1], codeAfter[2]);
  const symbol = /(US\$|CA\$|A\$|NZ\$|S\$|HK\$|[$€£¥₹])\s*([0-9][0-9.,]{0,15})\b/i.exec(text);
  if (!symbol) return undefined;
  const currency = ({
    "US$": "USD",
    "CA$": "CAD",
    "A$": "AUD",
    "NZ$": "NZD",
    "S$": "SGD",
    "HK$": "HKD",
    "€": "EUR",
    "£": "GBP",
    "¥": country.startsWith("cn-") ? "CNY" : "JPY",
    "₹": "INR",
    "$": dollarCurrency(country),
  } as Record<string, string>)[symbol[1].toUpperCase()] ?? dollarCurrency(country);
  return formattedProductPrice(symbol[2], currency);
}

function productPrice(product: JsonRecord): ProductPrice | undefined {
  const offer = firstOffer(product);
  if (!offer) return undefined;
  const specification = record(offer.priceSpecification);
  return formattedProductPrice(
    offer.price ?? offer.lowPrice ?? specification?.price ?? specification?.minPrice,
    offer.priceCurrency ?? specification?.priceCurrency,
  );
}

function htmlAttribute(tag: string, name: string): string {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`,
    "i",
  ).exec(tag);
  return stringValue(match?.[1] ?? match?.[2] ?? match?.[3], 240)
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&amp;/gi, "&");
}

function productMetaContent(html: string, keys: ReadonlySet<string>): string {
  for (const match of html.matchAll(/<(?:meta|data|span|div)\b[^>]*>/gi)) {
    const tag = match[0];
    const key = (
      htmlAttribute(tag, "property") ||
      htmlAttribute(tag, "name") ||
      htmlAttribute(tag, "itemprop")
    ).toLowerCase();
    if (!keys.has(key)) continue;
    const content = htmlAttribute(tag, "content") || htmlAttribute(tag, "value");
    if (content) return content;
  }
  return "";
}

/** Standard merchant metadata fallback when Product JSON-LD omits an offer. */
export function productPriceFromHtml(html: string): ProductPrice | undefined {
  const amount = productMetaContent(html, new Set([
    "product:price:amount",
    "og:price:amount",
    "product.price.amount",
    "price",
  ]));
  const currency = productMetaContent(html, new Set([
    "product:price:currency",
    "og:price:currency",
    "product.price.currency",
    "pricecurrency",
  ]));
  const metadataPrice = formattedProductPrice(amount, currency);
  if (metadataPrice) return metadataPrice;
  const pairs = [
    /["'](?:price|salePrice|currentPrice)["']\s*:\s*["']?([0-9][0-9.,]{0,15})["']?[\s\S]{0,320}?["'](?:priceCurrency|currencyCode|currency)["']\s*:\s*["']([A-Za-z]{3})["']/gi,
    /["'](?:priceCurrency|currencyCode|currency)["']\s*:\s*["']([A-Za-z]{3})["'][\s\S]{0,320}?["'](?:price|salePrice|currentPrice)["']\s*:\s*["']?([0-9][0-9.,]{0,15})["']?/gi,
  ];
  const amountFirst = pairs[0].exec(html);
  if (amountFirst) return formattedProductPrice(amountFirst[1], amountFirst[2]);
  const currencyFirst = pairs[1].exec(html);
  return currencyFirst
    ? formattedProductPrice(currencyFirst[2], currencyFirst[1])
    : undefined;
}

function productMerchant(product: JsonRecord, pageUrl: string): string {
  const brand = record(product.brand);
  const manufacturer = record(product.manufacturer);
  const offer = firstOffer(product);
  const seller = record(offer?.seller);
  return (
    stringValue(brand?.name ?? product.brand, 160) ||
    stringValue(manufacturer?.name ?? product.manufacturer, 160) ||
    stringValue(seller?.name ?? offer?.seller, 160) ||
    new URL(pageUrl).hostname.replace(/^www\./i, "")
  );
}

function availabilityLabel(value: unknown): string {
  const raw = stringValue(value, 200);
  if (!raw) return "";
  const tail = raw.split(/[\/#]/).filter(Boolean).at(-1) ?? raw;
  return tail.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
}

function unavailableOffer(value: unknown): boolean {
  return /\b(out of stock|sold out|discontinued|pre ?order|pre ?sale|back ?order)\b/i.test(
    availabilityLabel(value),
  );
}

function regionStrings(value: unknown, depth = 0): string[] {
  if (depth > 5 || value === null || value === undefined) return [];
  if (typeof value === "string") return [stringValue(value, 200)];
  if (Array.isArray(value)) return value.flatMap((entry) => regionStrings(entry, depth + 1));
  const candidate = record(value);
  if (!candidate) return [];
  return [
    ...regionStrings(candidate.addressCountry, depth + 1),
    ...regionStrings(candidate.countryCode, depth + 1),
    ...regionStrings(candidate.name, depth + 1),
    ...regionStrings(candidate.address, depth + 1),
    ...regionStrings(candidate.shippingDestination, depth + 1),
  ];
}

const EUROPEAN_MARKETS = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
  "FR", "GR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MT",
  "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK", "CH", "GB",
]);

function regionMatchesCountry(value: string, countryCode: string): boolean {
  const folded = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const aliases = marketAliases(`${countryCode.toLowerCase()}-en`);
  if (aliases.some((alias) => new RegExp(
    `\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    "i",
  ).test(folded))) {
    return true;
  }
  return EUROPEAN_MARKETS.has(countryCode) && /\b(?:EU|Europe|European Union)\b/i.test(folded);
}

function declaredOfferRegions(offer: JsonRecord): string[] {
  return [
    ...regionStrings(offer.eligibleRegion),
    ...regionStrings(offer.areaServed),
    ...regionStrings(offer.shippingDestination),
    ...regionStrings(offer.shippingDetails),
  ].filter(Boolean);
}

/** Reject explicit merchant evidence that the item is unavailable or out of market. */
export function structuredProductAvailableInCountry(
  value: unknown,
  rawCountryCode: string,
): boolean {
  const product = record(value);
  if (!product) return false;
  const offer = firstOffer(product);
  if (!offer) return true;
  if (unavailableOffer(offer.availability)) return false;
  const declaredRegions = declaredOfferRegions(offer);
  if (declaredRegions.length === 0) return true;
  const countryCode = rawCountryCode.trim().toUpperCase();
  return declaredRegions.some((region) => regionMatchesCountry(region, countryCode));
}

function structuredProductHasMarketEvidence(
  product: JsonRecord,
  countryCode: string,
): boolean {
  const offer = firstOffer(product);
  if (!offer) return false;
  const declaredRegions = declaredOfferRegions(offer);
  return declaredRegions.length > 0 &&
    declaredRegions.some((region) => regionMatchesCountry(region, countryCode));
}

function productAvailabilityFromHtml(html: string): string {
  return productMetaContent(html, new Set([
    "product:availability",
    "og:availability",
    "availability",
  ]));
}

function htmlDeclaresPurchasableProduct(html: string): boolean {
  const productType = productMetaContent(html, new Set(["og:type"]));
  const hasProductMetadata = /^product$/i.test(productType) ||
    /itemtype\s*=\s*["'][^"']*schema\.org\/Product/i.test(html) ||
    /property\s*=\s*["']product:price:amount["']/i.test(html) ||
    /name\s*=\s*["']product["'][^>]*value\s*=\s*["'][^"']{2,}/i.test(html);
  const hasPurchaseAction = /\b(add to (?:cart|basket)|buy now|in winkelwagen|bestellen|direct bestellen|voeg toe|afrekenen|kopen)\b/i.test(
    decodedSearchText(html),
  );
  return hasProductMetadata && hasPurchaseAction;
}

function resolvedDirectProductUrl(
  product: JsonRecord,
  finalUrl: string,
  allowFinalOfferEvidence: boolean,
): string {
  const final = new URL(finalUrl);
  const offer = firstOffer(product);
  for (const raw of [product.url, offer?.url, product["@id"], finalUrl]) {
    const text = stringValue(raw, 2_000);
    if (!text) continue;
    let resolved = "";
    try {
      resolved = safeProductUrl(new URL(text, final).toString());
    } catch {
      continue;
    }
    if (!resolved || isIntermediaryProductUrl(resolved)) continue;
    const hostname = new URL(resolved).hostname;
    if (hostname !== final.hostname) continue;
    if (isBuyableProductUrl(resolved)) return resolved;
    if (
      raw !== finalUrl &&
      offer &&
      productPrice(product)
    ) {
      return resolved;
    }
    if (
      raw === finalUrl &&
      allowFinalOfferEvidence &&
      offer &&
      productPrice(product)
    ) {
      return resolved;
    }
  }
  return "";
}

function productAttributes(product: JsonRecord): ProductAttribute[] | undefined {
  const properties = Array.isArray(product.additionalProperty)
    ? product.additionalProperty
    : [];
  const attributes = properties.flatMap((entry): ProductAttribute[] => {
    const property = record(entry);
    if (!property) return [];
    const label = stringValue(property.name, 80);
    const value = stringValue(property.value, 240);
    return label && value ? [{ label, value }] : [];
  }).slice(0, 16);
  const sku = stringValue(product.sku ?? product.mpn, 120);
  if (sku && !attributes.some((attribute) => /^(sku|mpn)$/i.test(attribute.label))) {
    attributes.unshift({ label: "SKU", value: sku });
  }
  return attributes.length ? attributes.slice(0, 16) : undefined;
}

function shortHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function isMerchantProductCandidate(candidate: SearchCandidate): boolean {
  const pageUrl = safeProductUrl(candidate.pageUrl);
  if (!pageUrl) return false;
  const parsedPage = new URL(pageUrl);
  const editorialTitle = /^(?:best|top)\s|\b(?:buying guide|top picks?|hands-on review|product review)\b/i;
  const editorialPath = /\/(?:blogs?|news|articles?|guides?|reviews?)(?:\/|$)|\/(?:best|top)-/i;
  const categoryPath = /^\/(?:b|browse|search|category|categories|collections?)(?:\/|$)/i;
  const categoryTitle = /\b(?:products?|touchpads?|trackpads?)\s+for sale\s*\|\s*ebay$/i;
  const nonMerchantSite = /(?:^|\.)(?:pinterest|youtube|youtu\.be|reddit|facebook|instagram|tiktok)\./i;
  return !(
    editorialTitle.test(candidate.title) ||
    categoryTitle.test(candidate.title) ||
    editorialPath.test(parsedPage.pathname) ||
    (categoryPath.test(parsedPage.pathname) && !/\/products?\//i.test(parsedPage.pathname)) ||
    nonMerchantSite.test(parsedPage.hostname)
  );
}

async function inspectCandidate(
  candidate: SearchCandidate,
  accessedAt: string,
  country: string,
  signal?: AbortSignal,
): Promise<Array<{ product: ProductSearchItem; source: ProductSearchSource }>> {
  if (!isMerchantProductCandidate(candidate)) return [];
  const page = await fetchPublicProductPage(candidate.pageUrl, signal);
  const finalUrl = safeProductUrl(page.finalUrl);
  if (!finalUrl) return [];
  let imageUrl = safeProductUrl(candidate.imageUrl);
  if (imageUrl) {
    try {
      await assertPublicHost(new URL(imageUrl).hostname);
    } catch {
      imageUrl = "";
    }
  }
  const pagePrice = productPriceFromHtml(page.html) ?? candidate.priceHint;
  const pageAvailability = productAvailabilityFromHtml(page.html);
  const structuredProducts = jsonLdProductsFromHtml(page.html);
  if (
    structuredProducts.length === 0 &&
    pagePrice &&
    (isBuyableProductUrl(finalUrl) || htmlDeclaresPurchasableProduct(page.html)) &&
    urlMatchesMarket(finalUrl, country) &&
    !unavailableOffer(pageAvailability)
  ) {
    const sourceId = `source:${shortHash(finalUrl)}`;
    const source: ProductSearchSource = {
      id: sourceId,
      title: candidate.title,
      url: finalUrl,
      site: new URL(finalUrl).hostname.replace(/^www\./i, ""),
      accessedAt,
    };
    return [{
      source,
      product: {
        id: `product:${shortHash(finalUrl)}`,
        title: candidate.title,
        merchant: new URL(finalUrl).hostname.replace(/^www\./i, ""),
        url: finalUrl,
        ...(imageUrl ? { imageUrl } : {}),
        price: pagePrice,
        ...(pageAvailability
          ? { availability: availabilityLabel(pageAvailability) }
          : {}),
        sourceIds: [sourceId],
      },
    }];
  }
  return structuredProducts.flatMap((structured, index) => {
    const title = stringValue(structured.name, 300);
    const productUrl = resolvedDirectProductUrl(
      structured,
      finalUrl,
      structuredProducts.length === 1,
    );
    const countryCode = marketCountryCode(country);
    if (
      !title ||
      !productUrl ||
      !structuredProductAvailableInCountry(
        structured,
        countryCode,
      ) ||
      !(
        urlMatchesMarket(productUrl, country) ||
        structuredProductHasMarketEvidence(structured, countryCode)
      )
    ) {
      return [];
    }
    const sourceId = `source:${shortHash(productUrl)}`;
    const source: ProductSearchSource = {
      id: sourceId,
      title,
      url: productUrl,
      site: new URL(productUrl).hostname.replace(/^www\./i, ""),
      accessedAt,
    };
    const aggregate = record(structured.aggregateRating);
    const rating = Number(aggregate?.ratingValue);
    const reviewCount = Number(aggregate?.reviewCount ?? aggregate?.ratingCount);
    const offer = firstOffer(structured);
    const description = stringValue(structured.description, 1_200);
    const price = productPrice(structured) ?? (index === 0 ? pagePrice : undefined);
    const availability = availabilityLabel(offer?.availability);
    const attributes = productAttributes(structured);
    const product: ProductSearchItem = {
      id: `product:${shortHash(`${productUrl}:${stringValue(structured.sku ?? structured.mpn) || index}`)}`,
      title,
      merchant: productMerchant(structured, productUrl),
      url: productUrl,
      ...(imageUrl ? { imageUrl } : {}),
      ...(description ? { description } : {}),
      ...(price ? { price } : {}),
      ...(availability ? { availability } : {}),
      ...(Number.isFinite(rating) && rating >= 0 && rating <= 5 ? { rating } : {}),
      ...(Number.isSafeInteger(reviewCount) && reviewCount >= 0 ? { reviewCount } : {}),
      ...(attributes ? { attributes } : {}),
      sourceIds: [sourceId],
    };
    return [{ product, source }];
  });
}

/**
 * Search discovery is still a source when a merchant blocks server-side page
 * inspection. Project only facts the discovery response actually supplied;
 * a quoted price may be retained, while availability, ratings, descriptions,
 * and attributes stay absent.
 */
async function projectDiscoveredCandidate(
  candidate: SearchCandidate,
  accessedAt: string,
  country: string,
): Promise<Array<{ product: ProductSearchItem; source: ProductSearchSource }>> {
  const pageUrl = safeProductUrl(candidate.pageUrl);
  if (
    !pageUrl ||
    !candidate.priceHint ||
    !isMerchantProductCandidate(candidate) ||
    !(candidate.marketEvidence || urlMatchesMarket(pageUrl, country))
  ) {
    return [];
  }
  const parsedPage = new URL(pageUrl);
  await assertPublicHost(parsedPage.hostname);
  let imageUrl = safeProductUrl(candidate.imageUrl);
  if (imageUrl) {
    try {
      await assertPublicHost(new URL(imageUrl).hostname);
    } catch {
      imageUrl = "";
    }
  }
  const site = parsedPage.hostname.replace(/^www\./i, "");
  const sourceId = `source:${shortHash(pageUrl)}`;
  return [{
    source: {
      id: sourceId,
      title: candidate.title,
      url: pageUrl,
      site,
      accessedAt,
    },
    product: {
      id: `product:${shortHash(pageUrl)}`,
      title: candidate.title,
      merchant: site,
      url: pageUrl,
      ...(imageUrl ? { imageUrl } : {}),
      price: candidate.priceHint,
      sourceIds: [sourceId],
    },
  }];
}

export async function searchProducts(
  rawInput: ProductSearchInput,
  options: { signal?: AbortSignal } = {},
): Promise<ProductSearchResult> {
  const input = normalizeInput(rawInput);
  let candidates: SearchCandidate[];
  try {
    candidates = await discoverCandidates(input, options.signal);
  } catch (error) {
    if (error instanceof ProductSearchError) throw error;
    if (options.signal?.aborted) {
      throw new ProductSearchError("product_search_aborted", "Product search was cancelled.");
    }
    throw new ProductSearchError("product_search_failed", "Product search did not answer. Try again once.");
  }
  const accessedAt = new Date().toISOString();
  const inspected = await Promise.all(candidates.map(async (candidate) => {
    try {
      const structured = await inspectCandidate(
        candidate,
        accessedAt,
        input.country,
        options.signal,
      );
      if (structured.length) return structured;
    } catch {
      if (options.signal?.aborted) {
        throw new ProductSearchError("product_search_aborted", "Product search was cancelled.");
      }
      // Merchants routinely block automated page inspection. The fallback
      // below retains only provider-supplied facts after the same network
      // boundary checks; it never manufactures the richer fields.
    }
    return projectDiscoveredCandidate(candidate, accessedAt, input.country).catch(() => []);
  }));
  const pairs = inspected.flat().filter(({ product }) => Boolean(product.price));
  const products = [...new Map(pairs.map(({ product }) => [product.id, product])).values()]
    .slice(0, input.count);
  const usedSourceIds = new Set(products.flatMap((product) => product.sourceIds));
  const sources = [...new Map(
    pairs
      .map(({ source }) => [source.id, source] as const)
      .filter(([sourceId]) => usedSourceIds.has(sourceId)),
  ).values()];
  if (products.length === 0) {
    return {
      query: input.query,
      productsReturned: 0,
      sources: [],
      uiResources: [],
      summary: `No in-stock direct product pages with a sourced price were found for ${marketCountryName(input.country)}.`,
    };
  }
  const resource = normalizeGenerativeUiResource({
    schemaVersion: PRODUCT_SEARCH_SCHEMA_VERSION,
    kind: PRODUCT_SEARCH_RESOURCE_KIND,
    renderer: PRODUCT_CAROUSEL_RENDERER,
    id: `product-search:${shortHash(`${input.query}:${accessedAt}`)}`,
    title: `Products for “${input.query}”`,
    createdAt: accessedAt,
    actions: [...PRODUCT_RESOURCE_ACTIONS],
    data: { query: input.query, products, sources },
  });
  if (!resource || resource.kind !== PRODUCT_SEARCH_RESOURCE_KIND) {
    throw new ProductSearchError(
      "product_search_projection_failed",
      "The sourced product results could not be projected safely.",
    );
  }
  return {
    query: input.query,
    productsReturned: products.length,
    sources,
    uiResources: [resource],
    summary: `Found ${products.length} sourced product${products.length === 1 ? "" : "s"}.`,
  };
}
