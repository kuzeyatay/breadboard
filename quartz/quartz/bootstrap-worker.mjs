#!/usr/bin/env node
import workerpool from "workerpool"
const cacheFile = "./.quartz-cache/transpiled-worker.mjs"
const { parseMarkdown, processHtml, processChunk } = await import(cacheFile)
workerpool.worker({
  parseMarkdown,
  processHtml,
  processChunk,
})
