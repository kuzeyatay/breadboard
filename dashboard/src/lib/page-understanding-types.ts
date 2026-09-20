/** Green is a learning signal, never a manually selected page flag. */
export const UNDERSTOOD_COLOR = "#22c55e";
export const PAGE_FLAG_COLORS = [
  "#facc15", "#fb7185", "#f97316", "#14b8a6", "#38bdf8",
  "#60a5fa", "#a78bfa", "#f472b6",
] as const;

export interface PageUnderstanding {
  pageSlug: string;
  understood: boolean;
  updatedAt: string;
}

/** Match Quartz's published path, retaining folders so equal filenames stay distinct. */
export function understandingPageSlug(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
    .replace(/\.(md|html)$/i, "").replace(/\s/g, "-")
    .replace(/&/g, "-and-").replace(/%/g, "-percent")
    .replace(/[?#]/g, "").replace(/(^|\/)_index$/, "$1index");
}

export function pageFlagColor(manualColor: string, understood?: boolean): string {
  if (understood) return UNDERSTOOD_COLOR;
  // Legacy green flags are not evidence of understanding.
  return [UNDERSTOOD_COLOR, "#a3e635"].includes(manualColor.toLowerCase()) ? "" : manualColor;
}
