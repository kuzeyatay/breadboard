"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStartupLoading } from "@/app/components/startup-readiness";
import { notchProviders, type NotchProvider, type NotchUsagePayload } from "@/lib/usage-notch";

interface Reading { data?: NotchUsagePayload; loading: boolean; error?: string }

/** Each new tab refreshes limits once; subsequent ChatGPT polls read the report. */
export function useProviderUsage() {
  const [providers, setProviders] = useState<NotchProvider[]>([]);
  const [catalogError, setCatalogError] = useState<string>();
  const [catalogReady, setCatalogReady] = useState(false);
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());
  const pending = useRef(new Map<string, AbortController>());
  const catalogPending = useRef<AbortController | null>(null);
  const catalogs = useRef({ models: [] as string[], subscriptions: [] as string[] });
  const refreshedOnOpen = useRef(new Set<string>());
  const retryAt = useRef(new Map<string, number>());
  useStartupLoading(!catalogReady || providers.some((provider) => {
    const model = provider.models.includes(selection[provider.id]) ? selection[provider.id] : provider.models[0];
    return !readings[model] || readings[model].loading;
  }));

  const loadCatalog = useCallback(async () => {
    if (catalogPending.current) return;
    const controller = new AbortController();
    catalogPending.current = controller;
    try {
      const readCatalog = async (url: string, subscriptions = false): Promise<string[]> => {
        const response = await fetch(url, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
        if (!response.ok) throw new Error("Couldn’t load providers. Try again.");
        const payload = await response.json();
        const rows = subscriptions ? payload.models : payload.data;
        if (!Array.isArray(rows)) throw new Error("Couldn’t load providers. Try again.");
        return rows.flatMap((row) => {
          const id = subscriptions ? row : row?.id;
          return typeof id === "string" ? [id] : [];
        });
      };
      const [models, subscriptions] = await Promise.allSettled([
        readCatalog("/api/models"),
        readCatalog("/api/cliproxy/status", true),
      ]);
      if (!controller.signal.aborted) {
        // Keep each source's last successful catalog through a temporary outage.
        if (models.status === "fulfilled") catalogs.current.models = models.value;
        if (subscriptions.status === "fulfilled") catalogs.current.subscriptions = subscriptions.value;
        if (models.status === "rejected" && subscriptions.status === "rejected") throw new Error("Couldn’t load providers. Try again.");
        const next = notchProviders(catalogs.current.models, catalogs.current.subscriptions);
        setProviders((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
        setCatalogError(undefined);
      }
    } catch (error) {
      if (!controller.signal.aborted) setCatalogError(error instanceof Error ? error.message : "Couldn’t load providers.");
    } finally {
      if (!controller.signal.aborted) setCatalogReady(true);
      if (catalogPending.current === controller) catalogPending.current = null;
    }
  }, []);

  const refresh = useCallback(async (provider: NotchProvider, model: string, manual = false) => {
    if (pending.current.has(model)) return;
    // Claude's server cache owns throttling. Keep checking the local report so
    // an externally renewed sign-in is noticed even during an old cooldown.
    if (provider.id !== "anthropic" && Date.now() < (retryAt.current.get(model) ?? 0)) return;
    const controller = new AbortController();
    pending.current.set(model, controller);
    const firstRefresh = !refreshedOnOpen.current.has(provider.id);
    refreshedOnOpen.current.add(provider.id);
    setReadings((current) => ({ ...current, [model]: { ...current[model], loading: true } }));
    try {
      const query = new URLSearchParams({ model });
      let response = await fetch(`/api/usage-limits?${query}`, {
        method: (manual || firstRefresh) && provider.id === "chatgpt" ? "POST" : "GET",
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]),
      });
      let data: NotchUsagePayload = await response.json();
      if (controller.signal.aborted) return;
      if (provider.id === "anthropic" && data.recovery_required) {
        response = await fetch(`/api/usage-limits?${query}`, {
          method: "POST", cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
        });
        data = await response.json();
      }
      if (controller.signal.aborted) return;
      const retry = Date.parse(data.retry_at ?? "");
      if (Number.isFinite(retry)) retryAt.current.set(model, retry);
      else retryAt.current.delete(model);
      setReadings((current) => ({ ...current, [model]: {
        // A temporary failure must not erase a good reading or look like 0%.
        data: data.available || data.auth_required ? data : current[model]?.data
          ? { ...current[model].data, stale: true, retry_at: data.retry_at } : data,
        loading: false,
        error: data.refresh_error || data.error || (!response.ok ? "Couldn’t refresh usage. Try again." : !data.available ? "No usage reported yet." : undefined),
      } }));
      setNow(Date.now());
    } catch (error) {
      if (!controller.signal.aborted) setReadings((current) => ({ ...current, [model]: {
        ...current[model], loading: false, error: error instanceof Error && error.name === "TimeoutError" ? "Usage refresh timed out. Try again." : "Couldn’t refresh usage. Try again.",
      } }));
    } finally {
      if (pending.current.get(model) === controller) {
        if (controller.signal.aborted && firstRefresh) refreshedOnOpen.current.delete(provider.id);
        pending.current.delete(model);
      }
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
    const catalogTimer = window.setInterval(() => { if (!document.hidden) void loadCatalog(); }, 300000);
    const onFocus = () => { if (!document.hidden) void loadCatalog(); };
    window.addEventListener("focus", onFocus);
    const requests = pending.current;
    const opened = refreshedOnOpen.current;
    return () => {
      window.clearInterval(catalogTimer);
      window.removeEventListener("focus", onFocus);
      catalogPending.current?.abort();
      catalogPending.current = null;
      for (const request of requests.values()) request.abort();
      requests.clear();
      opened.clear();
    };
  }, [loadCatalog]);

  useEffect(() => {
    const poll = (initial = false) => {
      if (!initial && document.hidden) return;
      setNow(Date.now());
      for (const provider of providers) {
        const model = provider.models.includes(selection[provider.id]) ? selection[provider.id] : provider.models[0];
        void refresh(provider, model);
      }
    };
    poll(true);
    const onVisible = () => poll();
    const timer = window.setInterval(onVisible, 60000);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible); };
  }, [providers, selection, refresh]);

  return { providers, readings, selection, setSelection, now, refresh, catalogError, catalogReady, loadCatalog };
}
