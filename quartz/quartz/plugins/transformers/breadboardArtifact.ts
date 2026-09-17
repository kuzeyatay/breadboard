import type { Root, Code } from "mdast"
import { visit } from "unist-util-visit"
import type { QuartzTransformerPlugin } from "../types"
import { parseArtifactReference } from "../../util/artifactReference"
// @ts-ignore
import script from "../../components/scripts/breadboardArtifact.inline"
import style from "../../components/styles/breadboardArtifact.inline.scss"

export const BreadboardArtifacts: QuartzTransformerPlugin = () => ({
  name: "BreadboardArtifacts",
  markdownPlugins() {
    return [() => (tree: Root) => {
      visit(tree, "code", (node: Code) => {
        if (node.lang !== "artifact") return
        const reference = parseArtifactReference(node.value)
        node.data = { hProperties: {
          className: ["breadboard-artifact-block"],
          ...(reference ? { "data-artifact-reference": JSON.stringify(reference) } : {}),
        } }
        node.value = reference ? `Artifact: ${reference.title}` : "This artifact reference is invalid."
      })
    }]
  },
  externalResources() {
    return {
      js: [{ script, loadTime: "afterDOMReady", contentType: "inline" }],
      css: [{ content: style, inline: true }],
    }
  },
})
