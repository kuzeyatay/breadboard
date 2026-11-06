type Options = {
  select(signal: AbortSignal): Promise<boolean>;
  prepare(signal: AbortSignal): Promise<boolean>;
  clear(): Promise<void>;
  blocked(): boolean;
  reserve(): () => void;
  now?: () => number;
};

/** Maintain one microphone-free input transport, with bounded retries. Standby
 * yields to actual voice activity without taking microphone/audio focus. */
export function createDictationStandby(options: Options) {
  const now = options.now ?? Date.now;
  let closed = false, enabled: boolean | undefined;
  let controller: AbortController | undefined, pending: Promise<void> | undefined;
  let cleanup = Promise.resolve(), release: (() => void) | undefined;
  let failures = 0, retryAt = 0, healthySince: number | undefined;
  const clear = () => cleanup = Promise.all([cleanup, options.clear()]).then(() => {}, () => {});
  async function sync(): Promise<void> {
    if (closed) return;
    if (options.blocked()) {
      controller?.abort(); healthySince = undefined;
      await clear(); return;
    }
    if (pending) return pending;
    if (enabled === false || now() < retryAt) return;
    const attempt = new AbortController(); controller = attempt;
    pending = (async () => {
      try {
        await cleanup; attempt.signal.throwIfAborted();
        const selected = enabled ?? await options.select(attempt.signal);
        attempt.signal.throwIfAborted();
        enabled = selected;
        if (!enabled) { await clear(); release?.(); release = undefined; return; }
        release ??= options.reserve();
        if (options.blocked()) return;
        const ready = await options.prepare(attempt.signal);
        attempt.signal.throwIfAborted();
        if (ready) {
          healthySince ??= now();
          // A briefly connected but repeatedly failing service must not churn
          // through metered sessions. Reset backoff only after a stable minute.
          if (now() - healthySince >= 60_000) failures = 0;
        } else healthySince = undefined;
      } catch {
        healthySince = undefined;
        if (!attempt.signal.aborted) {
          // Disabled speech and signed-out settings reject selection. They
          // must not keep reserving an idle slot after the old cache closes.
          if (enabled === undefined) { await clear(); release?.(); release = undefined; }
          failures++;
          retryAt = now() + Math.min(15 * 60_000, 30_000 * 2 ** (failures - 1));
        }
      } finally { if (controller === attempt) controller = undefined; }
    })();
    try { await pending; } finally { pending = undefined; }
  }
  return {
    sync,
    async invalidate() {
      controller?.abort(); enabled = undefined; failures = 0; retryAt = 0; healthySince = undefined;
      await clear(); await pending; await sync();
    },
    async close() {
      closed = true; controller?.abort();
      await clear(); await pending;
      release?.(); release = undefined;
    },
  };
}
