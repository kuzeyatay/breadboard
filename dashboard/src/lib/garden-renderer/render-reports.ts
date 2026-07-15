import type { AcceptedGardenSnapshot } from "../garden-build/snapshot.ts";
import type { RenderedProjection } from "./render-pages.ts";

export function renderReportProjections(snapshot: AcceptedGardenSnapshot): RenderedProjection[] {
  const validation = ["# Canonical Validation Report", "", `Build: ${snapshot.buildId}`, `Snapshot-Fingerprint: ${snapshot.fingerprint}`, "Accepted: yes", `Blockers: ${snapshot.validation.blockers.length}`, `Warnings: ${snapshot.validation.warnings.length}`, ""].join("\n");
  return [
    { path: ".breadboard/validation-report.md", content: validation, projectionType: "validation_report", sourceEntityIds: [snapshot.buildId] },
    { path: ".breadboard/acceptance-status.json", content: `${JSON.stringify(snapshot.state.acceptance, null, 2)}\n`, projectionType: "acceptance", sourceEntityIds: [snapshot.buildId] },
  ];
}
