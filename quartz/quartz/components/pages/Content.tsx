import { ComponentChildren } from "preact"
import { htmlToJsx } from "../../util/jsx"
import { deferLongDocumentBlocks } from "../../util/longDocument"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "../types"
// @ts-ignore
import sourceVisualsScript from "../scripts/sourceVisuals.inline"
// @ts-ignore
import imageViewerScript from "../scripts/imageViewer.inline"
import imageViewerStyle from "../styles/imageViewer.scss"
// @ts-ignore
import pageUnderstandingScript from "../scripts/pageUnderstanding.inline"
import pageUnderstandingStyle from "../styles/pageUnderstanding.scss"
import longDocumentStyle from "../styles/longDocument.scss"

const Content: QuartzComponent = ({ fileData, tree }: QuartzComponentProps) => {
  const content = htmlToJsx(fileData.filePath!, deferLongDocumentBlocks(tree)) as ComponentChildren
  const classes: string[] = fileData.frontmatter?.cssclasses ?? []
  const classString = ["popover-hint", ...classes].join(" ")
  return <article class={classString}>{content}</article>
}

Content.afterDOMLoaded = `${sourceVisualsScript}\n${imageViewerScript}\n${pageUnderstandingScript}`
Content.css = `${imageViewerStyle}\n${pageUnderstandingStyle}\n${longDocumentStyle}`

export default (() => Content) satisfies QuartzComponentConstructor
