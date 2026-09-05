"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_ASSISTANT_MODELS, mergeAssistantModels } from "@/lib/ai-models";
import {
  invalidateAssistantModelCatalog,
  loadAssistantModelCatalog,
} from "@/lib/assistant-model-catalog-client";
import { invalidateSettingsCache } from "@/lib/settings-client-cache";

/**
 * The model catalog behind every Intelligence menu.
 *
 * ChatMock re-reads `providers.json` on each request, so a provider connected in
 * Settings can serve immediately. The menus were the only layer that did not
 * know: each surface fetched `/api/models` once and kept the result for the life
 * of the page, so a newly connected provider's models stayed missing until the
 * app was restarted. This hook keeps that one-shot load and adds the one
 * signal that actually invalidates it — plus a slow, visibility-gated refresh,
 * because the catalog is now discovered from the providers themselves and a
 * model released this afternoon should show up this afternoon.
 */

/** Dispatched when a provider is connected, changed, forgotten or synced. */
export const ASSISTANT_MODELS_CHANGED_EVENT = "breadboard:assistant-models-changed";

/** How often an open page re-reads the discovered catalog. */
export const ASSISTANT_MODELS_REFRESH_INTERVAL_MS = 10 * 60_000;

/** Tell every open model picker its catalog is out of date. */
export function notifyAssistantModelsChanged(): void {
  if (typeof window === "undefined") return;
  invalidateAssistantModelCatalog();
  invalidateSettingsCache();
  window.dispatchEvent(new Event(ASSISTANT_MODELS_CHANGED_EVENT));
}

export interface AssistantModelsState {
  models: string[];
  modelsLoading: boolean;
  /** Load on first need. Safe to call on every menu open. */
  loadModels: () => void;
}

export interface UseAssistantModelsOptions {
  /**
   * Load on mount instead of on first open. For surfaces that render the list
   * without a menu of their own to trigger the load.
   */
  eager?: boolean;
}

// A reconnect used to overwrite the complete Google subscription catalog with
// one bootstrap model. Repair that already-persisted state once when any model
// picker encounters it. The lone row may be the stale subscription snapshot
// itself or OpenRouter's vendor-scoped fallback after the subscription row was
// lost entirely, so both shapes count as the same truncated Google catalog.
let subscriptionCatalogRepairAttempted = false;

function modelIds(rows: readonly { id?: unknown }[]): string[] {
  return rows
    .map((item) => (typeof item?.id === "string" ? item.id : null))
    .filter((id): id is string => Boolean(id));
}

function googleSubscriptionCatalogLooksTruncated(ids: readonly string[]): boolean {
  return ids.filter(
    (id) =>
      /^cliproxy\/gemini-/i.test(id) ||
      /^openrouter\/google\/gemini-/i.test(id) ||
      /^google\/gemini-/i.test(id),
  ).length === 1;
}

export function useAssistantModels(
  options: UseAssistantModelsOptions = {},
): AssistantModelsState {
  const { eager = false } = options;
  const [models, setModels] = useState<string[]>([...DEFAULT_ASSISTANT_MODELS]);
  const [modelsLoading, setModelsLoading] = useState(false);
  // Refs rather than state: `loadModels` fires from a menu-open handler, and a
  // guard that changed its identity on every load would rebuild that handler
  // mid-interaction.
  const loaded = useRef(false);
  const inFlight = useRef(false);

  const fetchModels = useCallback(async (force = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setModelsLoading(true);
    try {
      let rows = await loadAssistantModelCatalog({ force });
      let ids = Array.isArray(rows) ? modelIds(rows) : [];
      if (
        !subscriptionCatalogRepairAttempted &&
        googleSubscriptionCatalogLooksTruncated(ids)
      ) {
        subscriptionCatalogRepairAttempted = true;
        try {
          const repaired = await fetch("/api/cliproxy/sync", { method: "POST" });
          if (repaired.ok) {
            invalidateAssistantModelCatalog();
            rows = await loadAssistantModelCatalog({ force: true });
            ids = Array.isArray(rows) ? modelIds(rows) : [];
          }
        } catch {
          // The subscription service is optional and may still be starting.
          // Keep the catalog already loaded; a later reconnect will sync it.
        }
      }
      if (ids.length > 0) setModels(mergeAssistantModels(ids));
      loaded.current = true;
    } catch {
      // Keep the built-in ids: a picker with the defaults still works, an empty
      // one does not.
    } finally {
      inFlight.current = false;
      setModelsLoading(false);
    }
  }, []);

  const loadModels = useCallback(() => {
    if (loaded.current) return;
    void fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    if (eager) void fetchModels();
  }, [eager, fetchModels]);

  useEffect(() => {
    // Unconditional refetch, including for a menu that is open right now: this
    // fires only on a deliberate provider change, so the cost is one request at
    // the moment the reader is most likely to go looking for the new models.
    const handler = () => void fetchModels(true);
    window.addEventListener(ASSISTANT_MODELS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(ASSISTANT_MODELS_CHANGED_EVENT, handler);
  }, [fetchModels]);

  useEffect(() => {
    // Discovery happens server-side on a timer; a page that stays open picks
    // it up here. Only a catalog that was loaded once is refreshed, and only
    // while someone could see the result.
    const timer = window.setInterval(() => {
      if (loaded.current && document.visibilityState === "visible") {
        void fetchModels(true);
      }
    }, ASSISTANT_MODELS_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [fetchModels]);

  return { models, modelsLoading, loadModels };
}
