// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/lib/core/execution-limits/errors.ts; adapted for Breadboard.
/** Error used when a cooperative execution timeout must fail its backing job. */
export class ExecutionTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}
