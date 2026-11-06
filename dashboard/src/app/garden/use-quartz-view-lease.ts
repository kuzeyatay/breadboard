"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const HEARTBEAT_MS = 20_000;

interface QuartzViewLeaseState {
  ready: boolean;
  failed: boolean;
}

interface QuartzViewLease extends QuartzViewLeaseState {
  retrying: boolean;
  retry(): Promise<boolean>;
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
): QuartzViewLease {
  const viewId = useRef<string | null>(null);
  const retryRef = useRef<() => Promise<boolean>>(async () => false);
  const [retrying, setRetrying] = useState(false);
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
    let suspended = false, hasLease = serverHeld, failures = 0;
    let heartbeat: number | undefined;
    let controller: AbortController | undefined;
    let running: Promise<boolean> | undefined;
    const renew = (): Promise<boolean> => {
      if (cancelled || suspended) return Promise.resolve(false);
      if (running) return running;
      window.clearTimeout(heartbeat);
      setRetrying(true);
      controller = new AbortController();
      const signal = controller.signal;
      const deadline = window.setTimeout(() => controller?.abort(), 30_000);
      running = (async () => {
        try {
          const response = await fetch("/api/quartz/view-lease", {
            method: "POST", signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ viewId: id }), cache: "no-store",
          });
          if (!response.ok) throw new Error("Garden is unavailable.");
          const body = (await response.json()) as { ok?: unknown };
          if (body.ok !== true) throw new Error("Garden is unavailable.");
          if (cancelled || suspended) return false;
          hasLease = true; failures = 0;
          setLeaseState({ ready: true, failed: false });
          return true;
        } catch {
          if (cancelled || suspended) return false;
          failures++;
          // A missed heartbeat must never remove an already visible reader.
          if (!hasLease) setLeaseState({ ready: false, failed: true });
          return false;
        } finally {
          window.clearTimeout(deadline);
          controller = undefined; running = undefined;
          if (!cancelled) setRetrying(false);
          if (!cancelled && !suspended) heartbeat = window.setTimeout(() => void renew(),
            failures ? Math.min(1_000 * 2 ** Math.min(failures - 1, 4), 10_000) : HEARTBEAT_MS);
        }
      })();
      return running;
    };
    retryRef.current = renew;
    const hide = () => {
      suspended = true;
      window.clearTimeout(heartbeat); controller?.abort();
      // React cleanup does not run on a full page reload. Without pagehide,
      // old holds consume the view limit until their TTL expires.
      release(id);
    };
    const show = (event: PageTransitionEvent) => { if (event.persisted) { suspended = false; void renew(); } };
    const online = () => void renew();
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    window.addEventListener("online", online);
    setLeaseState({ ready: serverHeld, failed: false });
    if (serverHeld) heartbeat = window.setTimeout(() => void renew(), HEARTBEAT_MS);
    else void renew();

    return () => {
      cancelled = true;
      window.clearTimeout(heartbeat); controller?.abort();
      retryRef.current = async () => false;
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      window.removeEventListener("online", online);
      release(id);
    };
  }, [active, initialViewId]);

  const retry = useCallback(() => retryRef.current(), []);
  return { ...leaseState, retrying, retry };
}
