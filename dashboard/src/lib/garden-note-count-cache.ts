/**
 * Note counts for the Garden cards (DATA-01).
 *
 * Counting walks a Garden's whole directory tree. The dashboard draws three
 * lists — your Gardens, public Gardens, organization Gardens — and a Garden in
 * more than one of them used to be walked once per list, on every single read.
 *
 * A count is a figure on a card, so a recently taken one is reused. Writers in
 * this process invalidate the Garden they changed; the freshness window is the
 * reconciliation path for writers that are not in this process at all (Runtime
 * workers write Garden files directly).
 */

export const NOTE_COUNT_FRESHNESS_MS = 10_000;
/** Gardens are few; the bound only stops an unbounded slug space from growing. */
const MAX_ENTRIES = 256;

interface CountEntry {
  count: number;
  countedAt: number;
}

const counts = new Map<string, CountEntry>();
const pendingCounts = new Map<string, Promise<number>>();

/** A launcher can show a recent count without walking any directories. */
export function readCachedGardenNoteCount(contentPath: string, slug: string): number | null {
  return counts.get(cacheKey(contentPath, slug))?.count ?? null;
}

function storeCount(key: string, count: number, countedAt: number): void {
  counts.set(key, { count, countedAt });
  while (counts.size > MAX_ENTRIES) {
    const oldest = counts.keys().next().value;
    if (typeof oldest !== "string") break;
    counts.delete(oldest);
  }
}

/** Refresh off the rendering path, sharing concurrent reads of one Garden. */
export async function cachedGardenNoteCountAsync(
  contentPath: string,
  slug: string,
  count: () => Promise<number>,
  options: { now?: () => number; freshnessMs?: number; staleWhileRevalidate?: boolean } = {},
): Promise<number> {
  const now = options.now ?? Date.now;
  const key = cacheKey(contentPath, slug);
  const entry = counts.get(key);
  if (entry && now() - entry.countedAt <= (options.freshnessMs ?? NOTE_COUNT_FRESHNESS_MS)) return entry.count;
  const pending = pendingCounts.get(key);
  if (pending) return options.staleWhileRevalidate && entry ? entry.count : pending;
  const work = Promise.resolve().then(count).then(value => {
    // A write or a newer synchronous count can invalidate this walk in flight.
    if (pendingCounts.get(key) === work) storeCount(key, value, now());
    return value;
  }).finally(() => {
    if (pendingCounts.get(key) === work) pendingCounts.delete(key);
  });
  pendingCounts.set(key, work);
  if (options.staleWhileRevalidate && entry) {
    // Keep the last real count on the card while an external writer's changes
    // are reconciled. A failed refresh retains it and permits the next retry.
    void work.catch(() => undefined);
    return entry.count;
  }
  return work;
}

function cacheKey(contentPath: string, slug: string): string {
  return `${contentPath}\u0000${slug}`;
}

/**
 * The Garden's note count, counted at most once per freshness window.
 * `count` performs the real walk and is only called when needed.
 */
export function cachedGardenNoteCount(
  contentPath: string,
  slug: string,
  count: () => number,
  options: { now?: () => number; freshnessMs?: number } = {},
): number {
  const now = options.now ?? Date.now;
  const freshnessMs = options.freshnessMs ?? NOTE_COUNT_FRESHNESS_MS;
  const key = cacheKey(contentPath, slug);
  const entry = counts.get(key);
  if (entry && now() - entry.countedAt <= freshnessMs) return entry.count;

  const counted = count();
  pendingCounts.delete(key);
  storeCount(key, counted, now());
  return counted;
}

/** Drop one Garden's count after this process changes its files, or all of them. */
export function invalidateGardenNoteCount(slug?: string): void {
  if (slug === undefined) {
    counts.clear();
    pendingCounts.clear();
    return;
  }
  const suffix = `\u0000${slug}`;
  for (const key of counts.keys()) {
    if (key.endsWith(suffix)) counts.delete(key);
  }
  for (const key of pendingCounts.keys()) {
    if (key.endsWith(suffix)) pendingCounts.delete(key);
  }
}
