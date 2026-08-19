// Vendored from simstudioai/sim (Apache-2.0), apps/sim/lib/core/config/env —
// adapted for Breadboard: plain process.env passthrough. The tools tree only
// reads optional keys (e.g. TRELLO_API_KEY, NEXT_PUBLIC_APP_URL).

export const env: Record<string, string | undefined> =
  typeof process === "undefined" ? {} : (process.env as Record<string, string | undefined>);
