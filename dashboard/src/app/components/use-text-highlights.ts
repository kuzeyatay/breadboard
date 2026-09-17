"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { openTextHighlights, type TextHighlightClient } from "@/lib/text-highlight-client";

const EMPTY: never[] = [];

/** Scope-tagged hydration prevents an old document/session from saving into a new one. */
export function useTextHighlights<T>(key: string | null, normalize: (value: unknown) => T[]) {
  const normalizer = useRef(normalize);
  normalizer.current = normalize;
  const controller = useRef<{ key: string; store: TextHighlightClient } | null>(null);
  const [snapshot, setSnapshot] = useState<{ key: string | null; entries: T[]; error: string | null }>({ key: null, entries: [], error: null });

  useEffect(() => {
    if (!key) { controller.current = null; return; }
    const store = openTextHighlights(key);
    controller.current = { key, store };
    const unsubscribe = store.subscribe((entries, error) => setSnapshot({ key, entries: normalizer.current(entries), error }));
    return () => { controller.current = null; unsubscribe(); };
  }, [key]);

  const setEntries = useCallback((action: SetStateAction<T[]>) => {
    const current = controller.current;
    if (!key || current?.key !== key) return;
    const previous = normalizer.current(current.store.getSnapshot());
    current.store.update(typeof action === "function" ? (action as (value: T[]) => T[])(previous) : action);
  }, [key]);

  return [snapshot.key === key ? snapshot.entries : EMPTY, setEntries, snapshot.key === key ? snapshot.error : null] as const;
}
