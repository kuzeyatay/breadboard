import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const script = fs.readFileSync(
  new URL("../components/scripts/explorer.inline.ts", import.meta.url),
  "utf8",
)
const style = fs.readFileSync(
  new URL("../components/styles/explorer.scss", import.meta.url),
  "utf8",
)

test("Quartz folder creation uses the styled explorer dialog", () => {
  assert.doesNotMatch(script, /window\.prompt\("New folder name"\)/)
  assert.match(script, /openCreateFolderDialog\(cluster, relFolder, addBtn\)/)
  assert.match(script, /role="dialog" aria-modal="true"/)
  assert.match(script, /event\.key === "Escape"/)
  assert.match(script, /second-brain:create-folder-result/)
  assert.match(script, /data\.retryable/)
  assert.match(script, /Waiting for the current garden update to finish/)
  assert.match(script, /sendCreateFolder\(current\.cluster, current\.pendingFolder\)/)
  assert.match(script, /window\.clearTimeout\(dialog\.retryTimer\)/)
  assert.doesNotMatch(script, /Organize notes/)
  assert.doesNotMatch(script, /Create a folder inside/)
  assert.doesNotMatch(script, /e\.g\. Practice notes/)
  assert.match(style, /\.explorer-folder-modal/)
  assert.match(style, /\.explorer-folder-panel/)
  assert.match(style, /\.explorer-folder-error\[data-waiting="true"\]/)
  assert.doesNotMatch(style, /\.explorer-folder-kicker/)
  assert.doesNotMatch(style, /\.explorer-folder-context/)
})
