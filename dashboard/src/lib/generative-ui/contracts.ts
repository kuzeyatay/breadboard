/**
 * Breadboard-owned generative UI contract.
 *
 * Tool output is untrusted. It can propose data for one of the renderers in
 * this discriminated union, but it can never name a React component, provide
 * executable code, or attach an arbitrary click handler. Every resource is
 * normalized at the tool-event boundary and again when a transcript is
 * restored in the browser.
 */

export const PRODUCT_SEARCH_RESOURCE_KIND = "product-search" as const;
export const PRODUCT_CAROUSEL_RENDERER = "product-carousel" as const;
export const PRODUCT_SEARCH_SCHEMA_VERSION = 1 as const;

export const PRODUCT_RESOURCE_ACTIONS = [
  "open-details",
  "find-similar",
  "compare",
  "visit",
] as const;

export type ProductResourceAction = (typeof PRODUCT_RESOURCE_ACTIONS)[number];

export interface ProductPrice {
  amount: string;
  currency: string;
  display: string;
}

export interface ProductAttribute {
  label: string;
  value: string;
}

export interface ProductSearchItem {
  id: string;
  title: string;
  merchant: string;
  url: string;
  imageUrl?: string;
  description?: string;
  price?: ProductPrice;
  availability?: string;
  rating?: number;
  reviewCount?: number;
  attributes?: ProductAttribute[];
  /** References ids in the resource's source list. */
  sourceIds: string[];
}

export interface ProductSearchSource {
  id: string;
  title: string;
  url: string;
  site: string;
  accessedAt: string;
}

export interface ProductSearchResource {
  schemaVersion: typeof PRODUCT_SEARCH_SCHEMA_VERSION;
  kind: typeof PRODUCT_SEARCH_RESOURCE_KIND;
  renderer: typeof PRODUCT_CAROUSEL_RENDERER;
  id: string;
  title: string;
  createdAt: string;
  actions: ProductResourceAction[];
  data: {
    query: string;
    products: ProductSearchItem[];
    sources: ProductSearchSource[];
  };
}

/** Add future maps, weather, music, calendar, stock, and MCP projections here. */
export type GenerativeUiResource = ProductSearchResource;

export type GenerativeUiAction =
  | {
      type: "product.open-details" | "product.find-similar" | "product.compare" | "product.visit";
      resource: ProductSearchResource;
      productId: string;
    };

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const MAX_PRODUCTS = 12;
const MAX_SOURCES = 24;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function id(value: unknown): string {
  const normalized = text(value, 160);
  return ID_PATTERN.test(normalized) ? normalized : "";
}

/** Product destinations are display data, never internal fetch instructions. */
export function safeProductUrl(value: unknown): string {
  const raw = text(value, 2_048);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      !parsed.hostname ||
      blockedDisplayHostname(parsed.hostname)
    ) {
      return "";
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function blockedDisplayHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".lan") ||
    host.endsWith(".internal") ||
    host === "::" ||
    host === "::1" ||
    host.includes(":")
  ) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function normalizePrice(value: unknown): ProductPrice | undefined {
  const candidate = record(value);
  if (!candidate) return undefined;
  const amount = text(candidate.amount, 48);
  const currency = text(candidate.currency, 3).toUpperCase();
  const display = text(candidate.display, 80);
  if (!amount || !/^[A-Z]{3}$/.test(currency) || !display) return undefined;
  return { amount, currency, display };
}

function normalizeAttributes(value: unknown): ProductAttribute[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attributes = value.flatMap((entry): ProductAttribute[] => {
    const candidate = record(entry);
    if (!candidate) return [];
    const label = text(candidate.label, 80);
    const attributeValue = text(candidate.value, 240);
    return label && attributeValue ? [{ label, value: attributeValue }] : [];
  }).slice(0, 16);
  return attributes.length ? attributes : undefined;
}

function normalizeSource(value: unknown): ProductSearchSource | null {
  const candidate = record(value);
  if (!candidate) return null;
  const sourceId = id(candidate.id);
  const title = text(candidate.title, 300);
  const url = safeProductUrl(candidate.url);
  const site = text(candidate.site, 200);
  const accessedAt = text(candidate.accessedAt, 40);
  if (
    !sourceId ||
    !title ||
    !url ||
    !site ||
    !Number.isFinite(Date.parse(accessedAt))
  ) {
    return null;
  }
  return { id: sourceId, title, url, site, accessedAt };
}

function normalizeProduct(
  value: unknown,
  sourceIds: ReadonlySet<string>,
): ProductSearchItem | null {
  const candidate = record(value);
  if (!candidate) return null;
  const productId = id(candidate.id);
  const title = text(candidate.title, 300);
  const merchant = text(candidate.merchant, 160);
  const url = safeProductUrl(candidate.url);
  const linkedSources = Array.isArray(candidate.sourceIds)
    ? [...new Set(candidate.sourceIds.map(id).filter((entry) => sourceIds.has(entry)))].slice(0, 8)
    : [];
  if (!productId || !title || !merchant || !url || linkedSources.length === 0) {
    return null;
  }
  const imageUrl = safeProductUrl(candidate.imageUrl);
  const description = text(candidate.description, 1_200);
  const availability = text(candidate.availability, 120);
  const rating = Number(candidate.rating);
  const reviewCount = Number(candidate.reviewCount);
  const price = normalizePrice(candidate.price);
  const attributes = normalizeAttributes(candidate.attributes);
  return {
    id: productId,
    title,
    merchant,
    url,
    ...(imageUrl ? { imageUrl } : {}),
    ...(description ? { description } : {}),
    ...(price ? { price } : {}),
    ...(availability ? { availability } : {}),
    ...(Number.isFinite(rating) && rating >= 0 && rating <= 5
      ? { rating: Math.round(rating * 10) / 10 }
      : {}),
    ...(Number.isSafeInteger(reviewCount) && reviewCount >= 0
      ? { reviewCount }
      : {}),
    ...(attributes ? { attributes } : {}),
    sourceIds: linkedSources,
  };
}

export function normalizeGenerativeUiResource(
  value: unknown,
): GenerativeUiResource | null {
  const candidate = record(value);
  if (
    !candidate ||
    candidate.schemaVersion !== PRODUCT_SEARCH_SCHEMA_VERSION ||
    candidate.kind !== PRODUCT_SEARCH_RESOURCE_KIND ||
    candidate.renderer !== PRODUCT_CAROUSEL_RENDERER
  ) {
    return null;
  }
  const resourceId = id(candidate.id);
  const title = text(candidate.title, 240);
  const createdAt = text(candidate.createdAt, 40);
  const data = record(candidate.data);
  if (!resourceId || !title || !data || !Number.isFinite(Date.parse(createdAt))) {
    return null;
  }
  const query = text(data.query, 300);
  const sources = Array.isArray(data.sources)
    ? data.sources.flatMap((source): ProductSearchSource[] => {
        const normalized = normalizeSource(source);
        return normalized ? [normalized] : [];
      }).slice(0, MAX_SOURCES)
    : [];
  const uniqueSources = [...new Map(sources.map((source) => [source.id, source])).values()];
  const knownSourceIds = new Set(uniqueSources.map((source) => source.id));
  const products = Array.isArray(data.products)
    ? data.products.flatMap((product): ProductSearchItem[] => {
        const normalized = normalizeProduct(product, knownSourceIds);
        return normalized ? [normalized] : [];
      }).slice(0, MAX_PRODUCTS)
    : [];
  const uniqueProducts = [...new Map(products.map((product) => [product.id, product])).values()];
  if (!query || uniqueSources.length === 0 || uniqueProducts.length === 0) return null;
  const actionSet = new Set(
    Array.isArray(candidate.actions)
      ? candidate.actions.filter((action): action is ProductResourceAction =>
          (PRODUCT_RESOURCE_ACTIONS as readonly unknown[]).includes(action),
        )
      : [],
  );
  const actions = PRODUCT_RESOURCE_ACTIONS.filter((action) => actionSet.has(action));
  return {
    schemaVersion: PRODUCT_SEARCH_SCHEMA_VERSION,
    kind: PRODUCT_SEARCH_RESOURCE_KIND,
    renderer: PRODUCT_CAROUSEL_RENDERER,
    id: resourceId,
    title,
    createdAt,
    actions: [...actions],
    data: { query, products: uniqueProducts, sources: uniqueSources },
  };
}

export function normalizeGenerativeUiResources(value: unknown): GenerativeUiResource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): GenerativeUiResource[] => {
    const normalized = normalizeGenerativeUiResource(entry);
    return normalized ? [normalized] : [];
  }).slice(0, 4);
}

function parsedToolOutput(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    if (value.length > 2 * 1024 * 1024) return null;
    try {
      return record(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return record(value);
}

/**
 * Project an untrusted completed tool result onto Breadboard's renderer union.
 * The tool name is checked as well as the payload discriminator, so another
 * tool cannot smuggle a product carousel into the transcript.
 */
export function generativeUiResourcesFromToolOutput(
  toolName: string,
  output: unknown,
): GenerativeUiResource[] {
  if (toolName.trim().toLowerCase() !== "product_search") return [];
  const parsed = parsedToolOutput(output);
  return normalizeGenerativeUiResources(parsed?.uiResources);
}

export function productForResource(
  resource: ProductSearchResource,
  productId: string,
): ProductSearchItem | null {
  return resource.data.products.find((product) => product.id === productId) ?? null;
}

/** Resolve an action only after checking both its target and resource grant. */
export function productForAction(action: GenerativeUiAction): ProductSearchItem | null {
  const required: ProductResourceAction =
    action.type === "product.open-details"
      ? "open-details"
      : action.type === "product.find-similar"
        ? "find-similar"
        : action.type === "product.compare"
          ? "compare"
          : "visit";
  if (!action.resource.actions.includes(required)) return null;
  return productForResource(action.resource, action.productId);
}
