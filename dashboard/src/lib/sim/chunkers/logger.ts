// Breadboard shim for sim's `@sim/logger` (simstudioai/sim, Apache-2.0), kept
// inside chunkers/ so this directory stays self-contained. The chunkers log at
// most a couple of lines per document; `info` goes to `console.debug` so a
// routine chunking never adds noise to ordinary server output, while `warn`
// and `error` stay visible because they mean a config or pattern problem.

export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export function createLogger(name: string): Logger {
  const prefix = `[sim:${name}]`
  return {
    debug: (...args: unknown[]) => console.debug(prefix, ...args),
    info: (...args: unknown[]) => console.debug(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
  }
}
