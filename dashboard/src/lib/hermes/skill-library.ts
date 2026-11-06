import type { DocumentSkillStatus } from "../document-skills/types.ts";
import type { SkillAvailability } from "./skill-compatibility.ts";
import type { ApprovedSkillSummary } from "./skills.ts";

export interface SkillLibraryEntry {
  upstreamId: string;
  name: string;
  slug: string;
  description: string;
  source: string;
  installationStatus: string;
  availability?: SkillAvailability;
  documentStatus?: DocumentSkillStatus;
}

export function canUseSkill(skill: Pick<SkillLibraryEntry, "installationStatus" | "availability">): boolean {
  return skill.installationStatus === "installed" && skill.availability === "ready";
}

export function documentSkillAvailability(status: DocumentSkillStatus, error: string | null) {
  return {
    documentStatus: status,
    availability: (status === "ready" ? "ready" : "unavailable") as SkillAvailability,
    reasons: status === "ready" ? [] : [status === "building"
      ? "The document is still being distilled."
      : `The document could not be distilled: ${error || "unknown error"}`],
  };
}

/** Availability reflects the reviewed files, never a newer upstream manifest. */
export function installedSkillCompatibility(skill: ApprovedSkillSummary | undefined) {
  return {
    availability: (!skill ? "unavailable" : !skill.enabled || !skill.healthy ? "needs_review" : skill.availability) as SkillAvailability,
    reasons: !skill ? ["The installed skill files are missing. Review and install this skill again."]
      : !skill.enabled || !skill.healthy ? ["The installed skill files have changed. Review this skill again before using it."]
      : skill.unavailableReasons,
    contract: skill?.capabilityContract ?? null,
    requirements: skill?.compatibilityRequirements ?? [],
  };
}

/** Merge by stable identity before searching, ordering, or taking a page.
 * Later sources own the executable state; distinct publishers may share a slug.
 */
export function querySkillLibrary<T extends SkillLibraryEntry>(input: {
  skills: readonly T[];
  query?: string;
  page?: number;
  perPage?: number;
  recentIds?: string[];
  pinnedIds?: string[];
  recentOnly?: boolean;
}) {
  const recent = new Map((input.recentIds ?? []).map((id, index) => [id, index]));
  const pinned = new Set(input.pinnedIds ?? []);
  const query = (input.query ?? "").trim().toLowerCase();
  const skills = [...new Map(input.skills.map((skill) => [skill.upstreamId, skill])).values()]
    .filter((skill) => (!input.recentOnly || recent.has(skill.upstreamId)) &&
      (!query || `${skill.name}\n${skill.description}\n${skill.slug}\n${skill.source}`.toLowerCase().includes(query)))
    .sort((left, right) =>
      (input.recentOnly ? 0 : Number(pinned.has(right.upstreamId)) - Number(pinned.has(left.upstreamId))) ||
      (recent.get(left.upstreamId) ?? Number.MAX_SAFE_INTEGER) - (recent.get(right.upstreamId) ?? Number.MAX_SAFE_INTEGER) ||
      left.name.localeCompare(right.name) || left.upstreamId.localeCompare(right.upstreamId));
  const page = Number.isFinite(input.page) ? Math.max(0, Math.trunc(input.page!)) : 0;
  const perPage = Number.isFinite(input.perPage) ? Math.min(100, Math.max(1, Math.trunc(input.perPage!))) : 50;
  const start = page * perPage;
  return {
    skills: skills.slice(start, start + perPage),
    pagination: { page, perPage, total: skills.length, hasMore: start + perPage < skills.length },
  };
}
