// ShapeR readiness is owned by a fresh authenticated Runtime V2 job. The pure
// clone resolver remains for developer/QA provisioning checks only; product
// execution never uses it as a subprocess fallback.

import { probeShapeRViaRuntime } from "../runtime-v2/formsmith-job.ts";
export {
  isShapeRClone,
  resolveShapeRRoot,
  shapeRBridgePath,
  type ShapeRRuntime,
} from "./source.ts";

export interface ShapeRHealth {
  available: boolean;
  cloned: boolean;
  root: string | null;
  python: string | null;
  bridgeFound: boolean;
  dependenciesInstalled: boolean;
  cudaAvailable: boolean;
  missing: string[];
  reason: string | null;
}

const HEALTH_CACHE_MS = 30_000;

type HealthCache = { at: number; health: ShapeRHealth };
const globals = globalThis as typeof globalThis & {
  __breadboardShapeRHealth?: HealthCache;
  __breadboardShapeRHealthInFlight?: Promise<ShapeRHealth>;
};

function unavailableHealth(reason: string): ShapeRHealth {
  return {
    available: false,
    cloned: false,
    root: null,
    python: null,
    bridgeFound: false,
    dependenciesInstalled: false,
    cudaAvailable: false,
    missing: [],
    reason,
  };
}

export async function shapeRHealth(options: {
  userId: number;
  force?: boolean;
}): Promise<ShapeRHealth> {
  const cached = globals.__breadboardShapeRHealth;
  if (!options.force && cached && Date.now() - cached.at < HEALTH_CACHE_MS) return cached.health;
  if (globals.__breadboardShapeRHealthInFlight) return globals.__breadboardShapeRHealthInFlight;
  const request = probeShapeRViaRuntime({ userId: options.userId })
    .catch((error) => unavailableHealth(
      error instanceof Error && error.message.trim()
        ? error.message.slice(0, 32 * 1024)
        : "The sealed ShapeR Runtime is unavailable.",
    ))
    .then((health) => {
      globals.__breadboardShapeRHealth = { at: Date.now(), health };
      return health;
    })
    .finally(() => { globals.__breadboardShapeRHealthInFlight = undefined; });
  globals.__breadboardShapeRHealthInFlight = request;
  return request;
}
