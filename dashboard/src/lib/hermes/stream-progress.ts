/** Replayed deltas can already be present in a restored progress checkpoint. */
export function mergeThinkingDetail(
  current: string,
  detail: string,
  mode: unknown,
  offset: unknown,
): string {
  if (mode === "replace") return detail;
  if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) {
    return current + detail;
  }
  if (current.slice(offset, offset + detail.length) === detail) return current;
  return current.slice(0, offset) + detail;
}

export function mergeProgressNote(
  current: readonly string[],
  note: string,
  index: unknown,
): string[] {
  const next = [...current];
  if (typeof index === "number" && Number.isInteger(index) && index >= 0 && index <= next.length) {
    next[index] = note;
  } else if (next.at(-1) !== note) {
    next.push(note);
  }
  return next;
}
