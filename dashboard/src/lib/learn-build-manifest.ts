/**
 * Active build manifest + page ownership (Part 3).
 *
 * Page identity is `learningUnitId` + `pageId`, plus the build that produced the
 * page — NEVER the filesystem path or title. The manifest is the single record
 * of which pages the current build owns; structural reconciliation compares the
 * on-disk tree against it to decide what is current, foreign, or obsolete.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const ACTIVE_BUILD_MANIFEST_REL = ".breadboard/active-build-manifest.json";
export const ACTIVE_BUILD_MANIFEST_SCHEMA_VERSION = 1;

export type ManifestUnitStatus = "planned" | "generated" | "repaired" | "accepted";

export interface ManifestUnitEntry {
  unitId: string;
  pageId: string;

  sectionId: string;
  expectedPagePath: string;

  generationAttempt: number;
  contentFingerprint: string;

  status: ManifestUnitStatus;
}

export interface ActiveLearnBuildManifest {
  schemaVersion: number;

  buildId: string;
  jobId: string;
  gardenSlug: string;

  sourceSetFingerprint: string;
  contractFingerprint: string;
  pathPlanFingerprint: string;

  units: ManifestUnitEntry[];

  sectionIds: string[];
  generatedVisualIds: string[];

  createdAt: string;
  updatedAt: string;
}

/** Ownership metadata every generated learner page carries in frontmatter. */
export interface PageOwnershipMetadata {
  learningUnitId: string;
  pageId: string;
  generatedByBuildId: string;
  generatedByJobId: string;
  contractFingerprint: string;
  generationAttempt: number;
}

/** Stable page id for a unit — NEVER derived from a path or title. */
export function pageIdForUnit(unitId: string): string {
  return `page:${unitId}`;
}

export function stableFingerprint(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 16);
}

/** Fingerprint the ordered contract so a changed contract forces re-planning. */
export function contractFingerprint(units: Array<{ id: string; title: string; role: string }>): string {
  return stableFingerprint(units.map((unit) => [unit.id, unit.title, unit.role]));
}

/** Fingerprint the planned page paths so a renamed section/path is detectable. */
export function pathPlanFingerprint(entries: Array<{ unitId: string; expectedPagePath: string }>): string {
  return stableFingerprint([...entries].sort((left, right) => left.unitId.localeCompare(right.unitId)));
}

export function createActiveBuildManifest(input: {
  buildId: string;
  jobId: string;
  gardenSlug: string;
  sourceSetFingerprint: string;
  contractFingerprint: string;
  units: Array<{ unitId: string; sectionId: string; expectedPagePath: string }>;
  sectionIds: string[];
}): ActiveLearnBuildManifest {
  const now = new Date().toISOString();
  const units: ManifestUnitEntry[] = input.units.map((unit) => ({
    unitId: unit.unitId,
    pageId: pageIdForUnit(unit.unitId),
    sectionId: unit.sectionId,
    expectedPagePath: unit.expectedPagePath,
    generationAttempt: 1,
    contentFingerprint: "",
    status: "planned",
  }));
  return {
    schemaVersion: ACTIVE_BUILD_MANIFEST_SCHEMA_VERSION,
    buildId: input.buildId,
    jobId: input.jobId,
    gardenSlug: input.gardenSlug,
    sourceSetFingerprint: input.sourceSetFingerprint,
    contractFingerprint: input.contractFingerprint,
    pathPlanFingerprint: pathPlanFingerprint(input.units),
    units,
    sectionIds: [...input.sectionIds],
    generatedVisualIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function manifestPath(gardenDir: string): string {
  return path.join(gardenDir, ...ACTIVE_BUILD_MANIFEST_REL.split("/"));
}

export function writeActiveBuildManifest(gardenDir: string, manifest: ActiveLearnBuildManifest): void {
  const abs = manifestPath(gardenDir);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(abs, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function readActiveBuildManifest(gardenDir: string): ActiveLearnBuildManifest | null {
  const abs = manifestPath(gardenDir);
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, "utf-8")) as ActiveLearnBuildManifest;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.units)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Record a unit's page as generated/repaired/accepted with its content
 * fingerprint and attempt count. Returns the updated manifest (same object). */
export function recordUnitPage(
  manifest: ActiveLearnBuildManifest,
  update: {
    unitId: string;
    expectedPagePath?: string;
    sectionId?: string;
    contentFingerprint?: string;
    status?: ManifestUnitStatus;
    bumpAttempt?: boolean;
  },
): ActiveLearnBuildManifest {
  const entry = manifest.units.find((unit) => unit.unitId === update.unitId);
  if (!entry) return manifest;
  if (update.expectedPagePath) entry.expectedPagePath = update.expectedPagePath;
  if (update.sectionId) entry.sectionId = update.sectionId;
  if (update.contentFingerprint !== undefined) entry.contentFingerprint = update.contentFingerprint;
  if (update.status) entry.status = update.status;
  if (update.bumpAttempt) entry.generationAttempt += 1;
  manifest.updatedAt = new Date().toISOString();
  return manifest;
}

/** Render the ownership frontmatter lines for a page (appended by the writer). */
export function ownershipMetadata(
  manifest: ActiveLearnBuildManifest,
  unitId: string,
): PageOwnershipMetadata {
  const entry = manifest.units.find((unit) => unit.unitId === unitId);
  return {
    learningUnitId: unitId,
    pageId: pageIdForUnit(unitId),
    generatedByBuildId: manifest.buildId,
    generatedByJobId: manifest.jobId,
    contractFingerprint: manifest.contractFingerprint,
    generationAttempt: entry?.generationAttempt ?? 1,
  };
}

/** Parse ownership metadata out of a page's raw frontmatter (scalar reads). */
export function readOwnershipFromFrontmatter(rawFrontmatter: string): Partial<PageOwnershipMetadata> {
  const scalar = (key: string): string | undefined => {
    const match = new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m").exec(rawFrontmatter);
    if (!match) return undefined;
    return match[1].replace(/^["']|["']$/g, "").trim() || undefined;
  };
  const attempt = scalar("generationAttempt");
  return {
    learningUnitId: scalar("learningUnitId"),
    pageId: scalar("pageId"),
    generatedByBuildId: scalar("generatedByBuildId"),
    generatedByJobId: scalar("generatedByJobId"),
    contractFingerprint: scalar("contractFingerprint"),
    generationAttempt: attempt ? Number(attempt) : undefined,
  };
}
