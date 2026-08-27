import { runGoogleImageSearch } from "./image-search-runtime-v2.ts";
import { ImageSearchServiceError } from "./image-search-errors.ts";

export { ImageSearchServiceError } from "./image-search-errors.ts";

// The `image_search` tool has two backends behind one contract. With Google
// credentials configured, a disposable Runtime V2 worker runs the real
// vendored mcp-google-images-search clone. The dashboard never owns that stdio
// child and never receives either Google credential. Without credentials it
// uses DuckDuckGo's process-free HTTP endpoint, so a fresh deployment still
// shows images with zero setup.
const KEYLESS_FETCH_TIMEOUT_MS = 15_000;
const MAX_COUNT = 10;

export interface ImageSearchDisplayItem {
  title: string;
  image: string;
  thumb: string;
  page: string;
  site: string;
  w?: number;
  h?: number;
}

export interface ImageSearchResult {
  query: string;
  itemsReturned: number;
  nextPageStartIndex?: number;
  display: { query: string; items: ImageSearchDisplayItem[] };
}

export interface ImageSearchInput {
  query: string;
  count?: number;
  safe?: "off" | "medium" | "high";
  startIndex?: number;
}

export interface ImageSearchRuntimeScope {
  userId: number;
  gardenId: string | null;
  conversationId: string;
}

export interface ImageSearchExecutionOptions {
  scope?: ImageSearchRuntimeScope;
  signal?: AbortSignal;
}

/**
 * Google is used only when both credentials are present; otherwise the keyless
 * DuckDuckGo backend serves the same display contract with zero setup.
 */
export function imageSearchMode(env: NodeJS.ProcessEnv = process.env): "google" | "keyless" {
  return env.BREADBOARD_GOOGLE_IMAGES_CONFIGURED?.trim().toLowerCase() === "true"
    ? "google"
    : "keyless";
}

export interface CanonicalImageSearchRequest {
  query: string;
  count: number;
  safe: "off" | "medium" | "high" | null;
  startIndex: number | null;
}

function normalizeArgs(input: ImageSearchInput): CanonicalImageSearchRequest {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query || query.length > 512) {
    throw new ImageSearchServiceError(
      "image_search_invalid_arguments",
      "Image search needs a non-empty query of at most 512 characters.",
    );
  }
  // The clone's own default is 2, which reads as a broken grid next to the
  // "give me 5 images" phrasing these turns arrive with — default to 5.
  const args: CanonicalImageSearchRequest = {
    query,
    count: 5,
    safe: null,
    startIndex: null,
  };
  if (input.count !== undefined) {
    const count = Number(input.count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
      throw new ImageSearchServiceError(
        "image_search_invalid_arguments",
        `Image search count must be an integer between 1 and ${MAX_COUNT}.`,
      );
    }
    args.count = count;
  }
  if (input.safe !== undefined) {
    if (!["off", "medium", "high"].includes(input.safe)) {
      throw new ImageSearchServiceError(
        "image_search_invalid_arguments",
        "Image search safe must be off, medium or high.",
      );
    }
    args.safe = input.safe;
  }
  if (input.startIndex !== undefined) {
    const startIndex = Number(input.startIndex);
    if (!Number.isInteger(startIndex) || startIndex < 1 || startIndex > 91) {
      throw new ImageSearchServiceError(
        "image_search_invalid_arguments",
        "Image search startIndex must be an integer between 1 and 91.",
      );
    }
    args.startIndex = startIndex;
  }
  return args;
}

// ── keyless backend (DuckDuckGo) ─────────────────────────────────────────────

const BROWSER_HEADERS = {
  // DuckDuckGo serves i.js to browsers; a bare node fetch UA gets a 403.
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  referer: "https://duckduckgo.com/",
} as const;

/** The per-query token DuckDuckGo embeds in its search page and requires on i.js. */
function fetchSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(KEYLESS_FETCH_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function fetchVqdToken(query: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
    { headers: BROWSER_HEADERS, signal: fetchSignal(signal) },
  );
  if (!response.ok) {
    throw new ImageSearchServiceError(
      "image_search_upstream_error",
      `The image search provider refused the request (HTTP ${response.status}).`,
    );
  }
  const html = await response.text();
  const token = html.match(/vqd=["']([^"']+)["']/)?.[1] ?? html.match(/vqd=([\d-]+)/)?.[1];
  if (!token) {
    throw new ImageSearchServiceError(
      "image_search_upstream_error",
      "The image search provider changed its page format and no search token was found.",
    );
  }
  return token;
}

interface DdgImageResult {
  title?: unknown;
  image?: unknown;
  thumbnail?: unknown;
  url?: unknown;
  width?: unknown;
  height?: unknown;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

async function searchImagesKeyless(
  args: CanonicalImageSearchRequest,
  signal?: AbortSignal,
): Promise<ImageSearchResult> {
  const query = args.query;
  const count = args.count;
  const startIndex = args.startIndex ?? 1;
  let vqd: string;
  try {
    vqd = await fetchVqdToken(query, signal);
  } catch (error) {
    if (error instanceof ImageSearchServiceError) throw error;
    if (signal?.aborted) {
      throw new ImageSearchServiceError("image_search_aborted", "The image search was cancelled.");
    }
    throw new ImageSearchServiceError(
      "image_search_failed",
      "The image search did not answer. Try again once.",
    );
  }
  const params = new URLSearchParams({
    l: "us-en",
    o: "json",
    q: query,
    vqd,
    f: ",,,",
    // DuckDuckGo has only on/off; "medium" maps to on, matching its own UI's
    // moderate default.
    p: args.safe === "high" || args.safe === "medium" ? "1" : "-1",
  });
  if (startIndex > 1) params.set("s", String(startIndex - 1));
  let payload: { results?: DdgImageResult[]; next?: unknown };
  try {
    const response = await fetch(`https://duckduckgo.com/i.js?${params.toString()}`, {
      headers: BROWSER_HEADERS,
      signal: fetchSignal(signal),
    });
    if (!response.ok) {
      throw new ImageSearchServiceError(
        "image_search_upstream_error",
        `The image search provider refused the request (HTTP ${response.status}).`,
      );
    }
    payload = (await response.json()) as { results?: DdgImageResult[]; next?: unknown };
  } catch (error) {
    if (error instanceof ImageSearchServiceError) throw error;
    if (signal?.aborted) {
      throw new ImageSearchServiceError("image_search_aborted", "The image search was cancelled.");
    }
    throw new ImageSearchServiceError(
      "image_search_failed",
      "The image search did not answer. Try again once.",
    );
  }
  const results = Array.isArray(payload.results) ? payload.results : [];
  const displayItems: ImageSearchDisplayItem[] = results
    .flatMap((item): ImageSearchDisplayItem[] => {
      const image = typeof item.image === "string" ? item.image : "";
      if (!/^https?:\/\//i.test(image)) return [];
      const page = typeof item.url === "string" ? item.url : "";
      return [
        {
          title: typeof item.title === "string" ? item.title : "",
          image,
          thumb: typeof item.thumbnail === "string" ? item.thumbnail : "",
          page,
          site: hostnameOf(page),
          ...(typeof item.width === "number" ? { w: item.width } : {}),
          ...(typeof item.height === "number" ? { h: item.height } : {}),
        },
      ];
    })
    .slice(0, count);
  const hasMore = typeof payload.next === "string" && results.length > count;
  return {
    query,
    itemsReturned: displayItems.length,
    ...(hasMore ? { nextPageStartIndex: startIndex + displayItems.length } : {}),
    display: { query, items: displayItems },
  };
}

// ── entry point ──────────────────────────────────────────────────────────────

export async function searchImages(
  input: ImageSearchInput,
  options: ImageSearchExecutionOptions = {},
): Promise<ImageSearchResult> {
  const args = normalizeArgs(input);
  if (imageSearchMode() === "keyless") return searchImagesKeyless(args, options.signal);
  return runGoogleImageSearch(args, options.scope, options.signal);
}
