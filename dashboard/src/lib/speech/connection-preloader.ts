type Connection = { close(): Promise<void>; isHealthy(): boolean };
type Entry<T> = {
  key: string; mode: string; controller: AbortController; promise: Promise<T>;
  connection?: T; leased: boolean; expires: number; connectedAt?: number; proven?: boolean;
  idleTimer?: ReturnType<typeof setTimeout>;
};

/** First retry delay after a failed warm-up; each further failure doubles it. */
const RETRY_BASE_MS = 30_000;
/** Never wait longer than this between warm-up attempts. */
const RETRY_MAX_MS = 15 * 60_000;
/** A warm connection that dies this soon after connecting counts as a failure. */
const SHORT_LIVED_MS = 60_000;
/** Brief reuse after actual speech must not become an all-night connection. */
const REUSE_IDLE_MS = 20_000;

/** Own idle connections separately from callers, so closing a view cannot
 * cancel a handoff and speculative work cannot exhaust the session limit. */
export function createConnectionPreloader<T extends Connection>(
  connect: (mode: string, signal: AbortSignal) => Promise<T>,
  now = Date.now,
) {
  const entries = new Map<string, Entry<T>>();
  const leases = new WeakMap<T, Entry<T>>();
  let key = '', modes: readonly string[] = [], retryAt = 0;
  let allowWarm = true;
  let retirement = Promise.resolve();
  // Every warm-up opens a metered realtime session on the signed-in account,
  // so a warm-up that keeps failing must not be retried on a fixed 30 s clock:
  // one bad night of that drained a whole 5-hour plan window with nobody
  // speaking. Consecutive failures double the wait, up to RETRY_MAX_MS.
  let failures = 0;

  function noteFailure() {
    failures += 1;
    retryAt = now() + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failures - 1));
  }

  function retire(entry: Entry<T>) {
    clearTimeout(entry.idleTimer);
    if (entries.get(entry.mode) === entry) entries.delete(entry.mode);
    entry.controller.abort();
    const closing = entry.promise.then(value => value.close(), () => {});
    retirement = Promise.all([retirement, closing]).then(() => {});
    return closing;
  }

  function invalidate(nextKey: string) {
    if (key === nextKey) return;
    key = nextKey;
    retryAt = 0;
    failures = 0;
    for (const entry of entries.values()) if (!entry.leased) retire(entry);
  }

  function start(mode: string) {
    const controller = new AbortController();
    const entry: Entry<T> = {
      key, mode, controller, leased: false, expires: now() + 5 * 60_000,
      promise: retirement.then(() => {
        controller.signal.throwIfAborted();
        return connect(mode, controller.signal);
      }),
    };
    entries.set(mode, entry);
    void entry.promise.then(connection => { entry.connection = connection; entry.connectedAt = now(); }, () => {
      if (!entry.leased && entries.get(mode) === entry) entries.delete(mode);
      if (!controller.signal.aborted) noteFailure();
    });
    return entry;
  }

  function warm() {
    for (const entry of entries.values()) {
      if (entry.leased) continue;
      const unhealthy = entry.connection?.isHealthy() === false;
      if (unhealthy && entry.connectedAt !== undefined && now() - entry.connectedAt < SHORT_LIVED_MS) noteFailure();
      else if (!entry.proven && entry.connection && entry.connectedAt !== undefined && now() - entry.connectedAt >= SHORT_LIVED_MS) {
        // One connection that lasted is proof the account and transport work
        // again; the next failure starts the backoff from the beginning.
        entry.proven = true;
        failures = 0;
      }
      if (entry.expires <= now() || unhealthy || !modes.includes(entry.mode)) retire(entry);
    }
    if (!allowWarm || !key || now() < retryAt) return;
    for (const mode of modes) {
      if (entries.has(mode)) continue;
      start(mode);
    }
  }

  return {
    configure(nextKey: string, nextModes: readonly string[], idle = true) {
      modes = nextModes;
      allowWarm = idle;
      invalidate(nextKey);
      warm();
      return retirement;
    },
    invalidate,
    warm,
    settled() { return retirement; },
    has(mode: string) { return Boolean(key) && modes.includes(mode) && !entries.get(mode)?.leased; },
    async take(mode: string, signal?: AbortSignal): Promise<T | undefined> {
      for (let attempt = 0; attempt < 2; attempt++) {
        signal?.throwIfAborted();
        if (!key || !modes.includes(mode)) return undefined;
        let entry = entries.get(mode);
        if (entry?.leased) return undefined;
        if (entry && (entry.key !== key || entry.expires <= now() || entry.connection?.isHealthy() === false)) {
          retire(entry);
          entry = undefined;
        }
        entry ??= start(mode);
        clearTimeout(entry.idleTimer);
        // Reserve cold replacements too, before the background timer can refill.
        entry.leased = true;
        const selected = entry;
        const abort = () => retire(selected);
        signal?.addEventListener('abort', abort, { once: true });
        try {
          const connection = await selected.promise;
          signal?.throwIfAborted();
          if (selected.key !== key || !connection.isHealthy()) throw new Error('The prepared voice connection expired.');
          leases.set(connection, selected);
          return connection;
        } catch (error) {
          await retire(selected);
          signal?.throwIfAborted();
          if (attempt === 1) throw error;
        } finally { signal?.removeEventListener('abort', abort); }
      }
    },
    async release(connection: T, reusable = false) {
      const entry = leases.get(connection);
      leases.delete(connection);
      if (entry && reusable && entry.key === key && modes.includes(entry.mode) &&
          entry.expires > now() && connection.isHealthy() && !entry.controller.signal.aborted) {
        entry.leased = false;
        entry.expires = Math.min(entry.expires, now() + REUSE_IDLE_MS);
        entry.idleTimer = setTimeout(() => { if (!entry.leased) retire(entry); }, Math.max(0, entry.expires - now()));
        return;
      }
      // A conversation can release its reader while it is itself retiring.
      // Await this lease only: the global barrier may already include the
      // parent close that is waiting for us. New connections still await that
      // full barrier in start(), preserving the provider's slot limit.
      if (entry) await retire(entry);
      else await connection.close();
    },
    clear() {
      modes = [];
      invalidate('');
      return retirement;
    },
  };
}
