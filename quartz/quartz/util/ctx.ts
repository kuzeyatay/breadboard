import { QuartzConfig } from "../cfg"
import { QuartzPluginData } from "../plugins/vfile"
import { FileTrieNode } from "./fileTrie"
import { FilePath, FullSlug } from "./path"
import type { TreeSpill } from "../processors/treeSpill"

export interface Argv {
  directory: string
  verbose: boolean
  output: string
  serve: boolean
  watch: boolean
  port: number
  wsPort: number
  remoteDevHost?: string
  concurrency?: number
  /** Content-relative posix directories to render; empty or absent = whole site. */
  scope?: string[]
}

export type BuildTimeTrieData = QuartzPluginData & {
  slug: string
  title: string
  filePath: string
}

export interface BuildCtx {
  buildId: string
  argv: Argv
  cfg: QuartzConfig
  allSlugs: FullSlug[]
  allFiles: FilePath[]
  trie?: FileTrieNode<BuildTimeTrieData>
  incremental: boolean
  /** Where a non-watching build parked its rendered trees; see treeSpill.ts. */
  treeSpill?: TreeSpill
}

export function trieFromAllFiles(allFiles: QuartzPluginData[]): FileTrieNode<BuildTimeTrieData> {
  const trie = new FileTrieNode<BuildTimeTrieData>([])
  allFiles.forEach((file) => {
    if (file.frontmatter) {
      // Spilled page trees live behind getters. Spreading metadata invokes
      // those getters and pins the entire library's HTML in this cached trie.
      // Copy descriptors so navigation keeps metadata without loading trees.
      const data = Object.defineProperties(
        {},
        Object.getOwnPropertyDescriptors(file),
      ) as BuildTimeTrieData
      data.slug = file.slug!
      data.title = file.frontmatter.title
      data.filePath = file.filePath!
      trie.add(data)
    }
  })

  return trie
}

export type WorkerSerializableBuildCtx = Omit<BuildCtx, "cfg" | "trie" | "treeSpill">
