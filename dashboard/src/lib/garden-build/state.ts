import { fingerprintGardenBuildState } from "./fingerprint.ts";
import type { CanonicalAcceptanceDecision, GardenBuildStage, GardenBuildState } from "./types.ts";

export const GARDEN_BUILD_SCHEMA_VERSION = 1;

export function emptyCanonicalAcceptance(buildId: string): CanonicalAcceptanceDecision {
  return {
    buildId, stateFingerprint: "", canonicalStatePass: false, snapshotCreated: false,
    projectionPass: false, criticAvailable: false, criticPass: false, blockers: [], warnings: [],
    accepted: false, publishReady: false, primaryReason: "canonical_state_invalid",
  };
}

export function createGardenBuildState(input: {
  buildId: string; gardenId: string; gardenSlug: string; topicTitle: string; sourceSetHash: string; stage?: GardenBuildStage;
}): GardenBuildState {
  const state: GardenBuildState = {
    schemaVersion: GARDEN_BUILD_SCHEMA_VERSION,
    buildId: input.buildId, gardenId: input.gardenId, gardenSlug: input.gardenSlug,
    topicTitle: input.topicTitle, revision: 0, stage: input.stage ?? "repair", sourceSetHash: input.sourceSetHash,
    sources: {}, sourceAnchors: {}, sections: {}, units: {}, pages: {}, concepts: {}, claims: {}, visuals: {},
    formulaAssignments: {}, sourceCoverage: { usages: [], intentionalOmissions: [] },
    issueState: { active: [], warnings: [], history: [] }, acceptance: emptyCanonicalAcceptance(input.buildId), fingerprint: "",
  };
  state.fingerprint = fingerprintGardenBuildState(state);
  state.acceptance.stateFingerprint = state.fingerprint;
  return state;
}

export function cloneGardenBuildState(state: GardenBuildState): GardenBuildState {
  return structuredClone(state);
}

export function refreshGardenBuildFingerprint(state: GardenBuildState): GardenBuildState {
  state.fingerprint = fingerprintGardenBuildState(state);
  state.acceptance.stateFingerprint = state.fingerprint;
  return state;
}
