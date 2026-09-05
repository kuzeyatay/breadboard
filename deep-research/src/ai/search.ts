// Search layer for the research engine.
//
// Three backends, same shape:
//
//  - `chatmock` (default): ChatMock's built-in `web_search` responses tool. The
//    upstream model runs the searches and returns a cited synthesis, so no
//    third-party search key is needed. What comes back is one grounded document
//    per query plus the URLs it cited — not raw scraped pages.
//  - `firecrawl`: the engine's original backend — real SERP results scraped to
//    markdown. Used when a Firecrawl credential is configured.
//  - `direct`: keyless DuckDuckGo results read over plain HTTP. Weaker than
//    either — no JavaScript rendering, no PDF parsing — and the reason it
//    exists is that it cannot be switched off by someone else's quota.
//
// Selection is `DEEP_RESEARCH_SEARCH_PROVIDER` (auto | chatmock | firecrawl |
// direct); `auto` prefers ChatMock when it is configured because it needs no
// credential, and falls back to `direct` per query when ChatMock's search
// turns out not to be usable on the active route.

import FirecrawlApp from '@mendable/firecrawl-js';

import { directSearch } from './direct-search';

export interface SearchResponse {
  /** Documents to learn from. May be empty when a query found nothing. */
  contents: string[];
  /** Source URLs behind those documents. */
  urls: string[];
  /** URL-bound documents when the backend can provide that relationship. */
  documents?: SearchDocument[];
  /** Gateway-reported usage for this search-backed model call, when present. */
  usage?: SearchUsage;
}

export interface SearchDocument {
  url: string;
  content: string;
  title?: string;
}

export interface SearchUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type SearchOptions = {
  signal?: AbortSignal;
};

export type SearchBackend =
  | 'chatmock-web-search'
  | 'firecrawl-cloud'
  | 'firecrawl-self-hosted'
  | 'direct-fetch';

const SEARCH_TIMEOUT_MS =
  Number(process.env.DEEP_RESEARCH_SEARCH_TIMEOUT_MS) || 300_000;

function chatmockBaseUrl(): string | undefined {
  // Runtime V2 hands the gateway over as `OPENAI_BASE_URL` with a
  // `CHATMOCK_MODEL` beside it; see the same fallback in providers.ts.
  const trimmed = (
    process.env.CHATMOCK_BASE_URL ||
    (process.env.CHATMOCK_MODEL ? process.env.OPENAI_BASE_URL : '') ||
    ''
  ).trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`,
    );
    const pathname = url.pathname.replace(/\/+$/, '');
    url.pathname = pathname.endsWith('/v1') ? pathname : `${pathname}/v1`;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function firecrawlBackend(): SearchBackend | null {
  if ((process.env.FIRECRAWL_BASE_URL || '').trim())
    return 'firecrawl-self-hosted';
  if ((process.env.FIRECRAWL_KEY || '').trim()) return 'firecrawl-cloud';
  return null;
}

/** Which backend a search would use right now, or null if none is usable. */
export function searchBackend(): SearchBackend | null {
  const preference = (process.env.DEEP_RESEARCH_SEARCH_PROVIDER || 'auto')
    .trim()
    .toLowerCase();
  if (preference === 'chatmock')
    return chatmockBaseUrl() ? 'chatmock-web-search' : null;
  if (preference === 'firecrawl') return firecrawlBackend();
  if (preference === 'direct') return 'direct-fetch';
  return (
    (chatmockBaseUrl() ? 'chatmock-web-search' : firecrawlBackend()) ??
    'direct-fetch'
  );
}

/**
 * True whenever a search is possible at all.
 *
 * Now always true outside an explicit single-backend preference, because the
 * direct backend needs no credential and no upstream tool. Health output says
 * "configured" where it used to say "unconfigured", and that is the honest
 * reading: a run started in this state returns sources.
 */
export function isSearchConfigured(): boolean {
  return searchBackend() !== null;
}

/** Reasoning models may prefix their answer with a think block; drop it. */
function stripReasoning(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .trim();
}

/**
 * Pull cited sources out of a web-search answer: markdown links and bare URLs,
 * de-duplicated, with the tracking parameters the tool appends removed.
 */
export function extractUrls(text: string, limit: number): string[] {
  const found = text.match(/https?:\/\/[^\s<>()[\]"']+/g) ?? [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of found) {
    const trimmed = raw.replace(/[.,;:]+$/, '');
    let normalized = trimmed;
    try {
      const url = new URL(trimmed);
      for (const parameter of [...url.searchParams.keys()]) {
        if (/^utm_/i.test(parameter)) url.searchParams.delete(parameter);
      }
      normalized = url.toString().replace(/\?$/, '');
    } catch {
      // Keep the raw match when it is not parseable as a URL.
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
    if (urls.length >= limit) break;
  }
  return urls;
}

const SEARCH_INSTRUCTIONS = [
  'You are a research assistant with web search.',
  'Search the web for the query below and report what the sources actually say.',
  'Rules:',
  '- Use web search. Do not answer from memory, and do not answer at all if search returns nothing useful.',
  '- Report concrete facts: entities, numbers, dates, measurements, named organizations.',
  '- Cite the source URL inline for every fact, as a markdown link.',
  '- No preamble, no advice, no summary of your process — findings only.',
].join('\n');

function timeoutSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('The operation was aborted.', 'AbortError');
  }
}

async function abortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;

  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('The operation was aborted.', 'AbortError'),
      );
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

async function chatmockSearch(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const baseUrl = chatmockBaseUrl();
  if (!baseUrl) return { contents: [], urls: [] };

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.CHATMOCK_API_KEY || 'local'}`,
    },
    body: JSON.stringify({
      model: process.env.CHATMOCK_MODEL || 'gpt-5.6-sol',
      messages: [
        { role: 'user', content: `${SEARCH_INSTRUCTIONS}\n\nQuery: ${query}` },
      ],
      // ChatMock's built-in search: the upstream model runs the queries.
      responses_tools: [{ type: 'web_search' }],
      responses_tool_choice: 'auto',
      stream: false,
    }),
    signal: timeoutSignal(signal),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `ChatMock web search failed with ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    );
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  const content = stripReasoning(body.choices?.[0]?.message?.content ?? '');
  const usage = body.usage
    ? {
        promptTokens: Number(body.usage.prompt_tokens) || 0,
        completionTokens: Number(body.usage.completion_tokens) || 0,
        totalTokens:
          Number(body.usage.total_tokens) ||
          (Number(body.usage.prompt_tokens) || 0) +
            (Number(body.usage.completion_tokens) || 0),
      }
    : undefined;

  // A search that cited nothing is treated as an empty result rather than as a
  // document: uncited text from a reasoning model is exactly what this agent
  // must not learn from.
  const urls = extractUrls(content, limit);
  if (!content || urls.length === 0) {
    return { contents: [], urls: [], ...(usage ? { usage } : {}) };
  }

  return {
    contents: [content],
    urls,
    // ChatMock returns one cited synthesis rather than raw pages. Associate
    // that exact synthesis with every URL it cited; downstream evidence may
    // cite only one of these registered IDs, but can never invent a URL.
    documents: urls.map(url => ({ url, content })),
    ...(usage ? { usage } : {}),
  };
}

async function firecrawlSearch(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const firecrawl = new FirecrawlApp({
    apiKey: process.env.FIRECRAWL_KEY ?? '',
    apiUrl: process.env.FIRECRAWL_BASE_URL,
  });
  const result = await abortable(
    firecrawl.search(query, {
      timeout: 15_000,
      limit,
      scrapeOptions: { formats: ['markdown'] },
    }),
    signal,
  );
  const items = result.data ?? [];
  const documents = items.flatMap(item =>
    item.url && item.markdown
      ? [{ url: item.url, content: item.markdown }]
      : [],
  );
  return {
    contents: documents.map(document => document.content),
    urls: documents.map(document => document.url),
    documents,
  };
}

/**
 * Run one search query through the active backend.
 *
 * ChatMock's search is attempted first when it is the active backend, and its
 * two failure modes both hand off to the direct backend rather than returning
 * nothing: a hard rejection (the route's search quota is spent) raises, and a
 * route whose model has no search tool answers from memory and cites no URL,
 * which arrives here as zero results. Neither is a statement about the topic,
 * so treating either as "no sources exist" is what produced empty reports.
 */
export async function searchWeb(
  query: string,
  limit = 5,
  options: SearchOptions = {},
): Promise<SearchResponse> {
  throwIfAborted(options.signal);
  const backend = searchBackend();
  if (backend === 'direct-fetch') {
    return directSearch(query, limit, options.signal);
  }
  if (backend === 'chatmock-web-search') {
    let result: SearchResponse | null = null;
    try {
      result = await chatmockSearch(query, limit, options.signal);
    } catch (error) {
      throwIfAborted(options.signal);
      console.warn(
        `[search] ChatMock web search failed (${error instanceof Error ? error.message : String(error)}); reading the web directly instead.`,
      );
    }
    if (result && result.urls.length > 0) return result;
    throwIfAborted(options.signal);
    if (result) {
      console.warn(
        '[search] ChatMock web search cited no sources; reading the web directly instead.',
      );
    }
    const direct = await directSearch(query, limit, options.signal);
    // Usage from the attempt still counts even when its output did not.
    return result?.usage ? { ...direct, usage: result.usage } : direct;
  }
  if (backend) return firecrawlSearch(query, limit, options.signal);
  throw new Error('No search backend is configured.');
}
