"use client";

export interface PublicAgencyAgent {
  id: string;
  slug: string;
  name: string;
  description: string;
  division: string;
  divisionLabel: string;
  divisionIcon: string;
  divisionColor: string;
  emoji?: string;
  color?: string;
  vibe?: string;
  services: Array<{ name: string; url?: string; tier?: string }>;
  source: string;
}

export interface AgencyAgentsClientCatalog {
  ok: boolean;
  agents: PublicAgencyAgent[];
  divisions: Array<{ slug: string; label: string; icon: string; color: string }>;
  configuration?: { status?: string; message?: string | null };
}

export const AGENCY_AGENTS_CACHE_TTL_MS = 5 * 60_000;

let cached: { value: AgencyAgentsClientCatalog; expiresAt: number } | null = null;
let inFlight: Promise<AgencyAgentsClientCatalog> | null = null;
let cacheGeneration = 0;

export function peekCachedAgencyAgentsClientCatalog(): AgencyAgentsClientCatalog | null {
  if (!cached || cached.expiresAt <= Date.now()) return null;
  return cached.value;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseAgencyAgentsClientCatalog(
  value: unknown,
  responseOk = true,
): AgencyAgentsClientCatalog {
  const data = record(value);
  const configuration = record(data?.configuration);
  if (!responseOk || data?.ok !== true) {
    const message =
      (typeof configuration?.message === "string" && configuration.message.trim()) ||
      (typeof data?.error === "string" && data.error.trim()) ||
      "Agency agents could not be loaded.";
    throw new Error(message);
  }
  const agents = Array.isArray(data.agents) ? data.agents as PublicAgencyAgent[] : [];
  const divisions = Array.isArray(data.divisions)
    ? data.divisions as AgencyAgentsClientCatalog["divisions"]
    : [];
  if (agents.length === 0 || divisions.length === 0) {
    throw new Error("The Agency Agents catalog loaded without a usable roster.");
  }
  return {
    ok: true,
    agents,
    divisions,
    configuration: configuration
      ? {
          status: typeof configuration.status === "string" ? configuration.status : undefined,
          message: typeof configuration.message === "string" ? configuration.message : null,
        }
      : undefined,
  };
}

/** Cache the large roster in this renderer; it contains no credentials. */
export async function loadAgencyAgentsClientCatalog(
  options: { force?: boolean; maxAgeMs?: number } = {},
): Promise<AgencyAgentsClientCatalog> {
  const force = options.force === true;
  if (force) invalidateAgencyAgentsClientCache();
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;
  if (!force && inFlight) return inFlight;
  const requestGeneration = cacheGeneration;
  const maxAgeMs = options.maxAgeMs ?? AGENCY_AGENTS_CACHE_TTL_MS;
  const request = fetch("/api/hermes/agency-agents", { cache: "no-store" })
    .then(async (response) => {
      const data = await response.json().catch(() => null);
      const value = parseAgencyAgentsClientCatalog(data, response.ok);
      if (requestGeneration === cacheGeneration) {
        cached = { value, expiresAt: Date.now() + maxAgeMs };
      }
      return value;
    })
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

export function invalidateAgencyAgentsClientCache(): void {
  cacheGeneration += 1;
  cached = null;
  // Let the old request settle for its original caller without allowing a new
  // read to reuse it after an explicit invalidation.
  inFlight = null;
}
