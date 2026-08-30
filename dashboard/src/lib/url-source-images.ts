import crypto from "node:crypto";
import { assertPublicHost } from "./get-doc/download.ts";

const DEFAULT_MAX_IMAGES = 128;
const DEFAULT_MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_IMAGE_BYTES = 256 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const IMAGE_FETCH_TIMEOUT_MS = 20_000;
const DEFAULT_CAPTURE_TIMEOUT_MS = 120_000;
const IMAGE_FETCH_CONCURRENCY = 4;

type FetchLike = typeof fetch;

interface MarkdownImageReference {
  alt: string;
  rawUrl: string;
  urlStart: number;
  urlEnd: number;
  context: string;
}

interface CapturedImageBytes {
  bytes: Buffer;
  contentType: string;
  extension: string;
  finalUrl: string;
}

export interface CapturedUrlSourceImage {
  alt: string;
  originalUrl: string;
  finalUrl: string;
  publicPath: string;
  relativePath: string;
  contentType: string;
  byteSize: number;
  context: string;
  bytes: Buffer;
}

export interface UrlSourceImageCapture {
  markdown: string;
  images: CapturedUrlSourceImage[];
  referencedImageCount: number;
  warningCount: number;
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function compactContext(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^\n]*?\)/g, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

function referenceContext(markdown: string, start: number, end: number): string {
  return compactContext(
    markdown.slice(Math.max(0, start - 300), Math.min(markdown.length, end + 300)),
  );
}

/**
 * Locate inline Markdown image destinations without mistaking ordinary links
 * for figures. The small scanner handles angle-bracket destinations and the
 * balanced parentheses that are common in Wikimedia-style image URLs.
 */
function markdownImageReferences(markdown: string): MarkdownImageReference[] {
  const references: MarkdownImageReference[] = [];
  let cursor = 0;

  while (cursor < markdown.length - 3) {
    const imageStart = markdown.indexOf("![", cursor);
    if (imageStart < 0) break;
    cursor = imageStart + 2;
    if (isEscaped(markdown, imageStart)) continue;

    let altEnd = cursor;
    while (altEnd < markdown.length) {
      if (markdown[altEnd] === "]" && !isEscaped(markdown, altEnd)) break;
      altEnd += 1;
    }
    if (altEnd >= markdown.length) break;

    let open = altEnd + 1;
    while (open < markdown.length && /[ \t]/.test(markdown[open])) open += 1;
    if (markdown[open] !== "(") {
      cursor = altEnd + 1;
      continue;
    }

    let urlStart = open + 1;
    while (urlStart < markdown.length && /[ \t]/.test(markdown[urlStart])) {
      urlStart += 1;
    }
    let urlEnd = urlStart;
    if (markdown[urlStart] === "<") {
      urlStart += 1;
      urlEnd = urlStart;
      while (
        urlEnd < markdown.length &&
        (markdown[urlEnd] !== ">" || isEscaped(markdown, urlEnd))
      ) {
        urlEnd += 1;
      }
      if (urlEnd >= markdown.length) {
        cursor = altEnd + 1;
        continue;
      }
    } else {
      let nestedParentheses = 0;
      while (urlEnd < markdown.length) {
        const character = markdown[urlEnd];
        if (character === "\\") {
          urlEnd += 2;
          continue;
        }
        if (character === "(") {
          nestedParentheses += 1;
        } else if (character === ")") {
          if (nestedParentheses === 0) break;
          nestedParentheses -= 1;
        } else if (/\s/.test(character) && nestedParentheses === 0) {
          break;
        }
        urlEnd += 1;
      }
    }

    const rawUrl = markdown.slice(urlStart, urlEnd).trim();
    if (rawUrl) {
      references.push({
        alt: markdown.slice(imageStart + 2, altEnd).replace(/\s+/g, " ").trim(),
        rawUrl,
        urlStart,
        urlEnd,
        context: referenceContext(markdown, imageStart, urlEnd),
      });
    }
    cursor = Math.max(urlEnd, altEnd + 1);
  }

  return references;
}

function htmlImageReferences(markdown: string): MarkdownImageReference[] {
  const references: MarkdownImageReference[] = [];
  const responsiveTag = /<(?:img|source)\b[^>]*>/gi;
  for (const match of markdown.matchAll(responsiveTag)) {
    if (match.index === undefined) continue;
    const tag = match[0];
    const quotedSource = /\bsrc\s*=\s*(["'])(.*?)\1/i.exec(tag);
    const bareSource = quotedSource
      ? null
      : /\bsrc\s*=\s*([^\s"'=<>`]+)/i.exec(tag);
    const source = quotedSource ?? bareSource;
    const rawUrl = quotedSource?.[2]?.trim() ?? bareSource?.[1]?.trim() ?? "";
    const alt = /\balt\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2]?.trim() ?? "";
    if (source && source.index !== undefined && rawUrl) {
      const sourceOffset = source.index + source[0].indexOf(rawUrl);
      references.push({
        alt,
        rawUrl,
        urlStart: match.index + sourceOffset,
        urlEnd: match.index + sourceOffset + rawUrl.length,
        context: referenceContext(markdown, match.index, match.index + tag.length),
      });
    }

    const srcset = /\bsrcset\s*=\s*(["'])(.*?)\1/i.exec(tag);
    if (!srcset || srcset.index === undefined || !srcset[2]?.trim()) continue;
    const valueOffset = srcset.index + srcset[0].indexOf(srcset[2]);
    const candidatePattern = /(?:^|,)\s*(\S+?)(?=\s+(?:\d+(?:\.\d+)?[wx])(?:\s*,|\s*$)|\s*,|\s*$)/g;
    for (const candidate of srcset[2].matchAll(candidatePattern)) {
      if (candidate.index === undefined || !candidate[1]?.trim()) continue;
      const candidateOffset = candidate.index + candidate[0].lastIndexOf(candidate[1]);
      references.push({
        alt,
        rawUrl: candidate[1].trim(),
        urlStart: match.index + valueOffset + candidateOffset,
        urlEnd: match.index + valueOffset + candidateOffset + candidate[1].length,
        context: referenceContext(markdown, match.index, match.index + tag.length),
      });
    }
  }
  return references;
}

function referenceStyleImageReferences(markdown: string): MarkdownImageReference[] {
  const usages = new Map<string, { alt: string; index: number }>();
  for (const match of markdown.matchAll(/!\[([^\]\n]*)\]\[([^\]\n]*)\]/g)) {
    if (match.index === undefined) continue;
    const alt = match[1].replace(/\s+/g, " ").trim();
    const label = (match[2].trim() || alt).toLowerCase();
    if (label && !usages.has(label)) usages.set(label, { alt, index: match.index });
  }
  if (usages.size === 0) return [];

  const references: MarkdownImageReference[] = [];
  const definition = /^[ \t]{0,3}\[([^\]\n]+)\]:[ \t]*(?:<([^>\n]+)>|(\S+))/gm;
  for (const match of markdown.matchAll(definition)) {
    if (match.index === undefined) continue;
    const usage = usages.get(match[1].trim().toLowerCase());
    const rawUrl = (match[2] || match[3] || "").trim();
    if (!usage || !rawUrl) continue;
    const offset = match[0].lastIndexOf(rawUrl);
    if (offset < 0) continue;
    references.push({
      alt: usage.alt,
      rawUrl,
      urlStart: match.index + offset,
      urlEnd: match.index + offset + rawUrl.length,
      context: referenceContext(
        markdown,
        usage.index,
        usage.index + match[0].length,
      ),
    });
  }
  return references;
}

export function extractEmbeddedImageReferences(
  markdown: string,
): Array<Pick<MarkdownImageReference, "alt" | "rawUrl">> {
  return [
    ...markdownImageReferences(markdown),
    ...referenceStyleImageReferences(markdown),
    ...htmlImageReferences(markdown),
  ]
    .sort((left, right) => left.urlStart - right.urlStart)
    .map(({ alt, rawUrl }) => ({ alt, rawUrl }));
}

function allImageReferences(markdown: string): MarkdownImageReference[] {
  const sorted = [
    ...markdownImageReferences(markdown),
    ...referenceStyleImageReferences(markdown),
    ...htmlImageReferences(markdown),
  ].sort((left, right) => left.urlStart - right.urlStart);
  const references: MarkdownImageReference[] = [];
  for (const reference of sorted) {
    const previous = references.at(-1);
    if (previous && reference.urlStart < previous.urlEnd) continue;
    references.push(reference);
  }
  return references;
}

function resolvedImageUrl(rawUrl: string, baseUrl: URL): URL | null {
  if (/^(?:data|blob|file|javascript):/i.test(rawUrl)) return null;
  try {
    const url = new URL(rawUrl.replace(/&amp;/gi, "&"), baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

async function readBoundedImage(response: Response, maxImageBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxImageBytes) {
    throw new Error("Embedded image is too large");
  }
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maxImageBytes) throw new Error("Embedded image is too large");
    return bytes;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxImageBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Embedded image is too large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function sanitizeSvg(bytes: Buffer): Buffer {
  let svg = bytes.toString("utf8");
  if (
    !/^(?:\uFEFF)?\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg\b/i.test(svg) ||
    /<!DOCTYPE|<!ENTITY/i.test(svg)
  ) {
    throw new Error("Embedded SVG is not safe to store");
  }
  svg = svg
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/\s*>/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/<foreignObject\b[^>]*\/\s*>/gi, "")
    .replace(/<(?:iframe|object|embed)\b[\s\S]*?<\/(?:iframe|object|embed)\s*>/gi, "")
    .replace(/<(?:iframe|object|embed)\b[^>]*\/\s*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, "")
    .replace(
      /\s+(?:href|xlink:href)\s*=\s*(["'])(?!#|data:image\/)[\s\S]*?\1/gi,
      "",
    )
    .replace(/@import\s+[^;]+;?/gi, "")
    .replace(/url\(\s*(["']?)https?:[\s\S]*?\1\s*\)/gi, "none");
  return Buffer.from(svg, "utf8");
}

function detectedImage(
  input: Buffer,
  responseContentType: string,
): { bytes: Buffer; contentType: string; extension: string } | null {
  const type = responseContentType.split(";", 1)[0].trim().toLowerCase();
  if (input.length >= 8 && input.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return { bytes: input, contentType: "image/png", extension: "png" };
  }
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) {
    return { bytes: input, contentType: "image/jpeg", extension: "jpg" };
  }
  if (/^GIF8[79]a/.test(input.subarray(0, 6).toString("ascii"))) {
    return { bytes: input, contentType: "image/gif", extension: "gif" };
  }
  if (
    input.length >= 12 &&
    input.subarray(0, 4).toString("ascii") === "RIFF" &&
    input.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { bytes: input, contentType: "image/webp", extension: "webp" };
  }
  if (
    input.length >= 12 &&
    input.subarray(4, 8).toString("ascii") === "ftyp" &&
    /^(?:avif|avis)$/.test(input.subarray(8, 12).toString("ascii"))
  ) {
    return { bytes: input, contentType: "image/avif", extension: "avif" };
  }
  if (
    type === "image/svg+xml" ||
    /^(?:\uFEFF)?\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg\b/i.test(
      input.toString("utf8", 0, 4096),
    )
  ) {
    const bytes = sanitizeSvg(input);
    return { bytes, contentType: "image/svg+xml", extension: "svg" };
  }
  return null;
}

async function fetchImageBytes({
  initialUrl,
  pageUrl,
  fetchImpl,
  assertPublicHostImpl,
  maxImageBytes,
  timeoutMs,
}: {
  initialUrl: URL;
  pageUrl: string;
  fetchImpl: FetchLike;
  assertPublicHostImpl: (hostname: string) => Promise<void>;
  maxImageBytes: number;
  timeoutMs: number;
}): Promise<CapturedImageBytes> {
  let current = initialUrl;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, Math.min(IMAGE_FETCH_TIMEOUT_MS, timeoutMs)),
  );
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (
        (current.protocol !== "http:" && current.protocol !== "https:") ||
        current.username ||
        current.password
      ) {
        throw new Error("Embedded image URL is not a public HTTP address");
      }
      await assertPublicHostImpl(current.hostname);
      const response = await fetchImpl(current, {
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.5",
          Referer: (() => {
            const referer = new URL(pageUrl);
            referer.username = "";
            referer.password = "";
            referer.hash = "";
            return referer.toString();
          })(),
          "User-Agent": "Breadboard-URL-Source/1.0",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Embedded image redirected without a target");
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) throw new Error(`Embedded image returned ${response.status}`);
      const detected = detectedImage(
        await readBoundedImage(response, maxImageBytes),
        response.headers.get("content-type") ?? "",
      );
      if (!detected) throw new Error("Embedded resource was not a supported image");
      return { ...detected, finalUrl: current.toString() };
    }
    throw new Error("Embedded image redirected too many times");
  } finally {
    clearTimeout(timeout);
  }
}

function assetStem(alt: string): string {
  return alt
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        await task(items[index], index);
      }
    },
  );
  await Promise.all(workers);
}

/**
 * Snapshot every fetchable image embedded by the Reader's Markdown. Successful
 * references are rewritten to garden-local URLs; failed or unsupported images
 * remain remote so a partial capture never removes source information.
 */
export async function captureUrlSourceImages({
  markdown,
  pageUrl,
  canonicalUrl,
  contentHash,
  clusterSlug,
  fetchImpl = fetch,
  assertPublicHostImpl = assertPublicHost,
  maxImages = DEFAULT_MAX_IMAGES,
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  maxTotalImageBytes = DEFAULT_MAX_TOTAL_IMAGE_BYTES,
  captureTimeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS,
}: {
  markdown: string;
  pageUrl: string;
  canonicalUrl?: string;
  contentHash: string;
  clusterSlug: string;
  fetchImpl?: FetchLike;
  assertPublicHostImpl?: (hostname: string) => Promise<void>;
  maxImages?: number;
  maxImageBytes?: number;
  maxTotalImageBytes?: number;
  captureTimeoutMs?: number;
}): Promise<UrlSourceImageCapture> {
  const references = allImageReferences(markdown);
  if (references.length === 0) {
    return { markdown, images: [], referencedImageCount: 0, warningCount: 0 };
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(canonicalUrl || pageUrl);
  } catch {
    return {
      markdown,
      images: [],
      referencedImageCount: references.length,
      warningCount: references.length,
    };
  }

  const referencesByUrl = new Map<string, MarkdownImageReference[]>();
  let unresolvedReferenceCount = 0;
  for (const reference of references) {
    const resolved = resolvedImageUrl(reference.rawUrl, baseUrl);
    if (!resolved) {
      unresolvedReferenceCount += 1;
      continue;
    }
    const key = resolved.toString();
    const group = referencesByUrl.get(key) ?? [];
    group.push(reference);
    referencesByUrl.set(key, group);
  }

  const candidates = [...referencesByUrl.entries()].slice(
    0,
    Math.max(0, Math.floor(maxImages)),
  );
  const capturedByUrl = new Map<string, CapturedUrlSourceImage>();
  let warningCount =
    unresolvedReferenceCount + Math.max(0, referencesByUrl.size - candidates.length);
  let capturedByteSize = 0;
  const folderHash = /^[a-f0-9]{16,}$/i.test(contentHash)
    ? contentHash.slice(0, 16).toLowerCase()
    : crypto.createHash("sha256").update(markdown).digest("hex").slice(0, 16);
  const captureDeadline = Date.now() + Math.max(1, captureTimeoutMs);

  await mapWithConcurrency(candidates, IMAGE_FETCH_CONCURRENCY, async ([url, group], index) => {
    const remainingMs = captureDeadline - Date.now();
    if (remainingMs <= 0) {
      warningCount += 1;
      return;
    }
    try {
      const fetched = await fetchImageBytes({
        initialUrl: new URL(url),
        pageUrl,
        fetchImpl,
        assertPublicHostImpl,
        maxImageBytes,
        timeoutMs: remainingMs,
      });
      if (capturedByteSize + fetched.bytes.byteLength > maxTotalImageBytes) {
        warningCount += 1;
        return;
      }
      capturedByteSize += fetched.bytes.byteLength;
      const first = group[0];
      const byteHash = crypto.createHash("sha256").update(fetched.bytes).digest("hex").slice(0, 16);
      const stem = assetStem(first.alt) || `figure-${index + 1}`;
      const fileName = `${String(index + 1).padStart(3, "0")}-${stem}-${byteHash}.${fetched.extension}`;
      const relativePath = `assets/url-sources/${folderHash}/${fileName}`;
      const publicPath = `/${clusterSlug.trim()}/${relativePath}`;
      capturedByUrl.set(url, {
        alt: first.alt || `Embedded figure ${index + 1}`,
        originalUrl: url,
        finalUrl: fetched.finalUrl,
        publicPath,
        relativePath,
        contentType: fetched.contentType,
        byteSize: fetched.bytes.byteLength,
        context: first.context,
        bytes: fetched.bytes,
      });
    } catch {
      warningCount += 1;
    }
  });

  const replacements: Array<{ start: number; end: number; value: string }> = [];
  for (const [url, group] of referencesByUrl) {
    const captured = capturedByUrl.get(url);
    if (!captured) continue;
    for (const reference of group) {
      replacements.push({
        start: reference.urlStart,
        end: reference.urlEnd,
        value: captured.publicPath,
      });
    }
  }
  replacements.sort((left, right) => right.start - left.start);
  let localizedMarkdown = markdown;
  for (const replacement of replacements) {
    localizedMarkdown =
      localizedMarkdown.slice(0, replacement.start) +
      replacement.value +
      localizedMarkdown.slice(replacement.end);
  }

  return {
    markdown: localizedMarkdown,
    images: candidates
      .map(([url]) => capturedByUrl.get(url))
      .filter((image): image is CapturedUrlSourceImage => Boolean(image)),
    referencedImageCount: references.length,
    warningCount,
  };
}
