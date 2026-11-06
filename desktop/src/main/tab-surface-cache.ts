/** Extra compositor surfaces only. Documents, history and unsaved work are never discarded. */
export const TAB_SURFACE_BUDGET_BYTES = 128 * 1024 * 1024;
export type TabMemoryPressure = "normal" | "constrained" | "critical" | "emergency";

export class TabSurfaceCache {
  private entries = new Map<number, number>();
  private pressure: TabMemoryPressure = "normal";
  private capacity = TAB_SURFACE_BUDGET_BYTES;

  setCapacity(bytes: number): void { this.capacity = Math.max(0, Math.min(TAB_SURFACE_BUDGET_BYTES, Math.floor(bytes))); }

  get budget(): number {
    return this.pressure === "normal" ? this.capacity
      : this.pressure === "constrained" ? Math.floor(this.capacity / 4) : 0;
  }
  get bytes(): number { return [...this.entries.values()].reduce((sum, size) => sum + size, 0); }
  get canPrewarm(): boolean { return this.pressure === "normal"; }
  setPressure(pressure: TabMemoryPressure): void { this.pressure = pressure; }
  forget(id: number): void { this.entries.delete(id); }
  touch(id: number, bytes: number): void {
    this.entries.delete(id);
    this.entries.set(id, Math.max(0, Math.ceil(bytes)));
  }
  resize(id: number, bytes: number): void {
    if (this.entries.has(id)) this.entries.set(id, Math.max(0, Math.ceil(bytes)));
  }
  /** Active/pending surfaces are necessary display resources, not cache entries. */
  trim(protectedIds: ReadonlySet<number>): number[] {
    const evicted: number[] = [];
    let bytes = [...this.entries].reduce((sum, [id, size]) => sum + (protectedIds.has(id) ? 0 : size), 0);
    for (const [id, size] of this.entries) {
      if (bytes <= this.budget) break;
      if (protectedIds.has(id)) continue;
      this.entries.delete(id);
      bytes -= size;
      evicted.push(id);
    }
    return evicted;
  }
}

/** How long a background tab keeps its page before it is unloaded back to a
 * deferred tab (same place, title and address; reloads when selected). Windows
 * commit, not physical RAM, is what ran out in the 2026-10-16 and 10-19 crashes,
 * so low free commit shortens the delay even while physical pressure is normal. */
export function idleUnloadDelayMs(pressure: TabMemoryPressure, freeCommitMb: number | null): number {
  if (pressure === "critical" || pressure === "emergency" || (freeCommitMb !== null && freeCommitMb < 4096)) return 0;
  if (pressure === "constrained" || (freeCommitMb !== null && freeCommitMb < 8192)) return 5 * 60_000;
  return 10 * 60_000;
}

/** Background tabs exempt from idle unloading while memory is not short: the
 * few most recently left, so flipping between them stays instant. */
export const WARM_BACKGROUND_TABS = 3;

/** Ids of the `warm` background tabs left most recently. A zero delay means
 * memory is short, and then nothing is held warm. */
export function warmBackgroundTabs(
  tabs: ReadonlyArray<{ id: number; backgroundSince?: number }>,
  delayMs: number,
  warm = WARM_BACKGROUND_TABS,
): Set<number> {
  if (delayMs === 0) return new Set();
  return new Set(tabs
    .filter((tab): tab is { id: number; backgroundSince: number } => tab.backgroundSince !== undefined)
    .sort((a, b) => b.backgroundSince - a.backgroundSince)
    .slice(0, warm)
    .map((tab) => tab.id));
}

/** Conservative triple-buffer reservation at physical-pixel resolution. */
export function surfaceReservation(width: number, height: number, scale: number, surfaces = 1): number {
  return Math.ceil(width * scale) * Math.ceil(height * scale) * 4 * 3 * surfaces;
}
