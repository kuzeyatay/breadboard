import type { AcceptedGardenSnapshot } from "../garden-build/snapshot.ts";
import type { GardenPathPlan } from "../garden-build/path-plan.ts";
import type { RenderedProjection } from "./render-pages.ts";

export function renderClaimProjection(snapshot: AcceptedGardenSnapshot, paths: GardenPathPlan): RenderedProjection {
  const claims = Object.values(snapshot.state.claims).filter((claim) => claim.status === "active").sort((a, b) => a.id.localeCompare(b.id)).map((claim) => ({
    id: claim.id, text: claim.text, subject: claim.subjectConceptId, predicate: claim.predicate, object: claim.objectConceptId,
    conceptIds: claim.conceptIds, learningUnitId: claim.unitId, pageId: claim.pageId, pageRelPath: paths.pagePaths[claim.pageId],
    evidenceAnchors: claim.evidenceAnchorIds, derivationAnchors: claim.derivationAnchorIds, status: "active",
  }));
  return { path: ".breadboard/claims.json", content: `${JSON.stringify({ schemaVersion: 1, gardenId: snapshot.state.gardenId, sourceSetHash: snapshot.state.sourceSetHash, claims }, null, 2)}\n`, projectionType: "claim_registry", sourceEntityIds: claims.map((claim) => claim.id) };
}
