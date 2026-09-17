import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { Root } from "hast"
import { neutralizeInvalidTagNames } from "./sanitizeTagNames"

describe("invalid tag name recovery", () => {
  it("folds an element with an unrenderable tag name into text", () => {
    // `<td>$0<p<1,\quad q=1-p$</td>` as the HTML parser sees it.
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "td",
          properties: {},
          children: [
            { type: "text", value: "$0" },
            {
              type: "element",
              tagName: "p<1,\\quad",
              properties: { q: "1-p$" },
              children: [{ type: "text", value: "tail" }],
            },
          ],
        },
      ],
    }

    assert.equal(neutralizeInvalidTagNames(tree), 1)
    assert.deepEqual(tree.children[0], {
      type: "element",
      tagName: "td",
      properties: {},
      children: [
        { type: "text", value: "$0" },
        { type: "text", value: "<p<1,\\quad " },
        { type: "text", value: "tail" },
      ],
    })
  })

  it("leaves valid markup alone", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "custom-element",
          properties: {},
          children: [{ type: "element", tagName: "span", properties: {}, children: [] }],
        },
      ],
    }
    const before = structuredClone(tree)
    assert.equal(neutralizeInvalidTagNames(tree), 0)
    assert.deepEqual(tree, before)
  })
})
