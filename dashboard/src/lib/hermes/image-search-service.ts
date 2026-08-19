import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";

import { repositoryRoot } from "../runtime-paths.ts";

// The `image_search` tool has two backends behind one contract. With Google
// credentials configured it runs the REAL vendored mcp-google-images-search
// clone as an MCP stdio child — the clone validates the upstream response
// shape itself (Zod) and its patched search_image handler appends the
// structured result (titles, thumbnails, context links) as one JSON content
// item. Without credentials it falls back to DuckDuckGo's keyless image
// endpoint (the vqd-token + i.js flow the keyless image-search libraries
// use), so a fresh deployment shows images with zero setup.
const CONNECT_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 30_000;
const KEYLESS_FETCH_TIMEOUT_MS = 15_000;
const MAX_COUNT = 10;

export class ImageSearchServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ImageSearchServiceError";
    this.code = code;
  }
}

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

function trimmedEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function googleImagesApiKey(): string {
  return trimmedEnv("BREADBOARD_GOOGLE_IMAGES_API_KEY");
}

function googleImagesEngineId(): string {
  return trimmedEnv("BREADBOARD_GOOGLE_IMAGES_SEARCH_ENGINE_ID");
}

/** Env override first, else the vendored clone; the built entry file is the availability probe. */
export function resolveImageSearchEntry(): string | null {
  const configured = trimmedEnv("BREADBOARD_GOOGLE_IMAGES_ROOT");
  const root = configured
    ? path.resolve(configured)
    : path.join(repositoryRoot(), "mcp-google-images-search");
  const entry = path.join(root, "src", "index.js");
  return fs.existsSync(entry) ? entry : null;
}

/**
 * Google is used only when both credentials are present; otherwise the keyless
 * DuckDuckGo backend serves the same display contract with zero setup.
 */
export function imageSearchMode(): "google" | "keyless" {
  return googleImagesApiKey() && googleImagesEngineId() ? "google" : "keyless";
}

interface ServiceState {
  client: Client;
  fingerprint: string;
}

// Pinned to globalThis so Next dev HMR cannot strand a connected child behind a
// reloaded module copy, with an in-flight guard so concurrent chat turns do not
// each spawn their own MCP process.
const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardImageSearch?: ServiceState | null;
  __breadboardImageSearchStarting?: Promise<ServiceState> | null;
};

function fingerprintOf(entry: string): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([entry, googleImagesApiKey(), googleImagesEngineId()]))
    .digest("hex");
}

async function connect(entry: string): Promise<ServiceState> {
  const client = new Client({ name: "breadboard-image-search", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd: path.dirname(path.dirname(entry)),
    env: {
      ...getDefaultEnvironment(),
      // The clone's env schema hard-exits the process on a missing key, and
      // stderr is ignored, so both values are verified before spawning.
      API_KEY: googleImagesApiKey(),
      SEARCH_ENGINE_ID: googleImagesEngineId(),
    },
    // Never inherit the child's stderr into Breadboard logs, where it could
    // print the API key from a request URL.
    stderr: "ignore",
  });
  await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
  return { client, fingerprint: fingerprintOf(entry) };
}

async function ensureClient(): Promise<Client> {
  const entry = resolveImageSearchEntry();
  if (!entry) {
    throw new ImageSearchServiceError(
      "image_search_runtime_unavailable",
      "The image search runtime is not prepared. Run `node scripts/setup-google-images.mjs` to build mcp-google-images-search/.",
    );
  }
  const wanted = fingerprintOf(entry);
  const existing = runtimeGlobal.__breadboardImageSearch;
  if (existing && existing.fingerprint === wanted) return existing.client;
  if (existing) {
    void existing.client.close().catch(() => {});
    runtimeGlobal.__breadboardImageSearch = null;
  }
  const starting = runtimeGlobal.__breadboardImageSearchStarting;
  if (starting) return (await starting).client;
  const attempt = connect(entry)
    .then((state) => {
      runtimeGlobal.__breadboardImageSearch = state;
      return state;
    })
    .finally(() => {
      runtimeGlobal.__breadboardImageSearchStarting = null;
    });
  runtimeGlobal.__breadboardImageSearchStarting = attempt;
  try {
    return (await attempt).client;
  } catch {
    throw new ImageSearchServiceError(
      "image_search_launch_failed",
      "The image search server could not start.",
    );
  }
}

function dropClient(): void {
  const existing = runtimeGlobal.__breadboardImageSearch;
  if (existing) {
    void existing.client.close().catch(() => {});
    runtimeGlobal.__breadboardImageSearch = null;
  }
}

interface CloneSearchItem {
  title?: unknown;
  link?: unknown;
  displayLink?: unknown;
  image?: {
    contextLink?: unknown;
    dimensions?: unknown;
    thumbnail?: { link?: unknown };
  };
}

interface CloneResultPayload {
  summary?: { query?: unknown; pagination?: { nextPageStartIndex?: unknown } };
  items?: CloneSearchItem[];
}

function parseDimensions(value: unknown): { w?: number; h?: number } {
  if (typeof value !== "string") return {};
  const match = value.match(/^(\d+)x(\d+)$/);
  if (!match) return {};
  return { w: Number(match[1]), h: Number(match[2]) };
}

function normalizeArgs(input: ImageSearchInput): Record<string, unknown> {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query || query.length > 512) {
    throw new ImageSearchServiceError(
      "image_search_invalid_arguments",
      "Image search needs a non-empty query of at most 512 characters.",
    );
  }
  // The clone's own default is 2, which reads as a broken grid next to the
  // "give me 5 images" phrasing these turns arrive with — default to 5.
  const args: Record<string, unknown> = { query, count: 5 };
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
async function fetchVqdToken(query: string): Promise<string> {
  const response = await fetch(
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
    { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(KEYLESS_FETCH_TIMEOUT_MS) },
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

async function searchImagesKeyless(args: Record<string, unknown>): Promise<ImageSearchResult> {
  const query = String(args.query);
  const count = Number(args.count);
  const startIndex = typeof args.startIndex === "number" ? args.startIndex : 1;
  const vqd = await fetchVqdToken(query);
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
      signal: AbortSignal.timeout(KEYLESS_FETCH_TIMEOUT_MS),
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

export async function searchImages(input: ImageSearchInput): Promise<ImageSearchResult> {
  const args = normalizeArgs(input);
  if (imageSearchMode() === "keyless") return searchImagesKeyless(args);
  return searchImagesGoogle(args);
}

async function searchImagesGoogle(args: Record<string, unknown>): Promise<ImageSearchResult> {
  const client = await ensureClient();
  let result: Awaited<ReturnType<Client["callTool"]>>;
  try {
    result = await client.callTool({ name: "search_image", arguments: args }, undefined, {
      timeout: CALL_TIMEOUT_MS,
    });
  } catch {
    // A dead child (machine sleep, crash) surfaces here; drop the connection so
    // the next turn respawns instead of failing forever on a closed transport.
    dropClient();
    throw new ImageSearchServiceError(
      "image_search_failed",
      "The image search did not answer. Try again once.",
    );
  }

  const meta = (result as { _meta?: { error?: { message?: unknown } } })._meta;
  if (meta?.error) {
    const message =
      typeof meta.error.message === "string" && meta.error.message
        ? meta.error.message
        : "Google image search rejected the request.";
    throw new ImageSearchServiceError("image_search_upstream_error", message);
  }

  const content = Array.isArray(result.content) ? result.content : [];
  let parsed: CloneResultPayload | null = null;
  for (const item of content) {
    if (item?.type !== "text" || typeof item.text !== "string") continue;
    if (!item.text.startsWith('{"imageResults":')) continue;
    try {
      parsed =
        (JSON.parse(item.text) as { imageResults?: CloneResultPayload }).imageResults ?? null;
    } catch {
      parsed = null;
    }
  }
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new ImageSearchServiceError(
      "image_search_failed",
      "The image search returned no readable results.",
    );
  }

  const displayItems: ImageSearchDisplayItem[] = parsed.items.flatMap((item) => {
    const link = typeof item.link === "string" ? item.link : "";
    if (!link) return [];
    const thumb =
      typeof item.image?.thumbnail?.link === "string" ? item.image.thumbnail.link : "";
    return [
      {
        title: typeof item.title === "string" ? item.title : "",
        image: link,
        thumb,
        page: typeof item.image?.contextLink === "string" ? item.image.contextLink : "",
        site: typeof item.displayLink === "string" ? item.displayLink : "",
        ...parseDimensions(item.image?.dimensions),
      },
    ];
  });

  const query =
    typeof parsed.summary?.query === "string" && parsed.summary.query
      ? parsed.summary.query
      : String(args.query);
  const nextRaw = parsed.summary?.pagination?.nextPageStartIndex;
  return {
    query,
    itemsReturned: displayItems.length,
    ...(typeof nextRaw === "number" ? { nextPageStartIndex: nextRaw } : {}),
    display: { query, items: displayItems },
  };
}
