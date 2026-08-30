import assert from "node:assert/strict"
import test from "node:test"
import type { Element, Root } from "hast"
import { groupBreadboardSourceVisuals } from "./breadboardSourceVisual"

const text = (value: string) => ({ type: "text" as const, value })
const element = (tagName: string, children: Element["children"], properties = {}): Element => ({
  type: "element",
  tagName,
  properties,
  children,
})

test("groups a Learn source screenshot and its caption into a compact figure hook", () => {
  const image = element("img", [], {
    src: "/garden/assets/source-visuals/source-page-3-diagram-f1.png",
    alt: "Field diagram",
  })
  const tree: Root = {
    type: "root",
    children: [
      element("p", [image]),
      text("\n"),
      element("p", [
        element("em", [text("Field diagram")]),
        text(" "),
        element("em", [text("(p. 3)")]),
      ]),
      element("p", [text("The field changes across the boundary.")]),
    ],
  }

  groupBreadboardSourceVisuals(tree)

  assert.equal(tree.children.length, 2)
  const figure = tree.children[0] as Element
  assert.equal(figure.tagName, "figure")
  assert.deepEqual(figure.properties.className, ["breadboard-source-visual"])
  assert.equal((figure.children[0] as Element).tagName, "img")
  assert.equal((figure.children[0] as Element).properties.loading, "lazy")
  assert.equal((figure.children[0] as Element).properties.decoding, "async")
  assert.equal((figure.children[1] as Element).tagName, "figcaption")
  assert.deepEqual((figure.children[1] as Element).properties.className, [
    "breadboard-source-visual-caption",
  ])
  assert.equal((tree.children[1] as Element).tagName, "p")
})

test("leaves ordinary images and prose captions unchanged", () => {
  const tree: Root = {
    type: "root",
    children: [
      element("p", [element("img", [], { src: "/garden/assets/photo.png" })]),
      element("p", [text("An ordinary paragraph.")]),
    ],
  }

  groupBreadboardSourceVisuals(tree)

  assert.equal(tree.children.length, 2)
  assert.equal((tree.children[0] as Element).tagName, "p")
  assert.equal((tree.children[1] as Element).tagName, "p")
})
