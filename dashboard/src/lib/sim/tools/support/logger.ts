// Vendored from simstudioai/sim (Apache-2.0), packages/logger — adapted for
// Breadboard: console-backed shim with the same createLogger surface.

export interface Logger {
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
  debug(message: string, ...meta: unknown[]): void;
}

export function createLogger(scope: string): Logger {
  const prefix = `[sim-tools:${scope}]`;
  return {
    info: (message, ...meta) => console.log(prefix, message, ...meta),
    warn: (message, ...meta) => console.warn(prefix, message, ...meta),
    error: (message, ...meta) => console.error(prefix, message, ...meta),
    debug: () => {},
  };
}
