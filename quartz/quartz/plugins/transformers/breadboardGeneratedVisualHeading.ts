function normalizeHeading(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase()
}

function headingNames(visible: string, target: string): boolean {
  return visible === target || visible.endsWith(` ${target}`)
}

/**
 * Learn targets a visual at its lesson ("How a Channel Is Partitioned Among
 * Users"), while a lesson body may open with its own internal `###` beats. The
 * visual belongs there when either the nearest heading above it or the page
 * title names the target; the insertion anchor still pins its exact position.
 */
export function generatedVisualHeadingMatches(input: {
  targetHeading: string
  precedingHeading: string | null
  pageTitle: string
}): boolean {
  const target = normalizeHeading(input.targetHeading)
  if (!target) return false
  const candidates = [input.precedingHeading, input.pageTitle]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map(normalizeHeading)
  return candidates.some((visible) => headingNames(visible, target))
}
