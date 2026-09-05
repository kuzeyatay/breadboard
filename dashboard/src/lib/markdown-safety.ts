/**
 * Repairs the small set of LaTeX commands that can be damaged when model tool
 * arguments cross a JSON boundary with a single backslash.
 *
 * `\frac` is the important example: JSON interprets `\f` as a form-feed, so
 * the stored Markdown can contain U+000C + `rac` (or U+FFFD + `rac` after a
 * lossy decoder). KaTeX then paints the raw command as a red parse error. The
 * same failure mode exists for the other JSON control escapes below.
 *
 * Code is deliberately excluded. A code sample that demonstrates malformed
 * input is evidence, not prose for the renderer to rewrite.
 */

const CODE_REGIONS = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`/g;

function outsideMarkdownCode(
  markdown: string,
  transform: (prose: string) => string,
): string {
  let output = "";
  let cursor = 0;
  for (const match of markdown.matchAll(CODE_REGIONS)) {
    output += transform(markdown.slice(cursor, match.index)) + match[0];
    cursor = match.index + match[0].length;
  }
  return output + transform(markdown.slice(cursor));
}

const DAMAGED_LATEX_COMMANDS: ReadonlyArray<{
  pattern: RegExp;
  replacement: string;
}> = [
  // Backslash + f/b/t/r are valid JSON escapes. Once decoded, the control
  // character replaces the first letter of the LaTeX command.
  { pattern: /(?:\u000c|\uFFFD+)rac(?=\s*\{)/gu, replacement: "\\frac" },
  { pattern: /(?:\u0008|\uFFFD+)eta(?=\b|\s*[_^{])/gu, replacement: "\\beta" },
  // JSON's \t and \r escapes decode to otherwise-valid Markdown whitespace.
  // Only repair their lossy-decoder marker: treating a real tab or CR as
  // damage could join two ordinary lines (for example, CRLF + "rho").
  { pattern: /\uFFFD+heta(?=\b|\s*[_^{])/gu, replacement: "\\theta" },
  { pattern: /\uFFFD+imes(?=\b|\s*[_^{])/gu, replacement: "\\times" },
  { pattern: /\uFFFD+ext(?=\s*\{)/gu, replacement: "\\text" },
  { pattern: /\uFFFD+ho(?=\b|\s*[_^{])/gu, replacement: "\\rho" },
  { pattern: /(?:\u000b|\uFFFD+)arepsilon(?=\b|\s*[_^{])/gu, replacement: "\\varepsilon" },
];

/** Repair known, deterministic JSON-escape damage without touching code. */
export function repairDamagedLatex(markdown: string): string {
  if (!markdown) return markdown;
  return outsideMarkdownCode(markdown, (prose) => {
    let repaired = prose;
    for (const { pattern, replacement } of DAMAGED_LATEX_COMMANDS) {
      repaired = repaired.replace(pattern, replacement);
    }
    return repaired;
  });
}

/**
 * A produced Markdown artifact must not become ready while it still contains
 * evidence of lossy decoding or an unexpected C0 control character. Tabs and
 * line endings are valid Markdown; the remaining controls are not.
 */
export function markdownIntegrityIssue(markdown: string): string | null {
  if (markdown.includes("\uFFFD")) {
    return "Markdown contains a Unicode replacement character from damaged text encoding.";
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(markdown)) {
    return "Markdown contains an unexpected control character.";
  }
  return null;
}

/** Normalize first, then validate the exact text that will be stored. */
export function normalizeProducedMarkdown(markdown: string): string {
  return repairDamagedLatex(markdown);
}
