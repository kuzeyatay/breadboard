// Keyless search + page reading, used when nothing else can search.
//
// The engine's other two backends both have a way to be unavailable that looks
// like success. Firecrawl needs a credential, which is at least an obvious
// absence. ChatMock's `web_search` responses tool is the subtle one: it is
// honored only on routes whose upstream model actually has the tool, so a
// request answered by a model without it comes back as fluent prose citing
// nothing, and a request on a route whose search quota is spent comes back as
// a typed rejection. Both reach the research loop as "this query found no
// sources" — the run then completes, having read nothing, and reports an empty
// result for a topic with a live official page.
//
// This backend removes that failure mode by not depending on anyone's tool: it
// queries DuckDuckGo's HTML endpoint and reads the result pages over plain
// HTTP. Its answers are weaker than a paid reader's — no JavaScript rendering,
// no PDF parsing — but they are real page text with real URLs, which is the
// difference between a thin answer and no answer.

import { execFile } from 'node:child_process';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { promisify } from 'node:util';

import type { SearchDocument, SearchResponse } from './search';

const execFileAsync = promisify(execFile);

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MAX_DOCUMENT_CHARS = 20_000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(part => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part))) return true;
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return a >= 224;
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice(7);
    if (isIP(mapped) === 4) return isPrivateIpv4(mapped);
  }
  return (
    lower === '::' ||
    lower === '::1' ||
    /^f[cd]/.test(lower) ||
    /^fe[89ab]/.test(lower) ||
    lower.startsWith('ff')
  );
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

/**
 * Refuse anything that is not a public HTTP(S) address.
 *
 * Search results are attacker-influenceable input — a poisoned result page can
 * name any host it likes — so the guard runs on every hop rather than on the
 * URL the engine started with.
 */
async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs can be read');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error('Local or private hostnames are not allowed');
  }
  if (isIP(hostname) !== 0) {
    if (isPrivateAddress(hostname)) {
      throw new Error('Private or local IP addresses are not allowed');
    }
    return;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error('Hostname did not resolve');
  for (const address of addresses) {
    if (isPrivateAddress(address.address)) {
      throw new Error('This URL resolves to a private or local address');
    }
  }
}

async function fetchPublic(
  url: URL,
  init: RequestInit,
  signal?: AbortSignal,
  redirects = 0,
): Promise<Response> {
  await assertPublicUrl(url);
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const response = await fetch(url.toString(), {
    ...init,
    cache: 'no-store',
    redirect: 'manual',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: {
      'user-agent': USER_AGENT,
      'accept-language': 'en-US,en;q=0.9',
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.has('location')
  ) {
    if (redirects >= MAX_REDIRECTS) throw new Error('Too many redirects');
    const next = new URL(response.headers.get('location') ?? '', url);
    return fetchPublic(next, init, signal, redirects + 1);
  }
  return response;
}

async function readLimitedText(response: Response): Promise<string> {
  const declared = Number.parseInt(
    response.headers.get('content-length') ?? '',
    10,
  );
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    throw new Error('Response is too large to read');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  // Oversized bodies are truncated rather than dropped: the head of a long
  // page is still evidence, and the engine caps document length anyway.
  return buffer.subarray(0, MAX_BYTES).toString('utf-8');
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[lower] ?? match;
  });
}

function compact(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function htmlTitle(html: string): string {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  return compact(decodeEntities(raw.replace(/<[^>]+>/g, ' ')));
}

/**
 * Narrow a document to its content region when it marks one.
 *
 * Without this, a site with a large navigation tree spends most of its budget
 * on menu labels — the extracted text is real, and useless as evidence. A page
 * that marks no region keeps its whole body.
 */
function mainRegion(html: string): string {
  for (const tag of ['main', 'article']) {
    const open = new RegExp(`<${tag}[\\s>]`, 'i').exec(html);
    if (!open) continue;
    const close = html.toLowerCase().lastIndexOf(`</${tag}>`);
    if (close > open.index) {
      const region = html.slice(open.index, close);
      if (region.length > 500) return region;
    }
  }
  const body = /<body[\s>]/i.exec(html);
  return body ? html.slice(body.index) : html;
}

/** Strip a page to readable text — same shape as the chat link reader. */
export function htmlToText(html: string): string {
  const withoutChrome = mainRegion(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const withBreaks = withoutChrome
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(
      /<\/(p|div|section|article|header|main|li|tr|td|th|h[1-6])>/gi,
      '\n',
    )
    .replace(/<li[^>]*>/gi, '\n- ');

  return compact(decodeEntities(withBreaks.replace(/<[^>]+>/g, ' ')));
}

/** DuckDuckGo wraps some results in a redirector; recover the real target. */
function unwrapDuckDuckGoUrl(href: string): string | null {
  const absolute = href.startsWith('//') ? `https:${href}` : href;
  let url: URL;
  try {
    url = new URL(absolute, 'https://duckduckgo.com');
  } catch {
    return null;
  }
  const wrapped = url.searchParams.get('uddg');
  if (wrapped) {
    try {
      return new URL(wrapped).toString();
    } catch {
      return null;
    }
  }
  if (url.hostname.endsWith('duckduckgo.com')) return null;
  return url.toString();
}

export interface DirectSearchResult {
  url: string;
  title: string;
  snippet: string;
}

/** Parse an organic result list out of a DuckDuckGo results page. */
export function parseDuckDuckGoResults(
  html: string,
  limit: number,
): DirectSearchResult[] {
  const results: DirectSearchResult[] = [];
  const seen = new Set<string>();
  // `result__a` is the full HTML endpoint; `result-link` is the lite one.
  const linkPattern =
    /<a[^>]+class="[^"]*(?:result__a|result-link)[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(html)) !== null) {
    const url = unwrapDuckDuckGoUrl(decodeEntities(match[1] ?? ''));
    if (!url || seen.has(url)) continue;
    seen.add(url);
    results.push({
      url,
      title: compact(decodeEntities((match[2] ?? '').replace(/<[^>]+>/g, ' '))),
      snippet: '',
    });
    if (results.length >= limit) break;
  }

  // Snippets are matched positionally against the links. They are a nicety —
  // the page text is the evidence — so a mismatch costs nothing.
  const snippets: string[] = [];
  const snippetPattern =
    /class="[^"]*(?:result__snippet|result-snippet)[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td)>/gi;
  while ((match = snippetPattern.exec(html)) !== null) {
    snippets.push(
      compact(decodeEntities((match[1] ?? '').replace(/<[^>]+>/g, ' '))),
    );
  }
  results.forEach((result, index) => {
    result.snippet = snippets[index] ?? '';
  });

  return results;
}

// Scraped in order until one yields results. Same index, different markup.
const DUCKDUCKGO_ENDPOINTS = [
  'https://html.duckduckgo.com/html/',
  'https://lite.duckduckgo.com/lite/',
];

/**
 * Search through the `ddgs` package in Breadboard's Hermes environment.
 *
 * Worth the subprocess: DuckDuckGo answers a plain HTTP client with an HTTP
 * 202 challenge page perhaps half the time, and `ddgs` gets past it because it
 * impersonates a browser's TLS fingerprint — something `fetch` cannot do. The
 * interpreter path arrives as `DEEP_RESEARCH_DDGS_PYTHON`; without it this
 * simply doesn't run and the HTTP scrape below is used instead.
 */
async function ddgsPackageSearch(
  query: string,
  limit: number,
): Promise<DirectSearchResult[] | null> {
  const python = (process.env.DEEP_RESEARCH_DDGS_PYTHON ?? '').trim();
  if (!python) return null;
  const program = [
    'import json, sys',
    'from ddgs import DDGS',
    'query, limit = sys.argv[1], int(sys.argv[2])',
    'rows = list(DDGS().text(query, max_results=limit))',
    'print(json.dumps([{ "url": r.get("href") or "", "title": r.get("title") or "",'
      + ' "snippet": r.get("body") or "" } for r in rows]))',
  ].join('\n');
  try {
    const { stdout } = await execFileAsync(
      python,
      ['-c', program, query, String(limit)],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    );
    const parsed: unknown = JSON.parse(stdout.trim().split('\n').pop() ?? '[]');
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter(
        (row): row is DirectSearchResult =>
          typeof (row as DirectSearchResult)?.url === 'string' &&
          (row as DirectSearchResult).url.length > 0,
      )
      .slice(0, limit);
  } catch (error) {
    console.warn(
      `[search] ddgs search unavailable (${error instanceof Error ? error.message : String(error)}); scraping DuckDuckGo directly.`,
    );
    return null;
  }
}

/**
 * Query DuckDuckGo and return the organic results.
 *
 * Two ways in, tried in order: the `ddgs` package when Breadboard passed an
 * interpreter, then DuckDuckGo's own no-JavaScript endpoints. Parsing is
 * deliberately loose — a markup change should thin the results, not throw.
 */
export async function duckDuckGoSearch(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<DirectSearchResult[]> {
  const viaPackage = await ddgsPackageSearch(query, limit);
  if (viaPackage && viaPackage.length > 0) return viaPackage;

  let lastStatus = 0;
  for (const endpoint of DUCKDUCKGO_ENDPOINTS) {
    const response = await fetchPublic(
      new URL(endpoint),
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ q: query }).toString(),
      },
      signal,
    );
    lastStatus = response.status;
    if (!response.ok) continue;
    const results = parseDuckDuckGoResults(await readLimitedText(response), limit);
    // HTTP 202 with a challenge page is DuckDuckGo's rate limit, and it parses
    // to zero results rather than to an error — so "parsed nothing" is the
    // signal to try the other endpoint.
    if (results.length > 0) return results;
  }
  if (lastStatus >= 400) {
    throw new Error(`DuckDuckGo search returned ${lastStatus}`);
  }
  return [];
}

/** Fetch one URL and return its readable text, or null when it cannot be read. */
export async function readPage(
  url: string,
  signal?: AbortSignal,
): Promise<SearchDocument | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  try {
    const response = await fetchPublic(
      parsed,
      {
        headers: {
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
        },
      },
      signal,
    );
    if (!response.ok) return null;
    const type = (response.headers.get('content-type') ?? '')
      .split(';')[0]
      ?.trim()
      .toLowerCase() ?? '';
    if (type && !type.startsWith('text/') && !type.endsWith('+xml')) return null;

    const body = await readLimitedText(response);
    const content = compact(htmlToText(body)).slice(0, MAX_DOCUMENT_CHARS);
    if (content.length < 200) return null;
    return {
      url: response.url || parsed.toString(),
      content,
      title: htmlTitle(body),
    };
  } catch {
    return null;
  }
}

/**
 * One search query, answered with real page text.
 *
 * Pages are read concurrently and failures are dropped: a research step that
 * reads three of five results is a good step, and waiting on a dead host to
 * time out serially is how a run burns its budget.
 */
export async function directSearch(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const hits = await duckDuckGoSearch(query, Math.max(limit, 1), signal);
  if (hits.length === 0) return { contents: [], urls: [] };

  const pages = await Promise.all(hits.map(hit => readPage(hit.url, signal)));
  const documents: SearchDocument[] = [];
  hits.forEach((hit, index) => {
    const page = pages[index];
    if (page) {
      documents.push({ ...page, title: page.title || hit.title });
    } else if (hit.snippet) {
      // A result whose page would not open still carries its snippet, and a
      // labelled snippet is honest evidence where an invented page is not.
      documents.push({
        url: hit.url,
        title: hit.title,
        content: `${hit.title}\n${hit.snippet}\n\n[Search-result snippet only — the page could not be read.]`,
      });
    }
  });

  return {
    contents: documents.map(document => document.content),
    urls: documents.map(document => document.url),
    documents,
  };
}
