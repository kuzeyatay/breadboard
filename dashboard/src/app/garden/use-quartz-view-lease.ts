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

export function useQuartzViewLease(active = true): QuartzViewLeaseState {
  const viewId = useRef<string | null>(null);
  const [leaseState, setLeaseState] = useState<QuartzViewLeaseState>({
    ready: false,
    failed: false,
  });

  if (viewId.current === null && typeof crypto !== "undefined") {
    viewId.current = crypto.randomUUID();
  }

  useEffect(() => {
    const id = viewId.current;
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

    setLeaseState({ ready: false, failed: false });
    void renew(true).then(() => {
      if (cancelled) {
        release(id);
        return;
      }
      heartbeat = window.setInterval(() => void renew(false), HEARTBEAT_MS);
    });

    return () => {
      cancelled = true;
      if (heartbeat !== null) window.clearInterval(heartbeat);
      release(id);
    };
  }, [active]);

  return leaseState;
}
