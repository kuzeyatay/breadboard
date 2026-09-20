import type { Element, Node, Root } from "hast"

const deferredTags = new Set(["p", "pre", "ul", "ol", "blockquote"])

/** Mark long articles before they reach the browser, without changing text or
 * heading structure. Both publication and canonical refresh use this path. */
export function deferLongDocumentBlocks<T extends Node>(tree: T): T {
  if (tree.type !== "root") return tree
  const root = tree as unknown as Root
  if (root.children.filter(child => child.type === "element").length < 80) return tree
  return {
    ...tree,
    children: root.children.map(child => {
      if (child.type !== "element") return child
      const classes = Array.isArray(child.properties.className)
        ? child.properties.className
        : String(child.properties.className ?? "").split(/\s+/).filter(Boolean)
      if (!deferredTags.has(child.tagName) && !classes.includes("table-container")) return child
      if (classes.includes("quartz-deferred-block")) return child
      return {
        ...child,
        properties: { ...child.properties, className: [...classes, "quartz-deferred-block"] },
      } satisfies Element
    }),
  }
}
