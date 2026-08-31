import type { ContentDetails } from "../plugins/emitters/contentIndex"
import { FileTrieNode } from "./fileTrie"

const VIRTUAL_CLUSTER_ROOT = "__breadboard-garden-clusters__"
const FOLDER_SEPARATOR = "/"

function folderSegments(folder: string | undefined): string[] {
  return (folder ?? "")
    .split(FOLDER_SEPARATOR)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

export function gardenClusterFoldersFromJson(value: string | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : []
  } catch {
    return []
  }
}

export function isVirtualGardenClusterNode(node: FileTrieNode): boolean {
  return String(node.slug).startsWith(`${VIRTUAL_CLUSTER_ROOT}/`)
}

/**
 * The Quartz content tree stores every Garden at the filesystem root, while
 * Breadboard clusters are virtual paths in the database. Re-parent only the
 * Explorer nodes so navigation mirrors the dashboard without moving content
 * or changing any real Garden URL.
 */
export function groupGardenExplorerNodes(
  trie: FileTrieNode<ContentDetails>,
  gardenSlugs: string[],
  clusterFolders: string[],
): void {
  const folderByGarden = new Map<string, string[]>()
  for (let index = 0; index < gardenSlugs.length; index += 1) {
    const segments = folderSegments(clusterFolders[index])
    if (segments.length > 0) folderByGarden.set(gardenSlugs[index], segments)
  }
  if (folderByGarden.size === 0) return

  const rootChildren: Array<FileTrieNode<ContentDetails>> = []
  const virtualNodes = new Map<string, FileTrieNode<ContentDetails>>()

  const ensureVirtualPath = (segments: string[]): FileTrieNode<ContentDetails> => {
    let parentChildren = rootChildren
    let current: FileTrieNode<ContentDetails> | undefined

    for (let depth = 0; depth < segments.length; depth += 1) {
      const pathSegments = segments.slice(0, depth + 1)
      const key = pathSegments.join(FOLDER_SEPARATOR)
      current = virtualNodes.get(key)
      if (!current) {
        current = new FileTrieNode<ContentDetails>([VIRTUAL_CLUSTER_ROOT, ...pathSegments])
        current.isFolder = true
        current.displayName = pathSegments.at(-1) ?? key
        virtualNodes.set(key, current)
        parentChildren.push(current)
      }
      parentChildren = current.children
    }

    return current!
  }

  for (const gardenNode of trie.children) {
    const segments = folderByGarden.get(gardenNode.slugSegment)
    if (!segments) {
      rootChildren.push(gardenNode)
      continue
    }
    ensureVirtualPath(segments).children.push(gardenNode)
  }

  trie.children = rootChildren
}
