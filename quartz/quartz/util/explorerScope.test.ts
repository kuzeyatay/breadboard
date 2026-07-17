import assert from "node:assert/strict"
import test from "node:test"
import { isVisibleGardenRootFolder } from "./explorerScope"

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
    assert.equal(isVisibleGardenRootFolder(folder(name, true)), true, name)
  }
})

test("garden Explorer keeps legacy Learning and Sources folders", () => {
  assert.equal(isVisibleGardenRootFolder(folder("learning")), true)
  assert.equal(isVisibleGardenRootFolder(folder("Sources")), true)
})

test("garden Explorer hides internal folders and root files", () => {
  for (const name of [".breadboard", "assets", "generated", "Internal", "static", "tags"]) {
    assert.equal(isVisibleGardenRootFolder(folder(name, true)), false, name)
  }

  assert.equal(
    isVisibleGardenRootFolder({ isFolder: false, slugSegment: "loose-note", data: {} }),
    false,
  )
})
