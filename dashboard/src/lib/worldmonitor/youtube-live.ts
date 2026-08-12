// Finding what a channel is streaming right now.
//
// Upstream worldmonitor ships a fallback video id per channel and resolves the
// CURRENT one through its own service, because broadcasters restart their 24/7
// streams and every restart mints a new id — a hardcoded id is not wrong so
// much as perishable, and a stale one renders as "video unavailable".
//
// There is no API key here, and there does not need to be one: a channel's
// `/live` page redirects to whatever it is streaming, and says so in its
// canonical link. Reading that from the server also keeps YouTube off the
// browser's request path until the reader actually opens a tile.

const LIVE_TTL_MS = 10 * 60 * 1000;
/** A channel that is simply off air should not be re-fetched every render. */
const MISS_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;

// Without a desktop UA YouTube serves a consent interstitial with no canonical.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

interface Entry {
  videoId: string | null;
  at: number;
}

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<string | null>>();

/** `@handle` → canonical handle, or null when it is not one. */
export function normalizeHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^@[A-Za-z0-9._-]{2,60}$/.test(trimmed) ? trimmed : null;
}

function extractVideoId(html: string): string | null {
  // The canonical link is the reliable one: when a channel is live it points at
  // the watch page, and when it is not it points back at the channel.
  const canonical = /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i.exec(html)?.[1];
  const fromCanonical = canonical ? /[?&]v=([A-Za-z0-9_-]{11})/.exec(canonical)?.[1] : null;
  if (fromCanonical) return fromCanonical;

  // Some channels serve the player payload before the canonical tag; the first
  // videoId in it is the one the page is about to play.
  const fromPayload = /"videoId":"([A-Za-z0-9_-]{11})"/.exec(html)?.[1];
  return fromPayload ?? null;
}

async function fetchLiveId(handle: string): Promise<string | null> {
  try {
    const response = await fetch(`https://www.youtube.com/${handle}/live`, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;
    return extractVideoId(await response.text());
  } catch {
    return null;
  }
}

/** The channel's current live video id, or null when it is off air. */
export async function resolveLiveId(handle: string): Promise<string | null> {
  const cached = cache.get(handle);
  if (cached) {
    const ttl = cached.videoId ? LIVE_TTL_MS : MISS_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.videoId;
  }

  const existing = inFlight.get(handle);
  if (existing) return existing;

  const promise = fetchLiveId(handle)
    .then((videoId) => {
      cache.set(handle, { videoId, at: Date.now() });
      return videoId;
    })
    .finally(() => inFlight.delete(handle));

  inFlight.set(handle, promise);
  return promise;
}

/** Resolve several channels at once, a few at a time. */
export async function resolveLiveIds(
  handles: string[],
  concurrency = 4,
): Promise<Record<string, string | null>> {
  const unique = [...new Set(handles)];
  const out: Record<string, string | null> = {};
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, unique.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= unique.length) return;
      const handle = unique[index]!;
      out[handle] = await resolveLiveId(handle);
    }
  });

  await Promise.all(workers);
  return out;
}
