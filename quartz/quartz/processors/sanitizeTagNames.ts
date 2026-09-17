import { Root, Element, ElementContent } from "hast"
import { visit } from "unist-util-visit"

/** Characters preact-render-to-string refuses in a tag name. */
const UNSAFE_TAG_NAME = /[\s\n\\/='"\0<>]/

/**
 * Extracted documents occasionally carry raw HTML with math inside it, such
 * as `<td>$0<p<1,\quad q=1-p$</td>`. The HTML parser turns `<p<1,\quad` into
 * an element whose tag name the page renderer rejects, which used to abort
 * the whole publication. Fold such elements back into text so the page still
 * renders, keeping the readable content and every valid descendant.
 */
export function neutralizeInvalidTagNames(tree: Root): number {
  let repaired = 0
  visit(tree, "element", (node: Element, index, parent) => {
    if (!parent || index === undefined) return
    if (typeof node.tagName === "string" && !UNSAFE_TAG_NAME.test(node.tagName)) return
    const replacement: ElementContent[] = [
      { type: "text", value: `<${String(node.tagName)} ` },
      ...node.children,
    ]
    parent.children.splice(index, 1, ...replacement)
    repaired += 1
    // Revisit the spliced-in children in place of the removed element.
    return index
  })
  return repaired
}

export function rehypeNeutralizeInvalidTagNames() {
  return (tree: Root) => {
    neutralizeInvalidTagNames(tree)
  }
}
