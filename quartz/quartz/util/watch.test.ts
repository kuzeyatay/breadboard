import test, { describe } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { isQuartzInternalWatchPath } from "./watch"

describe("isQuartzInternalWatchPath", () => {
  test("ignores Learn atomic promotion trees and their descendants", () => {
    const ignoredPaths = [
      ".electromagnetism-1.incoming-172376",
      ".electromagnetism-1.incoming-172376/learning/page.md",
      "content/.electromagnetism-1.previous-172375/assets/figure.png",
      String.raw`C:\garden\content\.electromagnetism-1.previous-172375\learning\page.md`,
    ]

    for (const fp of ignoredPaths) {
      assert.equal(isQuartzInternalWatchPath(fp), true, fp)
    }
  })

  test("ignores .breadboard metadata wherever it occurs", () => {
    assert.equal(isQuartzInternalWatchPath(".breadboard/events.jsonl"), true)
    assert.equal(
      isQuartzInternalWatchPath("electromagnetism-1/.breadboard/validation-report.md"),
      true,
    )
    assert.equal(
      isQuartzInternalWatchPath(String.raw`electromagnetism-1\.breadboard\repair-log.json`),
      true,
    )
  })

  test("keeps ordinary garden content watchable", () => {
    const watchedPaths = [
      "electromagnetism-1/learning/page.md",
      "electromagnetism-1/assets/figure.png",
      "electromagnetism-1/lesson.previous-notes.md",
      ".incoming-not-a-promotion/page.md",
      "garden/.breadboard-notes/page.md",
    ]

    for (const fp of watchedPaths) {
      assert.equal(isQuartzInternalWatchPath(fp), false, fp)
    }
  })
})

test("Quartz applies internal ignores before subscribing and polls on Windows", () => {
  const buildSource = fs.readFileSync(new URL("../build.ts", import.meta.url), "utf8")

  assert.match(buildSource, /chokidar\.watch\("\."[\s\S]*ignored: buildData\.ignored/)
  assert.match(buildSource, /usePolling: process\.platform === "win32"/)
})
