"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { BrainGraphResponse } from "@/lib/profile/brain-graph-types.ts";
import BrainMapSkeleton from "./brain-map-skeleton.tsx";

const BrainMapCanvas = dynamic(() => import("./brain-map-canvas.tsx"), {
  ssr: false,
  loading: () => <BrainMapSkeleton />,
});

const KNOWLEDGE_REFRESH_INTERVAL_MS = 30_000;

function normalizedScope(scopeKey: string): string {
  return !scopeKey || scopeKey === "personal" ? "all" : scopeKey;
}

function scopeQuery(scopeKey: string): URLSearchParams {
  const query = new URLSearchParams();
  if (scopeKey === "all") {
    query.set("scope", "all");
  } else {
    query.set("scope", "organization");
    query.set("organization", scopeKey);
  }
  query.set("mode", "full");
  return query;
}

function rememberScope(scopeKey: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", "knowledge");
  if (scopeKey === "all") {
    url.searchParams.set("scope", "all");
    url.searchParams.delete("organization");
  } else {
    url.searchParams.set("scope", "organization");
    url.searchParams.set("organization", scopeKey);
  }
  window.history.replaceState(window.history.state, "", url);
}

export default function BrainMapClient({
  initialScope,
  onScopeChange,
}: {
  initialScope: string;
  onScopeChange?: (scope: string) => void;
}) {
  const router = useRouter();
  const [scopeKey, setScopeKey] = useState(() => normalizedScope(initialScope));
  const [graph, setGraph] = useState<BrainGraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rendererFailed, setRendererFailed] = useState(false);
  const fetchRef = useRef<AbortController | null>(null);

  const load = useCallback(async (nextScope: string, background = false) => {
    // A poll should never cancel the foreground request that owns the loading
    // state. Focus and visibility events can otherwise leave the canvas stuck
    // on "Updating..." even though the background request succeeded.
    if (background && fetchRef.current) return;
    fetchRef.current?.abort();
    const controller = new AbortController();
    fetchRef.current = controller;
    if (!background) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await fetch(`/api/profile/brain-graph?${scopeQuery(nextScope)}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as BrainGraphResponse & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Thought Topology could not be loaded.");
      if (!controller.signal.aborted) {
        setGraph((current) => current?.revision === payload.revision ? current : payload);
      }
    } catch (cause) {
      if (!background && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Thought Topology could not be loaded.");
      }
    } finally {
      if (!background && !controller.signal.aborted) setLoading(false);
      if (fetchRef.current === controller) fetchRef.current = null;
    }
  }, []);

  useEffect(() => {
    void load(scopeKey);
    const refresh = () => {
      if (document.visibilityState === "visible") void load(scopeKey, true);
    };
    const timer = window.setInterval(refresh, KNOWLEDGE_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      fetchRef.current?.abort();
    };
  }, [load, scopeKey]);

  const changeScope = useCallback((nextScope: string) => {
    rememberScope(nextScope);
    onScopeChange?.(nextScope);
    setRendererFailed(false);
    setScopeKey(nextScope);
  }, [onScopeChange]);

  if (loading && !graph) return <BrainMapSkeleton />;
  if (error && !graph) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-8 text-center">
        <p className="text-sm text-red-300">{error}</p>
        <button
          type="button"
          onClick={() => void load(scopeKey)}
          className="mt-4 rounded-lg border border-red-800 px-3 py-2 text-xs text-red-200 hover:bg-red-950"
        >
          Try again
        </button>
      </div>
    );
  }
  if (!graph) return null;

  const scopeOptions = graph.scopeOptions.filter((option) => option.kind !== "personal");

  if (rendererFailed) {
    return (
      <div className="rounded-lg border border-amber-800/50 p-8 text-center">
        <p className="text-sm text-amber-700">Thought Topology could not be rendered.</p>
        <button
          type="button"
          onClick={() => setRendererFailed(false)}
          className="mt-4 rounded-lg border border-gray-700 px-3 py-2 text-xs text-gray-500 hover:text-gray-900"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <BrainMapCanvas
      graph={graph}
      scopeKey={scopeKey}
      scopeOptions={scopeOptions}
      loading={loading}
      onScopeChange={changeScope}
      onOpen={(href) => router.push(href)}
      onFailure={() => setRendererFailed(true)}
    />
  );
}
