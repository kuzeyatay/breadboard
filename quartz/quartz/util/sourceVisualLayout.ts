export type SourceVisualAlignment = "left" | "right" | "center"

type ImageDimensions = { width: number; height: number }

function fitsBesideContent(width: number, height: number, availableWidth: number, rem: number) {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) return false
  const aspectRatio = width / height
  const displayWidth = Math.min(width, availableWidth, 30 * rem)
  return aspectRatio > 0.75 && aspectRatio < 1.8 && displayWidth / aspectRatio <= 22 * rem
}

export function sourceVisualsCanShareRow(
  first: ImageDimensions,
  second: ImageDimensions,
  columnWidth: number,
  rem = 16,
): boolean {
  const slotWidth = (columnWidth - 1.5 * rem) / 2
  return (
    columnWidth >= 48 * rem &&
    [first, second].every(({ width, height }) => fitsBesideContent(width, height, slotWidth, rem))
  )
}

/** Keep figures in reading order unless the author explicitly opts into wrapping.
 * Image dimensions cannot tell us whether the next paragraph explains a figure
 * or introduces an equation or a new topic.
 */
export function sourceVisualAlignment(
  columnWidth: number,
  requested?: string,
  rem = 16,
): SourceVisualAlignment {
  if (columnWidth < 48 * rem) return "center"
  if (requested === "left" || requested === "right" || requested === "center") {
    return requested
  }
  return "center"
}
