import { FilePath, joinSegments, slugifyFilePath } from "../../util/path"
import { QuartzEmitterPlugin } from "../types"
import path from "path"
import fs from "fs"
import { glob } from "../../util/glob"
import { Argv } from "../../util/ctx"
import { QuartzConfig } from "../../cfg"
import { isScopedBuild } from "../../util/scope"

const filesToCopy = async (argv: Argv, cfg: QuartzConfig) => {
  // glob all non MD files in content folder and copy it over
  const scope = argv.scope ?? []
  const pattern = isScopedBuild(scope) ? scope.map((root) => `${root}/**`) : "**"
  return await glob(pattern, argv.directory, ["**/*.md", ...cfg.configuration.ignorePatterns])
}

// Garden assets (page scans, source PDFs) run to gigabytes and never change
// after they are written, so link them into the output instead of copying.
// Volumes without hard links (exFAT, network shares) fall back to a copy; a
// link that fails once is not retried for the rest of the build.
let hardLinksUnavailable = false

async function placeFile(src: FilePath, dest: FilePath) {
  if (!hardLinksUnavailable) {
    try {
      await fs.promises.rm(dest, { force: true })
      await fs.promises.link(src, dest)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code === "ENOENT") throw error
      hardLinksUnavailable = true
    }
  }
  await fs.promises.copyFile(src, dest)
}

export const copyFile = async (argv: Argv, fp: FilePath) => {
  const src = joinSegments(argv.directory, fp) as FilePath

  const name = slugifyFilePath(fp)
  const dest = joinSegments(argv.output, name) as FilePath

  // ensure dir exists
  const dir = path.dirname(dest) as FilePath
  await fs.promises.mkdir(dir, { recursive: true })

  try {
    await placeFile(src, dest)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    // A garden can change while a full publish is copying assets. If an asset
    // disappeared after the glob snapshot, omit that stale entry; keep
    // destination, permission, and every other filesystem failure terminal.
    if (code === "ENOENT" && !fs.existsSync(src)) return undefined
    if (code === "ENOENT") {
      // The source is there, so the miss was transient (an ingest rewriting
      // the folder, an indexer holding it). One retry after a beat; if that
      // fails too, skip this asset with a warning rather than abort the
      // publish with the output folder already cleared — a missing picture
      // is recoverable on the next publish, a blank site is not.
      await new Promise((resolve) => setTimeout(resolve, 250))
      try {
        await fs.promises.mkdir(dir, { recursive: true })
        await placeFile(src, dest)
        return dest
      } catch (retryError) {
        console.warn(
          `[quartz] skipping asset ${fp}: ${(retryError as Error)?.message ?? retryError}`,
        )
        return undefined
      }
    }
    throw error
  }
  return dest
}

export const Assets: QuartzEmitterPlugin = () => {
  return {
    name: "Assets",
    async *emit({ argv, cfg }) {
      const fps = await filesToCopy(argv, cfg)
      for (const fp of fps) {
        const dest = await copyFile(argv, fp)
        if (dest) yield dest
      }
    },
    async *partialEmit(ctx, _content, _resources, changeEvents) {
      for (const changeEvent of changeEvents) {
        const ext = path.extname(changeEvent.path)
        if (ext === ".md") continue

        if (changeEvent.type === "add" || changeEvent.type === "change") {
          const dest = await copyFile(ctx.argv, changeEvent.path)
          if (dest) yield dest
        } else if (changeEvent.type === "delete") {
          const name = slugifyFilePath(changeEvent.path)
          const dest = joinSegments(ctx.argv.output, name) as FilePath
          await fs.promises.rm(dest, { force: true })
        }
      }
    },
  }
}
