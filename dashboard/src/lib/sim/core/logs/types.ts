// Breadboard stand-in for sim's lib/logs/types.ts (simstudioai/sim, Apache-2.0).
// Only `TraceSpan` is used by the vendored executor, and only as an opaque field
// on `ChildWorkflowError` / `BlockLog.childTraceSpans` — Breadboard dropped the
// workflow (sub-workflow) block handler that is the only thing that ever
// populates it, so a minimal shape (rather than sim's full run-history-UI type)
// is enough to keep those call sites type-correct.

export interface TraceSpan {
  id: string;
  name: string;
  type: string;
  duration: number;
  startTime: string;
  endTime: string;
  children?: TraceSpan[];
  status?: "success" | "error";
  blockId?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  [key: string]: unknown;
}
