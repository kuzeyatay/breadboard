"use client";

// Minimal GBrain knowledge-status indicator for authenticated Garden Chat and the
// AI Terminal. Shows healthy / lexical-degraded / indexing / stale / unavailable
// and offers a reindex action for the garden owner. Renders nothing when GBrain
// is disabled (no palette clutter). It NEVER shows secrets, URLs, absolute paths,
// internal source ids, or stack traces — it consumes only /api/gbrain/status.

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
  healthy: { text: "Knowledge: hybrid", tone: "#16a34a", title: "GBrain hybrid retrieval is healthy." },
  degraded: { text: "Knowledge: keyword-only", tone: "#d97706", title: "GBrain is running in lexical-degraded mode (no embeddings)." },
  indexing: { text: "Knowledge: indexing…", tone: "#2563eb", title: "GBrain is indexing this garden." },
  stale: { text: "Knowledge: stale", tone: "#d97706", title: "This garden's index is stale; a reindex is recommended." },
  unavailable: { text: "Knowledge: unavailable", tone: "#dc2626", title: "GBrain retrieval is unavailable right now." },
};

export default function GBrainStatusBadge({ gardenSlug, canReindex }: Props) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [busy, setBusy] = useState(false);

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

  if (!status || status.state === "disabled") return null;

  // Derive the display key: sync state can promote to indexing/stale.
  const syncStatus = status.sync?.status;
  let key: string = status.state ?? "unavailable";
  if (status.state !== "unavailable") {
    if (syncStatus === "syncing" || syncStatus === "pending") key = "indexing";
    else if (syncStatus === "stale" || syncStatus === "failed") key = "stale";
  }
  const label = LABEL[key] ?? LABEL.unavailable;
  const showReindex = canReindex && gardenSlug && (key === "stale" || key === "unavailable" || status.state === "degraded");

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
