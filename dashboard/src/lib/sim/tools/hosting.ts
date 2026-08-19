// Vendored from simstudioai/sim (Apache-2.0), apps/sim/tools/hosting.ts —
// unchanged. Breadboard's executor never grants hosted keys, but a handful of
// vendored tool configs still call this at module-init time to build their
// `hosting.enabled` predicate, so it needs to keep existing and working.

import type { ToolHostingCondition, ToolHostingPredicate } from "./types";

export function hostedKeyEnabledWhen<P>(
  condition: ToolHostingCondition,
): ToolHostingPredicate<P> {
  const predicate = ((params: P) => {
    const value = (params as unknown as Record<string, unknown>)[condition.field];
    if (condition.operator === "equals") return value === condition.value;
    return condition.values.includes(value as string | number | boolean | null);
  }) as ToolHostingPredicate<P>;

  predicate.condition = condition;
  return predicate;
}
