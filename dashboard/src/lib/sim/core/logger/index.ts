// Breadboard stand-in for sim's @sim/logger (simstudioai/sim, Apache-2.0 —
// packages/logger/src/index.ts). Console-backed: the engine's block-level result
// log lives in the executor's ExecutionResult, not here, so module loggers only
// need to be quiet in production and visible in dev.

export type LoggerMetadata = Record<string, unknown>

const VERBOSE = process.env.SIM_ENGINE_VERBOSE_LOGS === "1";

export class Logger {
  constructor(
    private module: string,
    private metadata: LoggerMetadata = {},
  ) {}

  /**
   * Sim's loggers carry per-execution correlation fields (workflowId, executionId, …).
   * Console-backed here, so the bound metadata is just appended to each line.
   */
  withMetadata(metadata: LoggerMetadata): Logger {
    return new Logger(this.module, { ...this.metadata, ...metadata });
  }

  private emit(level: "debug" | "info" | "warn" | "error", args: unknown[]) {
    if (!VERBOSE && (level === "debug" || level === "info")) return;
    const line = `[sim:${this.module}]`;
    const bound = Object.keys(this.metadata).length > 0 ? [this.metadata] : [];
    if (level === "error") console.error(line, ...args, ...bound);
    else if (level === "warn") console.warn(line, ...args, ...bound);
    else console.log(line, ...args, ...bound);
  }

  debug(...args: unknown[]) {
    this.emit("debug", args);
  }
  info(...args: unknown[]) {
    this.emit("info", args);
  }
  warn(...args: unknown[]) {
    this.emit("warn", args);
  }
  error(...args: unknown[]) {
    this.emit("error", args);
  }
}

export function createLogger(module: string): Logger {
  return new Logger(module);
}

/**
 * Sim binds a per-request AsyncLocalStorage context so route handlers and loggers
 * share one request id. Breadboard's engine runs outside any such wrapper, so
 * callers fall back to generating their own id.
 */
export function getRequestContext(): { requestId: string } | undefined {
  return undefined;
}
