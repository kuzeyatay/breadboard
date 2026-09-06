"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import { browserRecentSearchesControl } from "@/lib/desktop-browser-tabs";
import { normalizeRecentSearches } from "./browser-recent-searches";
import { createBrowserRecentSearchesStore } from "./browser-recent-searches-store";

export function useBrowserRecentSearches(ownerKey: string, pageAddress?: string, privateBrowsing = false) {
  const desktopReady = useDesktopTabs() !== null;
  const storageKey = `breadboard:browser-searches:${ownerKey}`;
  const store = useMemo(() => createBrowserRecentSearchesStore(() => ({
    key: storageKey,
    legacyKey: `breadboard:browser-history:${ownerKey}`,
    label: "recent searches",
    storage: {
      getItem: (key) => privateBrowsing ? null : window.localStorage.getItem(key),
      setItem: (key, value) => { if (!privateBrowsing) window.localStorage.setItem(key, value); },
    },
    control: privateBrowsing ? null : browserRecentSearchesControl(ownerKey),
    desktop: !privateBrowsing && "breadboardDesktop" in window,
    normalize: normalizeRecentSearches,
  })), [ownerKey, storageKey, privateBrowsing]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  useEffect(() => {
    const refresh = () => { void store.refresh(); };
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) refresh();
    };
    refresh();
    window.addEventListener("storage", sync);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", refresh);
    };
  }, [store, storageKey, desktopReady]);

  useEffect(() => {
    // Include searches submitted inside the web page and links opened into a
    // browser tab, as well as searches submitted through Breadboard's toolbar.
    if (pageAddress && !privateBrowsing) void store.remember(pageAddress);
  }, [store, pageAddress, privateBrowsing]);

  return { ...state, remember: privateBrowsing ? async () => true : store.remember, remove: store.remove, clear: store.clear, retry: store.refresh };
}
