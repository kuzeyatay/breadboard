import { runGoogleImageSearch } from "./image-search-runtime-v2.ts";
import { ImageSearchServiceError } from "./image-search-errors.ts";
import { readGoogleImageCredentials } from "./image-search-credentials.ts";
import { prepareImageSearchPreview } from "./image-search-preview.ts";
import { MAX_IMAGE_RESULTS, imageResultUrl } from "./image-results.ts";

export { ImageSearchServiceError } from "./image-search-errors.ts";

// The `image_search` tool has two backends behind one contract. With Google
// credentials saved in Profile, a disposable Runtime V2 worker runs the real
// vendored mcp-google-images-search clone. The dashboard never owns that stdio
// child; it sends the credentials to the worker as a sealed, single-use Runtime
// input that native Runtime deletes after the worker exits. Without credentials
// it uses DuckDuckGo's process-free HTTP endpoint, so a fresh deployment still
// shows images with zero setup.
const KEYLESS_FETCH_TIMEOUT_MS = 15_000;

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
  screenshot?: { dataUrl: string };
  guidance?: string;
  inspection?: { status: "awaiting_review" | "unavailable"; requested: number; loaded: number; timedOut: boolean };
  /** Provider positions for an internal candidate pool; never part of display. */
  candidatePositions?: number[];
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
 * Google is used only when this profile has both credentials; otherwise the
 * keyless DuckDuckGo backend serves the same display contract with zero setup.
 */
export function imageSearchMode(configured: boolean): "google" | "keyless" {
  return configured ? "google" : "keyless";
}

export interface CanonicalImageSearchRequest {
  query: string;
  count: number;
  safe: "off" | "medium" | "high" | null;
  startIndex: number | null;
}

function normalizeArgs(input: ImageSearchInput): CanonicalImageSearchRequest {
  const query = input && typeof input.query === "string" ? input.query.trim() : "";
  if (!query || query.length > 512) {
    throw new ImageSearchServiceError(
      "image_search_invalid_arguments",
      "Image search needs a non-empty query of at most 512 characters.",
    );
  }
  // The model chooses count explicitly. Older callers get one useful picture.
  const args: CanonicalImageSearchRequest = {
    query,
    count: 1,
    safe: null,
    startIndex: null,
  };
  if (input.count !== undefined) {
    const count = input.count;
    if (!Number.isInteger(count) || count < 1 || count > MAX_IMAGE_RESULTS) {
      throw new ImageSearchServiceError(
        "image_search_invalid_arguments",
        `Image search count must be an integer between 1 and ${MAX_IMAGE_RESULTS}.`,
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
    const startIndex = input.startIndex;
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
    if (!payload || !Array.isArray(payload.results)) {
      throw new ImageSearchServiceError("image_search_upstream_error", "The image search returned an unreadable result list.");
    }
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
  const candidatePositions: number[] = [];
  // Keep raw positions: dropped malformed entries must not make "more images"
  // revisit the same provider results or loop on an empty page.
  const poolSize = Math.min(results.length, count);
  const displayItems: ImageSearchDisplayItem[] = results.slice(0, poolSize)
    .flatMap((item, index): ImageSearchDisplayItem[] => {
      if (!item || typeof item !== "object") return [];
      const thumb = imageResultUrl(item.thumbnail);
      const image = imageResultUrl(item.image) || thumb;
      if (!image) return [];
      const page = imageResultUrl(item.url);
      candidatePositions.push(startIndex + index);
      return [
        {
          title: typeof item.title === "string" ? item.title : "",
          image,
          thumb,
          page,
          site: hostnameOf(page),
          ...(typeof item.width === "number" ? { w: item.width } : {}),
          ...(typeof item.height === "number" ? { h: item.height } : {}),
        },
      ];
    });
  const hasMore = poolSize > 0 && (results.length > poolSize || typeof payload.next === "string");
  return {
    query,
    itemsReturned: displayItems.length,
    ...(hasMore && startIndex + poolSize <= 91 ? { nextPageStartIndex: startIndex + poolSize } : {}),
    display: { query, items: displayItems },
    candidatePositions,
  };
}

// ── entry point ──────────────────────────────────────────────────────────────

export async function searchImages(
  input: ImageSearchInput,
  options: ImageSearchExecutionOptions = {},
): Promise<ImageSearchResult> {
  const args = normalizeArgs(input);
  if (options.signal?.aborted) {
    throw new ImageSearchServiceError("image_search_aborted", "The image search was cancelled.");
  }
  const credentials = options.scope
    ? readGoogleImageCredentials(options.scope.userId)
    : null;
  const mode = imageSearchMode(credentials !== null);
  // Overfetch a bounded candidate pool to replace broken/duplicate images.
  // This internal count may exceed the public tool's 1–5 display limit.
  const candidateArgs = { ...args, count: Math.min(10, Math.max(5, args.count * 2)) };
  const candidates = mode === "keyless" || credentials === null
    ? await searchImagesKeyless(candidateArgs, options.signal)
    : await runGoogleImageSearch(candidateArgs, options.scope, credentials, options.signal);
  try {
    return await prepareImageSearchPreview(candidates, args.count, args.startIndex ?? 1, {
      signal: options.signal,
    });
  } catch {
    throw new ImageSearchServiceError(
      options.signal?.aborted ? "image_search_aborted" : "image_search_preview_failed",
      options.signal?.aborted ? "The image search was cancelled." : "The image previews could not be loaded. Try a more focused query once.",
    );
  }
}
