// Breadboard stand-in for sim's lib/core/config/env.ts (simstudioai/sim, Apache-2.0).
// Sim validates ~300 env vars through @t3-oss/env-nextjs at import time and would
// throw on a Breadboard deployment that sets none of them. The engine only reads a
// handful of optional values, so this is a plain process.env passthrough.

/** Reads a single variable; empty strings are treated as unset. */
export function getEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === "" ? undefined : value;
}

export function isTruthy(value: string | boolean | number | undefined | null): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

/**
 * Named-property view over process.env. Sim's `env` is a typed object; callers here
 * only ever read, so a Proxy keeps every name available without enumerating them.
 */
export const env: Record<string, string | undefined> = new Proxy(
  {},
  {
    get: (_target, prop: string | symbol) =>
      typeof prop === "string" ? getEnv(prop) : undefined,
    has: (_target, prop: string | symbol) =>
      typeof prop === "string" ? prop in process.env : false,
  },
);
