// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/lib/logs/execution/trace-spans/trace-spans.ts (filterHiddenOutputKeys only); adapted for Breadboard.
// Sim's full module also builds a trace-span tree for the run-history UI, which
// Breadboard doesn't have — only the hidden-key output filter is used, by
// executor/utils/output-filter.ts.

const HIDDEN_OUTPUT_KEYS = new Set(["childTraceSpans"]);

function setFilteredValue(output: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(output, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/**
 * Recursively filters hidden keys from nested objects for cleaner display.
 */
export function filterHiddenOutputKeys(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => filterHiddenOutputKeys(item));
  }

  if (typeof value === "object") {
    const filtered: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (HIDDEN_OUTPUT_KEYS.has(key)) {
        continue;
      }
      setFilteredValue(filtered, key, filterHiddenOutputKeys(val));
    }
    return filtered;
  }

  return value;
}
