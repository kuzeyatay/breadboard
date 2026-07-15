import fs from "node:fs";
import path from "node:path";
import { contentFingerprint } from "../garden-build/fingerprint.ts";
import { buildGardenPathPlan } from "../garden-build/path-plan.ts";
import type { AcceptedGardenSnapshot } from "../garden-build/snapshot.ts";
import { stableGardenIssueId } from "../garden-build/issue-identity.ts";
import type { GardenIssue, GardenIssueBase, ProjectionIntegrityIssue } from "../garden-build/issues.ts";
import type { RenderedGardenManifest } from "./manifest.ts";
import { renderSourceCoverageProjection } from "./render-source-coverage.ts";

export interface ProjectionValidationResult { passed: boolean; issues: ProjectionIntegrityIssue[]; checkedFiles: number }

function projectionIssue(type: ProjectionIntegrityIssue["type"], target: GardenIssueBase["target"], category: string, evidence: Record<string, unknown>): ProjectionIntegrityIssue {
  const base: Omit<GardenIssueBase, "issueId"> = {
    type, severity: "blocking", repairClass: "projection_bug", stage: "projection_validation", target,
    evidence: { semanticCategory: category, ...evidence }, detectedBy: ["projection_validation"],
  };
  return { ...base, issueId: stableGardenIssueId(base) } as ProjectionIntegrityIssue;
}

function read(root: string, rel: string): string | undefined {
  try { return fs.readFileSync(path.join(root, ...rel.split("/")), "utf8"); } catch { return undefined; }
}

function frontmatter(content: string): Record<string, unknown> {
  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const result: Record<string, unknown> = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    try { result[match[1]] = JSON.parse(match[2]); } catch { result[match[1]] = match[2]; }
  }
  return result;
}

function equal(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

export function validateRenderedGardenProjection(snapshot: AcceptedGardenSnapshot, outputDir: string, manifest: RenderedGardenManifest): ProjectionValidationResult {
  const issues: ProjectionIntegrityIssue[] = [];
  const paths = buildGardenPathPlan(snapshot);
  if (manifest.buildId !== snapshot.buildId || manifest.snapshotFingerprint !== snapshot.fingerprint) {
    issues.push(projectionIssue("projection_manifest_mismatch", {}, "snapshot_manifest_identity", { manifestBuildId: manifest.buildId, manifestFingerprint: manifest.snapshotFingerprint, expectedBuildId: snapshot.buildId, expectedFingerprint: snapshot.fingerprint }));
  }
  const expectedProjectionPaths = new Set([
    "learning/_index.md",
    ...Object.values(paths.sectionPaths).map((sectionPath) => `${sectionPath}/_index.md`),
    ...Object.values(paths.pagePaths),
    ".breadboard/learning-unit-contract.json",
    ".breadboard/concept-registry.json",
    ".breadboard/claims.json",
    ...Object.values(paths.visualPaths),
    ".breadboard/planning/Source Coverage.md",
    ".breadboard/validation-report.md",
    ".breadboard/acceptance-status.json",
  ]);
  const manifestedPaths = new Set(manifest.files.map((file) => file.path));
  for (const expectedPath of expectedProjectionPaths) {
    if (!manifestedPaths.has(expectedPath)) issues.push(projectionIssue("projection_manifest_mismatch", {}, "expected_projection_not_manifested", { expectedPath }));
  }
  const serializedManifest = read(outputDir, ".breadboard/render-manifest.json");
  if (serializedManifest === undefined) {
    issues.push(projectionIssue("projection_missing_file", {}, "render_manifest", { expectedPath: ".breadboard/render-manifest.json" }));
  } else {
    try {
      if (!equal(JSON.parse(serializedManifest), manifest)) issues.push(projectionIssue("projection_manifest_mismatch", {}, "serialized_manifest_mismatch", {}));
    } catch {
      issues.push(projectionIssue("projection_manifest_mismatch", {}, "serialized_manifest_invalid_json", {}));
    }
  }
  for (const file of manifest.files) {
    const content = read(outputDir, file.path);
    const entityId = file.sourceEntityIds[0];
    const target = entityId?.startsWith("page:") ? { pageId: entityId } : {};
    if (content === undefined) issues.push(projectionIssue("projection_missing_file", target, file.projectionType, { expectedPath: file.path }));
    else if (contentFingerprint(content) !== file.contentFingerprint) issues.push(projectionIssue("projection_content_mismatch", target, file.projectionType, { expectedPath: file.path, expectedFingerprint: file.contentFingerprint, actualFingerprint: contentFingerprint(content) }));
  }
  for (const page of Object.values(snapshot.state.pages)) {
    const rel = paths.pagePaths[page.id];
    const content = rel ? read(outputDir, rel) : undefined;
    if (!content) { issues.push(projectionIssue("projection_missing_file", { pageId: page.id, unitId: page.unitId }, "page", { expectedPath: rel })); continue; }
    const data = frontmatter(content);
    const unit = snapshot.state.units[page.unitId];
    const expectedTags = [...new Set([...unit.primaryConceptIds, ...unit.supportingConceptIds].map((id) => snapshot.state.concepts[id]?.slug).filter(Boolean))];
    const expectedFormulaAnchors = unit.formulaAssignmentIds.map((id) => snapshot.state.formulaAssignments[id]).filter((entry) => entry?.status === "verified").map((entry) => entry.formulaAnchorId);
    const checks: Array<[string, unknown, unknown]> = [
      ["pageId", data.pageId, page.id], ["learningUnitId", data.learningUnitId, unit.id], ["sectionId", data.sectionId, unit.sectionId],
      ["tags", data.tags, expectedTags], ["claimIds", data.claimIds, unit.claimIds], ["sourceFormulaAnchors", data.sourceFormulaAnchors, expectedFormulaAnchors],
      ["sourceAnchors", data.sourceAnchors, unit.sourceAnchorIds], ["sourceVisualIds", data.sourceVisualIds, unit.sourceVisualAnchorIds],
      ["visuals", data.visuals, page.embeddedVisualIds],
    ];
    for (const [field, actual, expected] of checks) if (!equal(actual, expected)) issues.push(projectionIssue("projection_reference_mismatch", { pageId: page.id, unitId: unit.id }, `page_${field}`, { expectedPath: rel, field, expected, actual }));
  }
  for (const visual of Object.values(snapshot.state.visuals)) {
    if (visual.status === "historical") continue;
    const rel = paths.visualPaths[visual.id];
    const content = read(outputDir, rel);
    if (!content) { issues.push(projectionIssue("projection_missing_file", { visualId: visual.id, pageId: visual.pageId }, "visual", { expectedPath: rel })); continue; }
    try {
      const projection = JSON.parse(content) as Record<string, unknown>;
      if (!equal(projection.sourceAnchors, visual.sourceAnchorIds) || !equal(projection.textAnchors, visual.textAnchorIds)) issues.push(projectionIssue("projection_reference_mismatch", { visualId: visual.id, pageId: visual.pageId }, "visual_grounding", { expectedPath: rel }));
    } catch { issues.push(projectionIssue("projection_content_mismatch", { visualId: visual.id }, "visual_json", { expectedPath: rel })); }
  }
  const coverage = read(outputDir, ".breadboard/planning/Source Coverage.md");
  const expectedCoverage = renderSourceCoverageProjection(snapshot, paths).content;
  if (coverage !== expectedCoverage) issues.push(projectionIssue("projection_report_mismatch", {}, "source_coverage", { expectedFingerprint: contentFingerprint(expectedCoverage), actualFingerprint: coverage ? contentFingerprint(coverage) : undefined }));
  const report = read(outputDir, ".breadboard/validation-report.md");
  if (!report?.includes(`Snapshot-Fingerprint: ${snapshot.fingerprint}`)) issues.push(projectionIssue("projection_report_mismatch", {}, "validation_report", { expectedFingerprint: snapshot.fingerprint }));
  return { passed: issues.length === 0, issues, checkedFiles: manifest.files.length + 1 };
}

export function projectionBlockers(result: ProjectionValidationResult): GardenIssue[] { return result.issues.filter((issue) => issue.severity === "blocking"); }
