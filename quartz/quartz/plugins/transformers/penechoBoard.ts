import { Root, Code } from "mdast"
import { visit } from "unist-util-visit"
import { QuartzTransformerPlugin } from "../types"
import { JSResource, CSSResource } from "../../util/resources"
// @ts-ignore
import penechoBoardScript from "../../components/scripts/penechoBoard.inline"
import penechoBoardStyle from "../../components/styles/penechoBoard.inline.scss"

/**
 * Whiteboard cards: a ```penecho fenced block names one board.
 *
 * The block holds a reference, never content — an id, a title and a height —
 * because the drawing itself lives in the PenEcho canvas server, which is what
 * lets a board keep its ink and its viewport between visits. The build
 * validates the reference and tags the code node; the client script then
 * replaces it with the card that frames the board.
 */

const LANG = "penecho"
// The id doubles as PenEcho's canvas id, whose shape its server enforces.
const ID_PATTERN = /^\d{10,16}-[a-zA-Z0-9-]{8,64}$/
const DEFAULT_HEIGHT = 520
const MIN_HEIGHT = 280
const MAX_HEIGHT = 1200

interface BoardReference {
  id: string
  title: string
  height: number
}

function field(value: string, name: string): string {
  return value.match(new RegExp(`^${name}:\\s*(.+?)\\s*$`, "m"))?.[1] ?? ""
}

function parseBoard(value: string): BoardReference | null {
  const id = field(value, "id")
  if (!ID_PATTERN.test(id)) return null
  const requested = Number(field(value, "height"))
  return {
    id,
    title: field(value, "title").slice(0, 80) || "Whiteboard",
    height: Number.isFinite(requested)
      ? Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, requested)))
      : DEFAULT_HEIGHT,
  }
}

/**
 * The canvas server a card points at. Configurable so a deployed garden can
 * name its own; the client derives a local default when this is unset, which
 * keeps the common `next dev` + `quartz build` pair working with no
 * configuration at all.
 */
function configuredServer(): string {
  const value = (process.env.PENECHO_URL ?? process.env.NEXT_PUBLIC_PENECHO_URL ?? "").trim()
  if (!value) return ""
  try {
    return new URL(value).origin
  } catch {
    return ""
  }
}

function markInvalid(node: Code): void {
  node.data = {
    hProperties: {
      className: ["penecho-board-block", "penecho-board-invalid"],
    },
  }
  node.value = "This whiteboard reference is not valid."
}

export const PenechoBoards: QuartzTransformerPlugin = () => ({
  name: "PenechoBoards",
  markdownPlugins() {
    return [
      () => (tree: Root) => {
        visit(tree, "code", (node: Code) => {
          if (node.lang !== LANG) return
          const board = parseBoard(node.value)
          if (!board) {
            markInvalid(node)
            return
          }
          node.data = {
            hProperties: {
              className: ["penecho-board-block"],
              "data-board-id": board.id,
              "data-board-title": board.title,
              "data-board-height": String(board.height),
              "data-board-server": configuredServer(),
            },
          }
          node.value = `Whiteboard: ${board.title}`
        })
      },
    ]
  },
  externalResources() {
    const js: JSResource[] = [
      { script: penechoBoardScript, loadTime: "afterDOMReady", contentType: "inline" },
    ]
    const css: CSSResource[] = [{ content: penechoBoardStyle, inline: true }]
    return { js, css }
  },
})
