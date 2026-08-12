// Make anydoc's GitHub-Flavored Markdown safe for Breadboard's three renderers.
//
// Breadboard renders Markdown three ways — Quartz (the garden iframe), the chat
// renderer, and the PDF/DOCX exporters — and they disagree about raw HTML and
// Obsidian syntax. anydoc already emits clean GFM, so only two things need
// lowering:
//
//   * the `<a id="…"></a>` markers anydoc emits for link targets that are not
//     headings (Quartz renders them, chat drops them, and neither reader is
//     any better off for having an invisible anchor)
//   * text a renderer would eat rather than show: a raw `<`, and Obsidian's
//     `%%…%%` (Quartz *deletes* everything between a pair) and `[[…]]`
//
// Deliberately NOT reused here: `vlm-ocr/quartz-safe.ts`. That module also runs
// a KaTeX pass over every `$…$` span, which is right for OCR output full of
// LaTeX and wrong for an office document — "costs $50 and $75" would be read as
// one inline formula, fail to render, and get demoted to code mid-sentence.

/** Fenced and inline code are literal text and are never rewritten. */
const PROTECTED_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`/g;

const MASK_OPEN = String.fromCharCode(0);
const MASK_CLOSE = String.fromCharCode(1);

function withProtectedSpans(
  text: string,
  transform: (prose: string) => string,
): string {
  const spans: string[] = [];
  const masked = text.replace(PROTECTED_RE, (value) => {
    spans.push(value);
    return `${MASK_OPEN}${spans.length - 1}${MASK_CLOSE}`;
  });
  return transform(masked).replace(
    new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, "g"),
    (_whole, index: string) => spans[Number(index)] ?? "",
  );
}

/**
 * Drop the standalone anchor markers. Links *to* headings keep working: anydoc
 * points those at the heading's GFM slug, which Quartz generates the same way.
 */
const ANCHOR_MARKER_RE = /<a id="[^"]*"><\/a>\s*/g;

export function stripAnchorMarkers(markdown: string): string {
  return markdown.replace(ANCHOR_MARKER_RE, "");
}

/**
 * Show every remaining `<` as a character rather than handing it to a renderer
 * as a tag. anydoc backslash-escapes the ones that look like tag openings, so
 * those are unescaped first — otherwise the backslash would survive into the
 * page as visible punctuation.
 */
function escapeRawHtml(prose: string): string {
  return prose.replace(/\\</g, "<").replace(/</g, "&lt;");
}

/**
 * Neutralize the Obsidian syntax Quartz applies to the raw source. `%%…%%` is
 * the dangerous one: Quartz strips the comment *and its contents* before
 * parsing, so an unlucky pair of percent signs would silently delete a chunk of
 * the document. Character references keep the rendered text identical.
 */
function neutralizeObsidianSyntax(prose: string): string {
  return prose
    .replace(/%%/g, "%&#37;")
    .replace(/\[\[/g, "[&#91;")
    .replace(/!\[&#91;/g, "!&#91;&#91;");
}

/** Lower one anydoc conversion to Markdown every Breadboard renderer handles. */
export function sanitizeAnydocMarkdown(markdown: string): string {
  return withProtectedSpans(stripAnchorMarkers(markdown), (prose) =>
    escapeRawHtml(neutralizeObsidianSyntax(prose)),
  )
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

/**
 * A readable plain-text rendering of a Markdown section, for the prompt text
 * the knowledge extractor sees. Tables and lists keep their rows — only the
 * decoration that carries no meaning on its own is removed.
 */
export function anydocSectionPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/^```[^\n]*\n?/, "").replace(/```$/, ""),
    )
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?![\w*])/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
