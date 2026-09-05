"use client";

import { useEffect, useRef, useState } from "react";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import {
  loadSavedBrowserItems,
  saveBrowserItems,
  type SavedItemsControl,
  type SavedItemsOptions,
} from "./browser-saved-items";

export function useBrowserSavedItems<T>(
  ownerKey: string,
  storageKey: string,
  resolveControl: (owner: string) => SavedItemsControl<T> | null,
  normalize: (value: unknown) => T[],
) {
  const desktopReady = useDesktopTabs() !== null;
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{
    owner: string | null;
    items: T[];
    ready: boolean;
    saving: boolean;
    error: string | null;
  }>({ owner: null, items: [], ready: false, saving: false, error: null });
  const readyRef = useRef(false);
  const savingRef = useRef(false);
  const generationRef = useRef(0);

  function options(): SavedItemsOptions<T> {
    return {
      key: storageKey,
      // Access localStorage inside the guarded read/write, including its getter.
      storage: {
        getItem: (key) => window.localStorage.getItem(key),
        setItem: (key, value) => window.localStorage.setItem(key, value),
      },
      control: resolveControl(ownerKey),
      desktop: "breadboardDesktop" in window,
      normalize,
    };
  }

  useEffect(() => {
    let active = true;
    const invalidatePendingWork = () => ++generationRef.current;
    async function restore() {
      const generation = invalidatePendingWork();
      readyRef.current = false;
      // Keep state changes asynchronous, including the initial cache read.
      await Promise.resolve();
      if (!active) return;
      setState((previous) => ({ ...previous, ready: false, error: null }));
      try {
        const items = await loadSavedBrowserItems({
          key: storageKey,
          storage: {
            getItem: (key) => window.localStorage.getItem(key),
            setItem: (key, value) => window.localStorage.setItem(key, value),
          },
          control: resolveControl(ownerKey),
          desktop: "breadboardDesktop" in window,
          normalize,
        });
        if (!active || generation !== generationRef.current) return;
        readyRef.current = true;
        setState({ owner: ownerKey, items, ready: true, saving: false, error: null });
      } catch (error) {
        if (!active || generation !== generationRef.current) return;
        setState((previous) => ({
          ...previous,
          ready: false,
          error: error instanceof Error ? error.message : "Couldn’t load your saved sites. Try again.",
        }));
      }
    }
    void restore();
    const sync = (event: StorageEvent) => {
      if (!savingRef.current && (event.key === storageKey || event.key === null)) void restore();
    };
    const focus = () => { if (!savingRef.current) void restore(); };
    window.addEventListener("storage", sync);
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      readyRef.current = false;
      invalidatePendingWork();
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", focus);
    };
  }, [ownerKey, storageKey, resolveControl, normalize, desktopReady, reload]);

  async function save(next: T[]): Promise<boolean> {
    if (!readyRef.current || savingRef.current || state.owner !== ownerKey) return false;
    savingRef.current = true;
    const generation = ++generationRef.current;
    setState((previous) => ({ ...previous, saving: true, error: null }));
    try {
      const items = await saveBrowserItems(options(), next);
      if (generation !== generationRef.current) return false;
      setState({ owner: ownerKey, items, ready: true, saving: false, error: null });
      return true;
    } catch (error) {
      if (generation === generationRef.current) {
        setState((previous) => ({
          ...previous,
          saving: false,
          error: error instanceof Error ? error.message : "Couldn’t save your sites. Try again.",
        }));
      }
      return false;
    } finally {
      savingRef.current = false;
    }
  }

  return {
    items: state.owner === ownerKey ? state.items : [],
    ready: state.owner === ownerKey && state.ready,
    saving: state.saving,
    error: state.error,
    save,
    retry: () => setReload((value) => value + 1),
  };
}
