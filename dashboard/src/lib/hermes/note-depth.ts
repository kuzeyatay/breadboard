import { proseWordCount } from "../learn-utils.ts";

/** Count teaching prose, not equations, headings, markup, or link targets. */
export function noteProseWordCount(markdown: string): number {
  return proseWordCount(markdown
    .replace(/~~~[^\n]*\n[\s\S]*?~~~/g, " ")
    .replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g, " ")
    .replace(/\$[^$\n]+\$|\\\([^\n]*?\\\)/g, " ")
    .replace(/^#{1,6}\s+.*$/gm, " ")
    .replace(/!\[\[[^\]]+\]\]/g, " ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>|\[!(?:note|info|warning|tip|important)\]/gi, " "));
}

export function noteDepthError(content: string, minimum: unknown): string | null {
  if (minimum === undefined) return null;
  if (typeof minimum !== "number" || !Number.isSafeInteger(minimum) || minimum < 1) {
    return "minimumProseWords must be a positive integer.";
  }
  const count = noteProseWordCount(content);
  return count < minimum
    ? `This note has ${count} explanatory prose words; at least ${minimum} are required. Expand the explanations and worked examples before retrying. Nothing was saved.`
    : null;
}
