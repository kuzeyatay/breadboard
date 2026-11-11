import { app } from "electron";
import { MemoryGovernor } from "./memory-governor";
import { fallbackMemoryPolicy } from "./memory-policy";
import type { TabMemoryPressure } from "./tab-surface-cache";

/** Reuse the governor's thresholds, hysteresis and sampling cadence for surfaces.
 * Physical headroom is a conservative fallback: swap is never surface-cache
 * capacity. This observer has no service-admission or document-discard authority.
 */
export function observeTabMemoryPressure(changed: (state: TabMemoryPressure) => void): () => void {
  // Plain Node (unit tests) has no Electron process memory info and nothing to observe.
  if (typeof process.getSystemMemoryInfo !== "function") return () => undefined;
  const governor = new MemoryGovernor({
    // The admission floors (20% of RAM: 6.4 GB on 32 GB) protect multi-GB
    // service launches. Holding them against a 128 MB surface cache and one
    // spare new-tab page kept both off whenever this machine sat at its usual
    // ~3.5 GB free: every new Terminal loaded cold and every switch repainted.
    policy: { ...fallbackMemoryPolicy(), minFreeCommitMb: 2048, criticalFreeCommitMb: 1024,
      emergencyFreeCommitMb: 512, recoveryHysteresisMb: 256 },
    metrics: { async sample() {
      const memory = process.getSystemMemoryInfo();
      return { sampledAt: Date.now(), physicalTotalMb: memory.total / 1024,
        physicalAvailableMb: memory.free / 1024, commitLimitMb: memory.total / 1024,
        commitTotalMb: (memory.total - memory.free) / 1024 };
    } },
  });
  governor.on("state-changed", changed);
  governor.start();
  void governor.refresh().catch(() => undefined);
  const stop = () => { governor.stop(); governor.removeListener("state-changed", changed); };
  app.once("before-quit", stop);
  return stop;
}
