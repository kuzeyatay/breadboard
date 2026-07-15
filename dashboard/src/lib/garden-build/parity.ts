import type { GardenIssue } from "./issues.ts";
import type { GardenBuildState } from "./types.ts";
import type { AcceptedGardenSnapshot } from "./snapshot.ts";
import { buildGardenPathPlan } from "./path-plan.ts";
import type { ProjectionValidationResult } from "../garden-renderer/projection-validation.ts";

export interface CanonicalParityDifference {
  category: "expected_normalization" | "legacy_stale_state_removed" | "path_only_difference" | "semantic_difference" | "missing_projection" | "unexpected_regression";
  entityId?: string;
  legacyPath?: string;
  canonicalPath?: string;
  description: string;
}

export interface CanonicalParityReport {
  buildId: string;
  legacyFingerprint: string;
  canonicalFingerprint: string;
  differences: CanonicalParityDifference[];
  semanticParityDifferenceCount: number;
  unexpectedRegressionCount: number;
  acceptanceDisagreement: boolean;
  legacyAccepted?: boolean;
  canonicalAccepted: boolean;
  liveGardenMutated: boolean;
}

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

function sameExcept(left: Record<string, unknown>, right: Record<string, unknown>, ignoredKeys: string[]): boolean {
  const ignored = new Set(ignoredKeys);
  return same(
    Object.fromEntries(Object.entries(left).filter(([key]) => !ignored.has(key))),
    Object.fromEntries(Object.entries(right).filter(([key]) => !ignored.has(key))),
  );
}

export function compareCanonicalParity(input: {
  importedState: GardenBuildState;
  repairedState: GardenBuildState;
  importIssues: GardenIssue[];
  snapshot?: AcceptedGardenSnapshot;
  projection?: ProjectionValidationResult;
  legacyAccepted?: boolean;
  liveGardenMutated?: boolean;
}): CanonicalParityReport {
  const { importedState: legacy, repairedState: canonical } = input;
  const differences: CanonicalParityDifference[] = [];
  const paths = input.snapshot ? buildGardenPathPlan(input.snapshot) : undefined;
  for (const [pageId, legacyPage] of Object.entries(legacy.pages)) {
    const page = canonical.pages[pageId];
    if (!page) { differences.push({ category: "unexpected_regression", entityId: pageId, legacyPath: legacyPage.legacyPath, description: "canonical state is missing a legacy learner page" }); continue; }
    if (legacyPage.title !== page.title) differences.push({ category: "semantic_difference", entityId: pageId, description: "page title changed" });
    if (legacyPage.body !== page.body) differences.push({ category: "semantic_difference", entityId: pageId, description: "page body changed" });
    if (!same(legacyPage.formulaEntries, page.formulaEntries)) differences.push({ category: "semantic_difference", entityId: pageId, description: "formula metadata changed" });
    const canonicalPath = paths?.pagePaths[pageId];
    if (legacyPage.legacyPath && canonicalPath && legacyPage.legacyPath !== canonicalPath) differences.push({ category: "path_only_difference", entityId: pageId, legacyPath: legacyPage.legacyPath, canonicalPath, description: "stable page identity rendered at a newly planned path" });
  }
  for (const pageId of Object.keys(canonical.pages)) if (!legacy.pages[pageId]) differences.push({ category: "semantic_difference", entityId: pageId, description: "canonical repair introduced a page not present in the legacy import" });
  const comparisons: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ["section", legacy.sections, canonical.sections], ["unit", legacy.units, canonical.units], ["source anchor", legacy.sourceAnchors, canonical.sourceAnchors],
    ["formula assignment", legacy.formulaAssignments, canonical.formulaAssignments], ["concept", legacy.concepts, canonical.concepts],
    ["claim", legacy.claims, canonical.claims], ["visual", legacy.visuals, canonical.visuals],
  ];
  const staleClaimIds = new Set(input.importIssues.filter((issue) => issue.type === "claim_page_mapping").map((issue) => issue.target.claimId).filter(Boolean));
  for (const [label, before, after] of comparisons) {
    for (const id of Object.keys(before)) if (!after[id]) differences.push({ category: label === "claim" ? "legacy_stale_state_removed" : "expected_normalization", entityId: id, description: `${label} was removed from the active canonical projection` });
    for (const id of Object.keys(after)) {
      if (!before[id]) {
        const remappedClaim = label === "claim" && staleClaimIds.has(id);
        differences.push({ category: remappedClaim ? "expected_normalization" : "semantic_difference", entityId: id, description: remappedClaim ? "stale path-owned claim was remapped to its stable canonical page ID" : `${label} was introduced during canonical repair` });
        continue;
      }
      if (same(before[id], after[id])) continue;
      const beforeEntity = before[id] as Record<string, unknown>;
      const afterEntity = after[id] as Record<string, unknown>;
      const claimIndexOnly = label === "unit" && sameExcept(beforeEntity, afterEntity, ["claimIds"]);
      const staleVisualOmission = label === "visual"
        && beforeEntity.status === "unresolved"
        && afterEntity.status === "omitted"
        && sameExcept(beforeEntity, afterEntity, ["status"]);
      differences.push({
        category: claimIndexOnly || staleVisualOmission ? "expected_normalization" : "semantic_difference",
        entityId: id,
        description: claimIndexOnly ? "unit claim index was rebuilt from stable canonical claim ownership"
          : staleVisualOmission ? "unresolved stale-path visual was retained as an explicit omission"
            : `${label} changed during canonical repair`,
      });
    }
  }
  if (!same(legacy.sourceCoverage, canonical.sourceCoverage)) {
    differences.push({ category: "semantic_difference", description: "canonical Source Coverage differs from the imported legacy usage projection" });
  }
  for (const issue of input.importIssues.filter((entry) => entry.type === "claim_page_mapping")) {
    if (!differences.some((entry) => entry.entityId === issue.target.claimId)) differences.push({ category: "legacy_stale_state_removed", entityId: issue.target.claimId, legacyPath: String(issue.evidence.legacyPagePath ?? "") || undefined, description: "stale path-owned claim was excluded from the active canonical claim map" });
  }
  for (const issue of input.projection?.issues ?? []) {
    differences.push({ category: issue.type === "projection_missing_file" ? "missing_projection" : "unexpected_regression", entityId: issue.target.pageId ?? issue.target.visualId, description: `${issue.type}: ${String(issue.evidence.semanticCategory ?? "projection integrity failure")}` });
  }
  if (input.liveGardenMutated) differences.push({ category: "unexpected_regression", description: "shadow execution changed a live garden file outside .breadboard/canonical-shadow" });
  const canonicalAccepted = Boolean(input.snapshot && input.projection?.passed !== false);
  const acceptanceDisagreement = input.legacyAccepted !== undefined && input.legacyAccepted !== canonicalAccepted;
  if (acceptanceDisagreement) differences.push({ category: "semantic_difference", description: `acceptance disagreement: legacy=${input.legacyAccepted}, canonical=${canonicalAccepted}` });
  return {
    buildId: canonical.buildId, legacyFingerprint: legacy.fingerprint, canonicalFingerprint: canonical.fingerprint,
    differences, semanticParityDifferenceCount: differences.filter((entry) => ["semantic_difference", "missing_projection", "unexpected_regression"].includes(entry.category)).length,
    unexpectedRegressionCount: differences.filter((entry) => entry.category === "unexpected_regression").length,
    acceptanceDisagreement, legacyAccepted: input.legacyAccepted, canonicalAccepted, liveGardenMutated: Boolean(input.liveGardenMutated),
  };
}

export function renderCanonicalParityMarkdown(report: CanonicalParityReport): string {
  const lines = ["# Canonical Shadow Parity", "", `Build: ${report.buildId}`, `Semantic differences: ${report.semanticParityDifferenceCount}`, `Unexpected regressions: ${report.unexpectedRegressionCount}`, `Acceptance disagreement: ${report.acceptanceDisagreement ? "yes" : "no"}`, `Live garden mutated: ${report.liveGardenMutated ? "yes" : "no"}`, "", "## Differences", ""];
  if (!report.differences.length) lines.push("- None");
  for (const difference of report.differences) lines.push(`- **${difference.category}**${difference.entityId ? ` (${difference.entityId})` : ""}: ${difference.description}`);
  return `${lines.join("\n")}\n`;
}
