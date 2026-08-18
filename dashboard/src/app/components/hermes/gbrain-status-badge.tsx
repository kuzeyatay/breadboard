"use client";

// Minimal GBrain knowledge-status indicator for authenticated Garden Chat and the
// AI Terminal. Shows healthy / lexical-degraded / indexing / stale / unavailable
// and offers a reindex action for the garden owner. Renders nothing when GBrain
// is disabled (no palette clutter). It NEVER shows secrets, URLs, absolute paths,
// internal source ids, or stack traces — it consumes only /api/gbrain/status.
//
// The polling and state derivation live in `useGBrainStatus` so a surface with no
// room for a worded badge can read the same state and say it some other way. The
// Terminal does exactly that: its header dot turns red, and nothing is written.

import { useCallback, useEffect, useState } from "react";

type State = "disabled" | "unavailable" | "degraded" | "healthy";

interface StatusResponse {
  state?: State;
  backend?: "gbrain" | "fake" | null;
  mode?: "hybrid" | "lexical_degraded" | null;
  sync?: { status?: string } | null;
}

interface Props {
  gardenSlug?: string;
  /** Whether the current user can trigger a reindex (garden owner). */
  canReindex?: boolean;
}

const LABEL: Record<string, { text: string; tone: string; title: string }> = {
  degraded: { text: "Knowledge: keyword-only", tone: "#d97706", title: "GBrain is running in lexical-degraded mode (no embeddings)." },
  indexing: { text: "Knowledge: indexing…", tone: "#2563eb", title: "GBrain is indexing this garden." },
  stale: { text: "Knowledge: stale", tone: "#d97706", title: "This garden's index is stale; a reindex is recommended." },
  unavailable: { text: "Knowledge: unavailable", tone: "#dc2626", title: "GBrain retrieval is unavailable right now." },
};

export interface GBrainStatusView {
  /** Raw state from /api/gbrain/status; null until the first reply lands. */
  state: State | null;
  /**
   * Display key: healthy / degraded / indexing / stale / unavailable, or null
   * while unknown and when GBrain is disabled — a null key means "say nothing".
   */
  key: string | null;
  refresh: () => Promise<void>;
}

/** Polls the safe status endpoint and derives the one key a surface should show. */
export function useGBrainStatus(gardenSlug?: string): GBrainStatusView {
  const [status, setStatus] = useState<StatusResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      const url = gardenSlug
        ? `/api/gbrain/status?gardenId=${encodeURIComponent(gardenSlug)}`
        : "/api/gbrain/status";
      const res = await fetch(url);
      if (!res.ok) return;
      setStatus((await res.json()) as StatusResponse);
    } catch {
      /* leave last state */
    }
  }, [gardenSlug]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!status || status.state === "disabled") {
    return { state: status?.state ?? null, key: null, refresh };
  }

  // Derive the display key: sync state can promote to indexing/stale.
  const syncStatus = status.sync?.status;
  let key: string = status.state ?? "unavailable";
  if (status.state !== "unavailable") {
    if (syncStatus === "syncing" || syncStatus === "pending") key = "indexing";
    else if (syncStatus === "stale" || syncStatus === "failed") key = "stale";
  }
  return { state: status.state ?? "unavailable", key, refresh };
}

export default function GBrainStatusBadge({ gardenSlug, canReindex }: Props) {
  const { state, key, refresh } = useGBrainStatus(gardenSlug);
  const [busy, setBusy] = useState(false);

  const reindex = useCallback(async () => {
    if (!gardenSlug || busy) return;
    setBusy(true);
    try {
      await fetch("/api/gbrain/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gardenId: gardenSlug }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [gardenSlug, busy, refresh]);

  // A null key is GBrain disabled or not yet answered: nothing to say.
  if (!key) return null;
  // Healthy knowledge retrieval is the normal state, so it does not need to
  // occupy persistent header space. Keep displaying actionable/degraded states.
  if (key === "healthy") return null;
  const label = LABEL[key] ?? LABEL.unavailable;
  const showReindex = canReindex && gardenSlug && (key === "stale" || key === "unavailable" || state === "degraded");

  return (
    <span
      title={label.title}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: label.tone }}
    >
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: label.tone, display: "inline-block" }} />
      {label.text}
      {showReindex ? (
        <button
          type="button"
          onClick={reindex}
          disabled={busy}
          style={{
            marginLeft: 4,
            fontSize: 11,
            padding: "1px 6px",
            borderRadius: 6,
            border: `1px solid ${label.tone}`,
            background: "transparent",
            color: label.tone,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "Reindexing…" : "Reindex"}
        </button>
      ) : null}
    </span>
  );
}
