import assert from "node:assert/strict"
import test from "node:test"
import { isVisibleGardenRootEntry } from "./explorerScope"

function folder(slugSegment: string, hasIndex = false) {
  return {
    isFolder: true,
    slugSegment,
    data: hasIndex ? { title: slugSegment } : null,
  }
}

test("garden Explorer includes user-created root folders", () => {
  for (const name of [
    "module-v-waves-and-oscilations",
    "module-vi-propagation-of-light",
    "module-vii-quantum-mechanics",
    "notes",
  ]) {
    assert.equal(isVisibleGardenRootEntry(folder(name, true)), true, name)
  }
})

test("garden Explorer keeps legacy Learning and Sources folders", () => {
  assert.equal(isVisibleGardenRootEntry(folder("learning")), true)
  assert.equal(isVisibleGardenRootEntry(folder("Sources")), true)
})

test("garden Explorer hides internal and unindexed folders", () => {
  for (const name of [".breadboard", "assets", "generated", "Internal", "static", "tags"]) {
    assert.equal(isVisibleGardenRootEntry(folder(name, true)), false, name)
  }

  assert.equal(isVisibleGardenRootEntry(folder("empty-folder")), false)
})

test("garden Explorer includes notes stored directly at the garden root", () => {
  assert.equal(
    isVisibleGardenRootEntry({
      isFolder: false,
      slugSegment: "standard-negative-and-positive-feedback-transfer-functions",
      data: { title: "Standard Negative and Positive Feedback Transfer Functions" },
    }),
    true,
  )
  assert.equal(isVisibleGardenRootEntry({ isFolder: false, slugSegment: "index", data: {} }), false)
  assert.equal(
    isVisibleGardenRootEntry({ isFolder: false, slugSegment: "missing-note", data: null }),
    false,
  )
})
