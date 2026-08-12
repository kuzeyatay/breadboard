// Fetching and parsing the feed catalog.
//
// Upstream worldmonitor fetches from the browser and therefore needs a CORS
// proxy and a DOMParser. Here the fetch happens in the Next server, so the
// publisher URL is used directly and the XML is read by the small RSS/Atom
// reader below rather than by pulling in a parser dependency.
//
// Feeds are cached per source with a TTL, and a source that fails twice goes
// into a cooldown — upstream's behaviour, and the thing that keeps one dead
// publisher from costing every refresh a timeout.

import type { Feed } from "./feeds.ts";

const CACHE_TTL_MS = 10 * 60 * 1000;
const FEED_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_FAILURES = 2;
const FETCH_TIMEOUT_MS = 8000;
const MAX_ITEMS_PER_FEED = 40;

const USER_AGENT =
  "Mozilla/5.0 (compatible; breadboard-worldmonitor/1.0; +https://github.com/koala73/worldmonitor)";

export interface RawItem {
  title: string;
  link: string;
  published: Date;
  /** The feed carried no usable date, so `published` is arrival time. */
  publishedMissing: boolean;
  summary: string;
}

export interface FeedResult {
  feed: Feed;
  items: RawItem[];
  cached: boolean;
  fetchedAt: number;
  error?: string;
}

interface CacheEntry {
  items: RawItem[];
  fetchedAt: number;
}

const feedCache = new Map<string, CacheEntry>();
const feedFailures = new Map<string, { count: number; cooldownUntil: number }>();
const inFlight = new Map<string, Promise<FeedResult>>();

// ── XML reading ─────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function stripCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

/**
 * Entities are decoded BEFORE tags are stripped as well as after: a feed that
 * escapes its markup (`&lt;p&gt;…`) would otherwise survive the tag strip and
 * decode into visible `<p>` in the summary.
 */
function cleanText(value: string): string {
  const decoded = decodeEntities(stripCdata(value));
  return decodeEntities(stripTags(decoded)).replace(/\s+/g, " ").trim();
}

/** First `<tag>` in `block`, namespace-tolerant (`dc:date` matches `date`). */
function tagText(block: string, tag: string): string | null {
  const re = new RegExp(
    `<(?:[a-z0-9]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-z0-9]+:)?${tag}>`,
    "i",
  );
  const match = re.exec(block);
  return match ? cleanText(match[1]!) : null;
}

/** Atom links are attributes, not text; prefer rel="alternate". */
function linkOf(block: string): string {
  const text = tagText(block, "link");
  if (text && /^https?:/i.test(text)) return text;

  const hrefs = [...block.matchAll(/<link\b([^>]*)>/gi)].map((m) => m[1]!);
  const alternate = hrefs.find((attrs) => /rel=["']?alternate/i.test(attrs));
  const chosen = alternate ?? hrefs[0];
  const href = chosen ? /href=["']([^"']+)["']/i.exec(chosen)?.[1] : null;
  if (href) return decodeEntities(href);

  return tagText(block, "guid") ?? "";
}

function parseDate(block: string): { date: Date; missing: boolean } {
  for (const tag of ["pubDate", "published", "updated", "date", "modified"]) {
    const raw = tagText(block, tag);
    if (!raw) continue;
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return { date: parsed, missing: false };
  }
  // Upstream tracks this rather than defaulting silently: an item stamped with
  // arrival time must not be presented as "1 minute ago" breaking news.
  return { date: new Date(), missing: true };
}

export function parseFeedXml(xml: string): RawItem[] {
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ].map((match) => match[1]!);

  const items: RawItem[] = [];
  for (const block of blocks.slice(0, MAX_ITEMS_PER_FEED)) {
    const title = tagText(block, "title");
    if (!title) continue;

    const { date, missing } = parseDate(block);
    const summary =
      tagText(block, "description") ??
      tagText(block, "summary") ??
      tagText(block, "content") ??
      "";

    items.push({
      title,
      link: linkOf(block),
      published: date,
      publishedMissing: missing,
      summary: summary.slice(0, 600),
    });
  }
  return items;
}

// ── Fetching ────────────────────────────────────────────────────────────────

function noteFailure(name: string): void {
  const current = feedFailures.get(name) ?? { count: 0, cooldownUntil: 0 };
  current.count += 1;
  if (current.count >= MAX_FAILURES) {
    current.cooldownUntil = Date.now() + FEED_COOLDOWN_MS;
    current.count = 0;
  }
  feedFailures.set(name, current);
}

function inCooldown(name: string): boolean {
  const failure = feedFailures.get(name);
  return Boolean(failure && failure.cooldownUntil > Date.now());
}

async function fetchFeed(feed: Feed): Promise<FeedResult> {
  const cached = feedCache.get(feed.name);
  const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
  if (fresh) {
    return { feed, items: cached.items, cached: true, fetchedAt: cached.fetchedAt };
  }

  if (inCooldown(feed.name)) {
    return {
      feed,
      items: cached?.items ?? [],
      cached: true,
      fetchedAt: cached?.fetchedAt ?? 0,
      error: "source in cooldown after repeated failures",
    };
  }

  try {
    const response = await fetch(feed.url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const items = parseFeedXml(await response.text());
    if (items.length === 0) throw new Error("no items in feed");

    const entry: CacheEntry = { items, fetchedAt: Date.now() };
    feedCache.set(feed.name, entry);
    feedFailures.delete(feed.name);
    return { feed, items, cached: false, fetchedAt: entry.fetchedAt };
  } catch (error) {
    noteFailure(feed.name);
    // Stale beats empty: a source that just timed out still has yesterday's
    // reporting, and the panel says which sources are stale.
    return {
      feed,
      items: cached?.items ?? [],
      cached: true,
      fetchedAt: cached?.fetchedAt ?? 0,
      error: error instanceof Error ? error.message : "fetch failed",
    };
  }
}

/** One in-flight request per source, however many panels asked for it. */
export function loadFeed(feed: Feed): Promise<FeedResult> {
  const existing = inFlight.get(feed.name);
  if (existing) return existing;

  const promise = fetchFeed(feed).finally(() => inFlight.delete(feed.name));
  inFlight.set(feed.name, promise);
  return promise;
}

/** Fetch a set of feeds with a concurrency ceiling. */
export async function loadFeeds(feeds: Feed[], concurrency = 8): Promise<FeedResult[]> {
  const results: FeedResult[] = new Array(feeds.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, feeds.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= feeds.length) return;
      results[index] = await loadFeed(feeds[index]!);
    }
  });

  await Promise.all(workers);
  return results;
}

/** True when this source has usable cached items — used to bias rotation. */
export function hasCached(feedName: string): boolean {
  return feedCache.has(feedName);
}
