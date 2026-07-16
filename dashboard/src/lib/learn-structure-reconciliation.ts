/**
 * Structural freeze before semantic reconciliation (Parts 4-8).
 *
 * This is the root-cause fix for the mixed-generation failure. Before ANY
 * semantic reconciliation, formula reconciliation, weak-anchor healing, critic
 * loop, or finalize runs, the active learner tree must contain exactly one page
 * per current contract unit — no foreign-build pages, no obsolete unknown-unit
 * pages, no duplicate unit mappings, no stale section trees.
 *
 * Every decision here is DETERMINISTIC. Which stale filesystem copy survives is
 * never a ChatMock question — it is decided by the active build manifest
 * (current-build ownership + expected path + generation attempt), never by
 * modification time and never by title.
 */

import fs from "node:fs";
import path from "node:path";

import type { LearningUnitContract } from "./learning-unit-contract.ts";
import {
  readOwnershipFromFrontmatter,
  type ActiveLearnBuildManifest,
} from "./learn-build-manifest.ts";

// ---------------------------------------------------------------------------
// Scan exclusions (Part 7)
// ---------------------------------------------------------------------------

/** Top-level trees that are NEVER part of the active learner projection. Any
 * Markdown walker / learner-page scanner must skip these. */
export const NON_ACTIVE_PROJECTION_PREFIXES = [
  ".breadboard/",
  ".breadboard/quarantine/",
  ".breadboard/canonical-shadow/",
  ".breadboard/backups/",
  ".breadboard/checkpoints/",
  ".previous-builds/",
  ".tmp/",
  "node_modules/",
];

/** Is this repo-relative path part of the active learner projection for the
 * given build? Excludes internal/quarantine/backup/shadow trees. `activeBuildId`
 * is accepted for symmetry and future per-build fencing; exclusion is currently
 * path-based so it holds even before ownership metadata is read. */
export function isActiveLearnerProjectionPath(relativePath: string, activeBuildId: string): boolean {
  void activeBuildId;
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized.endsWith(".md")) return false;
  return !NON_ACTIVE_PROJECTION_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Types (Parts 4-6)
// ---------------------------------------------------------------------------

export type StructuralProjectionIssueType =
  | "foreign_build_page"
  | "unknown_learning_unit"
  | "duplicate_unit_page"
  | "missing_unit_page"
  | "manifest_path_mismatch"
  | "unexpected_section"
  | "stale_section_index"
  | "stale_generated_visual"
  | "stale_generated_registry";

export type StructuralDeterministicAction =
  | "keep_manifest_page"
  | "remove_foreign_page"
  | "quarantine_unknown_page"
  | "regenerate_missing_page"
  | "remove_stale_section"
  | "rebuild_projection";

export interface StructuralProjectionIssue {
  issueId: string;
  type: StructuralProjectionIssueType;
  severity: "blocking" | "warning";
  unitId?: string;
  pageId?: string;
  pagePaths: string[];
  currentBuildId: string;
  detectedBuildIds: string[];
  deterministicAction?: StructuralDeterministicAction;
  reason: string;
}

export interface LearnStructureReconciliationResult {
  passed: boolean;
  issuesBefore: StructuralProjectionIssue[];
  issuesAfter: StructuralProjectionIssue[];
  pagesKept: string[];
  pagesRemoved: string[];
  pagesQuarantined: string[];
  pagesRegenerated: string[];
  staleSectionsRemoved: string[];
  staleVisualsRemoved: string[];
  staleRegistriesReset: string[];
  changed: boolean;
}

interface ScannedPage {
  rel: string;
  abs: string;
  learningUnitId?: string;
  buildId?: string;
  generationAttempt: number;
  isLearnerPage: boolean;
  learningVersionId?: string;
  date?: string;
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function walkActivePages(gardenDir: string, activeBuildId: string): ScannedPage[] {
  const out: ScannedPage[] = [];
  const walk = (relDir: string) => {
    const absDir = path.join(gardenDir, relDir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      // Prune excluded top-level trees early.
      if (entry.isDirectory()) {
        if (NON_ACTIVE_PROJECTION_PREFIXES.some((prefix) => `${rel}/` === prefix || `${rel}/`.startsWith(prefix))) continue;
        walk(rel);
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;
      if (!isActiveLearnerProjectionPath(rel, activeBuildId)) continue;
      const abs = path.join(gardenDir, rel);
      const content = safeRead(abs);
      if (content === undefined) continue;
      const fm = splitFrontmatter(content);
      const generatedBy = scalar(fm, "generated_by") || scalar(fm, "generatedBy");
      const kt = scalar(fm, "knowledge_type");
      const bt = scalar(fm, "breadboardType");
      const isLearnerPage = (kt === "learning-page" || bt === "learning_page")
        && generatedBy === "learn_button";
      if (!isLearnerPage) continue;
      const ownership = readOwnershipFromFrontmatter(fm);
      out.push({
        rel,
        abs,
        learningUnitId: ownership.learningUnitId,
        buildId: ownership.generatedByBuildId,
        generationAttempt: ownership.generationAttempt ?? 1,
        isLearnerPage,
        learningVersionId: scalar(fm, "learningVersionId") || scalar(fm, "learningVersion"),
        date: scalar(fm, "date"),
      });
    }
  };
  walk("");
  return out;
}

function safeRead(abs: string): string | undefined {
  try {
    return fs.readFileSync(abs, "utf-8");
  } catch {
    return undefined;
  }
}

function splitFrontmatter(content: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  return match ? match[1] : "";
}

function scalar(rawFrontmatter: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m").exec(rawFrontmatter);
  if (!match) return undefined;
  return match[1].replace(/^["']|["']$/g, "").trim() || undefined;
}

// ---------------------------------------------------------------------------
// Detection (Parts 5-6)
// ---------------------------------------------------------------------------

function issueId(type: string, key: string): string {
  return `struct:${type}:${key}`;
}

/**
 * Diagnose every structural problem in the active tree relative to the current
 * contract + manifest. Pure — makes no filesystem changes.
 */
export function detectStructuralIssues(
  gardenDir: string,
  contract: LearningUnitContract[],
  manifest: ActiveLearnBuildManifest,
): StructuralProjectionIssue[] {
  const currentBuildId = manifest.buildId;
  const contractUnitIds = new Set(contract.map((unit) => unit.id));
  const manifestByUnit = new Map(manifest.units.map((entry) => [entry.unitId, entry]));
  const pages = walkActivePages(gardenDir, currentBuildId);
  const issues: StructuralProjectionIssue[] = [];

  const pagesByUnit = new Map<string, ScannedPage[]>();
  for (const page of pages) {
    if (!page.learningUnitId) continue;
    pagesByUnit.set(page.learningUnitId, [...(pagesByUnit.get(page.learningUnitId) ?? []), page]);
  }

  // Unknown-unit pages (Part 6).
  for (const page of pages) {
    if (page.learningUnitId && !contractUnitIds.has(page.learningUnitId)) {
      issues.push({
        issueId: issueId("unknown_learning_unit", page.rel),
        type: "unknown_learning_unit",
        severity: "blocking",
        unitId: page.learningUnitId,
        pagePaths: [page.rel],
        currentBuildId,
        detectedBuildIds: page.buildId ? [page.buildId] : [],
        deterministicAction: "quarantine_unknown_page",
        reason: `learner page has learningUnitId "${page.learningUnitId}" which is not in the current contract`,
      });
    }
  }

  // Duplicate / foreign / path-mismatch per current unit (Part 5).
  for (const unit of contract) {
    const unitPages = (pagesByUnit.get(unit.id) ?? []);
    const manifestEntry = manifestByUnit.get(unit.id);
    if (unitPages.length === 0) {
      issues.push({
        issueId: issueId("missing_unit_page", unit.id),
        type: "missing_unit_page",
        severity: "blocking",
        unitId: unit.id,
        pageId: manifestEntry?.pageId,
        pagePaths: [],
        currentBuildId,
        detectedBuildIds: [],
        deterministicAction: "regenerate_missing_page",
        reason: `current unit ${unit.id} has no active learner page`,
      });
      continue;
    }
    if (unitPages.length > 1) {
      const detectedBuildIds = [...new Set(unitPages.map((page) => page.buildId ?? "unknown"))];
      issues.push({
        issueId: issueId("duplicate_unit_page", unit.id),
        type: "duplicate_unit_page",
        severity: "blocking",
        unitId: unit.id,
        pageId: manifestEntry?.pageId,
        pagePaths: unitPages.map((page) => page.rel),
        currentBuildId,
        detectedBuildIds,
        deterministicAction: "keep_manifest_page",
        reason: `unit ${unit.id} is mapped by ${unitPages.length} active pages (${unitPages.map((page) => page.rel).join(", ")})`,
      });
      continue;
    }
    // Exactly one page: check it belongs to the current build and sits at the
    // manifest's expected path.
    const [page] = unitPages;
    if (page.buildId && page.buildId !== currentBuildId) {
      issues.push({
        issueId: issueId("foreign_build_page", unit.id),
        type: "foreign_build_page",
        severity: "blocking",
        unitId: unit.id,
        pagePaths: [page.rel],
        currentBuildId,
        detectedBuildIds: [page.buildId],
        deterministicAction: "regenerate_missing_page",
        reason: `unit ${unit.id}'s only page was generated by build ${page.buildId}, not the current build ${currentBuildId}`,
      });
      continue;
    }
    if (manifestEntry && page.rel !== manifestEntry.expectedPagePath) {
      issues.push({
        issueId: issueId("manifest_path_mismatch", unit.id),
        type: "manifest_path_mismatch",
        severity: "warning",
        unitId: unit.id,
        pagePaths: [page.rel],
        currentBuildId,
        detectedBuildIds: page.buildId ? [page.buildId] : [],
        deterministicAction: "keep_manifest_page",
        reason: `unit ${unit.id} page is at ${page.rel} but the manifest expects ${manifestEntry.expectedPagePath}`,
      });
    }
  }

  return issues.sort((left, right) => left.issueId.localeCompare(right.issueId));
}

// ---------------------------------------------------------------------------
// Deterministic resolution (Parts 5-6)
// ---------------------------------------------------------------------------

function quarantineDir(gardenDir: string, buildId: string): string {
  return path.join(gardenDir, ".breadboard", "quarantine", buildId, "obsolete-pages");
}

function moveToQuarantine(gardenDir: string, buildId: string, page: ScannedPage): string {
  const destDir = quarantineDir(gardenDir, buildId);
  fs.mkdirSync(destDir, { recursive: true });
  const flatName = page.rel.replace(/[\\/]/g, "__");
  const dest = path.join(destDir, flatName);
  try {
    fs.renameSync(page.abs, dest);
  } catch {
    // Fall back to copy+unlink for cross-device / locked renames.
    fs.copyFileSync(page.abs, dest);
    fs.rmSync(page.abs, { force: true });
  }
  return path.relative(gardenDir, dest).replace(/\\/g, "/");
}

function removePage(abs: string): void {
  fs.rmSync(abs, { force: true });
}

/**
 * Resolve every structural issue deterministically, mutating the staging tree.
 * Missing/foreign pages are reported for the caller to regenerate (this module
 * never invents page content). Empty section folders left behind are removed.
 */
export function reconcileActiveLearnStructure(
  gardenDir: string,
  contract: LearningUnitContract[],
  manifest: ActiveLearnBuildManifest,
): LearnStructureReconciliationResult {
  const currentBuildId = manifest.buildId;
  const issuesBefore = detectStructuralIssues(gardenDir, contract, manifest);
  const manifestByUnit = new Map(manifest.units.map((entry) => [entry.unitId, entry]));

  const pagesKept: string[] = [];
  const pagesRemoved: string[] = [];
  const pagesQuarantined: string[] = [];
  const pagesRegenerated: string[] = [];
  const staleSectionsRemoved: string[] = [];
  const staleVisualsRemoved: string[] = [];
  const staleRegistriesReset: string[] = [];

  const rescanUnitPages = (unitId: string): ScannedPage[] =>
    walkActivePages(gardenDir, currentBuildId).filter((page) => page.learningUnitId === unitId);

  for (const issue of issuesBefore) {
    switch (issue.type) {
      case "unknown_learning_unit": {
        const page = walkActivePages(gardenDir, currentBuildId).find((candidate) => candidate.rel === issue.pagePaths[0]);
        if (page) pagesQuarantined.push(moveToQuarantine(gardenDir, currentBuildId, page));
        break;
      }
      case "duplicate_unit_page": {
        const unitId = issue.unitId!;
        const candidates = rescanUnitPages(unitId);
        const survivor = chooseSurvivor(candidates, manifestByUnit.get(unitId)?.expectedPagePath, currentBuildId);
        for (const page of candidates) {
          if (survivor && page.rel === survivor.rel) {
            pagesKept.push(page.rel);
            continue;
          }
          // A non-survivor duplicate from ANY build is obsolete output.
          removePage(page.abs);
          pagesRemoved.push(page.rel);
        }
        if (!survivor) pagesRegenerated.push(unitId);
        break;
      }
      case "foreign_build_page": {
        const page = rescanUnitPages(issue.unitId!)[0];
        if (page) {
          removePage(page.abs);
          pagesRemoved.push(page.rel);
        }
        pagesRegenerated.push(issue.unitId!);
        break;
      }
      case "missing_unit_page": {
        pagesRegenerated.push(issue.unitId!);
        break;
      }
      case "manifest_path_mismatch": {
        // Keep the page; the manifest's expected path is authoritative and is
        // corrected to where the current-build page actually is.
        const entry = manifestByUnit.get(issue.unitId!);
        if (entry && issue.pagePaths[0]) {
          entry.expectedPagePath = issue.pagePaths[0];
          pagesKept.push(issue.pagePaths[0]);
        }
        break;
      }
      default:
        break;
    }
  }

  staleSectionsRemoved.push(...removeEmptyLearningSections(gardenDir, contract, manifest));

  const changed =
    pagesRemoved.length > 0 ||
    pagesQuarantined.length > 0 ||
    staleSectionsRemoved.length > 0 ||
    staleVisualsRemoved.length > 0 ||
    staleRegistriesReset.length > 0;

  const issuesAfter = detectStructuralIssues(gardenDir, contract, manifest);
  // Remaining issues are only the missing/foreign pages the caller must
  // regenerate; duplicates and unknown-unit pages must be gone.
  const unresolved = issuesAfter.filter((issue) =>
    issue.type === "duplicate_unit_page" || issue.type === "unknown_learning_unit");

  return {
    passed: unresolved.length === 0,
    issuesBefore,
    issuesAfter,
    pagesKept: [...new Set(pagesKept)],
    pagesRemoved: [...new Set(pagesRemoved)],
    pagesQuarantined: [...new Set(pagesQuarantined)],
    pagesRegenerated: [...new Set(pagesRegenerated)],
    staleSectionsRemoved,
    staleVisualsRemoved,
    staleRegistriesReset,
    changed,
  };
}

/**
 * Choose which of several pages claiming one unit survives, in priority order:
 * 1. current-build page at the manifest's expected path,
 * 2. any current-build page (highest generationAttempt, then shortest path),
 * 3. none (all are older builds) → caller regenerates.
 * Modification time is never consulted.
 */
function chooseSurvivor(
  candidates: ScannedPage[],
  expectedPagePath: string | undefined,
  currentBuildId: string,
): ScannedPage | undefined {
  const currentBuildPages = candidates.filter((page) => page.buildId === currentBuildId);
  if (currentBuildPages.length === 0) return undefined; // both/all belong to older builds → regenerate
  const atExpected = expectedPagePath
    ? currentBuildPages.find((page) => page.rel === expectedPagePath)
    : undefined;
  if (atExpected) return atExpected;
  return [...currentBuildPages].sort((left, right) =>
    right.generationAttempt - left.generationAttempt
    || left.rel.length - right.rel.length
    || left.rel.localeCompare(right.rel))[0];
}

/** Remove now-empty learning section folders and any section index whose folder
 * holds no current pages. Section folders that still hold current pages stay. */
function removeEmptyLearningSections(
  gardenDir: string,
  contract: LearningUnitContract[],
  manifest: ActiveLearnBuildManifest,
): string[] {
  const removed: string[] = [];
  const learningDir = path.join(gardenDir, "learning");
  let sectionDirs: fs.Dirent[];
  try {
    sectionDirs = fs.readdirSync(learningDir, { withFileTypes: true });
  } catch {
    return removed;
  }
  const currentPages = walkActivePages(gardenDir, manifest.buildId)
    .filter((page) => page.learningUnitId && contract.some((unit) => unit.id === page.learningUnitId));
  const sectionsWithCurrentPages = new Set(
    currentPages.map((page) => page.rel.split("/").slice(0, 2).join("/")),
  );
  for (const dirent of sectionDirs) {
    if (!dirent.isDirectory()) continue;
    const rel = `learning/${dirent.name}`;
    const abs = path.join(learningDir, dirent.name);
    // Does this section folder still contain any current learner page?
    const hasCurrentPage = [...sectionsWithCurrentPages].some((sectionRel) => sectionRel === rel);
    if (hasCurrentPage) continue;
    // No current page → the whole folder is stale generation output.
    const anyMarkdown = walkAll(abs).some((file) => file.endsWith(".md"));
    if (anyMarkdown) {
      // Contains only foreign/obsolete .md that structural cleanup already
      // removed the current ones from — remove the residual stale tree.
      fs.rmSync(abs, { recursive: true, force: true });
      removed.push(rel);
    } else {
      // Truly empty folder.
      fs.rmSync(abs, { recursive: true, force: true });
      removed.push(rel);
    }
  }
  return removed;
}

function walkAll(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(abs);
    }
  };
  walk(dir);
  return out;
}

// ---------------------------------------------------------------------------
// Version-based generation freeze (legacy pages without build ownership)
// ---------------------------------------------------------------------------

export interface GenerationFreezeResult {
  currentVersion?: string;
  versionsSeen: Record<string, number>;
  pagesKept: string[];
  pagesQuarantined: string[];
  staleSectionsRemoved: string[];
  changed: boolean;
  reason: string;
}

/**
 * Freeze the active learner tree to a SINGLE generation using each page's
 * embedded `learningVersionId` — the artifact-level generation identity that
 * legacy pages (written before build-ownership metadata existed) still carry.
 * This is NOT modification-time reasoning: the version id names the generation
 * that produced the page, and the current generation is the one whose unit set
 * matches the current contract.
 *
 * The current version is the one that (1) covers the most current-contract
 * units, then (2) carries the fewest units NOT in the contract, then (3) is
 * newest by embedded generation date. Every page from any other version, and
 * every page whose unit is not in the contract, is quarantined out of the
 * active tree; emptied section folders are removed. With a single version
 * present this is a no-op, so it is always safe to run.
 */
export function freezeActiveGenerationByVersion(
  gardenDir: string,
  contract: LearningUnitContract[],
  options: { buildId?: string; currentVersion?: string } = {},
): GenerationFreezeResult {
  const buildId = options.buildId ?? "legacy";
  const contractUnitIds = new Set(contract.map((unit) => unit.id));
  const pages = walkActivePages(gardenDir, buildId);
  const versionsSeen: Record<string, number> = {};
  const byVersion = new Map<string, ScannedPage[]>();
  for (const page of pages) {
    const version = page.learningVersionId ?? "unversioned";
    versionsSeen[version] = (versionsSeen[version] ?? 0) + 1;
    byVersion.set(version, [...(byVersion.get(version) ?? []), page]);
  }

  // When the caller knows the running generation's version (its
  // textbookVersionId), keep exactly that generation and quarantine every
  // other — no inference needed. Otherwise infer the current generation from
  // contract coverage below (repairing a pre-existing mixed garden).
  const explicit = options.currentVersion && byVersion.has(options.currentVersion)
    ? options.currentVersion
    : undefined;

  if (!explicit && byVersion.size <= 1) {
    return {
      currentVersion: [...byVersion.keys()][0],
      versionsSeen,
      pagesKept: pages.map((page) => page.rel),
      pagesQuarantined: [],
      staleSectionsRemoved: [],
      changed: false,
      reason: byVersion.size === 0 ? "no learner pages found" : "single generation present; nothing to freeze",
    };
  }
  if (explicit && byVersion.size <= 1 && !pages.some((page) => (page.learningVersionId ?? "unversioned") !== explicit || !(page.learningUnitId && contractUnitIds.has(page.learningUnitId)))) {
    return {
      currentVersion: explicit,
      versionsSeen,
      pagesKept: pages.map((page) => page.rel),
      pagesQuarantined: [],
      staleSectionsRemoved: [],
      changed: false,
      reason: "single current generation present; nothing to freeze",
    };
  }

  // Rank versions: most contract units covered, then fewest foreign units,
  // then newest embedded generation date, then version id for determinism.
  const scored = [...byVersion.entries()].map(([version, versionPages]) => {
    const unitIds = new Set(versionPages.map((page) => page.learningUnitId).filter(Boolean) as string[]);
    const covered = [...unitIds].filter((id) => contractUnitIds.has(id)).length;
    const foreign = [...unitIds].filter((id) => !contractUnitIds.has(id)).length;
    const newestDate = versionPages
      .map((page) => Date.parse(page.date ?? ""))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => right - left)[0] ?? 0;
    return { version, versionPages, covered, foreign, newestDate };
  }).sort((left, right) =>
    right.covered - left.covered
    || left.foreign - right.foreign
    || right.newestDate - left.newestDate
    || left.version.localeCompare(right.version));

  const current = explicit
    ? (scored.find((entry) => entry.version === explicit) ?? { version: explicit, covered: contractUnitIds.size, foreign: 0 })
    : scored[0];
  const pagesKept: string[] = [];
  const pagesQuarantined: string[] = [];
  for (const page of pages) {
    const isCurrentVersion = (page.learningVersionId ?? "unversioned") === current.version;
    const unitInContract = page.learningUnitId ? contractUnitIds.has(page.learningUnitId) : false;
    if (isCurrentVersion && unitInContract) {
      pagesKept.push(page.rel);
    } else {
      pagesQuarantined.push(moveToQuarantine(gardenDir, buildId, page));
    }
  }
  const staleSectionsRemoved = removeEmptyLearningSectionsByPresence(gardenDir, new Set(pagesKept));

  return {
    currentVersion: current.version,
    versionsSeen,
    pagesKept,
    pagesQuarantined,
    staleSectionsRemoved,
    changed: pagesQuarantined.length > 0 || staleSectionsRemoved.length > 0,
    reason: `kept generation ${current.version} (covers ${current.covered} contract unit(s), ${current.foreign} foreign); quarantined ${pagesQuarantined.length} page(s) from ${byVersion.size - 1} stale generation(s)`,
  };
}

/** Remove learning section folders that retain no kept page. */
function removeEmptyLearningSectionsByPresence(gardenDir: string, keptRels: Set<string>): string[] {
  const removed: string[] = [];
  const learningDir = path.join(gardenDir, "learning");
  const keptSections = new Set([...keptRels].map((rel) => rel.split("/").slice(0, 2).join("/")));
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(learningDir, { withFileTypes: true });
  } catch {
    return removed;
  }
  for (const dirent of entries) {
    if (!dirent.isDirectory()) continue;
    const rel = `learning/${dirent.name}`;
    if (keptSections.has(rel)) continue;
    fs.rmSync(path.join(learningDir, dirent.name), { recursive: true, force: true });
    removed.push(rel);
  }
  return removed;
}
