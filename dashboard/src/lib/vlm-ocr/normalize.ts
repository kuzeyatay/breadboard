// doc_parse output normalization, ported from HunyuanOCR-1.5's
// inference/utils/output_utils.py (`normalize_doc_parse_markdown`).
//
// Upstream applies ten conservative patterns; the six ported here are the ones
// that affect whether the markdown *renders* rather than how it scores against
// a benchmark:
//
//   U — strip trailing layout coordinate tokens the model leaks into prose
//   T — lift <caption> out of <table> so the caption is real markdown
//   E — split an `array{l}` block whose rows are separate equations
//   D — rebalance \left / \right (unbalanced pairs are a KaTeX parse error)
//   A — promote a whole-line inline formula to display math
//   V — repair display blocks with a leading bare `&` or surplus `}`
//
// The benchmark-alignment patterns (C, C2, W, F) are deliberately not ported:
// they reshape correct-but-differently-formatted math to match ground truth,
// which is not something Breadboard needs and each carries corruption risk.
//
// Apply only to `doc_parse` / `layout_parse` output. The other tasks emit JSON,
// bare LaTeX or bare HTML and must not be touched.

import { cleanRepeatedSubstrings } from "./repetition.ts";

// ── Pattern E — array{l} rows that are independent equations ────────────────

const PARA_BREAK = /\\\\\s*\\\\/;
const ARRAY_L_BLOCK = /^\\begin\{array\}\{l\}([\s\S]*?)\\end\{array\}$/;

function splitArrayLBlock(inner: string): string[] | null {
  if (!PARA_BREAK.test(inner)) return null;

  const parts = inner.split(/\\\\\s*\\\\/);
  const cleaned: string[] = [];
  for (const rawPart of parts) {
    let part = rawPart.trim().replace(/\\\\$/, "").trim();
    if (part.startsWith("{") && part.endsWith("}")) {
      const inner2 = part.slice(1, -1);
      let depth = 0;
      let ok = true;
      for (const ch of inner2) {
        if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (depth < 0) {
            ok = false;
            break;
          }
        }
      }
      if (ok && depth === 0) part = inner2.trim();
    }
    if (part) cleaned.push(part);
  }
  return cleaned;
}

function applyPatternE(text: string): string {
  const replaceBlock = (whole: string, innerFull: string): string => {
    const stripped = innerFull.trim();
    const match = ARRAY_L_BLOCK.exec(stripped);
    if (!match) return whole;
    const parts = splitArrayLBlock(match[1] ?? "");
    if (!parts || parts.length < 2) return whole;
    return `\n\n${parts.map((part) => `$$ ${part} $$`).join("\n\n")}\n\n`;
  };

  return text
    .replace(/\$\$([\s\S]*?)\$\$/g, (whole, inner: string) =>
      replaceBlock(whole, inner),
    )
    .replace(/\\\[([\s\S]*?)\\\]/g, (whole, inner: string) =>
      replaceBlock(whole, inner),
    );
}

// ── Pattern D — \left / \right rebalance ────────────────────────────────────

const LEFT_RE = /\\left(?![a-zA-Z@])/g;
const RIGHT_RE = /\\right(?![a-zA-Z@])/g;

/** Balance `\left`/`\right` so KaTeX can parse the block. */
export function fixLeftRight(content: string): { content: string; fixes: number } {
  const left = content.match(LEFT_RE)?.length ?? 0;
  const right = content.match(RIGHT_RE)?.length ?? 0;
  if (left === right) return { content, fixes: 0 };

  if (left > right) {
    const diff = left - right;
    const ends = [...content.matchAll(/\\end\{[^}]+\}/g)];
    const last = ends[ends.length - 1];
    if (last?.index !== undefined) {
      return {
        content: `${content.slice(0, last.index)}${"\\right.".repeat(diff)} ${content.slice(last.index)}`,
        fixes: diff,
      };
    }
    return {
      content: `${content.replace(/\s+$/, "")} ${"\\right.".repeat(diff)}`,
      fixes: diff,
    };
  }

  const diff = right - left;
  const begin = /\\begin\{[^}]+\}/.exec(content);
  if (begin) {
    const pos = begin.index + begin[0].length;
    return {
      content: `${content.slice(0, pos)} ${"\\left.".repeat(diff)}${content.slice(pos)}`,
      fixes: diff,
    };
  }
  return { content: ` ${"\\left.".repeat(diff)}${content}`, fixes: diff };
}

function applyPatternD(text: string): string {
  const fix = (open: string, close: string) => (_whole: string, inner: string) =>
    `${open}${fixLeftRight(inner).content}${close}`;

  return text
    .replace(/\$\$([\s\S]*?)\$\$/g, fix("$$", "$$"))
    .replace(/\\\[([\s\S]*?)\\\]/g, fix("\\[", "\\]"));
}

// ── Pattern A — whole-line inline formula → display math ────────────────────

const RICH_TOKEN =
  /\\(?:frac|sum|int|prod|therefore|because|forall|exists|begin|left|right|sqrt|partial|nabla|infty|cdot|times|div|leq|geq|neq|approx|equiv|to|rightarrow|leftarrow|leftrightarrow|cap|cup|in|notin|subset|supseteq|cong|sim)\b/;

function looksLikeRealFormula(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length >= 15) return true;
  return RICH_TOKEN.test(trimmed);
}

function applyPatternA(text: string): string {
  return text.replace(
    /^[ \t]*\$([^$\n]+?)\$[ \t]*$/gm,
    (whole, inner: string) => {
      const trimmed = inner.trim();
      return looksLikeRealFormula(trimmed) ? `\n\n$$ ${trimmed} $$\n\n` : whole;
    },
  );
}

// ── Pattern V — low-risk display block repair ───────────────────────────────

/** Net `{` minus `}` depth, skipping escaped characters. */
export function netBraceDepth(value: string): number {
  let depth = 0;
  let i = 0;
  while (i < value.length) {
    const ch = value[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    i += 1;
  }
  return depth;
}

export function repairDisplayBlock(content: string): {
  content: string;
  fixes: number;
} {
  const original = content;
  let next = content;
  let fixes = 0;

  const stripped = next.replace(/^(\s*)&/, "$1");
  if (stripped !== next) {
    next = stripped;
    fixes += 1;
  }

  const depth = netBraceDepth(next);
  if (depth < 0) {
    let need = -depth;
    while (need > 0) {
      const match = /\}\s*$/.exec(next);
      if (!match) break;
      let backslashes = 0;
      let j = match.index - 1;
      while (j >= 0 && next[j] === "\\") {
        backslashes += 1;
        j -= 1;
      }
      if (backslashes % 2 === 1) break;
      next = next.slice(0, match.index) + next.slice(match.index + 1);
      need -= 1;
      fixes += 1;
    }
  }

  return { content: next, fixes: next === original ? 0 : fixes };
}

function applyPatternV(text: string): string {
  const fix = (open: string, close: string) => (_whole: string, inner: string) =>
    `${open}${repairDisplayBlock(inner).content}${close}`;

  return text
    .replace(/\$\$([\s\S]*?)\$\$/g, fix("$$", "$$"))
    .replace(/\\\[([\s\S]*?)\\\]/g, fix("\\[", "\\]"));
}

// ── Pattern T — lift <caption> out of <table> ───────────────────────────────

const TABLE_CAPTION_RE =
  /<table([^>]*)>\s*<caption[^>]*>([\s\S]*?)<\/caption>\s*([\s\S]*?)<\/table>/gi;

function applyPatternT(text: string): string {
  return text.replace(
    TABLE_CAPTION_RE,
    (whole, attrs: string, rawCaption: string, rawBody: string) => {
      const caption = rawCaption.trim();
      if (!caption) return whole;
      const body = rawBody.trim().replace(/^<td>\s*(?=<tr>)/i, "");
      return `${caption}\n\n<table${attrs ?? ""}>${body}</table>`;
    },
  );
}

// ── Pattern U — strip trailing layout coordinate tokens ─────────────────────

const COORD_PAIR = /\(\d{1,4},\d{1,4}\),\(\d{1,4},\d{1,4}\)/;
const TRAILING_COORDS = /(?:[ \t,，]*\(\d{1,4},\d{1,4}\),\(\d{1,4},\d{1,4}\))+[ \t]*$/;

function hasHtmlTableToken(line: string): boolean {
  const low = line.toLowerCase();
  return (
    low.includes("<table") ||
    low.includes("<tr") ||
    low.includes("<td") ||
    low.includes("</td")
  );
}

// NUL never appears in model output, so it is a collision-free mask sentinel.
const MASK = String.fromCharCode(0);
const MASK_RE = new RegExp(MASK + String.raw`U(\d+)` + MASK, "g");

function applyPatternU(text: string): string {
  // Mask math so coordinate-looking point sets inside formulas survive.
  const spans: string[] = [];
  const masked = text.replace(
    /\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\[[\s\S]*?\\\]/g,
    (value) => {
      spans.push(value);
      return `${MASK}U${spans.length - 1}${MASK}`;
    },
  );

  const outLines: string[] = [];
  for (const line of masked.split("\n")) {
    if (hasHtmlTableToken(line) || !COORD_PAIR.test(line)) {
      outLines.push(line);
      continue;
    }
    const stripped = line.replace(TRAILING_COORDS, "");
    if (stripped === line) {
      // A coordinate pair that is not a clean trailing token — too risky.
      outLines.push(line);
      continue;
    }
    // A bare coordinate line is a figure box; drop it entirely.
    if (stripped.trim()) outLines.push(stripped.replace(/\s+$/, ""));
  }

  return outLines
    .join("\n")
    .replace(MASK_RE, (_whole, index: string) => spans[Number(index)]);
}

// ── Driver ──────────────────────────────────────────────────────────────────

/** Strip a fence the model sometimes wraps the whole answer in. */
export function unwrapWholeAnswerFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:markdown|md|html)?\s*\n([\s\S]*?)\n?```$/i.exec(trimmed);
  if (!match) return text;
  const inner = match[1] ?? "";
  // Only unwrap when the fence really did wrap everything.
  return inner.includes("```") ? text : inner;
}

/**
 * Breadboard-specific, not part of the upstream patterns.
 *
 * `normalizeQuartzMarkdown` strips trailing sentence punctuation from math, on
 * the assumption it leaked in from the surrounding prose. When pattern D closes
 * an open group with the invisible delimiter `\right.`, that dot is the last
 * character of the block — stripping it leaves a bare `\right`, which KaTeX
 * rejects. Anchoring it with an empty group keeps the delimiter and renders
 * identically.
 */
export function guardTrailingDelimiterFormula(formula: string): string {
  if (!/\\(?:left|right)\.\s*$/.test(formula)) return formula;
  return `${formula.replace(/\s+$/, "")}{}`;
}

/** Apply {@link guardTrailingDelimiterFormula} to every math span in `text`. */
export function guardTrailingDelimiter(text: string): string {
  return text
    .replace(/\$\$([\s\S]*?)\$\$/g, (whole, inner: string) => {
      const guarded = guardTrailingDelimiterFormula(inner);
      return guarded === inner ? whole : `$$${guarded}$$`;
    })
    .replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (whole, prefix: string, inner: string) => {
      const guarded = guardTrailingDelimiterFormula(inner);
      return guarded === inner ? whole : `${prefix}$${guarded}$`;
    });
}

/**
 * Close a display block the model never finished. Hitting the token budget
 * mid-formula leaves a lone `$$`, which every later pass would then skip —
 * the block would reach the page as literal `$$ …` text.
 */
export function closeDanglingDisplayMath(text: string): string {
  const delimiters = text.match(/\$\$/g)?.length ?? 0;
  if (delimiters % 2 === 0) return text;
  return `${text.replace(/\s+$/, "")}\n$$`;
}

/**
 * Normalize one page of `doc_parse` output. Safe to call on an empty string.
 */
export function normalizeDocParseMarkdown(text: string): string {
  if (!text.trim()) return "";

  let next = cleanRepeatedSubstrings(unwrapWholeAnswerFence(text));
  next = closeDanglingDisplayMath(next);
  next = applyPatternU(next);
  next = applyPatternT(next);
  next = applyPatternE(next);
  next = applyPatternD(next);
  next = applyPatternA(next);
  next = applyPatternV(next);
  next = guardTrailingDelimiter(next);
  return next.trim();
}
