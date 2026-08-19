// Vendored from simstudioai/sim (Apache-2.0) — packages/workflow-renderer/src/lib/overflow-span.tsx; adapted for Breadboard.
// Breadboard adaptation: the emcn floating-tooltip stack is not vendored, so
// this renders the truncated span alone. The full value stays reachable in the
// editor's config panel, which is where a clipped value is actually edited.

interface OverflowSpanProps {
  value: string;
  className: string;
}

/** Truncated span for card copy; relies on the surrounding truncate class. */
export function OverflowSpan({ value, className }: OverflowSpanProps) {
  return <span className={className}>{value}</span>;
}
