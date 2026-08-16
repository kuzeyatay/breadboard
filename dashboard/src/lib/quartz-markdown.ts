export interface MathExpression {
  formula: string;
  display: boolean;
  line: number;
  excerpt: string;
}

const CODE_FENCE_RE = /```[\s\S]*?```/g;

function splitCodeFences(markdown: string): Array<{ text: string; code: boolean }> {
  const parts: Array<{ text: string; code: boolean }> = [];
  let lastIndex = 0;
  for (const match of markdown.matchAll(CODE_FENCE_RE)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) {
      parts.push({ text: markdown.slice(lastIndex, match.index), code: false });
    }
    parts.push({ text: match[0], code: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < markdown.length) {
    parts.push({ text: markdown.slice(lastIndex), code: false });
  }
  return parts;
}

function maskMarkdownRegion(value: string): string {
  return value.replace(/[^\r\n]/g, " ");
}

/** Mask Markdown regions that are not learner-visible prose/math while
 * preserving offsets and line breaks for diagnostics. This extractor is a
 * grounding gate, so an equation hidden in metadata, a comment, or code must
 * never satisfy a required displayed-formula contract. */
function maskNonRenderedMarkdown(markdown: string): string {
  let masked = markdown;
  masked = masked.replace(
    /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,
    (value) => maskMarkdownRegion(value),
  );
  masked = masked.replace(
    /^( {0,3})(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)[\s\S]*?^(?: {0,3})\2[ \t]*(?:\r?\n|$)/gm,
    (value) => maskMarkdownRegion(value),
  );
  // An unclosed fence makes the rest of the candidate code, not rendered
  // lesson content. Over-masking is intentionally fail-closed here.
  masked = masked.replace(
    /^( {0,3})(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)[\s\S]*$/gm,
    (value) => maskMarkdownRegion(value),
  );
  masked = masked.replace(/<!--[\s\S]*?(?:-->|$)/g, (value) =>
    maskMarkdownRegion(value));
  masked = masked.replace(/(`+)[^\r\n]*?\1/g, (value) =>
    maskMarkdownRegion(value));
  return masked;
}

function normalizeFormulaText(formula: string): string {
  let next = formula
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/Ï„/g, "\\tau")
    .replace(/τ/g, "\\tau")
    .replace(/Î”/g, "\\Delta")
    .replace(/Δ/g, "\\Delta")
    .replace(/â‰¥/g, "\\geq")
    .replace(/≥/g, "\\geq")
    .replace(/â‰¤/g, "\\leq")
    .replace(/≤/g, "\\leq")
    .replace(/Ã—/g, "\\times")
    .replace(/×/g, "\\times")
    .replace(/(?<!\\)%/g, "\\%")
    .replace(/\\tag\{([^}]+)\}/g, "\\qquad \\text{($1)}")
    .trim();

  // Trailing prose punctuation inside a display equation is fragile in KaTeX
  // and almost always came from sentence punctuation around the block.
  next = next.replace(/[,.]\s*$/g, "");
  return next;
}

function displayBlock(formula: string): string {
  return `\n\n$$\n${normalizeFormulaText(formula)}\n$$\n\n`;
}

function normalizeNonCodeMarkdown(text: string): string {
  let next = text;

  next = next.replace(/\[\[(Page\s+\d{1,5})\]\]/gi, (_match, label: string) => {
    const clean = label.replace(/\s+/g, " ").trim();
    return `[[#${clean}|${clean}]]`;
  });

  next = next.replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula: string) =>
    displayBlock(formula),
  );

  next = next.replace(/\$\$([\s\S]*?)\$\$/g, (_match, formula: string) =>
    displayBlock(formula),
  );

  next = next.replace(/\\\(([\s\S]*?)\\\)/g, (_match, formula: string) => {
    return `$${normalizeFormulaText(formula)}$`;
  });

  next = next.replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (_match, prefix: string, formula: string) => {
    return `${prefix}$${normalizeFormulaText(formula)}$`;
  });

  return next
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}(\$\$)/g, "\n\n$1")
    .replace(/(\$\$\n)\n+/g, "$1")
    .replace(/\n+(\n\$\$)/g, "$1")
    .replace(/(\n\$\$\n[^\n][\s\S]*?\n\$\$)\n{3,}/g, "$1\n\n");
}

/** Normalize generated Markdown to Quartz/KaTeX-safe dollar delimiters. Code
 * fences are left byte-for-byte intact. */
export function normalizeQuartzMarkdown(markdown: string): string {
  // Frontmatter is YAML, not Markdown. In particular, a serialized LaTeX value
  // can legitimately contain `\\[6pt]` as a cases/aligned row separator. Running
  // the display-math normalizer over that value mistakes its final backslash for
  // a `\\[` delimiter and can inject newlines/`$$` into the quoted YAML scalar.
  // Keep a leading frontmatter block byte-for-byte intact and normalize only the
  // document body.
  const frontmatter = markdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? "";
  const body = frontmatter ? markdown.slice(frontmatter.length) : markdown;
  const normalizedBody = splitCodeFences(body)
    .map((part) => (part.code ? part.text : normalizeNonCodeMarkdown(part.text)))
    .join("")
    .replace(/\n{4,}/g, "\n\n\n");

  return `${frontmatter}${normalizedBody}`;
}

/**
 * Extract model-authored display equations without applying Quartz's rendering
 * normalizations first. This is intentionally stricter than
 * `extractQuartzMath(normalizeQuartzMarkdown(markdown))`: source-grounding
 * checks need to see whether the model actually reproduced canonical notation
 * such as `\\tag{...}`, even though the writer later lowers that notation to a
 * KaTeX-safe equivalent.
 */
export function extractVerbatimDisplayMath(markdown: string): MathExpression[] {
  const expressions: MathExpression[] = [];
  const withoutCode = maskNonRenderedMarkdown(markdown);

  for (const match of withoutCode.matchAll(/\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]/g)) {
    if (match.index === undefined) continue;
    const formula = (match[1] ?? match[2] ?? "").trim();
    if (!formula) continue;
    const line = withoutCode.slice(0, match.index).split(/\r?\n/).length;
    expressions.push({
      formula,
      display: true,
      line,
      excerpt: formula.replace(/\s+/g, " ").slice(0, 160),
    });
  }

  return expressions.sort((a, b) => a.line - b.line);
}

export function extractQuartzMath(markdown: string): MathExpression[] {
  const expressions: MathExpression[] = [];
  const withoutCode = splitCodeFences(markdown)
    .map((part) => (part.code ? " ".repeat(part.text.length) : part.text))
    .join("");

  for (const match of withoutCode.matchAll(/\$\$([\s\S]*?)\$\$/g)) {
    if (match.index === undefined) continue;
    const formula = (match[1] ?? "").trim();
    if (!formula) continue;
    const line = withoutCode.slice(0, match.index).split(/\r?\n/).length;
    expressions.push({
      formula,
      display: true,
      line,
      excerpt: formula.replace(/\s+/g, " ").slice(0, 160),
    });
  }

  const maskedDisplay = withoutCode.replace(/\$\$[\s\S]*?\$\$/g, (value) =>
    " ".repeat(value.length),
  );
  for (const match of maskedDisplay.matchAll(/(^|[^\\$])\$([^\n$]+?)\$/g)) {
    if (match.index === undefined) continue;
    const formula = (match[2] ?? "").trim();
    if (!formula) continue;
    const line = maskedDisplay.slice(0, match.index).split(/\r?\n/).length;
    expressions.push({
      formula,
      display: false,
      line,
      excerpt: formula.replace(/\s+/g, " ").slice(0, 160),
    });
  }

  return expressions.sort((a, b) => a.line - b.line);
}
