import { sourceVisualAlignment, sourceVisualsCanShareRow } from "../../util/sourceVisualLayout"

function canGroupFigures(first: HTMLElement, second: HTMLElement | undefined): boolean {
  if (!second) return false
  // Intervening prose or math has its own place in the reading order. Never
  // move it above an earlier diagram just to fill a two-column row.
  return first.nextElementSibling === second
}

function unwrapRow(row: HTMLElement) {
  row.replaceWith(...Array.from(row.childNodes))
}

document.addEventListener("nav", () => {
  for (const article of document.querySelectorAll<HTMLElement>("article.popover-hint")) {
    const figures = Array.from(
      article.querySelectorAll<HTMLElement>(":scope > .breadboard-source-visual"),
    )
    if (figures.length === 0) continue

    const images = figures.map((figure) => figure.querySelector("img"))
    const groupable = figures.map((figure, index) => canGroupFigures(figure, figures[index + 1]))
    const rows = new Map<number, HTMLElement>()
    const column = article.closest<HTMLElement>(".center") ?? article
    let frame = 0

    const layout = () => {
      const columnWidth = Math.min(column.clientWidth, article.clientWidth)
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      // Single figures stay in the main reading flow. Only author-requested
      // wrapping is allowed, and only when the column has enough room.
      figures.forEach((figure, index) => {
        const image = images[index]
        if (!image) return
        const alignment = sourceVisualAlignment(
          columnWidth,
          figure.dataset.align ?? image.dataset.align,
          rem,
        )
        figure.dataset.layout = alignment
      })

      const paired = new Set<number>()
      for (let index = 0; index < figures.length - 1; index += 1) {
        const first = images[index]
        const second = images[index + 1]
        const explicitAlignment = [index, index + 1].some((i) =>
          ["left", "right", "center"].includes(
            figures[i].dataset.align ?? images[i]?.dataset.align ?? "",
          ),
        )
        if (
          !groupable[index] ||
          !first ||
          !second ||
          explicitAlignment ||
          !sourceVisualsCanShareRow(
            { width: first.naturalWidth, height: first.naturalHeight },
            { width: second.naturalWidth, height: second.naturalHeight },
            columnWidth,
            rem,
          )
        )
          continue
        paired.add(index)
        index += 1
      }

      for (const [index, row] of rows) {
        if (paired.has(index)) continue
        unwrapRow(row)
        rows.delete(index)
      }
      for (const index of paired) {
        if (rows.has(index)) continue
        const row = document.createElement("div")
        row.className = "breadboard-source-visual-row"
        const first = figures[index]
        const last = figures[index + 1]
        first.before(row)
        // Move the original nodes together, preserving their reading order,
        // captions, and the whitespace between them.
        let node: ChildNode | null = first
        while (node) {
          const next: ChildNode | null = node.nextSibling
          row.append(node)
          if (node === last) break
          node = next
        }
        rows.set(index, row)
      }
    }

    const scheduleLayout = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(layout)
    }

    const observer = new ResizeObserver(scheduleLayout)
    observer.observe(column)
    if (column !== article) observer.observe(article)
    for (const image of images) {
      image?.addEventListener("load", scheduleLayout)
      image?.addEventListener("error", scheduleLayout)
    }
    layout()

    window.addCleanup(() => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      for (const row of rows.values()) unwrapRow(row)
      for (const image of images) {
        image?.removeEventListener("load", scheduleLayout)
        image?.removeEventListener("error", scheduleLayout)
      }
    })
  }
})
