import type { AcceptedGardenSnapshot } from "../garden-build/snapshot.ts";
import type { RenderedProjection } from "./render-pages.ts";

export function renderContractProjection(snapshot: AcceptedGardenSnapshot): RenderedProjection {
  const units = Object.values(snapshot.state.units).sort((a, b) => a.order - b.order);
  const content = `${JSON.stringify({ schemaVersion: 1, gardenId: snapshot.state.gardenId, sourceSetHash: snapshot.state.sourceSetHash, units, formulaAssignments: Object.values(snapshot.state.formulaAssignments) }, null, 2)}\n`;
  return { path: ".breadboard/learning-unit-contract.json", content, projectionType: "learning_unit_contract", sourceEntityIds: units.map((unit) => unit.id) };
}
