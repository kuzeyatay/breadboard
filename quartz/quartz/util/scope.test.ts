import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { isScopedBuild, normalizeBuildScope, pathWithinScope } from "./scope"

describe("build scope", () => {
  it("normalizes roots and drops duplicates and blanks", () => {
    assert.deepEqual(normalizeBuildScope(["math-1", " /math-1/ ", "", "a\\b/"]), [
      "math-1",
      "a/b",
    ])
    assert.deepEqual(normalizeBuildScope("telecom-1"), ["telecom-1"])
    assert.deepEqual(normalizeBuildScope(undefined), [])
  })

  it("rejects traversal and empty segments", () => {
    assert.throws(() => normalizeBuildScope(["../public"]), /Invalid build scope/)
    assert.throws(() => normalizeBuildScope(["a//b"]), /Invalid build scope/)
    assert.throws(() => normalizeBuildScope([42 as unknown as string]), /must be a string/)
  })

  it("matches only files under a scoped root", () => {
    const scope = normalizeBuildScope(["math-1", "private-library/user-1"])
    assert.equal(isScopedBuild(scope), true)
    assert.equal(pathWithinScope("math-1/Concepts/vectors.md", scope), true)
    assert.equal(pathWithinScope("math-10/vectors.md", scope), false)
    assert.equal(pathWithinScope("private-library/user-1/_index.md", scope), true)
    assert.equal(pathWithinScope("private-library/user-12/_index.md", scope), false)
    assert.equal(pathWithinScope("index.md", scope), false)
  })

  it("treats an empty scope as the whole site", () => {
    assert.equal(isScopedBuild([]), false)
    assert.equal(pathWithinScope("anything/at/all.md", []), true)
    assert.equal(pathWithinScope("anything/at/all.md", undefined), true)
  })
})
