export const LEARNING_FOLDER = "Learning";
// Learner-facing lesson pages/sections. The word "textbook" is never written to
// visible markdown, so the current values are learning-* and the older
// textbook-* values are still accepted when reading existing gardens.
export const LEARNING_PAGE_TYPE = "learning-page";
export const LEARNING_SECTION_TYPE = "learning-section";
/** @deprecated legacy value, still read for back-compat. */
export const TEXTBOOK_PAGE_TYPE = LEARNING_PAGE_TYPE;
export const LEARNING_PAGE_TYPES = new Set([LEARNING_PAGE_TYPE, "textbook-page"]);
export const LEARNING_PAGE_BREADBOARD_TYPES = new Set([
  "learning_page",
  "textbook_page",
]);
export const LEARNING_SECTION_TYPES = new Set([
  LEARNING_SECTION_TYPE,
  "textbook-section",
  "learning_section",
  "textbook_section",
]);
export const INTERNAL_CONCEPT_TYPE = "internal-concept";
export const LEGACY_GENERATED_TOPIC_FOLDER = "generated";
export const INTERNAL_CONCEPT_FOLDER = "Internal/Concept Graph";

export const LEARNING_PAGE_ORDER = [
  "Learning/Topic Overview.md",
  "Learning/Learning Map.md",
  "Learning/Source Map.md",
  "Learning/Scope Contract.md",
  "Learning/Source Coverage.md",
] as const;

export type BreadboardMetadata = Record<string, string | string[] | undefined>;

function metadataString(data: BreadboardMetadata | undefined, key: string): string {
  const value = data?.[key];
  return typeof value === "string" ? value : "";
}

function normalizedRelPath(relPath = ""): string {
  return relPath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

export function showLegacySubtopicPages(value?: string | null): boolean {
  return /^(1|true|yes|on)$/i.test((value ?? "").trim());
}

export function isLegacySubtopicRelPath(relPath = ""): boolean {
  const normalized = normalizedRelPath(relPath);
  return (
    normalized.startsWith(`${LEGACY_GENERATED_TOPIC_FOLDER}/`) ||
    normalized.startsWith("generated subtopics/") ||
    normalized.startsWith("subtopics/") ||
    normalized.startsWith("ai topics/") ||
    normalized.startsWith("topic cards/") ||
    normalized.startsWith("legacy/generated subtopics/")
  );
}

export function breadboardType(data: BreadboardMetadata | undefined): string {
  return (
    metadataString(data, "breadboardType") ||
    metadataString(data, "breadboard_type") ||
    metadataString(data, "knowledge_type")
  );
}

export function isInternalConceptMetadata(
  data: BreadboardMetadata | undefined,
  relPath = "",
): boolean {
  const type = breadboardType(data);
  const knowledgeType = metadataString(data, "knowledge_type");
  return (
    type === "internal_concept" ||
    type === INTERNAL_CONCEPT_TYPE ||
    knowledgeType === INTERNAL_CONCEPT_TYPE ||
    (knowledgeType === "knowledge-topic" && isLegacySubtopicRelPath(relPath))
  );
}

export function isLearningPageMetadata(data: BreadboardMetadata | undefined): boolean {
  const knowledgeType = metadataString(data, "knowledge_type");
  const bbType = breadboardType(data);
  return (
    LEARNING_PAGE_TYPES.has(knowledgeType) ||
    LEARNING_PAGE_TYPES.has(bbType) ||
    LEARNING_PAGE_BREADBOARD_TYPES.has(bbType)
  );
}

/** @deprecated use isLearningPageMetadata */
export const isTextbookPageMetadata = isLearningPageMetadata;

export function isLearningPageRelPath(relPath = ""): boolean {
  return normalizedRelPath(relPath).startsWith(`${LEARNING_FOLDER.toLowerCase()}/`);
}

export function shouldPublishGardenPage({
  metadata,
  relPath,
  showLegacySubtopics = false,
}: {
  metadata?: BreadboardMetadata;
  relPath?: string;
  showLegacySubtopics?: boolean;
}): boolean {
  const legacySubtopic =
    isLegacySubtopicRelPath(relPath) || metadataString(metadata, "legacy_subtopic_page") === "true";
  if (legacySubtopic) return showLegacySubtopics;
  if (metadataString(metadata, "draft") === "true") return false;
  if (isInternalConceptMetadata(metadata, relPath)) return false;
  return true;
}

export function readingOrderRank(relPath = "", type = ""): number {
  const normalized = relPath.replace(/\\/g, "/");
  const exact = LEARNING_PAGE_ORDER.findIndex(
    (item) => item.toLowerCase() === normalized.toLowerCase(),
  );
  if (exact >= 0) return exact;
  if (isLearningPageRelPath(normalized)) return 10;
  if (LEARNING_PAGE_TYPES.has(type) || normalized.match(/^\d+\.\s*[^/]+\//)) return 20;
  if (normalized.toLowerCase().startsWith("sources/")) return 30;
  if (normalized.toLowerCase().startsWith("legacy/")) return 90;
  if (isLegacySubtopicRelPath(normalized)) return 95;
  return 50;
}
