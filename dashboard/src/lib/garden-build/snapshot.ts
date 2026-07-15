import { fingerprintGardenBuildState } from "./fingerprint.ts";
import { mergeGardenIssues } from "./issue-identity.ts";
import type { GardenIssue } from "./issues.ts";
import { validateGardenBuildInvariants } from "./invariants.ts";
import type { GardenBuildState } from "./types.ts";

export interface AcceptedGardenSnapshot {
  schemaVersion: number;
  buildId: string;
  revision: number;
  fingerprint: string;
  acceptedAt: string;
  state: Readonly<GardenBuildState>;
  validation: { blockers: GardenIssue[]; warnings: GardenIssue[]; validatorVersion: string };
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createAcceptedGardenSnapshot(state: GardenBuildState, options: { acceptedAt?: string } = {}): AcceptedGardenSnapshot | undefined {
  const all = mergeGardenIssues([state.issueState.active, state.issueState.warnings, validateGardenBuildInvariants(state)]);
  const blockers = all.filter((issue) => issue.severity === "blocking");
  if (blockers.length > 0) return undefined;
  const acceptedState = structuredClone(state);
  acceptedState.stage = "accepted_snapshot";
  acceptedState.fingerprint = fingerprintGardenBuildState(acceptedState);
  acceptedState.acceptance = {
    ...acceptedState.acceptance,
    stateFingerprint: acceptedState.fingerprint,
    canonicalStatePass: true,
    snapshotCreated: true,
    blockers: [],
    warnings: all.filter((issue) => issue.severity !== "blocking"),
    accepted: true,
    primaryReason: "accepted",
  };
  return deepFreeze({
    schemaVersion: 1,
    buildId: state.buildId,
    revision: acceptedState.revision,
    fingerprint: acceptedState.fingerprint,
    acceptedAt: options.acceptedAt ?? new Date().toISOString(),
    state: acceptedState,
    validation: { blockers: [], warnings: acceptedState.acceptance.warnings, validatorVersion: "garden-build-v1" },
  }) as AcceptedGardenSnapshot;
}

export function isDeepFrozen(value: unknown): boolean {
  if (!value || typeof value !== "object" || !Object.isFrozen(value)) return false;
  return Object.values(value as Record<string, unknown>).every((child) => !child || typeof child !== "object" || isDeepFrozen(child));
}
