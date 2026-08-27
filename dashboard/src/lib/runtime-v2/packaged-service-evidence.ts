import {
  acquireServiceLease,
  readSupervisedServiceSnapshot,
  readSupervisedServiceSnapshots,
  releaseSupervisorLeaseStrict,
  type SupervisedServiceId,
  type SupervisedServiceSnapshot,
  type SupervisorLease,
} from "../supervisor-control.ts";
import { DEFAULT_RECALL_SETTINGS } from "../recall/policy.ts";
import { reconcileRecallRuntime } from "../recall/runtime-service.ts";

export type PackagedServiceEvidencePolicy = "lease" | "recall-reconcile";

export interface PackagedServiceEvidenceDefinition {
  readonly id: SupervisedServiceId;
  readonly policy: PackagedServiceEvidencePolicy;
}

/**
 * Closed mirror of the packaged Runtime service manifest.
 *
 * The source validator compares this list with services.json, including each
 * startup policy. It deliberately does not read a caller-supplied service id
 * from disk or turn this diagnostic into generic process control.
 */
export const PACKAGED_SERVICE_EVIDENCE_DEFINITIONS = Object.freeze([
  { id: "chatmock", policy: "lease" },
  { id: "dashboard", policy: "lease" },
  { id: "hermes", policy: "lease" },
  { id: "gbrain", policy: "lease" },
  { id: "comfyui", policy: "lease" },
  { id: "telegram-gateway", policy: "lease" },
  { id: "whatsapp-gateway", policy: "lease" },
  { id: "openwork", policy: "lease" },
  { id: "openscience", policy: "lease" },
  { id: "money-printer", policy: "lease" },
  { id: "wardrobe", policy: "lease" },
  { id: "penecho", policy: "lease" },
  { id: "vlm-ocr", policy: "lease" },
  { id: "recall", policy: "recall-reconcile" },
  { id: "mem0-semantic-engine", policy: "lease" },
  { id: "local-mcp-broker", policy: "lease" },
  { id: "postiz-coordinator", policy: "lease" },
  { id: "inbox-zero-stack", policy: "lease" },
  { id: "spotify-playback", policy: "lease" },
  { id: "cliproxy", policy: "lease" },
  { id: "quartz", policy: "lease" },
  { id: "ui-tars", policy: "lease" },
  { id: "cad", policy: "lease" },
  { id: "solidworks-mcp", policy: "lease" },
  { id: "colpali", policy: "lease" },
  { id: "humanizer", policy: "lease" },
  { id: "voicebox", policy: "lease" },
  { id: "scriberr", policy: "lease" },
  { id: "deep-research", policy: "lease" },
  { id: "deer-flow", policy: "lease" },
  { id: "vibe-trading", policy: "lease" },
  { id: "stock-analyst", policy: "lease" },
] as const satisfies readonly PackagedServiceEvidenceDefinition[]);

const DEFINITION_BY_ID = new Map<
  SupervisedServiceId,
  PackagedServiceEvidenceDefinition
>(PACKAGED_SERVICE_EVIDENCE_DEFINITIONS.map((definition) => [definition.id, definition]));

interface EvidenceLeaseState {
  readonly leases: Map<SupervisedServiceId, SupervisorLease>;
  readonly operations: Map<SupervisedServiceId, Promise<unknown>>;
  endpoints: Readonly<Record<SupervisedServiceId, string>> | null;
  recallActive: boolean;
}

const evidenceGlobal = globalThis as typeof globalThis & {
  __breadboardPackagedServiceEvidence?: EvidenceLeaseState;
};

function state(): EvidenceLeaseState {
  evidenceGlobal.__breadboardPackagedServiceEvidence ??= {
    leases: new Map(),
    operations: new Map(),
    endpoints: null,
    recallActive: false,
  };
  return evidenceGlobal.__breadboardPackagedServiceEvidence;
}

export function packagedServiceEvidenceDefinition(
  value: unknown,
): PackagedServiceEvidenceDefinition | null {
  return typeof value === "string"
    ? DEFINITION_BY_ID.get(value as SupervisedServiceId) ?? null
    : null;
}

async function serialize<T>(
  serviceId: SupervisedServiceId,
  operation: () => Promise<T>,
): Promise<T> {
  const leaseState = state();
  const previous = leaseState.operations.get(serviceId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  leaseState.operations.set(serviceId, current);
  try {
    return await current;
  } finally {
    if (leaseState.operations.get(serviceId) === current) {
      leaseState.operations.delete(serviceId);
    }
  }
}

export async function packagedServiceEvidenceStatuses(): Promise<
  readonly SupervisedServiceSnapshot[]
> {
  const snapshots = await readSupervisedServiceSnapshots(
    PACKAGED_SERVICE_EVIDENCE_DEFINITIONS.map(({ id }) => id),
  );
  if (!snapshots) {
    throw new Error("Runtime V2 service status authority is unavailable.");
  }
  return snapshots;
}

export function packagedServiceEvidenceHeldServiceIds(): readonly SupervisedServiceId[] {
  const held = state();
  return Object.freeze(
    PACKAGED_SERVICE_EVIDENCE_DEFINITIONS
      .filter(({ id }) => held.leases.has(id) || (id === "recall" && held.recallActive))
      .map(({ id }) => id),
  );
}

export function packagedServiceEvidenceEndpoints(
  env: NodeJS.ProcessEnv = process.env,
): Readonly<Record<SupervisedServiceId, string>> {
  const cached = state().endpoints;
  if (env === process.env && cached) return cached;
  const raw = env.BREADBOARD_PACKAGED_SERVICE_EVIDENCE_ENDPOINTS?.trim() ?? "";
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Packaged service evidence endpoints are unavailable.");
  }
  if (!Array.isArray(value) || value.length !== PACKAGED_SERVICE_EVIDENCE_DEFINITIONS.length) {
    throw new Error("Packaged service evidence endpoints are invalid.");
  }
  const endpoints = new Map<SupervisedServiceId, string>();
  const origins = new Set<string>();
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string") {
      throw new Error("Packaged service evidence endpoints are invalid.");
    }
    const definition = DEFINITION_BY_ID.get(pair[0] as SupervisedServiceId);
    let url: URL;
    try {
      url = new URL(pair[1]);
    } catch {
      throw new Error("Packaged service evidence endpoints are invalid.");
    }
    if (
      !definition ||
      endpoints.has(definition.id) ||
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port === "" ||
      origins.has(url.origin)
    ) {
      throw new Error("Packaged service evidence endpoints are invalid.");
    }
    endpoints.set(definition.id, url.origin);
    origins.add(url.origin);
  }
  if (PACKAGED_SERVICE_EVIDENCE_DEFINITIONS.some(({ id }) => !endpoints.has(id))) {
    throw new Error("Packaged service evidence endpoints are incomplete.");
  }
  const result = Object.freeze(Object.fromEntries(endpoints)) as Readonly<
    Record<SupervisedServiceId, string>
  >;
  if (env === process.env) state().endpoints = result;
  return result;
}

export async function acquirePackagedServiceEvidenceLease(
  serviceId: SupervisedServiceId,
  signal?: AbortSignal,
): Promise<{ readonly acquired: boolean; readonly snapshot: SupervisedServiceSnapshot }> {
  const definition = DEFINITION_BY_ID.get(serviceId);
  if (!definition) {
    throw new TypeError("The service is not registered for packaged evidence.");
  }
  return serialize(serviceId, async () => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const leaseState = state();
    if (definition.policy === "recall-reconcile") {
      if (leaseState.recallActive) {
        const snapshot = await readSupervisedServiceSnapshot(serviceId);
        if (!snapshot) throw new Error("Runtime V2 service status authority is unavailable.");
        return { acquired: false, snapshot };
      }
      await reconcileRecallRuntime(
        2_147_483_646,
        "running",
        {
          ...DEFAULT_RECALL_SETTINGS,
          captureEnabled: true,
          captureAudio: false,
          excludedWindows: ["Breadboard"],
        },
      );
      leaseState.recallActive = true;
      if (signal?.aborted) {
        await reconcileRecallRuntime(2_147_483_646, "stopped", null);
        leaseState.recallActive = false;
        throw new DOMException("Aborted", "AbortError");
      }
      const snapshot = await readSupervisedServiceSnapshot(serviceId);
      if (!snapshot) {
        await reconcileRecallRuntime(2_147_483_646, "stopped", null);
        leaseState.recallActive = false;
        throw new Error("Runtime V2 service status authority is unavailable.");
      }
      return { acquired: true, snapshot };
    }
    const previous = leaseState.leases.get(serviceId);
    if (previous) {
      const snapshot = await readSupervisedServiceSnapshot(serviceId);
      if (!snapshot) throw new Error("Runtime V2 service status authority is unavailable.");
      return { acquired: false, snapshot };
    }

    const lease = await acquireServiceLease(serviceId, "packaged-service-evidence");
    if (!lease) throw new Error("Runtime V2 service lease authority is unavailable.");
    leaseState.leases.set(serviceId, lease);
    if (signal?.aborted) {
      await releaseSupervisorLeaseStrict(lease);
      leaseState.leases.delete(serviceId);
      throw new DOMException("Aborted", "AbortError");
    }
    const snapshot = await readSupervisedServiceSnapshot(serviceId);
    if (!snapshot) {
      await releaseSupervisorLeaseStrict(lease);
      leaseState.leases.delete(serviceId);
      throw new Error("Runtime V2 service status authority is unavailable.");
    }
    return { acquired: true, snapshot };
  });
}

export async function releasePackagedServiceEvidenceLease(
  serviceId: SupervisedServiceId,
): Promise<{ readonly released: boolean; readonly snapshot: SupervisedServiceSnapshot }> {
  const definition = DEFINITION_BY_ID.get(serviceId);
  if (!definition) {
    throw new TypeError("The service is not registered for packaged evidence.");
  }
  return serialize(serviceId, async () => {
    if (definition.policy === "recall-reconcile") {
      const active = state().recallActive;
      // Stop is intentionally idempotent for the fixed QA owner. This also
      // recovers a start whose HTTP acknowledgement was lost before local
      // recallActive state could be recorded.
      await reconcileRecallRuntime(2_147_483_646, "stopped", null);
      state().recallActive = false;
      const snapshot = await readSupervisedServiceSnapshot(serviceId);
      if (!snapshot) throw new Error("Runtime V2 service status authority is unavailable.");
      return { released: active, snapshot };
    }
    const lease = state().leases.get(serviceId);
    if (lease) {
      await releaseSupervisorLeaseStrict(lease);
      state().leases.delete(serviceId);
    }
    const snapshot = await readSupervisedServiceSnapshot(serviceId);
    if (!snapshot) throw new Error("Runtime V2 service status authority is unavailable.");
    return { released: Boolean(lease), snapshot };
  });
}
