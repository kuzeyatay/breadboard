import rehypeKatex from "rehype-katex"
import { visit } from "unist-util-visit"
import { toText } from "hast-util-to-text"
import type { Root, Element } from "hast"
import type { VFile } from "vfile"
import type { KatexOptions } from "katex"
import { mathAnnotationText } from "./mathAnnotation"

/** Keep copy/annotation source without adding a second tree of math glyphs. */
export default function rehypeKatexSource(options: KatexOptions = {}) {
  const render = rehypeKatex(options)
  return (tree: Root, file: VFile) => {
    const sources: string[] = []
    const existing = new Set<Element>()
    visit(tree, "element", (node, _index, parent) => {
      const classes = Array.isArray(node.properties.className) ? node.properties.className : []
      if (classes.includes('katex') || classes.includes('katex-error')) existing.add(node)
      if (!classes.some(name => name === 'language-math' || name === 'math-inline' || name === 'math-display')) return
      // remark-math parses $$...$$ on one line as inline math. Preserve the
      // author's display delimiter so numbered equations render correctly.
      // Use the parsed node's source range; code examples and escaped dollars
      // never reach this branch and the stored Markdown stays untouched.
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      const source = start !== undefined && end !== undefined ? String(file.value).slice(start, end) : ''
      if (classes.includes('math-inline') && source.startsWith('$$') && source.endsWith('$$')) {
        classes[classes.indexOf('math-inline')] = 'math-display'
      }
      sources.push(mathAnnotationText(toText(node, { whitespace: 'pre' }),
        classes.includes('math-display') || parent?.type === 'element' && parent.tagName === 'pre'))
    })
    render(tree, file)
    let index = 0
    visit(tree, "element", node => {
      if (existing.has(node)) return
      const classes = Array.isArray(node.properties.className) ? node.properties.className : []
      if (classes?.some(name => name === 'katex' || name === 'katex-error')) {
        if (sources[index] !== undefined) node.properties.dataBbMathSource = sources[index++]
      }
    })
  }
}
