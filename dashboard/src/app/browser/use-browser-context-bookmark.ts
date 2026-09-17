"use client";

import { useEffect } from "react";

/** The native page menu asks the trusted shell to use its profile's bookmark store. */
export function useBrowserContextBookmark<T extends { url: string }>(
  store: { items: T[]; ready: boolean; saving: boolean; save(next: T[]): Promise<boolean> },
  normalize: (value: unknown) => T | null,
  limit: number,
) {
  useEffect(() => {
    const bookmark = (event: Event) => {
      const detail = (event as CustomEvent<{ bookmark?: unknown; complete?: (saved: boolean) => void }>).detail;
      if (!detail || typeof detail.complete !== "function") return;
      const complete = detail.complete;
      void (async () => {
        const item = normalize(detail.bookmark);
        if (!item || !store.ready || store.saving) return false;
        if (store.items.some(existing => existing.url === item.url)) return true;
        if (store.items.length >= limit) return false;
        return store.save([...store.items, item]);
      })().then(complete, () => complete(false));
    };
    window.addEventListener("breadboard:bookmark-browser-page", bookmark);
    return () => window.removeEventListener("breadboard:bookmark-browser-page", bookmark);
  }, [store, normalize, limit]);
}
