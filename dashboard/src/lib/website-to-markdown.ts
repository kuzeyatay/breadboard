import { createHash } from "node:crypto";
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { fromMarkdown } from "mdast-util-from-markdown";
import { XMLParser } from "fast-xml-parser";
import { assertPublicHost } from "./get-doc/download.ts";
import {
  convertUrlToMarkdown,
  normalizeSourceUrl,
  type UrlToMarkdownResult,
} from "./url-to-markdown.ts";

const ASSET_EXTENSION = /\.(?:png|jpe?g|gif|webp|svg|ico|avif|css|js|mjs|map|woff2?|ttf|mp[34]|wav|ogg|webm|mov|zip|gz|tar|exe|dmg)$/i;
const TRACKING_PARAMETER = /^(?:utm_.+|fbclid|gclid|msclkid)$/i;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;

export type WebsiteScope = "site" | "section";

export interface WebsitePage extends UrlToMarkdownResult {
  anchor: string;
  discoveredLinks: string[];
}

export interface WebsiteSnapshot {
  rootUrl: string;
  pages: WebsitePage[];
  aliases: Record<string, string>;
  failures: Array<{ url: string; error: string }>;
  skipped: Array<{ url: string; reason: string }>;
  complete: boolean;
}

export class IncompleteWebsiteError extends Error {
  readonly snapshot: WebsiteSnapshot;
  constructor(snapshot: WebsiteSnapshot) {
    super(`Website import is incomplete: ${snapshot.pages.length} pages read, ${snapshot.failures.length} unresolved. ${snapshot.failures.slice(0, 3).map(x => `${x.url}: ${x.error}`).join("; ")}`);
    this.name = "IncompleteWebsiteError";
    this.snapshot = snapshot;
  }
}

/** HTTP/HTTPS and the apex/www spelling of this site only; never subdomains. */
export function websitePageUrl(value: string, base: string, site: string): string | null {
  try {
    // Unexpanded template bindings are not pages (including percent-encoded
    // bindings emitted by a reader). Following them creates endless fake URLs.
    let decoded = value;
    for (let i = 0; i < 3; i++) {
      if (/\{\{|\}\}|\$\{|<%|%>/.test(decoded)) return null;
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    const url = new URL(value, base);
    const root = new URL(site);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password ||
        url.hostname.replace(/^www\./i, "") !== root.hostname.replace(/^www\./i, "") ||
        url.port !== root.port) return null;
    url.hash = "";
    url.hostname = root.hostname;
    url.protocol = root.protocol;
    for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMETER.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}

export function websiteCrawlRoot(value: string, scope: WebsiteScope = "site"): string {
  const entry = normalizeSourceUrl(value);
  const root = scope === "site" ? new URL("/", entry).href : entry;
  const normalized = websitePageUrl(root, entry, root);
  if (!normalized) throw new Error("Website URL must be a public HTTP address without credentials");
  return normalized;
}

/** Match path segments, so /math never includes /mathematics or parent pages. */
export function isWithinWebsiteRoot(address: string, rootUrl: string): boolean {
  const normalized = websitePageUrl(address, rootUrl, rootUrl);
  if (!normalized) return false;
  const url = new URL(normalized), root = new URL(rootUrl);
  const rootPath = root.pathname.replace(/\/+$/, "");
  return (url.pathname.replace(/\/+$/, "") === rootPath || url.pathname.startsWith(`${rootPath}/`)) &&
    [...root.searchParams].every(([key, value]) => url.searchParams.getAll(key).includes(value));
}

/** Category/course links in main content, excluding site navigation and chrome. */
export function websiteHtmlSectionLinks(html: string, pageUrl: string): string[] {
  const document = parse(html);
  type Node = DefaultTreeAdapterTypes.Node;
  const mains: Node[] = [], fallbacks: Node[] = [];
  let base = pageUrl;
  const attr = (node: DefaultTreeAdapterTypes.Element, name: string) => node.attrs.find(a => a.name === name)?.value ?? "";
  const find = (node: Node): void => {
    if ("tagName" in node) {
      if (node.tagName === "base" && attr(node, "href")) {
        try { base = new URL(attr(node, "href"), pageUrl).href; } catch { /* invalid base */ }
      }
      if (node.tagName === "main" || attr(node, "role") === "main") mains.push(node);
      else if (/^(?:main|content|main-content|primary)$/i.test(attr(node, "id"))) fallbacks.push(node);
    }
    if ("childNodes" in node) node.childNodes.forEach(find);
  };
  find(document);
  const links = new Set<string>();
  const visit = (node: Node, inArticle = false): void => {
    if ("tagName" in node) {
      inArticle ||= node.tagName === "article" || /(?:^|\s)(?:post|hentry)(?:\s|$)/.test(attr(node, "class")) ||
        /schema\.org\/(?:Article|BlogPosting|NewsArticle)/.test(attr(node, "itemtype"));
      if (["nav", "aside", "footer", "script", "style", "template"].includes(node.tagName) ||
          (node.tagName === "header" && !inArticle) ||
          /^(?:navigation|complementary|contentinfo|banner)$/.test(attr(node, "role")) ||
          /(?:^|\s)(?:sidebar|breadcrumb[s]?|menu|navbar|cat-links|tags-links)(?:\s|$)/i.test(`${attr(node, "id")} ${attr(node, "class")}`)) return;
      const href = attr(node, "href");
      if ((node.tagName === "a" || node.tagName === "area") && href) {
        try { links.add(new URL(href, base).href); } catch { /* invalid link */ }
      }
    }
    if ("childNodes" in node) node.childNodes.forEach(child => visit(child, inArticle));
  };
  (mains.length ? mains : fallbacks.length ? fallbacks : [document]).forEach(node => visit(node));
  return [...links];
}

function websiteHtmlCanonical(html: string, pageUrl: string): string | null {
  let canonical: string | null = null;
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ("tagName" in node && node.tagName === "link" &&
        node.attrs.find(a => a.name === "rel")?.value.toLowerCase().split(/\s+/).includes("canonical")) {
      const href = node.attrs.find(a => a.name === "href")?.value;
      if (href && !canonical) { try { canonical = new URL(href, pageUrl).href; } catch { /* invalid canonical */ } }
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parse(html));
  return canonical;
}

export function websiteHtmlLinks(html: string, pageUrl: string): string[] {
  const document = parse(html);
  let base = pageUrl;
  let hasBase = false;
  const hrefs: string[] = [];
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ("tagName" in node) {
      const href = node.attrs.find(attr => attr.name === "href")?.value;
      if (node.tagName === "base" && href && !hasBase) {
        try { base = new URL(href, pageUrl).href; hasBase = true; } catch { /* ignore malformed base */ }
      }
      if ((node.tagName === "a" || node.tagName === "area") && href) hrefs.push(href);
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(document);
  return hrefs.flatMap(href => { try { return [new URL(href, base).href]; } catch { return []; } });
}

/** Preserve linked equation images that readability extractors may omit. */
export function websiteHtmlImages(html: string, pageUrl: string): Array<{ url: string; alt: string }> {
  const images: Array<{ url: string; alt: string }> = [];
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ("tagName" in node && node.tagName === "img") {
      const attr = (name: string) => node.attrs.find(item => item.name === name)?.value;
      const src = attr("data-src") || attr("data-original") || attr("src");
      if (src && attr("width") !== "1" && attr("height") !== "1") {
        try {
          const url = new URL(src, pageUrl);
          if (/^https?:$/.test(url.protocol) && !images.some(image => image.url === url.href)) {
            images.push({ url: url.href, alt: (attr("alt") || "Source figure").replace(/[\[\]\r\n]/g, " ") });
          }
        } catch { /* malformed image URL */ }
      }
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parse(html));
  return images;
}

export function websiteMarkdownLinks(markdown: string, pageUrl: string): string[] {
  const result: string[] = [];
  const visit = (node: { type: string; url?: string; value?: string; children?: unknown[] }): void => {
    if ((node.type === "link" || node.type === "definition") && node.url) {
      try { result.push(new URL(node.url, pageUrl).href); } catch { /* ignore invalid link */ }
    }
    if (node.type === "html" && node.value) result.push(...websiteHtmlLinks(node.value, pageUrl));
    node.children?.forEach(child => visit(child as Parameters<typeof visit>[0]));
  };
  visit(fromMarkdown(markdown));
  return result;
}

async function boundedText(response: Response, limit: number): Promise<string> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error("Page exceeds the import size limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new Error("Page exceeds the import size limit");
      chunks.push(next.value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  return Buffer.concat(chunks).toString("utf8");
}

export async function convertWebsiteToMarkdown({
  url, signal, fetchImpl = fetch, assertPublicHostImpl = assertPublicHost,
  convertPage = convertUrlToMarkdown, maxPages = Infinity, maxBytes = Infinity,
  scope = "site", onProgress, onPage,
}: {
  url: string;
  scope?: WebsiteScope;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  assertPublicHostImpl?: (hostname: string) => Promise<void>;
  convertPage?: (input: { url: string; signal?: AbortSignal }) => Promise<UrlToMarkdownResult>;
  maxPages?: number;
  maxBytes?: number;
  onProgress?: (message: string) => void;
  onPage?: (page: WebsitePage) => Promise<void> | void;
}): Promise<WebsiteSnapshot> {
  const entry = normalizeSourceUrl(url);
  const rootUrl = websiteCrawlRoot(entry, scope);
  if (!websitePageUrl(entry, entry, rootUrl)) throw new Error("Website URL must be a public HTTP address without credentials");
  if ((maxPages !== Infinity && !Number.isSafeInteger(maxPages)) || maxPages < 1 ||
      (maxBytes !== Infinity && !Number.isSafeInteger(maxBytes)) || maxBytes < 1) {
    throw new Error("Invalid website import limits");
  }
  const snapshot: WebsiteSnapshot = { rootUrl, pages: [], aliases: {}, failures: [], skipped: [], complete: false };
  const queue: string[] = [];
  const seen = new Set<string>();
  const pageHashes = new Map<string, string>();
  const listedArticles = new Set<string>();
  let totalBytes = 0;
  const enqueue = (candidate: string, base = entry, listed = false): void => {
    const normalized = websitePageUrl(candidate, base, rootUrl);
    if (!normalized || seen.has(normalized)) return;
    if (scope === "section" && !isWithinWebsiteRoot(normalized, rootUrl)) {
      const candidatePath = new URL(normalized).pathname.replace(/\/+$/, "");
      if (new URL(rootUrl).pathname.startsWith(`${candidatePath}/`)) return;
      if (listed) listedArticles.add(normalized);
      if (!listedArticles.has(normalized)) return;
    }
    seen.add(normalized);
    if (ASSET_EXTENSION.test(new URL(normalized).pathname)) {
      snapshot.skipped.push({ url: normalized, reason: "Linked asset; embedded figures are captured with their page" });
      return;
    }
    if (queue.length >= maxPages) {
      snapshot.failures.push({ url: normalized, error: `Website exceeds the ${maxPages}-page limit; no partial import was published` });
      return;
    }
    queue.push(normalized);
  };
  const request = async (address: string): Promise<{ text: string; url: string; status: number; contentType: string }> => {
    const deadline = AbortSignal.timeout(60_000);
    const activeSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let current = new URL(address);
    for (let hop = 0; hop <= 5; hop++) {
      activeSignal.throwIfAborted();
      if (!websitePageUrl(current.href, entry, rootUrl)) throw new Error("Redirect leaves the website");
      await assertPublicHostImpl(current.hostname);
      const response = await fetchImpl(current, { redirect: "manual", signal: activeSignal,
        headers: { "User-Agent": "Breadboard-Website-Import/1.0", Accept: "text/html,application/xhtml+xml,application/xml,text/plain;q=0.8" } });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) throw new Error("Redirect has no destination");
        current = new URL(location, current);
        continue;
      }
      const text = await boundedText(response, Math.min(MAX_PAGE_BYTES, maxBytes - totalBytes));
      totalBytes += Buffer.byteLength(text);
      if (totalBytes > maxBytes) throw new Error("Website exceeds the import size limit");
      return { text, url: current.href, status: response.status, contentType: response.headers.get("content-type") ?? "" };
    }
    throw new Error("Too many redirects");
  };
  enqueue(rootUrl);

  // Include orphan pages advertised by sitemap indexes, not just navigation.
  const sitemaps: string[] = [];
  const seenSitemaps = new Set<string>();
  const enqueueSitemap = (value: string): void => {
    if (!value.trim()) return;
    const address = websitePageUrl(value, rootUrl, rootUrl);
    if (address && !seenSitemaps.has(address)) { seenSitemaps.add(address); sitemaps.push(address); }
  };
  enqueueSitemap(new URL("/sitemap.xml", rootUrl).href);
  try {
    const robots = await request(new URL("/robots.txt", rootUrl).href);
    if (robots.status === 200) for (const match of robots.text.matchAll(/^\s*Sitemap:\s*(\S+)/gmi)) {
      enqueueSitemap(match[1]);
    }
  } catch { signal?.throwIfAborted(); /* robots is optional */ }
  for (let i = 0; i < sitemaps.length; i++) {
    signal?.throwIfAborted();
    try {
      const response = await request(sitemaps[i]);
      if (response.status === 404) continue;
      if (response.status !== 200) throw new Error(`Sitemap returned HTTP ${response.status}`);
      // Decode standard XML escapes in URLs, without accepting custom entities.
      if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(response.text)) throw new Error("Sitemap contains unsupported entity declarations");
      const xml = new XMLParser({ ignoreAttributes: true, processEntities: true }).parse(response.text);
      const list = (value: unknown): unknown[] => value ? Array.isArray(value) ? value : [value] : [];
      for (const item of list(xml.sitemapindex?.sitemap)) {
        enqueueSitemap(String((item as { loc?: unknown }).loc ?? ""));
      }
      for (const item of list(xml.urlset?.url)) enqueue(String((item as { loc?: unknown }).loc ?? ""));
    } catch (error) {
      signal?.throwIfAborted();
      snapshot.failures.push({ url: sitemaps[i], error: error instanceof Error ? error.message : String(error) });
    }
  }
  for (let i = 0; i < queue.length; i++) {
    signal?.throwIfAborted();
    const pageUrl = queue[i];
    onProgress?.(`Reading website page ${i + 1} of ${queue.length}: ${pageUrl}`);
    try {
      const response = await request(pageUrl);
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
      if (scope === "section" && !isWithinWebsiteRoot(response.url, rootUrl) && !listedArticles.has(pageUrl)) {
        throw new Error("Redirect leaves the selected section");
      }
      if (!/(?:html|text\/plain|application\/pdf)/i.test(response.contentType)) throw new Error(`Unsupported page type: ${response.contentType || "unknown"}`);
      const canonicalHref = websiteHtmlCanonical(response.text, response.url);
      const canonical = canonicalHref && websitePageUrl(canonicalHref, response.url, rootUrl);
      // Honor a site's canonical declaration for print and other alternate
      // views, but do not follow a canonical cycle or broaden a section root.
      if (canonical && canonical !== pageUrl && !ASSET_EXTENSION.test(new URL(canonical).pathname) &&
          (scope === "site" || isWithinWebsiteRoot(canonical, rootUrl) || listedArticles.has(pageUrl))) {
        const chain = new Set([pageUrl]);
        let target = canonical;
        while (snapshot.aliases[target] && !chain.has(target)) { chain.add(target); target = snapshot.aliases[target]; }
        if (!chain.has(target)) {
          enqueue(canonical, response.url, listedArticles.has(pageUrl));
          snapshot.aliases[pageUrl] = canonical;
          continue;
        }
      }
      const discoveredLinks = websiteHtmlLinks(response.text, response.url);
      discoveredLinks.forEach(link => enqueue(link, response.url));
      const isSectionListing = scope === "section" && isWithinWebsiteRoot(response.url, rootUrl);
      const sectionLinks = isSectionListing ? websiteHtmlSectionLinks(response.text, response.url) : [];
      sectionLinks.forEach(link => enqueue(link, response.url, true));
      const converted = await convertPage({ url: response.url, signal });
      signal?.throwIfAborted();
      if (!converted.markdown.trim()) throw new Error("Reader returned empty Markdown");
      if (converted.canonicalUrl && !websitePageUrl(converted.canonicalUrl, response.url, rootUrl)) throw new Error("Reader redirected outside the website");
      totalBytes += Buffer.byteLength(converted.markdown);
      if (totalBytes > maxBytes) throw new Error("Website exceeds the import size limit");
      websiteMarkdownLinks(converted.markdown, response.url).forEach(link =>
        enqueue(link, response.url, isSectionListing && sectionLinks.length === 0 && !discoveredLinks.includes(link)));
      // Different SPA routes can serve the same HTML shell. Only merge pages
      // when their rendered content also agrees, after discovering its links.
      const pageHash = createHash("sha256").update(response.text).update("\0").update(converted.markdown).digest("hex");
      const duplicate = pageHashes.get(pageHash);
      if (duplicate) { snapshot.aliases[pageUrl] = duplicate; continue; }
      const missingImages = websiteHtmlImages(response.text, response.url).filter(image =>
        !converted.markdown.includes(image.url) && !converted.markdown.includes(new URL(image.url).pathname));
      const markdown = converted.markdown + (missingImages.length
        ? `\n\n### Additional source figures\n\n${missingImages.map(image => `![${image.alt}](${image.url})`).join("\n\n")}` : "");
      const page: WebsitePage = { ...converted, originalUrl: pageUrl, discoveredLinks,
        markdown,
        anchor: `website-page-${snapshot.pages.length + 1}` };
      snapshot.pages.push(page);
      pageHashes.set(pageHash, pageUrl);
      const finalUrl = websitePageUrl(response.url, pageUrl, rootUrl);
      if (finalUrl && finalUrl !== pageUrl) snapshot.aliases[finalUrl] = pageUrl;
      await onPage?.(page);
    } catch (error) {
      signal?.throwIfAborted();
      snapshot.failures.push({ url: pageUrl, error: error instanceof Error ? error.message : String(error) });
    } finally {
      // Traverse the site's navigation in a stable order even when the user
      // pastes an article URL. Add an undiscoverable entry even after an alias.
      if (i === queue.length - 1) enqueue(entry);
    }
  }
  snapshot.complete = snapshot.failures.length === 0 && snapshot.pages.length > 0;
  if (!snapshot.complete) throw new IncompleteWebsiteError(snapshot);
  return snapshot;
}

/** Full text, page boundaries, and a local table of contents; no summarization. */
export function websiteSnapshotMarkdown(snapshot: WebsiteSnapshot): string {
  const targets = new Map(snapshot.pages.map(page => [page.originalUrl, page.anchor]));
  for (const [alias, original] of Object.entries(snapshot.aliases)) {
    const visited = new Set([alias]);
    let target = original;
    while (snapshot.aliases[target] && !visited.has(target)) { visited.add(target); target = snapshot.aliases[target]; }
    const anchor = targets.get(target); if (anchor) targets.set(alias, anchor);
  }
  const title = (page: WebsitePage) => (page.title || new URL(page.originalUrl).pathname).replace(/[\[\]\r\n]/g, " ");
  const contents = snapshot.pages.map(page => `- [${title(page)}](#${page.anchor})`).join("\n");
  const pages = snapshot.pages.map(page => {
    // Use AST offsets to change link destinations only, preserving math/code.
    let markdown = page.markdown;
    const edits: Array<{ start: number; end: number; text: string }> = [];
    const visit = (node: { type: string; url?: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: unknown[] }): void => {
      if ((node.type === "link" || node.type === "definition" || node.type === "image") && node.url && node.position) {
        const key = websitePageUrl(node.url, page.originalUrl, snapshot.rootUrl);
        const anchor = key && targets.get(key);
        const start = node.position.start.offset, end = node.position.end.offset;
        let replacement = anchor && node.type !== "image" ? `#${anchor}` : node.url;
        if (replacement === node.url) {
          try { replacement = new URL(node.url, page.originalUrl).href; } catch { /* preserve the original */ }
        }
        if (replacement !== node.url && start !== undefined && end !== undefined) {
          const raw = markdown.slice(start, end);
          const destination = node.type === "definition" ? raw.indexOf(node.url, raw.indexOf(":") + 1) : raw.lastIndexOf(node.url);
          if (destination >= 0) edits.push({ start: start + destination, end: start + destination + node.url.length, text: replacement });
        }
      }
      node.children?.forEach(child => visit(child as Parameters<typeof visit>[0]));
    };
    visit(fromMarkdown(markdown));
    edits.sort((a, b) => b.start - a.start).forEach(edit => { markdown = markdown.slice(0, edit.start) + edit.text + markdown.slice(edit.end); });
    // Ingested notes escape raw HTML. A Markdown heading survives that boundary
    // and Quartz gives it the same stable website-page-N fragment.
    const pageNumber = page.anchor.replace(/^website-page-/, "");
    return `## Website page ${pageNumber}\n\n### ${title(page)}\n\nOriginal page: [${page.originalUrl}](${page.originalUrl})\n\n${markdown}`;
  });
  return `## Website contents\n\n${snapshot.pages.length} pages imported from ${snapshot.rootUrl}.\n\n${contents}\n\n${pages.join("\n\n---\n\n")}\n`;
}
