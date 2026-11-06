import { ApiError } from "./hermes/route-core.ts";
import { createTwoFilesPatch, FILE_HEADERS_ONLY } from "diff";

export type RevisionRange = { start: number; end: number };

/** Apply one reviewed replacement or diff without guessing at context. */
export function applyGardenRevision(
  current: string,
  proposal: string,
  originalText?: string,
  options: { relocateHunks?: boolean } = {},
): string {
  return prepareGardenRevision(current, proposal, originalText, options).content;
}

/** Resolve the patch once and identify only the prose it actually adds. */
export function prepareGardenRevision(
  current: string,
  proposal: string,
  originalText?: string,
  options: { relocateHunks?: boolean } = {},
): { content: string; addedRanges: RevisionRange[] } {
  // A replacement names its scope with verbatim source text. Never interpret
  // a paragraph (or instructions describing an edit) as a whole-page rewrite.
  if (originalText !== undefined) {
    if (!originalText.trim()) throw new ApiError(400, "empty_revision_target", "originalText must contain the exact passage to replace.");
    const start = current.indexOf(originalText);
    if (start < 0 || current.indexOf(originalText, start + 1) !== -1) {
      throw new ApiError(409, "revision_conflict", "The original passage must match exactly once in the current page. Read the page again and include enough surrounding text to identify it uniquely.");
    }
    // Slice literally: preserve all bytes outside the match, including line
    // endings, metadata and trailing whitespace. Replacement may be empty.
    return { content: current.slice(0, start) + proposal + current.slice(start + originalText.length),
      addedRanges: proposal.length ? [{ start, end: start + proposal.length }] : [] };
  }

  let revision = proposal;
  const fence = revision.match(/^\s*```(?:markdown|md|diff|patch)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) revision = fence[1];
  if (!revision.trim()) throw new ApiError(400, "empty_revision", "The proposed revision is empty.");

  if (!/^(?:diff --git|--- [^\n]*\n\+\+\+ |@@|\*\*\* Begin Patch)/m.test(revision)) {
    throw new ApiError(400, "revision_target_required", "A replacement requires originalText containing the exact passage to replace, or a valid diff. Plain text never replaces the entire page. Read the page and submit a targeted revision.");
  }

  const conflict = () => new ApiError(409, "revision_conflict", "This patch does not match the current page. Request a fresh revision before applying it. Diff hunks must contain exact complete source lines, including blank lines and punctuation. To replace part of a line, use originalText copied verbatim from the current page instead.");
  const original = current.replace(/\r\n/g, "\n").split("\n");
  let trailingNewline = original.at(-1) === "";
  if (trailingNewline) original.pop();
  const patch = revision.replace(/\r\n/g, "\n").split("\n");
  if (patch.at(-1) === "") patch.pop();
  const output: string[] = [];
  const addedLines = new Set<number>();
  let cursor = 0;
  let hunks = 0;
  let patchCursor = 0;
  let patchDelta = 0;
  for (let index = 0; index < patch.length;) {
    const header = patch[index].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/);
    const contextOnly = patch[index] === "@@";
    if (!header && !contextOnly) {
      if (hunks || !/^(?:diff --git |index |--- |\+\+\+ )/.test(patch[index])) throw conflict();
      index += 1;
      continue;
    }
    hunks += 1;
    let oldCount = Number(header?.[2] ?? 1), newCount = Number(header?.[4] ?? 1);
    let start = Number(header?.[1]) - (oldCount === 0 ? 0 : 1);
    if (header && options.relocateHunks) {
      // Validate the patch's own coordinates before relocating its source.
      // A shifted page must not make a malformed or overlapping diff valid.
      if (start < patchCursor || Number(header[3]) - (newCount === 0 ? 0 : 1) !== start + patchDelta) throw conflict();
      patchCursor = start + oldCount;
      patchDelta += newCount - oldCount;
    }
    if (contextOnly || options.relocateHunks) {
      // Bare hunks and stale numbered hunks require an exact, unique source
      // block. Stale coordinates are never evidence for choosing between
      // duplicate matches, or for placing an insertion with no source context.
      const before: string[] = [];
      let replacementCount = 0;
      for (let next = index + 1; next < patch.length && !/^@@(?: |$)/.test(patch[next]); next += 1) {
        const line = patch[next];
        if (line === "\\ No newline at end of file") continue;
        if (!/^[ +\-]/.test(line)) throw conflict();
        if (line[0] !== "+") before.push(line.slice(1));
        if (line[0] !== "-") replacementCount += 1;
      }
      if (header && (oldCount !== before.length || newCount !== replacementCount)) throw conflict();
      oldCount = before.length;
      newCount = replacementCount;
      if (!oldCount) throw conflict();
      start = -1;
      for (let candidate = options.relocateHunks ? 0 : cursor; candidate <= original.length - oldCount; candidate += 1) {
        if (!before.every((line, offset) => original[candidate + offset] === line)) continue;
        if (start !== -1) throw conflict();
        start = candidate;
      }
    }
    if (start < cursor || start > original.length) throw conflict();
    output.push(...original.slice(cursor, start));
    cursor = start;
    if (header && !options.relocateHunks && Number(header[3]) - (newCount === 0 ? 0 : 1) !== output.length) throw conflict();
    let removed = 0, added = 0;
    index += 1;
    while (index < patch.length && !/^@@(?: |$)/.test(patch[index])) {
      const line = patch[index++];
      if (line === "\\ No newline at end of file") {
        if (!patch[index - 2]?.startsWith("-")) trailingNewline = false;
        continue;
      }
      const operation = line[0], text = line.slice(1);
      if (operation !== " " && operation !== "+" && operation !== "-") throw conflict();
      if (operation !== "+") {
        if (original[cursor] !== text) throw conflict();
        cursor += 1;
        removed += 1;
      }
      if (operation === "+") addedLines.add(output.length);
      if (operation !== "-") { output.push(text); added += 1; trailingNewline = true; }
      if (removed > oldCount || added > newCount) throw conflict();
    }
    if (removed !== oldCount || added !== newCount) throw conflict();
  }
  if (!hunks) throw conflict();
  if (cursor < original.length) trailingNewline = current.endsWith("\n");
  output.push(...original.slice(cursor));
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const addedRanges: RevisionRange[] = [];
  let offset = 0;
  output.forEach((line, index) => {
    if (addedLines.has(index)) {
      const previous = addedRanges.at(-1);
      if (previous && addedLines.has(index - 1)) previous.end = offset + line.length;
      else addedRanges.push({ start: offset, end: offset + line.length });
    }
    offset += line.length + eol.length;
  });
  return { content: output.join(eol) + (trailingNewline ? eol : ""), addedRanges };
}

/** Serialize reviewed prose back to a targeted patch, using the same strict applicator. */
export function createGardenRevision(current: string, revised: string): string {
  const normalize = (text: string) => text.replace(/\r\n/g, "\n");
  const patch = createTwoFilesPatch("page.md", "page.md", normalize(current), normalize(revised),
    undefined, undefined, { context: 3, headerOptions: FILE_HEADERS_ONLY, timeout: 1000 });
  if (!patch || normalize(applyGardenRevision(current, patch)) !== normalize(revised)) {
    throw new Error("The reviewed text could not be represented as an exact page revision.");
  }
  return patch;
}
