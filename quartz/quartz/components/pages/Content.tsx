import { ComponentChildren } from "preact"
import { htmlToJsx } from "../../util/jsx"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "../types"
// @ts-ignore
import sourceVisualsScript from "../scripts/sourceVisuals.inline"
// @ts-ignore
import imageViewerScript from "../scripts/imageViewer.inline"
import imageViewerStyle from "../styles/imageViewer.scss"

const Content: QuartzComponent = ({ fileData, tree }: QuartzComponentProps) => {
  const content = htmlToJsx(fileData.filePath!, tree) as ComponentChildren
  const classes: string[] = fileData.frontmatter?.cssclasses ?? []
  const classString = ["popover-hint", ...classes].join(" ")
  return <article class={classString}>{content}</article>
}

Content.afterDOMLoaded = `${sourceVisualsScript}\n${imageViewerScript}`
Content.css = imageViewerStyle

export default (() => Content) satisfies QuartzComponentConstructor
