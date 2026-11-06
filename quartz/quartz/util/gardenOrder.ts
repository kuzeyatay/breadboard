export interface GardenOrderNode {
  slugSegment: string
  slug: string
  displayName: string
  isFolder: boolean
  data: { knowledgeType?: string; breadboardType?: string } | null
}

// Keep this function self-contained: Explorer serializes it into the page.
export function compareGardenNodes(a: GardenOrderNode, b: GardenOrderNode): number {
  const rank = (node: GardenOrderNode) => {
    const segment = node.slugSegment.toLowerCase()
    const slug = String(node.slug ?? "").toLowerCase()
    const knowledgeType = node.data?.knowledgeType ?? ""
    const breadboardType = node.data?.breadboardType ?? ""
    if (segment === "learning" || slug.endsWith("/learning/index")) return 0
    if (
      knowledgeType === "topic-overview" ||
      knowledgeType === "learning-map" ||
      knowledgeType === "source-map" ||
      knowledgeType === "scope-contract"
    )
      return 1
    if (
      /^\d+\b/.test(segment) ||
      knowledgeType === "textbook-section" ||
      knowledgeType === "learning-section"
    )
      return 2
    if (
      knowledgeType === "textbook-page" ||
      knowledgeType === "learning-page" ||
      breadboardType === "textbook_page" ||
      breadboardType === "learning_page"
    )
      return 3
    if (segment === "sources" || knowledgeType === "source-document") return 4
    if (segment === "legacy") return 8
    if (knowledgeType === "internal-concept" || breadboardType === "internal_concept") return 9
    return 5
  }
  const rankDiff = rank(a) - rank(b)
  if (rankDiff !== 0) return rankDiff
  if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
  return a.displayName.localeCompare(b.displayName, undefined, {
    numeric: true,
    sensitivity: "base",
  })
}
