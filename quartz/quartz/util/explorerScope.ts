type GardenRootNode = {
  isFolder: boolean
  slugSegment: string
  data: unknown | null
  children?: GardenRootNode[]
}

const LEGACY_VISIBLE_GARDEN_FOLDERS = new Set(["learning", "sources"])
const INTERNAL_GARDEN_FOLDERS = new Set([
  ".breadboard",
  "assets",
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

  // Save page creates Generated/ without an index. Published children also
  // make a folder navigable; legacy topic cards have already been filtered out
  // of the content index by RemoveDrafts.
  return node.data !== null || LEGACY_VISIBLE_GARDEN_FOLDERS.has(segment) ||
    (node.children?.some(isVisibleGardenRootEntry) ?? false)
}
