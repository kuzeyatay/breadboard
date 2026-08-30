import type { Element, ElementContent, Root, RootContent } from "hast"
import type { QuartzTransformerPlugin } from "../types"

const SOURCE_VISUAL_PATH = /\/assets\/source-visuals\//i

type Container = Root | Element
type ContainerChild = RootContent | ElementContent

function isElement(node: ContainerChild | undefined, tagName?: string): node is Element {
  return (
    node?.type === "element" && (tagName === undefined || node.tagName.toLowerCase() === tagName)
  )
}

function meaningfulChildren(node: Element): ElementContent[] {
  return node.children.filter(
    (child) => !(child.type === "text" && child.value.trim().length === 0),
  )
}

function sourceVisualImage(node: ContainerChild | undefined): Element | null {
  if (!isElement(node, "p")) return null
  const children = meaningfulChildren(node)
  if (children.length !== 1 || !isElement(children[0], "img")) return null

  const src = children[0].properties.src
  return typeof src === "string" && SOURCE_VISUAL_PATH.test(src) ? children[0] : null
}

function sourceVisualCaption(node: ContainerChild | undefined): Element | null {
  if (!isElement(node, "p")) return null
  const children = meaningfulChildren(node)
  if (children.length === 0 || !children.every((child) => isElement(child, "em"))) return null
  return node
}

function nextContentIndex(children: ContainerChild[], start: number): number {
  let index = start
  while (index < children.length) {
    const child = children[index]
    if (child.type !== "text" || child.value.trim().length > 0) break
    index += 1
  }
  return index
}

function withClassName(element: Element, className: string): Element {
  const existing = element.properties.className
  const classNames = Array.isArray(existing)
    ? existing.map(String)
    : typeof existing === "string"
      ? existing.split(/\s+/).filter(Boolean)
      : []

  return {
    ...element,
    properties: {
      ...element.properties,
      className: [...classNames, className],
    },
  }
}

function groupContainer(container: Container): void {
  const children = container.children as ContainerChild[]

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    if (isElement(child)) groupContainer(child)

    const image = sourceVisualImage(child)
    if (!image) continue

    image.properties = {
      ...image.properties,
      loading: "lazy",
      decoding: "async",
    }

    // remark-rehype preserves a formatting newline between block siblings.
    // Look through those whitespace-only nodes when pairing the generated
    // caption with its screenshot.
    const captionIndex = nextContentIndex(children, index + 1)
    const captionParagraph = sourceVisualCaption(children[captionIndex])
    const caption = captionParagraph
      ? withClassName(
          { ...captionParagraph, tagName: "figcaption" },
          "breadboard-source-visual-caption",
        )
      : null

    const figure: Element = {
      type: "element",
      tagName: "figure",
      properties: { className: ["breadboard-source-visual"] },
      children: [image, ...(caption ? [caption] : [])],
    }

    children.splice(index, caption ? captionIndex - index + 1 : 1, figure)
  }
}

/**
 * Groups Learn's cropped source screenshot and its adjacent generated caption
 * into one semantic figure. Keeping this transformation independent of a
 * particular garden means existing pages gain the corrected layout on rebuild.
 */
export function groupBreadboardSourceVisuals(tree: Root): void {
  groupContainer(tree)
}

export const BreadboardSourceVisuals: QuartzTransformerPlugin = () => ({
  name: "BreadboardSourceVisuals",
  htmlPlugins() {
    return [() => (tree: Root) => groupBreadboardSourceVisuals(tree)]
  },
})
