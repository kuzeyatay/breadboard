import crypto from "crypto";

export type UrlToMarkdownProvider = "jina-reader-local" | "jina-reader-remote";

export interface UrlToMarkdownResult {
  originalUrl: string;
  canonicalUrl?: string;
  title?: string;
  markdown: string;
  provider: UrlToMarkdownProvider;
  fetchedAt: string;
  contentHash: string;
  contentType?: string;
  metadata?: Record<string, unknown>;
}

export interface ReaderEnv {
  [key: string]: string | undefined;
  READER_BASE_URL?: string;
  READER_PROVIDER?: string;
  READER_TIMEOUT_MS?: string;
  READER_ALLOW_REMOTE_FALLBACK?: string;
  READER_REMOTE_BASE_URL?: string;
}

type FetchLike = typeof fetch;

const DEFAULT_LOCAL_READER_BASE_URL = "";
const DEFAULT_REMOTE_READER_BASE_URL = "https://r.jina.ai";
const DEFAULT_READER_TIMEOUT_MS = 60_000;

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((value ?? "").trim());
}

/**
 * An operator who wants pages read only on this machine says so explicitly.
 * Silence is not a refusal: it means the setting was never considered, and a
 * link that cannot be read at all is worse than one read remotely.
 */
function remoteFallbackRefused(env: ReaderEnv): boolean {
  return /^(0|false|no|off)$/i.test((env.READER_ALLOW_REMOTE_FALLBACK ?? "").trim());
}

export function normalizeReaderProvider(value?: string): UrlToMarkdownProvider {
  return value === "jina-reader-remote" ? "jina-reader-remote" : "jina-reader-local";
}

export function normalizeSourceUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Link URL is required");
  }
  const raw = value.trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Enter a valid link URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS links are supported");
  }
  parsed.hash = "";
  return parsed.toString();
}

export function buildReaderRequestUrl(baseUrl: string, targetUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) throw new Error("READER_BASE_URL is required");
  const normalizedBase = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const base = new URL(normalizedBase);
  base.pathname = base.pathname.replace(/\/+$/, "");
  base.search = "";
  base.hash = "";
  const prefix = base.toString().replace(/\/+$/, "");
  return `${prefix}/${targetUrl}`;
}

export function contentHashForMarkdown(originalUrl: string, markdown: string): string {
  return crypto
    .createHash("sha256")
    .update(`${normalizeSourceUrl(originalUrl)}\n${markdown.trim()}`, "utf8")
    .digest("hex");
}

function parseFrontmatter(markdown: string): {
  data: Record<string, unknown>;
  body: string;
} {
  if (!markdown.startsWith("---")) return { data: {}, body: markdown };
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: markdown };
  const raw = markdown.slice(3, end).trim();
  const data: Record<string, unknown> = {};
  for (const line of raw.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (!key) continue;
    try {
      data[key] = JSON.parse(rawValue);
    } catch {
      data[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
  const bodyStart = markdown.indexOf("\n", end + 1);
  return {
    data,
    body: bodyStart === -1 ? "" : markdown.slice(bodyStart + 1).trimStart(),
  };
}

function metadataString(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function parseReaderMarkdownResult({
  originalUrl,
  markdown,
  provider,
  fetchedAt,
  contentType,
}: {
  originalUrl: string;
  markdown: string;
  provider: UrlToMarkdownProvider;
  fetchedAt: string;
  contentType?: string;
}): UrlToMarkdownResult {
  const normalizedUrl = normalizeSourceUrl(originalUrl);
  const parsed = parseFrontmatter(markdown.trim());
  const cleanMarkdown = parsed.body.trim() || markdown.trim();
  if (!cleanMarkdown) {
    throw new Error("Reader returned empty Markdown for this link.");
  }
  const title =
    metadataString(parsed.data, "title", "pageTitle") ??
    cleanMarkdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const canonicalUrl = metadataString(parsed.data, "url", "canonical", "canonicalUrl");
  return {
    originalUrl: normalizedUrl,
    canonicalUrl,
    title,
    markdown: cleanMarkdown,
    provider,
    fetchedAt,
    contentHash: contentHashForMarkdown(normalizedUrl, cleanMarkdown),
    contentType,
    metadata: parsed.data,
  };
}

async function fetchReaderMarkdown({
  provider,
  baseUrl,
  targetUrl,
  timeoutMs,
  fetchImpl,
  signal,
}: {
  provider: UrlToMarkdownProvider;
  baseUrl: string;
  targetUrl: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
  signal?: AbortSignal;
}): Promise<{ markdown: string; contentType?: string }> {
  const readerUrl = buildReaderRequestUrl(baseUrl, targetUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(readerUrl, {
      method: "GET",
      headers: {
        Accept: "text/markdown, text/plain;q=0.9",
        "X-Respond-With": "frontmatter",
      },
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const detail = text.trim() ? ` ${text.trim().slice(0, 300)}` : "";
      throw new Error(`Reader returned HTTP ${response.status}.${detail}`);
    }
    return {
      markdown: text,
      contentType: response.headers.get("content-type") ?? undefined,
    };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Reader timed out after ${timeoutMs}ms while converting ${targetUrl}.`);
    }
    if (provider === "jina-reader-local") {
      throw new Error(
        `Could not reach local Jina Reader at READER_BASE_URL (${baseUrl}). Start Reader or update READER_BASE_URL. ${
          error instanceof Error ? error.message : ""
        }`.trim(),
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function convertUrlToMarkdown({
  url,
  env = process.env,
  fetchImpl = fetch,
  now = () => new Date(),
  signal,
}: {
  url: string;
  env?: ReaderEnv;
  fetchImpl?: FetchLike;
  now?: () => Date;
  signal?: AbortSignal;
}): Promise<UrlToMarkdownResult> {
  const originalUrl = normalizeSourceUrl(url);
  const provider = normalizeReaderProvider(env.READER_PROVIDER);
  const timeoutMs = Number(env.READER_TIMEOUT_MS || DEFAULT_READER_TIMEOUT_MS);
  const localBaseUrl = env.READER_BASE_URL?.trim() || DEFAULT_LOCAL_READER_BASE_URL;
  const remoteBaseUrl = env.READER_REMOTE_BASE_URL?.trim() || DEFAULT_REMOTE_READER_BASE_URL;

  const tryProvider = async (
    selectedProvider: UrlToMarkdownProvider,
    baseUrl: string,
  ): Promise<UrlToMarkdownResult> => {
    const fetchedAt = now().toISOString();
    const response = await fetchReaderMarkdown({
      provider: selectedProvider,
      baseUrl,
      targetUrl: originalUrl,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_READER_TIMEOUT_MS,
      fetchImpl,
      signal,
    });
    return parseReaderMarkdownResult({
      originalUrl,
      markdown: response.markdown,
      provider: selectedProvider,
      fetchedAt,
      contentType: response.contentType,
    });
  };

  if (provider === "jina-reader-remote") {
    return tryProvider("jina-reader-remote", remoteBaseUrl);
  }

  // No local Reader configured at all. This used to throw "READER_BASE_URL is
  // required" as a 500, so saving a link failed with an environment variable's
  // name and no way forward (2026-09-17: nothing was listening for Reader, and
  // 8080 - the port the local Reader documents - was held by an unrelated
  // application). The remote Reader is then the only way to read a page, so
  // use it unless the operator has explicitly turned it off. The result
  // records provider "jina-reader-remote", so a page fetched off this machine
  // is always identifiable as such.
  if (!localBaseUrl) {
    if (remoteFallbackRefused(env)) {
      throw new Error(
        "No local Reader is configured (set READER_BASE_URL) and the remote Reader is disabled, so this link cannot be read.",
      );
    }
    return tryProvider("jina-reader-remote", remoteBaseUrl);
  }

  try {
    return await tryProvider("jina-reader-local", localBaseUrl);
  } catch (error) {
    signal?.throwIfAborted();
    if (remoteFallbackRefused(env) || !truthy(env.READER_ALLOW_REMOTE_FALLBACK)) throw error;
    return tryProvider("jina-reader-remote", remoteBaseUrl);
  }
}
