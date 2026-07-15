import type { AcceptedGardenSnapshot } from "../garden-build/snapshot.ts";
import type { GardenPathPlan } from "../garden-build/path-plan.ts";
import type { RenderedProjection } from "./render-pages.ts";

export function renderSourceCoverageProjection(snapshot: AcceptedGardenSnapshot, paths: GardenPathPlan): RenderedProjection {
  const lines = ["# Source Coverage", "", `Snapshot fingerprint: ${snapshot.fingerprint}`, "", "## Active Usage", ""];
  for (const usage of [...snapshot.state.sourceCoverage.usages].sort((a, b) => `${a.anchorId}:${a.pageId ?? ""}`.localeCompare(`${b.anchorId}:${b.pageId ?? ""}`))) {
    lines.push(`- ${usage.anchorId} — ${usage.mode}${usage.pageId ? ` — ${paths.pagePaths[usage.pageId] ?? usage.pageId}` : ""}`);
  }
  lines.push("", "## Intentionally Omitted", "");
  for (const omission of [...snapshot.state.sourceCoverage.intentionalOmissions].sort((a, b) => a.anchorId.localeCompare(b.anchorId))) lines.push(`- ${omission.anchorId} — ${omission.reason}`);
  lines.push("");
  return { path: ".breadboard/planning/Source Coverage.md", content: lines.join("\n"), projectionType: "source_coverage", sourceEntityIds: [...new Set([...snapshot.state.sourceCoverage.usages.map((usage) => usage.anchorId), ...snapshot.state.sourceCoverage.intentionalOmissions.map((entry) => entry.anchorId)])] };
}
