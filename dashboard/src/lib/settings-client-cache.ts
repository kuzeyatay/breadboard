/**
 * Short-lived, renderer-only cache for the Settings overview.
 *
 * These endpoints proxy local services and can take noticeably longer than the
 * panel itself takes to render. Their payloads may describe configured accounts,
 * so they deliberately stay in memory instead of localStorage or Cache Storage.
 */

export const SETTINGS_CACHE_TTL_MS = 5 * 60_000;

export const SETTINGS_OVERVIEW_URLS = [
  "/api/chatmock/account",
  "/api/chatmock/accounts",
  "/api/cliproxy/status",
  "/api/chatmock/providers",
] as const;

interface CachedResponseSnapshot {
  body: string;
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  expiresAt: number;
}

const snapshots = new Map<string, CachedResponseSnapshot>();
const requests = new Map<string, Promise<CachedResponseSnapshot>>();
let cacheGeneration = 0;

function responseFromSnapshot(snapshot: CachedResponseSnapshot): Response {
  return new Response(snapshot.body, {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers,
  });
}

async function readSettingsResponse(
  url: string,
  maxAgeMs: number,
  requestGeneration: number,
): Promise<CachedResponseSnapshot> {
  const response = await fetch(url, { cache: "no-store" });
  const headers: Array<[string, string]> = [];
  response.headers.forEach((value, key) => headers.push([key, value]));
  const snapshot: CachedResponseSnapshot = {
    body: await response.text(),
    status: response.status,
    statusText: response.statusText,
    headers,
    expiresAt: Date.now() + maxAgeMs,
  };
  // A transient service error must not make Settings look broken for five
  // minutes. Concurrent readers still share the failed request below.
  if (response.ok && requestGeneration === cacheGeneration) {
    snapshots.set(url, snapshot);
  }
  return snapshot;
}

export async function fetchCachedSettings(
  url: string,
  options: { force?: boolean; maxAgeMs?: number } = {},
): Promise<Response> {
  const force = options.force === true;
  const maxAgeMs = options.maxAgeMs ?? SETTINGS_CACHE_TTL_MS;
  if (force) invalidateSettingsCache(url);

  const cached = snapshots.get(url);
  if (!force && cached && cached.expiresAt > Date.now()) {
    return responseFromSnapshot(cached);
  }

  const existing = force ? undefined : requests.get(url);
  let pending = existing;
  if (!pending) {
    const request = readSettingsResponse(url, maxAgeMs, cacheGeneration);
    const clearRequest = () => {
      if (requests.get(url) === request) requests.delete(url);
    };
    void request.then(clearRequest, clearRequest);
    pending = request;
    requests.set(url, request);
  }
  return responseFromSnapshot(await pending);
}

/** Remove exact URLs and their query-string variants. No arguments clears all. */
export function invalidateSettingsCache(...urls: string[]): void {
  cacheGeneration += 1;
  if (urls.length === 0) {
    snapshots.clear();
    return;
  }
  for (const key of snapshots.keys()) {
    if (urls.some((url) => key === url || key.startsWith(`${url}?`))) {
      snapshots.delete(key);
    }
  }
}

/** Warm only the default overview; other tabs remain lazy until first opened. */
export async function preloadSettingsOverview(): Promise<void> {
  await Promise.allSettled(
    SETTINGS_OVERVIEW_URLS.map((url) => fetchCachedSettings(url)),
  );
}
