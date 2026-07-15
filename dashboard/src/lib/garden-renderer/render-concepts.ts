import type { AcceptedGardenSnapshot } from "../garden-build/snapshot.ts";
import type { RenderedProjection } from "./render-pages.ts";

export function renderConceptProjection(snapshot: AcceptedGardenSnapshot): RenderedProjection {
  const concepts = Object.values(snapshot.state.concepts).filter((concept) => concept.status === "active").sort((a, b) => a.id.localeCompare(b.id));
  return { path: ".breadboard/concept-registry.json", content: `${JSON.stringify({ schemaVersion: 1, gardenId: snapshot.state.gardenId, sourceSetHash: snapshot.state.sourceSetHash, concepts }, null, 2)}\n`, projectionType: "concept_registry", sourceEntityIds: concepts.map((concept) => concept.id) };
}
