import { QuartzFilterPlugin } from "../types"

interface RemoveDraftsOptions {
  showLegacySubtopicPages?: boolean
}

function frontmatterString(fm: Record<string, unknown> | undefined, key: string): string {
  const value = fm?.[key]
  return typeof value === "string" ? value : ""
}

function isLegacySubtopicPath(relativePath = ""): boolean {
  const parts = relativePath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase().split("/")
  return parts.some(
    (part, index) =>
      part === "generated" ||
      part === "generated subtopics" ||
      part === "subtopics" ||
      part === "ai topics" ||
      part === "topic cards" ||
      (part === "legacy" && parts[index + 1] === "generated subtopics"),
  )
}

/** Frontmatter types that are internal pipeline artifacts, never learner pages.
 * Raw source documents and planning artifacts (source map, scope contract,
 * source coverage) are internal too — only their distilled lessons under
 * Learning/ are learner-facing. */
const INTERNAL_KNOWLEDGE_TYPES = new Set([
  "internal-concept",
  "source-document",
  "source-map",
  "scope-contract",
  "source-coverage",
])

const INTERNAL_BREADBOARD_TYPES = new Set([
  "internal_concept",
  "source_document",
  "source_map",
  "scope_contract",
  "source_coverage",
])

/** Internal Breadboard metadata lives under Internal/, .breadboard/, sources/,
 * and numbered source-snapshot folders — none of which are learner-facing. */
function isInternalPath(relativePath = ""): boolean {
  const parts = relativePath.replace(/\\/g, "/").replace(/^\/+/, "").split("/")
  // parts[0] is the garden slug for nested content; check every segment so the
  // rule holds for both "garden/Internal/x.md" and "Internal/x.md" layouts.
  return parts.some((part) => {
    const lower = part.toLowerCase()
    return (
      lower === "internal" ||
      lower === ".breadboard" ||
      lower === "sources" ||
      /^\d+\.\s*source-snapshots$/.test(lower)
    )
  })
}

/** Internal planning artifacts that older ingest wrote directly under
 * Learning/. They must never be published even if a stale copy lingers. */
function isInternalLearningArtifact(relativePath = ""): boolean {
  const lower = relativePath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase()
  return (
    lower.endsWith("learning/source map.md") ||
    lower.endsWith("learning/scope contract.md") ||
    lower.endsWith("learning/source coverage.md")
  )
}

function slugifyLoose(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** Ingest-era stub pages titled after the raw upload ("1.1 2510.27379v1"):
 * a page whose title is just the source file name is an artifact, not a lesson. */
function isRawFileArtifactPage(fm: Record<string, unknown> | undefined): boolean {
  const title = frontmatterString(fm, "title").replace(/^\d+(?:\.\d+)*\.?\s*/, "")
  const sourceFile = frontmatterString(fm, "source_file").replace(
    /\.(pdf|docx?|pptx?|xlsx?|txt|md|csv|zip|png|jpe?g|webp)$/i,
    "",
  )
  if (!title || !sourceFile) return false
  return slugifyLoose(title) === slugifyLoose(sourceFile)
}

// Lesson sections/pages. The Learn pipeline stamps generated_by: learn_button
// and writes them under Learning/. Ingest-era sections/pages carry the same
// knowledge_type but no learn_button stamp, so they are internal scaffolding.
const LESSON_KNOWLEDGE_TYPES = new Set(["learning-page", "learning-section", "textbook-page", "textbook-section"])
const LESSON_BREADBOARD_TYPES = new Set(["learning_page", "learning_section", "textbook_page", "textbook_section"])

function isLearnAuthored(fm: Record<string, unknown> | undefined): boolean {
  return (
    frontmatterString(fm, "generated_by") === "learn_button" ||
    frontmatterString(fm, "generatedBy") === "learn_button"
  )
}

/** An ingest-produced lesson section/page (not authored by the Learn pipeline).
 * These are internal scaffolding and never learner-facing. Legacy flat
 * `knowledge-topic` gardens are a different type and stay visible. */
function isIngestLessonArtifact(
  fm: Record<string, unknown> | undefined,
  knowledgeType: string,
  breadboardType: string,
): boolean {
  const isLesson = LESSON_KNOWLEDGE_TYPES.has(knowledgeType) || LESSON_BREADBOARD_TYPES.has(breadboardType)
  return isLesson && !isLearnAuthored(fm)
}

export const RemoveDrafts: QuartzFilterPlugin<RemoveDraftsOptions> = (opts = {}) => ({
  name: "RemoveDrafts",
  shouldPublish(_ctx, [_tree, vfile]) {
    const fm = vfile.data?.frontmatter as Record<string, unknown> | undefined
    const relativePath = String(vfile.data?.relativePath ?? "")
    const knowledgeType = frontmatterString(fm, "knowledge_type")
    const breadboardType =
      frontmatterString(fm, "breadboardType") || frontmatterString(fm, "breadboard_type")
    const legacySubtopic =
      frontmatterString(fm, "legacy_subtopic_page") === "true" || isLegacySubtopicPath(relativePath)
    if (legacySubtopic) return opts.showLegacySubtopicPages === true

    const draftFlag: boolean = fm?.draft === true || fm?.draft === "true"
    if (
      INTERNAL_KNOWLEDGE_TYPES.has(knowledgeType) ||
      INTERNAL_BREADBOARD_TYPES.has(breadboardType) ||
      frontmatterString(fm, "internal") === "true" ||
      isInternalPath(relativePath) ||
      isInternalLearningArtifact(relativePath) ||
      isRawFileArtifactPage(fm) ||
      isIngestLessonArtifact(fm, knowledgeType, breadboardType)
    ) {
      return false
    }
    return !draftFlag
  },
})
