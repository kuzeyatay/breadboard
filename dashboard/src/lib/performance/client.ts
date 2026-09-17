"use client";

/**
 * The renderer's single interaction recorder, plus the contention counters the
 * plan asks to capture alongside every measurement (BASE-01, BASE-04).
 *
 * Everything here is in-memory and bounded. Nothing is sent anywhere: the QA
 * harness reads `window.__breadboardPerformance` when it wants a report, which
 * keeps diagnostics out of ordinary product flows.
 */

import {
  InteractionRecorder,
  type ContentionSource,
  type InteractionContention,
  type InteractionFeature,
  type InteractionHandle,
  type InteractionRecord,
} from "./interaction-trace.ts";
import {
  formatPerformanceReport,
  summarizeInteractions,
  type PerformanceReport,
} from "./summary.ts";

/** What ran the measurement. A report without this cannot be compared. */
export interface RuntimeIdentity {
  readonly mode: "development" | "production" | "unknown";
  readonly desktop: boolean;
  readonly userAgent: string;
  readonly displayScale: number | null;
  readonly deviceMemoryGb: number | null;
  readonly hardwareConcurrency: number | null;
  readonly viewport: { readonly width: number; readonly height: number } | null;
  readonly capturedAt: number;
}

interface PerformanceBridge {
  identity(): RuntimeIdentity;
  records(): readonly InteractionRecord[];
  report(): PerformanceReport;
  text(): string;
  pending(): readonly { id: string; feature: InteractionFeature; openedForMs: number }[];
  clear(): void;
}

declare global {
  interface Window {
    __breadboardPerformance?: PerformanceBridge;
  }
}

const DISABLED_VALUES = new Set(["0", "false", "off", "no"]);

function tracingEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const configured = process.env.NEXT_PUBLIC_BREADBOARD_PERF_TRACE?.trim().toLowerCase();
  return !(configured && DISABLED_VALUES.has(configured));
}

class BrowserContention implements ContentionSource {
  private readonly totals: InteractionContention = {
    longTaskMs: 0,
    requests: 0,
    duplicateRequests: 0,
    transferredBytes: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheStale: 0,
  };
  /** Request URLs already seen, so a repeated read is visible as duplication. */
  private readonly seenRequests = new Set<string>();

  constructor() {
    this.observe("longtask", (entries) => {
      for (const entry of entries) this.totals.longTaskMs += entry.duration;
    });
    this.observe("resource", (entries) => {
      for (const entry of entries as PerformanceResourceTiming[]) {
        this.totals.requests += 1;
        // The query string can carry a note title or a document id; the path
        // alone is enough to spot a repeated read.
        const key = requestKey(entry.name);
        if (key !== null) {
          if (this.seenRequests.has(key)) this.totals.duplicateRequests += 1;
          else this.seenRequests.add(key);
          // The set is a duplicate detector, not a log; cap it.
          if (this.seenRequests.size > 2_000) this.seenRequests.clear();
        }
        this.totals.transferredBytes += entry.transferSize || 0;
        if (entry.transferSize === 0 && entry.decodedBodySize > 0) this.totals.cacheHits += 1;
        else if (entry.transferSize > 0) this.totals.cacheMisses += 1;
      }
    });
  }

  private observe(
    type: string,
    handle: (entries: PerformanceEntryList) => void,
  ): void {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      const observer = new PerformanceObserver((list) => handle(list.getEntries()));
      // `buffered` catches work that happened before this module loaded.
      observer.observe({ type, buffered: true } as PerformanceObserverInit);
    } catch {
      // Long tasks are not observable in every engine; the rest still records.
    }
  }

  sample(): InteractionContention {
    return { ...this.totals };
  }
}

/** Path without query or fragment, so duplicate detection keeps no private text. */
function requestKey(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.href);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function runtimeIdentity(): RuntimeIdentity {
  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
  return {
    mode:
      process.env.NODE_ENV === "production"
        ? "production"
        : process.env.NODE_ENV === "development"
          ? "development"
          : "unknown",
    desktop: Boolean((window as Window & { breadboardDesktop?: unknown }).breadboardDesktop),
    userAgent: navigator.userAgent,
    displayScale: window.devicePixelRatio ?? null,
    deviceMemoryGb: navigatorWithMemory.deviceMemory ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    capturedAt: Date.now(),
  };
}

let recorder: InteractionRecorder | null = null;

function tracer(): InteractionRecorder | null {
  if (!tracingEnabled()) return null;
  if (recorder) return recorder;
  recorder = new InteractionRecorder({
    now: () => performance.now(),
    contention: new BrowserContention(),
  });
  const active = recorder;
  window.__breadboardPerformance = {
    identity: runtimeIdentity,
    records: () => active.completed(),
    report: () => summarizeInteractions(active.completed()),
    text: () => formatPerformanceReport(summarizeInteractions(active.completed())),
    pending: () => active.pending(),
    clear: () => active.clear(),
  };
  return recorder;
}

/** A handle that records nothing, so callers never branch on tracing state. */
const INERT: InteractionHandle = {
  id: "",
  feature: "route-input-to-usable",
  mark: () => undefined,
  end: () => null,
  open: false,
};

/**
 * Open an interaction at an input event. Safe to call during render or on the
 * server: it returns an inert handle when tracing is off.
 */
export function beginInteraction(
  feature: InteractionFeature,
  options: { startedAt?: number; background?: boolean } = {},
): InteractionHandle {
  const active = tracer();
  if (!active) return { ...INERT, feature };
  return active.begin(feature, options);
}

/** The report the QA harness and development diagnostics read. */
export function performanceReport(): PerformanceReport | null {
  const active = tracer();
  return active ? summarizeInteractions(active.completed()) : null;
}

export { runtimeIdentity };
