/**
 * Structural masking for Breadboard learning-page markdown.
 *
 * The upstream scanner masks fenced code, inline code, URLs and link targets.
 * That is not enough here. A generated learning page is mostly LaTeX, source
 * anchors, wikilinks and ```breadboard-visual``` blocks, none of which is prose
 * a human wrote and none of which should move the score. Display math in
 * particular is invisible to the upstream scanner, so a page heavy in `\text{}`
 * would score its own equations.
 *
 * Everything here blanks a region while preserving newlines and character
 * offsets, so reported line numbers still point at the real line.
 */

import { blankPreservingLines, prepareText } from "./engine.ts";
import type { PrepareOptions } from "./engine.ts";

/**
 * A runaway mask is worse than no mask: an unbalanced `$$` would otherwise
 * swallow the rest of the document and report a flattering score. Regions
 * longer than this are left alone rather than silently eating the page.
 */
const MAX_MASK_SPAN = 4000;

function maskBounded(text: string, re: RegExp): string {
  return text.replace(re, (match) =>
    match.length > MAX_MASK_SPAN ? match : blankPreservingLines(match),
  );
}

export interface GardenMaskOptions extends PrepareOptions {
  /** Skip the LaTeX passes. Only useful for plain chat prose. */
  skipMath?: boolean;
}

/**
 * Apply the upstream preparation, then blank the structures specific to a
 * Breadboard garden page. The result is the same length as the input.
 */
export function maskGardenMarkdown(
  raw: string,
  opts: GardenMaskOptions = {},
): string {
  // CRLF frontmatter, which the upstream leading-frontmatter regex misses.
  let text = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, blankPreservingLines);

  // Fenced code (including ```breadboard-visual``` JSON), inline code, URLs,
  // markdown link targets, optional blockquotes.
  text = prepareText(text, opts);

  if (!opts.skipMath) {
    text = maskBounded(text, /\$\$[\s\S]*?\$\$/g); // display math
    text = maskBounded(text, /\\\[[\s\S]*?\\\]/g); // \[ ... \]
    text = maskBounded(text, /\\\([\s\S]*?\\\)/g); // \( ... \)
    text = maskBounded(
      text,
      /\\begin\{[A-Za-z*]+\}[\s\S]*?\\end\{[A-Za-z*]+\}/g,
    ); // equation / align / cases
    text = text.replace(/\$[^$\n]{1,200}\$/g, blankPreservingLines); // inline math
    text = text.replace(/\\[A-Za-z]+(?:\{[^{}\n]{0,120}\})?/g, blankPreservingLines); // stray macros
  }

  // Wikilinks and embeds: the target is a page id and the label is a title,
  // neither of which is authored sentence prose.
  text = text.replace(/!?\[\[[^\]\n]{0,300}\]\]/g, blankPreservingLines);

  // Source anchor ids such as S1.P12.F1.
  text = text.replace(/\bS\d+(?:\.[A-Za-z]+\d+)+\b/g, blankPreservingLines);

  // Raw HTML tags.
  text = text.replace(/<\/?[A-Za-z][^>\n]{0,200}>/g, blankPreservingLines);

  // Table delimiter rows, whose runs of dashes are not em dashes.
  text = text.replace(/^\s*\|?[\s:|-]{4,}\|?\s*$/gm, blankPreservingLines);

  // Quartz/Obsidian callout markers.
  text = text.replace(/^\s*>\s*\[![A-Za-z-]+\][+-]?/gm, blankPreservingLines);

  return text;
}
