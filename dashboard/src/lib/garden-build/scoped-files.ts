import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { GardenIssue } from "./issues.ts";
import type { LearnRepairScope } from "./repair-scope.ts";
import type { GardenBuildState } from "./types.ts";

export interface ScopedFileMutationPolicy {
  allowedFiles: string[];
  allowedDirectories: string[];
  requiredUnchangedFiles: { path: string; fingerprint: string }[];
}

export interface ScopedFileMutationVerification {
  passed: boolean;
  changedFiles: string[];
  unauthorizedChanges: string[];
  requiredUnchangedViolations: string[];
  sourceFileChanges: string[];
}

function rel(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`Unsafe garden-relative path: ${value}`);
  }
  return normalized;
}

function hash(buffer: Buffer | string): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function fingerprintGardenFiles(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (absolute: string, prefix: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(absolute, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const childRel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const child = path.join(absolute, entry.name);
      if (entry.isDirectory()) walk(child, childRel);
      else if (entry.isFile()) result[childRel] = hash(fs.readFileSync(child));
    }
  };
  walk(root, "");
  return result;
}

function pagePath(state: GardenBuildState, pageId: string): string | undefined {
  const value = state.pages[pageId]?.legacyPath;
  return typeof value === "string" && value.trim() ? rel(value) : undefined;
}

function sectionIndexPaths(state: GardenBuildState, scope: LearnRepairScope): string[] {
  const result = new Set<string>();
  for (const sectionId of scope.sectionIds) {
    const section = state.sections[sectionId];
    const firstPath = section?.unitIds.map((unitId) => pagePath(state, state.units[unitId]?.pageId ?? "")).find(Boolean);
    if (firstPath) result.add(`${firstPath.split("/").slice(0, -1).join("/")}/_index.md`);
  }
  return [...result];
}

export function buildScopedFileMutationPolicy(
  state: GardenBuildState,
  scope: LearnRepairScope,
  fingerprintsBefore: Record<string, string>,
): ScopedFileMutationPolicy {
  const allowed = new Set<string>([
    ".breadboard/scoped-repair.json",
    ".breadboard/scoped-repair.md",
  ]);
  const directories = new Set<string>();
  for (const pageId of scope.pageIds) {
    const file = pagePath(state, pageId);
    if (file) allowed.add(file);
  }
  for (const visualId of scope.visualIds) {
    const visual = state.visuals[visualId];
    const fromFile = typeof visual?.provenance.fromFile === "string" ? visual.provenance.fromFile : undefined;
    if (fromFile) allowed.add(rel(fromFile));
    allowed.add(`.breadboard/visuals/${visualId}.json`);
    directories.add(`.breadboard/visuals/${visualId}`);
  }
  for (const projection of scope.requiredProjectionRebuilds) {
    if (projection === "contract") {
      allowed.add(".breadboard/learning-unit-contract.json");
      allowed.add(".breadboard/planning/learning-unit-contract.json");
    }
    if (projection === "claims") allowed.add(".breadboard/claims.json");
    if (projection === "concepts") allowed.add(".breadboard/concept-registry.json");
    if (projection === "visual_index") {
      allowed.add(".breadboard/visual-index.json");
      allowed.add(".breadboard/visualization-plan.json");
      allowed.add(".breadboard/visualization-coverage.json");
      allowed.add(".breadboard/visualization-coverage.md");
    }
    if (projection === "source_coverage") allowed.add(".breadboard/planning/Source Coverage.md");
    if (projection === "navigation") {
      allowed.add("learning/_index.md");
      allowed.add("learning/Learning Map.md");
      for (const file of sectionIndexPaths(state, scope)) allowed.add(file);
    }
    if (projection === "validation_reports") {
      allowed.add(".breadboard/validation-report.md");
      allowed.add(".breadboard/repair-report.md");
      allowed.add(".breadboard/repair-log.json");
    }
    if (projection === "acceptance_status") allowed.add(".breadboard/acceptance-status.json");
  }
  if (!scope.allowContractMutation) {
    allowed.delete(".breadboard/learning-unit-contract.json");
    allowed.delete(".breadboard/planning/learning-unit-contract.json");
  }
  const requiredUnchangedFiles = Object.entries(fingerprintsBefore)
    .filter(([file]) => !allowed.has(file) && ![...directories].some((dir) => file.startsWith(`${dir}/`)))
    .map(([file, fingerprint]) => ({ path: file, fingerprint }));
  return {
    allowedFiles: [...allowed].sort(),
    allowedDirectories: [...directories].sort(),
    requiredUnchangedFiles,
  };
}

function allowedByPolicy(file: string, policy: ScopedFileMutationPolicy): boolean {
  return policy.allowedFiles.includes(file)
    || policy.allowedDirectories.some((directory) => file === directory || file.startsWith(`${directory}/`));
}

export function verifyScopedFileMutationPolicy(
  before: Record<string, string>,
  after: Record<string, string>,
  policy: ScopedFileMutationPolicy,
): ScopedFileMutationVerification {
  const all = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changedFiles = [...all].filter((file) => before[file] !== after[file]).sort();
  const unauthorizedChanges = changedFiles.filter((file) => !allowedByPolicy(file, policy));
  const requiredUnchangedViolations = policy.requiredUnchangedFiles
    .filter((entry) => after[entry.path] !== entry.fingerprint)
    .map((entry) => entry.path)
    .sort();
  const sourceFileChanges = changedFiles.filter((file) => file === "sources" || file.startsWith("sources/") || file.startsWith(".breadboard/sources/"));
  return {
    passed: unauthorizedChanges.length === 0 && requiredUnchangedViolations.length === 0 && sourceFileChanges.length === 0,
    changedFiles, unauthorizedChanges, requiredUnchangedViolations, sourceFileChanges,
  };
}

function markdownParts(markdown: string): { frontmatter: string; body: string } {
  const match = markdown.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n?)([\s\S]*)$/);
  return match ? { frontmatter: match[1], body: match[2] } : { frontmatter: "", body: markdown };
}

export function markdownBodyFingerprint(markdown: string): string {
  return hash(markdownParts(markdown).body);
}

function removeOwnedVisualBlocks(markdown: string, visualIds: Set<string>): string {
  return markdown.replace(/```breadboard-(?:generated-)?visual\r?\n([\s\S]*?)\r?\n```/g, (block, payload: string) => {
    try {
      const id = String((JSON.parse(payload) as { id?: unknown }).id ?? "");
      return visualIds.has(id) ? `<!-- scoped-visual:${id} -->` : block;
    } catch { return block; }
  });
}

/** Normalize only the explicitly-owned visual fields; every other byte remains significant. */
export function visualOwnedBytesFingerprint(markdown: string, ownedVisualIds: string[]): string {
  const ids = new Set(ownedVisualIds);
  const parts = markdownParts(markdown);
  const frontmatter = parts.frontmatter
    .split(/(?<=\n)/)
    .filter((line) => !/^(?:visuals|visualIds|sourceVisualIds|semanticRepair|repairProvenance):/.test(line))
    .join("");
  return hash(`${frontmatter}${removeOwnedVisualBlocks(parts.body, ids)}`);
}

export interface PageIdentityVerification {
  passed: boolean;
  excludedPageChanges: string[];
  affectedPageBoundaryChanges: string[];
}

export function verifyPageByteIdentity(input: {
  state: GardenBuildState;
  scope: LearnRepairScope;
  issues: GardenIssue[];
  beforeRoot: string;
  afterRoot: string;
}): PageIdentityVerification {
  const excludedPageChanges: string[] = [];
  const affectedPageBoundaryChanges: string[] = [];
  for (const pageId of input.scope.explicitlyExcludedPageIds) {
    const file = pagePath(input.state, pageId);
    if (!file) continue;
    const before = fs.existsSync(path.join(input.beforeRoot, ...file.split("/"))) ? fs.readFileSync(path.join(input.beforeRoot, ...file.split("/"))) : null;
    const after = fs.existsSync(path.join(input.afterRoot, ...file.split("/"))) ? fs.readFileSync(path.join(input.afterRoot, ...file.split("/"))) : null;
    if (!before || !after || !before.equals(after)) excludedPageChanges.push(pageId);
  }
  const selectedTypes = new Set(input.issues.filter((issue) => input.scope.issueIds.includes(issue.issueId)).map((issue) => issue.type));
  const visualOnly = [...selectedTypes].length > 0 && [...selectedTypes].every((type) => ["missing_planned_visual", "visual_type_mismatch", "duplicate_visual_signature", "visual_grounding_mismatch", "visual_grounding"].includes(type));
  const metadataOnly = [...selectedTypes].length > 0 && !input.scope.allowPageBodyRewrite && !visualOnly;
  for (const pageId of input.scope.pageIds) {
    const file = pagePath(input.state, pageId);
    if (!file) continue;
    const beforePath = path.join(input.beforeRoot, ...file.split("/"));
    const afterPath = path.join(input.afterRoot, ...file.split("/"));
    if (!fs.existsSync(beforePath) || !fs.existsSync(afterPath)) { affectedPageBoundaryChanges.push(pageId); continue; }
    const before = fs.readFileSync(beforePath, "utf8");
    const after = fs.readFileSync(afterPath, "utf8");
    if (visualOnly && visualOwnedBytesFingerprint(before, input.scope.visualIds) !== visualOwnedBytesFingerprint(after, input.scope.visualIds)) {
      affectedPageBoundaryChanges.push(pageId);
    }
    if (metadataOnly && markdownBodyFingerprint(before) !== markdownBodyFingerprint(after)) affectedPageBoundaryChanges.push(pageId);
  }
  return { passed: excludedPageChanges.length === 0 && affectedPageBoundaryChanges.length === 0, excludedPageChanges, affectedPageBoundaryChanges };
}
