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

export function isVisibleGardenRootFolder(node: GardenRootNode): boolean {
  if (!node.isFolder) return false

  const segment = node.slugSegment.trim().toLowerCase()
  if (!segment || INTERNAL_GARDEN_FOLDERS.has(segment)) return false

  // User-created folders have an `_index.md`, represented by data on the folder node.
  // Keep the two historical garden folders visible for older content without an index.
  return node.data !== null || LEGACY_VISIBLE_GARDEN_FOLDERS.has(segment)
}
