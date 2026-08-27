// Compatibility hook for callers that used to start an always-on Next.js
// interval. Runtime V2 replaces that timer with a bounded one-shot submission
// kick; the Rust runtime owns every resulting disposable indexing worker.

import { resolveGBrainConfig } from "./config.ts";
import { kickQueuedGBrainSyncJobs } from "./sync.ts";

type Kick = () => Promise<unknown>;

const globalWithKick = global as typeof globalThis & {
  __gbrainRuntimeKick?: Promise<void>;
};

/**
 * Submit queued durable rows once. Safe to call repeatedly and intentionally
 * retains no timer, garden graph, adapter payload, or worker process.
 */
export function ensureSyncWorkerStarted(
  kick: Kick = () => kickQueuedGBrainSyncJobs(),
): void {
  if (resolveGBrainConfig().mode === "disabled") return;
  if (globalWithKick.__gbrainRuntimeKick) return;
  globalWithKick.__gbrainRuntimeKick = Promise.resolve()
    .then(kick)
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      delete globalWithKick.__gbrainRuntimeKick;
    });
}
