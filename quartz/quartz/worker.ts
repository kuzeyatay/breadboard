import sourceMapSupport from "source-map-support"
sourceMapSupport.install(options)
import cfg from "../quartz.config"
import { BuildCtx, WorkerSerializableBuildCtx } from "./util/ctx"
import { FilePath } from "./util/path"
import {
  createFileParser,
  createFusedParser,
  createHtmlProcessor,
  createMarkdownParser,
  createMdProcessor,
} from "./processors/parse"
import { options } from "./util/sourcemap"
import { MarkdownContent, ProcessedContent } from "./plugins/vfile"

// only called from worker thread
export async function parseMarkdown(
  partialCtx: WorkerSerializableBuildCtx,
  fps: FilePath[],
): Promise<MarkdownContent[]> {
  const ctx: BuildCtx = {
    ...partialCtx,
    cfg,
  }
  return await createFileParser(ctx, fps)(createMdProcessor(ctx))
}

// only called from worker thread: one chunk from text all the way to HTML, so
// the main thread only ever receives finished trees
export async function processChunk(
  partialCtx: WorkerSerializableBuildCtx,
  fps: FilePath[],
): Promise<ProcessedContent[]> {
  const ctx: BuildCtx = {
    ...partialCtx,
    cfg,
  }
  const result = await createFusedParser(
    ctx,
    fps,
    null,
  )(createMdProcessor(ctx), createHtmlProcessor(ctx))
  // Math-error messages carry `ancestors` up to the root; cloning them back to
  // the main thread would copy every tree a second time for nothing.
  for (const [, file] of result) file.messages.length = 0
  return result
}

// only called from worker thread
export function processHtml(
  partialCtx: WorkerSerializableBuildCtx,
  mds: MarkdownContent[],
): Promise<ProcessedContent[]> {
  const ctx: BuildCtx = {
    ...partialCtx,
    cfg,
  }
  return createMarkdownParser(ctx, mds)(createHtmlProcessor(ctx))
}
