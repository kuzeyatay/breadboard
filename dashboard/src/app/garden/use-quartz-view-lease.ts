"use client";

import { useEffect, useRef, useState } from "react";

const HEARTBEAT_MS = 20_000;

interface QuartzViewLeaseState {
  ready: boolean;
  failed: boolean;
}

function release(viewId: string): void {
  void fetch("/api/quartz/view-lease", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ viewId }),
    cache: "no-store",
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * Hold the Quartz view lease while a frame is mounted.
 *
 * `initialViewId` is the hold the Server Component already took during the
 * page render (see `openQuartzViewLease`). With it, the frame is ready on
 * first paint and this hook only heartbeats; the page never shows a loading
 * state of its own because the global navigation bar covered the wait.
 * Without it, the hook acquires from the browser as a fallback.
 */
export function useQuartzViewLease(
  active = true,
  initialViewId: string | null = null,
): QuartzViewLeaseState {
  const viewId = useRef<string | null>(null);
  const [leaseState, setLeaseState] = useState<QuartzViewLeaseState>({
    ready: Boolean(initialViewId),
    failed: false,
  });

  if (initialViewId) {
    viewId.current = initialViewId;
  } else if (viewId.current === null && typeof crypto !== "undefined") {
    viewId.current = crypto.randomUUID();
  }

  useEffect(() => {
    const id = initialViewId ?? viewId.current;
    const serverHeld = Boolean(initialViewId);
    if (!active || !id) {
      setLeaseState({ ready: false, failed: false });
      return;
    }

    let cancelled = false;
    let heartbeat: number | null = null;

    const renew = async (initial: boolean) => {
      try {
        const response = await fetch("/api/quartz/view-lease", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ viewId: id }),
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Quartz is unavailable.");
        const body = (await response.json()) as { ok?: unknown };
        if (body.ok !== true) throw new Error("Quartz is unavailable.");
        if (!cancelled) setLeaseState({ ready: true, failed: false });
      } catch {
        if (!cancelled && initial) setLeaseState({ ready: false, failed: true });
      }
    };

    setLeaseState({ ready: serverHeld, failed: false });
    if (serverHeld) {
      // The server already holds this view; the first renewal is only a
      // heartbeat, so a transient failure must not blank a visible frame.
      heartbeat = window.setInterval(() => void renew(false), HEARTBEAT_MS);
    } else {
      void renew(true).then(() => {
        if (cancelled) {
          release(id);
          return;
        }
        heartbeat = window.setInterval(() => void renew(false), HEARTBEAT_MS);
      });
    }

    return () => {
      cancelled = true;
      if (heartbeat !== null) window.clearInterval(heartbeat);
      release(id);
    };
  }, [active, initialViewId]);

  return leaseState;
}
