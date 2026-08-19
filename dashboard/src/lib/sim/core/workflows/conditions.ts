// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/lib/workflows/conditions.ts; adapted for Breadboard.
/**
 * Returns whether a condition title represents the fallback branch.
 *
 * @param title - Condition title from a workflow snapshot
 * @returns Whether the normalized title is `else`
 */
export function isElseConditionTitle(title: unknown): boolean {
  return typeof title === 'string' && title.trim().toLowerCase() === 'else'
}
