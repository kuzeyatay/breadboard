// Live organization messages.
//
// One background connection per signed-in Crumbs account to the organization
// store's live stream. A signal names only where something changed; the bridge
// then fetches and decrypts that room and adds it to the local transcript, so a
// message is on this machine before anyone opens the Organization page. Pages
// that are open hear about it through `onChange` and refresh at once.
//
// The stream is a hint, never the only path: on every (re)connect the store
// sends `ready` and a full sync catches up on whatever was missed, and the
// page's own refresh keeps working if the connection is down.
import type { Crumbs, OrgSignal } from "./core.ts";
import type { BuzzBridge } from "./buzz-bridge.ts";

export interface OrgListenerOptions {
  crumbs: Pick<Crumbs, "status" | "streamOrgEvents">;
  bridge: Pick<BuzzBridge, "handleSignal">;
  /** Rooms that may have changed for this account; `null` means any of them. */
  onChange: (userId: number, roomIds: number[] | null) => void;
  /** First wait before reconnecting; it doubles up to `maxRetryMs` while the store stays unreachable. */
  retryMs?: number;
  maxRetryMs?: number;
}

export function createOrgListener({ crumbs, bridge, onChange, retryMs = 2_000, maxRetryMs = 60_000 }: OrgListenerOptions) {
  const running = new Map<number, { controller: AbortController; live: boolean }>();

  function start(userId: number): void {
    if (running.has(userId) || !crumbs.status(userId).signedIn) return;
    const entry = { controller: new AbortController(), live: false };
    running.set(userId, entry);
    const { signal } = entry.controller;
    void (async () => {
      let delay = retryMs;
      // Signals are handled one at a time, in order; a burst queues behind the sync in progress.
      let queue: Promise<void> = Promise.resolve();
      const handle = (event: OrgSignal) => {
        if (event.kind === "ready") { entry.live = true; delay = retryMs; }
        queue = queue.then(async () => {
          if (signal.aborted) return;
          const rooms = await bridge.handleSignal(userId, event).catch(() => [] as number[]);
          if (rooms === null || rooms.length) onChange(userId, rooms);
        });
      };
      while (!signal.aborted && crumbs.status(userId).signedIn) {
        try { await crumbs.streamOrgEvents(userId, handle, signal); }
        catch { /* unreachable or refused: wait and try again */ }
        entry.live = false;
        if (signal.aborted) break;
        await new Promise<void>(resolve => { const timer = setTimeout(resolve, delay); signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); });
        delay = Math.min(delay * 2, maxRetryMs);
      }
      if (running.get(userId) === entry) running.delete(userId);
    })();
  }

  function stop(userId: number): void {
    running.get(userId)?.controller.abort();
    running.delete(userId);
  }

  return {
    start,
    stop,
    stopAll: () => { for (const userId of [...running.keys()]) stop(userId); },
    /** Connected and caught up: the page need not ask the store itself. */
    isLive: (userId: number) => running.get(userId)?.live === true,
  };
}
export type OrgListener = ReturnType<typeof createOrgListener>;
