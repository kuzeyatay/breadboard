type GardenRootNode = {
  isFolder: boolean
  slugSegment: string
  data: unknown | null
}

const LEGACY_VISIBLE_GARDEN_FOLDERS = new Set(["learning", "sources"])
const INTERNAL_GARDEN_FOLDERS = new Set([
  ".breadboard",
  "assets",
  "generated",
  "internal",
  "static",
  "tags",
])

export function isVisibleGardenRootEntry(node: GardenRootNode): boolean {
  const segment = node.slugSegment.trim().toLowerCase()
  if (!segment) return false

  // Notes may live directly at the garden root. They are real Explorer
  // entries, even though they are not folders; dropping them leaves a garden
  // with dozens of pages looking empty in the navigation tree.
  if (!node.isFolder) return segment !== "index" && node.data !== null

  if (INTERNAL_GARDEN_FOLDERS.has(segment)) return false

  // User-created folders have an `_index.md`, represented by data on the folder node.
  // Keep the two historical garden folders visible for older content without an index.
  return node.data !== null || LEGACY_VISIBLE_GARDEN_FOLDERS.has(segment)
}
