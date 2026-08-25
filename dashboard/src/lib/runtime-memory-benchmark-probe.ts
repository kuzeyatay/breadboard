// The memory benchmark changes only this integer, waits for the diagnostic
// route to observe it, then restores the file. That forces a real incremental
// compiler invalidation without touching product behavior or leaving a diff.
export const MEMORY_BENCHMARK_PROBE = 0;
