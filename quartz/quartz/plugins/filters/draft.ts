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

/** Frontmatter types that are internal pipeline artifacts, never learner pages:
 * raw source archives and the planning documents the Learn pipeline writes. */
const INTERNAL_KNOWLEDGE_TYPES = new Set([
  "internal-concept",
  "source-document",
  "source-map",
  "scope-contract",
  "source-coverage",
  "learning-map",
])

const INTERNAL_BREADBOARD_TYPES = new Set([
  "internal_concept",
  "source_document",
  "source_map",
  "scope_contract",
  "source_coverage",
  "learning_map",
])

/** Raw source material lives under sources/ (and older Internal/ trees). */
function isInternalPath(relativePath = ""): boolean {
  const parts = relativePath.replace(/\\/g, "/").replace(/^\/+/, "").split("/")
  // parts[0] is the garden slug for nested content; check every segment so the
  // rule holds for both "garden/sources/x.md" and "sources/x.md" layouts.
  return parts.some((part) => {
    const lower = part.toLowerCase()
    return lower === "sources" || lower === "internal" || lower === ".breadboard"
  })
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
      isRawFileArtifactPage(fm)
    ) {
      return false
    }
    return !draftFlag
  },
})
