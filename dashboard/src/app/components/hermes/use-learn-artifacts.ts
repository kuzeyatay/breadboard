"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LearnArtifact } from "@/lib/learn-artifacts";

export const LEARN_ARTIFACTS_CHANGED_EVENT = "breadboard:learn-artifacts-changed";
export const artifactVersionKey = (item: { id: string; version: number }) => `${item.id}:v${item.version}`;
type Selection = Omit<LearnArtifact, "content">;

export function useLearnArtifacts(gardenSlug?: string | null) {
  const [artifacts, setArtifacts] = useState<Selection[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  const url = gardenSlug ? `/api/gardens/${encodeURIComponent(gardenSlug)}/learn/artifacts` : null;
  useEffect(() => {
    setArtifacts([]);
    setLoaded(false);
    setBusy(null);
    setError(null);
    if (!url) return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load Learn artifacts.");
        if (!controller.signal.aborted) { setArtifacts(body.artifacts); setLoaded(true); setError(null); }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load Learn artifacts.");
      }
    };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.gardenSlug === gardenSlug) { setArtifacts(detail.artifacts); setLoaded(true); setError(null); }
    };
    void refresh();
    window.addEventListener(LEARN_ARTIFACTS_CHANGED_EVENT, changed);
    return () => { controller.abort(); mutation.current?.abort(); mutation.current = null; window.removeEventListener(LEARN_ARTIFACTS_CHANGED_EVENT, changed); };
  }, [url, gardenSlug, revision]);
  const toggle = useCallback(async (artifact: { id: string; version: number; conversationId: string }) => {
    if (!url || mutation.current || !loaded) return;
    const controller = new AbortController();
    mutation.current = controller;
    const key = artifactVersionKey(artifact);
    setBusy(key);
    setError(null);
    try {
      const response = await fetch(url, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifactId: artifact.id, conversationId: artifact.conversationId, version: artifact.version,
          included: !artifacts.some(item => artifactVersionKey(item) === key) }) });
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(body.error || "Could not update Learn artifacts.");
      setArtifacts(body.artifacts);
      window.dispatchEvent(new CustomEvent(LEARN_ARTIFACTS_CHANGED_EVENT, { detail: { gardenSlug, artifacts: body.artifacts } }));
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not update Learn artifacts."); }
    finally { if (mutation.current === controller) { mutation.current = null; setBusy(null); } }
  }, [url, loaded, artifacts, gardenSlug]);
  const refresh = useCallback(() => setRevision(current => current + 1), []);
  return { artifacts, busy, error, loaded, toggle, refresh };
}
