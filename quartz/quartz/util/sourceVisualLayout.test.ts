import assert from "node:assert/strict"
import test from "node:test"
import { sourceVisualAlignment, sourceVisualsCanShareRow } from "./sourceVisualLayout"

test("single figures stay in reading flow at every column width", () => {
  for (const width of [390, 760, 768, 800, 1070, 1600]) {
    assert.equal(sourceVisualAlignment(width), "center")
    assert.equal(sourceVisualAlignment(width, "invalid"), "center")
  }
})

test("honors explicit alignment while keeping narrow layouts stacked", () => {
  for (const alignment of ["left", "right", "center"] as const) {
    assert.equal(sourceVisualAlignment(1070, alignment), alignment)
    assert.equal(sourceVisualAlignment(390, alignment), "center")
    assert.equal(sourceVisualAlignment(800, alignment, 20), "center")
  }
})

test("pairs compact diagrams only when both fit readable side-by-side slots", () => {
  const compact = { width: 600, height: 366 }
  assert.equal(sourceVisualsCanShareRow(compact, compact, 1070), true)
  assert.equal(sourceVisualsCanShareRow(compact, compact, 768), true)
  assert.equal(sourceVisualsCanShareRow(compact, compact, 390), false)
  assert.equal(sourceVisualsCanShareRow(compact, compact, 800, 20), false)
  for (const other of [
    { width: 1200, height: 500 },
    { width: 900, height: 1060 },
    { width: 0, height: 0 },
  ]) {
    assert.equal(sourceVisualsCanShareRow(compact, other, 1070), false)
    assert.equal(sourceVisualsCanShareRow(other, compact, 1070), false)
  }
})
