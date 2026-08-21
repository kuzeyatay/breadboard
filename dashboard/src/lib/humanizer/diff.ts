// A line diff with word-level detail inside changed lines.
//
// First-party rather than a dependency. The repository had no diff utility to
// reuse, and adding one would have meant reconciling the dashboard's dependency
// tree — a several-thousand-package install on a OneDrive-backed checkout — for
// about a hundred lines of well-understood dynamic programming. This is a
// straight Hunt–Szymanski-style LCS over hashed lines, then the same LCS over
// tokens inside the lines that changed. Not a character diff: character diffs
// on prose produce confetti, which is why the brief warned against writing one.
//
// Pure, deterministic and framework-free, so it is unit-testable on its own and
// the rendering that consumes it stays first-party too.

export type DiffOp = "equal" | "insert" | "delete";

export interface WordPart {
  op: DiffOp;
  text: string;
}

export interface DiffLine {
  op: DiffOp | "replace";
  /** 1-based line number in the original, or null for a pure insertion. */
  originalNumber: number | null;
  /** 1-based line number in the rewrite, or null for a pure deletion. */
  rewriteNumber: number | null;
  originalText: string;
  rewriteText: string;
  /** Word-level parts, present only on a `replace`. */
  originalParts?: WordPart[];
  rewriteParts?: WordPart[];
}

export interface TextDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
  changed: number;
  /** True when the two texts are identical, which is worth saying plainly. */
  identical: boolean;
}

/**
 * Longest common subsequence over two arrays, returned as index pairs.
 *
 * O(n·m) in memory, which is why `MAX_DIFF_CELLS` exists below: a pathological
 * pair of inputs must degrade to a coarse diff rather than allocate a gigabyte.
 */
function lcsPairs<T>(left: readonly T[], right: readonly T[]): Array<[number, number]> {
  const rows = left.length;
  const columns = right.length;
  const table: Uint32Array = new Uint32Array((rows + 1) * (columns + 1));
  const at = (row: number, column: number) => row * (columns + 1) + column;

  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      table[at(row, column)] =
        left[row] === right[column]
          ? table[at(row + 1, column + 1)] + 1
          : Math.max(table[at(row + 1, column)], table[at(row, column + 1)]);
    }
  }

  const pairs: Array<[number, number]> = [];
  let row = 0;
  let column = 0;
  while (row < rows && column < columns) {
    if (left[row] === right[column]) {
      pairs.push([row, column]);
      row += 1;
      column += 1;
    } else if (table[at(row + 1, column)] >= table[at(row, column + 1)]) {
      row += 1;
    } else {
      column += 1;
    }
  }
  return pairs;
}

/** Above this the quadratic table is not worth the memory. */
const MAX_DIFF_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Tokens for the inner diff: words with their trailing whitespace attached, so
 * reassembling the parts reproduces the line exactly and the rendering can
 * preserve spacing without inventing any.
 */
export function splitWords(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

export function diffWords(before: string, after: string): {
  original: WordPart[];
  rewrite: WordPart[];
} {
  const left = splitWords(before);
  const right = splitWords(after);
  if (left.length * right.length > MAX_DIFF_CELLS) {
    return {
      original: before ? [{ op: "delete", text: before }] : [],
      rewrite: after ? [{ op: "insert", text: after }] : [],
    };
  }
  const pairs = lcsPairs(left, right);

  const original: WordPart[] = [];
  const rewrite: WordPart[] = [];
  let leftCursor = 0;
  let rightCursor = 0;

  const push = (parts: WordPart[], op: DiffOp, text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && last.op === op) last.text += text;
    else parts.push({ op, text });
  };

  for (const [leftIndex, rightIndex] of pairs) {
    while (leftCursor < leftIndex) push(original, "delete", left[leftCursor++]);
    while (rightCursor < rightIndex) push(rewrite, "insert", right[rightCursor++]);
    push(original, "equal", left[leftCursor++]);
    push(rewrite, "equal", right[rightCursor++]);
  }
  while (leftCursor < left.length) push(original, "delete", left[leftCursor++]);
  while (rightCursor < right.length) push(rewrite, "insert", right[rightCursor++]);

  return { original, rewrite };
}

/**
 * Pair a deletion run with an insertion run into `replace` rows.
 *
 * Without this a changed paragraph reads as "everything removed, everything
 * added" in two separate blocks, which is exactly the diff nobody can read.
 */
function emitBlock(
  removed: Array<{ number: number; text: string }>,
  added: Array<{ number: number; text: string }>,
  out: DiffLine[],
): void {
  const paired = Math.min(removed.length, added.length);
  for (let index = 0; index < paired; index += 1) {
    const before = removed[index];
    const after = added[index];
    const parts = diffWords(before.text, after.text);
    out.push({
      op: "replace",
      originalNumber: before.number,
      rewriteNumber: after.number,
      originalText: before.text,
      rewriteText: after.text,
      originalParts: parts.original,
      rewriteParts: parts.rewrite,
    });
  }
  for (let index = paired; index < removed.length; index += 1) {
    out.push({
      op: "delete",
      originalNumber: removed[index].number,
      rewriteNumber: null,
      originalText: removed[index].text,
      rewriteText: "",
    });
  }
  for (let index = paired; index < added.length; index += 1) {
    out.push({
      op: "insert",
      originalNumber: null,
      rewriteNumber: added[index].number,
      originalText: "",
      rewriteText: added[index].text,
    });
  }
  removed.length = 0;
  added.length = 0;
}

export function diffText(before: string, after: string): TextDiff {
  const left = splitLines(before);
  const right = splitLines(after);

  const pairs =
    left.length * right.length > MAX_DIFF_CELLS
      ? []
      : lcsPairs(left, right);

  const lines: DiffLine[] = [];
  const removed: Array<{ number: number; text: string }> = [];
  const added: Array<{ number: number; text: string }> = [];
  let leftCursor = 0;
  let rightCursor = 0;

  for (const [leftIndex, rightIndex] of pairs) {
    while (leftCursor < leftIndex) {
      removed.push({ number: leftCursor + 1, text: left[leftCursor] });
      leftCursor += 1;
    }
    while (rightCursor < rightIndex) {
      added.push({ number: rightCursor + 1, text: right[rightCursor] });
      rightCursor += 1;
    }
    emitBlock(removed, added, lines);
    lines.push({
      op: "equal",
      originalNumber: leftCursor + 1,
      rewriteNumber: rightCursor + 1,
      originalText: left[leftCursor],
      rewriteText: right[rightCursor],
    });
    leftCursor += 1;
    rightCursor += 1;
  }
  while (leftCursor < left.length) {
    removed.push({ number: leftCursor + 1, text: left[leftCursor] });
    leftCursor += 1;
  }
  while (rightCursor < right.length) {
    added.push({ number: rightCursor + 1, text: right[rightCursor] });
    rightCursor += 1;
  }
  emitBlock(removed, added, lines);

  let addedCount = 0;
  let removedCount = 0;
  let changedCount = 0;
  for (const line of lines) {
    if (line.op === "insert") addedCount += 1;
    else if (line.op === "delete") removedCount += 1;
    else if (line.op === "replace") changedCount += 1;
  }

  return {
    lines,
    added: addedCount,
    removed: removedCount,
    changed: changedCount,
    identical: before === after,
  };
}

/**
 * The same diff, flattened into one column.
 *
 * What a narrow screen gets. Two columns at 360px is two unreadable columns,
 * so the mobile mode is a real unified diff rather than a squeezed side-by-side
 * one.
 */
export interface UnifiedRow {
  op: DiffOp;
  number: number | null;
  text: string;
  parts?: WordPart[];
}

export function unifiedRows(diff: TextDiff): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  for (const line of diff.lines) {
    if (line.op === "equal") {
      rows.push({ op: "equal", number: line.rewriteNumber, text: line.rewriteText });
    } else if (line.op === "delete") {
      rows.push({ op: "delete", number: line.originalNumber, text: line.originalText });
    } else if (line.op === "insert") {
      rows.push({ op: "insert", number: line.rewriteNumber, text: line.rewriteText });
    } else {
      rows.push({
        op: "delete",
        number: line.originalNumber,
        text: line.originalText,
        ...(line.originalParts ? { parts: line.originalParts } : {}),
      });
      rows.push({
        op: "insert",
        number: line.rewriteNumber,
        text: line.rewriteText,
        ...(line.rewriteParts ? { parts: line.rewriteParts } : {}),
      });
    }
  }
  return rows;
}
