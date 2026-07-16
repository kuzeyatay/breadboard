/**
 * Disposable projection reset (Part 8) + recoverable-issue classification
 * (Part 14).
 *
 * After structural cleanup removes stale/foreign pages, every DERIVED projection
 * must be regenerated from the current active state rather than merged with
 * prior-build output. This module deletes the disposable projections and never
 * touches durable inputs (source files and canonical source extraction records).
 */

import fs from "node:fs";
import path from "node:path";

import type { ActiveLearnBuildManifest } from "./learn-build-manifest.ts";

export interface ProjectionResetResult {
  removed: string[];
  regenerated: string[];
  preservedDurableInputs: string[];
}

/** Disposable projection files/dirs under the garden that must not survive a
 * structural change. Relative to the garden root. */
const DISPOSABLE_PROJECTION_FILES = [
  ".breadboard/claims.json",
  ".breadboard/claims-history.json",
  ".breadboard/concept-registry.json",
  ".breadboard/concept-registry-history.json",
  ".breadboard/formula-assignment-plan.json",
  ".breadboard/formula-identities.json",
  ".breadboard/visual-index.json",
  ".breadboard/validation-report.md",
  ".breadboard/repair-report.md",
  ".breadboard/repair-log.json",
  ".breadboard/critic-issues.json",
  ".breadboard/critic-loop.json",
  ".breadboard/critic-report.md",
  ".breadboard/acceptance-status.json",
  ".breadboard/source-anchor-evidence.json",
  ".breadboard/source-anchor-evidence.md",
  ".breadboard/source-anchor-migration.json",
  ".breadboard/source-anchor-migration.md",
  ".breadboard/semantic-migration.json",
  ".breadboard/weak-anchor-self-healing.json",
  ".breadboard/weak-anchor-self-healing.md",
  ".breadboard/planning/Source Coverage.md",
];

/** Durable inputs that must always be preserved through a reset. */
const DURABLE_INPUTS = [
  "sources",
  ".breadboard/source-visuals.json",
  ".breadboard/active-build-manifest.json",
  ".breadboard/build-workspace.json",
];

/** Which projection categories the downstream engines will rebuild after a
 * reset (reported for the convergence log, not deleted here). */
const REGENERATED_CATEGORIES = [
  "claim-registry",
  "concept-registry",
  "page-claimIds",
  "page-concepts",
  "page-tags",
  "page-source-anchors",
  "formula-assignment-projection",
  "source-visual-assignment-projection",
  "visual-indexes",
  "source-coverage",
  "section-indexes",
  "root-navigation",
  "validation-report",
  "repair-report",
  "acceptance-report",
];

export function resetDisposableLearnProjections(
  gardenDir: string,
  manifest: ActiveLearnBuildManifest,
): ProjectionResetResult {
  void manifest;
  const removed: string[] = [];
  for (const rel of DISPOSABLE_PROJECTION_FILES) {
    const abs = path.join(gardenDir, ...rel.split("/"));
    if (fs.existsSync(abs)) {
      fs.rmSync(abs, { force: true });
      removed.push(rel);
    }
  }
  // Generated section indexes / navigation live inside learning/ as `_index.md`
  // and `Learning Map.md`; they are regenerated from the current spine.
  for (const rel of learningIndexFiles(gardenDir)) {
    const abs = path.join(gardenDir, ...rel.split("/"));
    if (fs.existsSync(abs)) {
      fs.rmSync(abs, { force: true });
      removed.push(rel);
    }
  }
  const preservedDurableInputs = DURABLE_INPUTS.filter((rel) =>
    fs.existsSync(path.join(gardenDir, ...rel.split("/"))));
  return { removed, regenerated: [...REGENERATED_CATEGORIES], preservedDurableInputs };
}

function learningIndexFiles(gardenDir: string): string[] {
  const out: string[] = [];
  const learningDir = path.join(gardenDir, "learning");
  const walk = (relDir: string) => {
    const absDir = path.join(gardenDir, relDir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name === "_index.md" || entry.name === "Learning Map.md") out.push(rel);
    }
  };
  if (fs.existsSync(learningDir)) walk("learning");
  return out;
}

// ---------------------------------------------------------------------------
// Recoverable-issue classification (Part 14)
// ---------------------------------------------------------------------------

export interface ClassifiableIssue {
  type: string;
  reason?: string;
}

/** Issue types the convergence loop can repair without terminally failing. */
const RECOVERABLE_ISSUE_TYPES = new Set([
  // Structural (deterministic).
  "foreign_build_page",
  "unknown_learning_unit",
  "duplicate_unit_page",
  "missing_unit_page",
  "manifest_path_mismatch",
  "unexpected_section",
  "stale_section_index",
  "stale_generated_visual",
  "stale_generated_registry",
  // Semantic/projection drift the engines already repair.
  "stale_claim_mapping",
  "tag_projection_drift",
  "contract_page_anchor",
  "missing_formula_metadata",
  "missing_visual_block",
  "stale_source_coverage",
  "duplicate_visual_projection",
  "section_semantic_mismatch",
  "formula_family_mismatch",
  "formula_classification_mismatch",
]);

/** Issue types that terminally fail a build (non-recoverable). */
const NON_RECOVERABLE_ISSUE_TYPES = new Set([
  "source_evidence_unavailable",
  "semantic_ambiguity_after_chatmock",
  "chatmock_unavailable_with_blockers",
  "repair_budget_exhausted",
  "canonical_invariant_bug",
  "io_failure",
]);

export function isRecoverableLearnIssue(issue: ClassifiableIssue): boolean {
  if (NON_RECOVERABLE_ISSUE_TYPES.has(issue.type)) return false;
  return RECOVERABLE_ISSUE_TYPES.has(issue.type);
}
