"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { randomAmbientPalette, RANDOM_AMBIENT_PERIOD_MS } from "@/lib/random-ambient-palette";

const serverCycle = () => -1;

export function useRandomAmbientPalette(enabled: boolean, running: boolean, reducedMotion: boolean) {
  const read = useCallback(() => enabled
    // Reduced motion uses a shared static palette, including in newly opened tabs.
    ? reducedMotion ? 0 : Math.floor(Date.now() / RANDOM_AMBIENT_PERIOD_MS)
    : -1, [enabled, reducedMotion]);
  const subscribe = useCallback((changed: () => void) => {
    if (!enabled || !running || reducedMotion) return () => {};
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      changed();
      // Align to the shared boundary, never twenty seconds from this tab's mount.
      timer = setTimeout(update, RANDOM_AMBIENT_PERIOD_MS - Date.now() % RANDOM_AMBIENT_PERIOD_MS);
    };
    update();
    window.addEventListener("focus", update);
    window.addEventListener("pageshow", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("pageshow", update);
    };
  }, [enabled, running, reducedMotion]);
  const cycle = useSyncExternalStore(subscribe, read, serverCycle);
  return useMemo(() => cycle < 0 ? null : {
    cycle,
    colors: randomAmbientPalette(cycle),
    previousColors: randomAmbientPalette(cycle - 1),
  }, [cycle]);
}
