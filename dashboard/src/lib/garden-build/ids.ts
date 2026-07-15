import crypto from "node:crypto";
import type { FormulaAssignmentId, LearningUnitId, PageId, SectionId } from "./types.ts";

function shortHash(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
}

export function pageIdForUnit(unitId: LearningUnitId): PageId {
  return `page:${unitId}`;
}

export function sectionIdForUnitMembership(unitIds: readonly LearningUnitId[]): SectionId {
  return `section:${shortHash([...unitIds].join("\u0000"))}`;
}

export function formulaAssignmentId(formulaAnchorId: string, unitId: LearningUnitId): FormulaAssignmentId {
  return `formula-assignment:${formulaAnchorId}:${unitId}`;
}

export function buildIdFor(gardenSlug: string, sourceSetHash: string): string {
  return `build:${gardenSlug}:${shortHash(sourceSetHash || gardenSlug)}`;
}
