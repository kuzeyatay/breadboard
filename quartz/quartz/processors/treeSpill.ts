import fs from "fs"
import path from "path"
import { Root as HTMLRoot } from "hast"
import { ProcessedContent } from "../plugins/vfile"
import { BuildCtx } from "../util/ctx"

/**
 * Rendered HTML trees are by far the largest thing a build holds: a
 * KaTeX-heavy page expands to megabytes of nodes, and a garden of several
 * thousand such pages does not fit in one V8 heap. Only the page emitter needs
 * a file's own tree, and only while it renders that page; every other consumer
 * reads `vfile.data`. So once a file is parsed its tree is written to disk and
 * the in-memory entry keeps just the VFile. Index 0 of the entry is an
 * accessor that reads the tree back on demand, which keeps `[tree, file]`
 * destructuring working unchanged wherever a tree is genuinely needed.
 */
export interface TreeSpill {
  readonly directory: string
  stash(content: ProcessedContent): ProcessedContent
  dispose(): void
}

export const SPILL_DIRECTORY_NAME = ".quartz-tree-spill"

export function createTreeSpill(ctx: BuildCtx): TreeSpill | null {
  const { argv } = ctx
  // Watch mode keeps trees resident: partial rebuilds hand them straight back
  // to the emitters and never hold a whole large garden.
  if (argv.watch || argv.serve) return null
  const directory = path.join(argv.output, SPILL_DIRECTORY_NAME)
  fs.rmSync(directory, { recursive: true, force: true })
  fs.mkdirSync(directory, { recursive: true })
  let sequence = 0
  return {
    directory,
    stash(content) {
      const [tree, file] = content
      sequence += 1
      const treePath = path.join(directory, `${sequence}.json`)
      const serialized = JSON.stringify(tree)
      fs.writeFileSync(treePath, serialized)
      // The original entry may still be referenced by whoever produced it (a
      // worker result held by its promise); do not let it pin the tree.
      ;(content as unknown as unknown[])[0] = undefined
      if (process.env.QUARTZ_MEMORY_DEBUG) {
        const keys = Object.entries(file.data as Record<string, unknown>)
          .filter(([key]) => key !== "htmlAst")
          .map(([key, value]) => `${key}=${JSON.stringify(value)?.length ?? 0}`)
          .join(" ")
        const fileKeys = Object.entries(file as unknown as Record<string, unknown>)
          .filter(([key]) => key !== "data" && key !== "value")
          .map(([key, value]) => {
            try {
              return `${key}=${JSON.stringify(value)?.length ?? 0}`
            } catch {
              return `${key}=?`
            }
          })
          .join(" ")
        console.log(
          `[memory] ${file.data.slug}: tree ${serialized.length} B, ` +
            `source ${String(file.value).length} B, messages ${file.messages.length} | ${keys} | ${fileKeys}`,
        )
      }
      const load = (): HTMLRoot => JSON.parse(fs.readFileSync(treePath, "utf8")) as HTMLRoot
      // rehype-katex records every math error with `ancestors` up to the root,
      // so each message would pin the whole tree. Nothing reads the messages
      // after parsing; the retry logic in parse.ts has already run.
      file.messages.length = 0
      const entry = [undefined, file] as unknown as ProcessedContent
      Object.defineProperty(entry, 0, { enumerable: true, configurable: true, get: load })
      // ObsidianFlavoredMarkdown keeps the same tree on `data.htmlAst` for
      // transclusion; that reference would pin the tree in memory regardless.
      if (file.data.htmlAst) {
        Object.defineProperty(file.data, "htmlAst", {
          enumerable: true,
          configurable: true,
          get: load,
        })
      }
      return entry
    },
    dispose() {
      fs.rmSync(directory, { recursive: true, force: true })
    },
  }
}

/** The VFile half of an entry without touching (and possibly loading) its tree. */
export function fileOf(content: ProcessedContent) {
  return content[1]
}
