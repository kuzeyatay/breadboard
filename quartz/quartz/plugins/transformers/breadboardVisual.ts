import { Root, Code } from "mdast"
import { visit } from "unist-util-visit"
import { QuartzTransformerPlugin } from "../types"
import { JSResource, CSSResource } from "../../util/resources"
import { tagVisualCodeNode, VISUAL_BLOCK_LANG } from "../../util/visualSpec"
// @ts-ignore
import breadboardVisualScript from "../../components/scripts/breadboardVisual.inline"
import breadboardVisualStyle from "../../components/styles/breadboardVisual.inline.scss"

/**
 * Breadboard visual blocks: ```breadboard-visual fenced code blocks carry a
 * JSON VisualSpec. This transformer validates the spec at build time and tags
 * the code block; the trusted client script (breadboardVisual.inline.ts) then
 * replaces it with an interactive card. Invalid specs degrade into a readable
 * fallback card and never render model-provided markup.
 */
export const BreadboardVisuals: QuartzTransformerPlugin = () => {
  return {
    name: "BreadboardVisuals",
    markdownPlugins() {
      return [
        () => {
          return (tree: Root) => {
            visit(tree, "code", (node: Code) => {
              if (node.lang !== VISUAL_BLOCK_LANG) return
              tagVisualCodeNode(node)
            })
          }
        },
      ]
    },
    externalResources() {
      const js: JSResource[] = [
        {
          script: breadboardVisualScript,
          loadTime: "afterDOMReady",
          contentType: "inline",
        },
      ]
      const css: CSSResource[] = [
        {
          content: breadboardVisualStyle,
          inline: true,
        },
      ]
      return { js, css }
    },
  }
}
