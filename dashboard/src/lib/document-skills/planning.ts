// The decisions a build makes before any model is called: is this document
// worth distilling, is it technical or prose, how many files should it become,
// and where does each one start and end.
//
// Kept separate from `builder.ts` on purpose. The builder reaches the ChatMock
// client and everything behind it; this module reaches nothing, so the turn
// path and the tests can ask "should this be distilled?" without loading a
// model stack to answer.

import type { BookType, DocumentChapter, SkillDepth } from "./types.ts";

/**
 * Ceiling on chapter files. Past this the cost of a blocking build stops being
 * justifiable, so neighbouring chapters are merged instead. The clone has no
 * such limit because it runs at the user's leisure; a chat turn does not.
 */
export const MAX_CHAPTER_FILES = 40;

/** How much of one chapter's raw text is sent to the model. */
export const MAX_CHAPTER_CHARS = 60_000;
/** When a chapter exceeds the cap, keep this much of its opening. */
const CHAPTER_HEAD_CHARS = 40_000;

/**
 * Documents below this stay verbatim in the prompt.
 *
 * Distilling a short document is a bad trade in both directions: the raw text
 * already fits, and a distillation of it is strictly less faithful than the
 * thing itself. The skill earns its cost only when the alternative is dumping
 * a book into every turn.
 */
export const MIN_TOKENS_FOR_SKILL = 6_000;

/** The clone's own ratio for whitespace-delimited text (config.WORDS_PER_TOKEN). */
export function estimateTokens(text: string): number {
  return Math.round(text.split(/\s+/).filter(Boolean).length / 0.75);
}

export function shouldDistill(text: string): boolean {
  return estimateTokens(text) >= MIN_TOKENS_FOR_SKILL;
}

export function fileSlug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "section"
  );
}

/**
 * Infer BOOK_TYPE the way the clone's Step 1.5 question does, from what is
 * actually in the text: fenced code, indented code, and pipe tables. The clone
 * asks the user; a chat attachment cannot stop and hold a dialogue mid-turn.
 */
export function inferBookType(text: string): BookType {
  const sample = text.slice(0, 400_000);
  const fences = (sample.match(/```/g) ?? []).length;
  const tables = (sample.match(/^\s*\|.+\|\s*$/gm) ?? []).length;
  const codeish = (sample.match(/^\s{4,}[\w$#{(].*$/gm) ?? []).length;
  const perThousandChars = ((fences / 2 + tables + codeish / 3) / Math.max(sample.length, 1)) * 1000;
  return perThousandChars > 0.35 ? "technical" : "text";
}

/** The clone's Step 7 budget matrix. */
export function chapterBudget(bookType: BookType, depth: SkillDepth): string {
  if (bookType === "technical") return depth === "study" ? "2,000-3,000 tokens" : "1,200-1,800 tokens";
  return depth === "study" ? "1,000-1,800 tokens" : "800-1,200 tokens";
}

/**
 * Fold the segmentation down to at most `limit` pieces by merging the smallest
 * adjacent pair repeatedly, so long chapters keep their own file and a run of
 * short ones becomes a single combined section. Merging never drops text: the
 * merged pieces still tile the document from the first offset to the last.
 */
export function mergeToLimit(
  chapters: readonly DocumentChapter[],
  limit = MAX_CHAPTER_FILES,
): DocumentChapter[] {
  const merged = chapters.map((chapter) => ({ ...chapter }));
  while (merged.length > limit) {
    let smallestIndex = 0;
    let smallestSize = Infinity;
    for (let index = 0; index < merged.length - 1; index += 1) {
      const size =
        merged[index].end - merged[index].start + (merged[index + 1].end - merged[index + 1].start);
      if (size < smallestSize) {
        smallestSize = size;
        smallestIndex = index;
      }
    }
    const left = merged[smallestIndex];
    const right = merged[smallestIndex + 1];
    merged.splice(smallestIndex, 2, {
      number: left.number,
      title: `${left.title} & ${right.title}`.slice(0, 120),
      start: left.start,
      end: right.end,
      kind: left.kind,
    });
  }
  return merged;
}

/**
 * The H1 a chapter file should carry.
 *
 * The clone reports a heading as the author wrote it, which usually already
 * says "Chapter 4: Replication". Prefixing that again produces
 * "Chapter 4: Chapter 4: Replication", so the ordinal is only added when the
 * title does not already carry one.
 */
export function chapterHeading(title: string, number: number, index: number): string {
  const clean = title.trim();
  if (/^(chapter|part|section|appendix|capítulo|capitulo|kapitel|chapitre)\b/i.test(clean)) {
    return clean;
  }
  // A synthesized window ("Part 3") or a bare heading ("Replication") gets the
  // number it was detected with, falling back to its position.
  return `Chapter ${number || index + 1}: ${clean}`;
}

export interface ChapterPlan extends DocumentChapter {
  /** `chapters/ch03-replication.md`, relative to the skill directory. */
  file: string;
  text: string;
  truncated: boolean;
}

/**
 * Turn boundaries into the files that will be written.
 *
 * An oversized chapter keeps its head and its tail rather than its first N
 * characters: a chapter's conclusions are at the end, and a distillation that
 * silently stops halfway would read as complete.
 */
export function planChapters(
  text: string,
  chapters: readonly DocumentChapter[],
): ChapterPlan[] {
  return chapters.map((chapter, index) => {
    const raw = text.slice(chapter.start, chapter.end);
    const truncated = raw.length > MAX_CHAPTER_CHARS;
    const body = truncated
      ? `${raw.slice(0, CHAPTER_HEAD_CHARS)}\n\n[… middle of this chapter omitted for length …]\n\n${raw.slice(
          -(MAX_CHAPTER_CHARS - CHAPTER_HEAD_CHARS),
        )}`
      : raw;
    const ordinal = String(index + 1).padStart(2, "0");
    return {
      ...chapter,
      file: `chapters/ch${ordinal}-${fileSlug(chapter.title)}.md`,
      text: body,
      truncated,
    };
  });
}
