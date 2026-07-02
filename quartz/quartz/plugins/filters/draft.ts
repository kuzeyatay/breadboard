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
    const internalConcept =
      breadboardType === "internal_concept" || knowledgeType === "internal-concept"
    if (internalConcept) return false
    return !draftFlag
  },
})
