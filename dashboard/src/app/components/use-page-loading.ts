"use client";

import { useEffect, useSyncExternalStore } from "react";

const pendingPages = new Set<symbol>();
const listeners = new Set<() => void>();
const getSnapshot = () => pendingPages.size > 0;
const getServerSnapshot = () => false;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Keep the shared top bar active until this page's work finishes or unmounts. */
export function usePageLoading(pending: boolean): void {
  useEffect(() => {
    if (!pending) return;
    const token = Symbol();
    pendingPages.add(token);
    listeners.forEach((listener) => listener());
    return () => {
      pendingPages.delete(token);
      listeners.forEach((listener) => listener());
    };
  }, [pending]);
}

export function usePageLoadingPending(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
