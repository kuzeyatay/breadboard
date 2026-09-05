import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { Root } from "mdast"
import { degradeRawHtmlNodesForRetry } from "./parse"

describe("malformed raw HTML recovery", () => {
  it("preserves readable table text while removing a truncated closing tag", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "html",
          value:
            "<table><tr><td>Course</td><td>5XTA0</td></tr>" +
            "<tr><td>Prior knowledge</td><td>5ETC0</td></t",
        },
      ],
    }

    assert.equal(degradeRawHtmlNodesForRetry(tree), 1)
    assert.deepEqual(tree, {
      type: "root",
      children: [
        {
          type: "text",
          value: "Course | 5XTA0\nPrior knowledge | 5ETC0",
        },
      ],
    })
  })

  it("leaves ordinary Markdown trees unchanged", () => {
    const tree: Root = {
      type: "root",
      children: [{ type: "paragraph", children: [{ type: "text", value: "Safe" }] }],
    }
    const before = structuredClone(tree)

    assert.equal(degradeRawHtmlNodesForRetry(tree), 0)
    assert.deepEqual(tree, before)
  })
})
