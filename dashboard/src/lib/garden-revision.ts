import { ApiError } from "./hermes/route-core.ts";

const FRONTMATTER = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/** Apply one reviewed replacement or diff without guessing at context. */
export function applyGardenRevision(current: string, proposal: string): string {
  let revision = proposal;
  const fence = revision.match(/^\s*```(?:markdown|md|diff|patch)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) revision = fence[1];
  if (!revision.trim()) throw new ApiError(400, "empty_revision", "The proposed revision is empty.");

  if (!/^(?:diff --git|--- [^\n]*\n\+\+\+ |@@|\*\*\* Begin Patch)/m.test(revision)) {
    revision = revision.trim();
    const frontmatter = current.match(FRONTMATTER)?.[0].trimEnd();
    return frontmatter && !FRONTMATTER.test(revision)
      ? `${frontmatter}\n\n${revision}\n`
      : `${revision}\n`;
  }

  const conflict = () => new ApiError(409, "revision_conflict", "This patch does not match the current page. Ask for a new revision before applying it.");
  const original = current.replace(/\r\n/g, "\n").split("\n");
  let trailingNewline = original.at(-1) === "";
  if (trailingNewline) original.pop();
  const patch = revision.replace(/\r\n/g, "\n").split("\n");
  if (patch.at(-1) === "") patch.pop();
  const output: string[] = [];
  let cursor = 0;
  let hunks = 0;
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
    if (contextOnly) {
      // Agents also propose bare @@ hunks. Without line numbers, require one
      // exact occurrence of the entire original block in the unconsumed page.
      // Never choose the first of several matches or place an unanchored insert.
      const before: string[] = [];
      newCount = 0;
      for (let next = index + 1; next < patch.length && !/^@@(?: |$)/.test(patch[next]); next += 1) {
        const line = patch[next];
        if (line === "\\ No newline at end of file") continue;
        if (!/^[ +\-]/.test(line)) throw conflict();
        if (line[0] !== "+") before.push(line.slice(1));
        if (line[0] !== "-") newCount += 1;
      }
      oldCount = before.length;
      if (!oldCount) throw conflict();
      start = -1;
      for (let candidate = cursor; candidate <= original.length - oldCount; candidate += 1) {
        if (!before.every((line, offset) => original[candidate + offset] === line)) continue;
        if (start !== -1) throw conflict();
        start = candidate;
      }
    }
    if (start < cursor || start > original.length) throw conflict();
    output.push(...original.slice(cursor, start));
    cursor = start;
    if (header && Number(header[3]) - (newCount === 0 ? 0 : 1) !== output.length) throw conflict();
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
      if (operation !== "-") { output.push(text); added += 1; trailingNewline = true; }
      if (removed > oldCount || added > newCount) throw conflict();
    }
    if (removed !== oldCount || added !== newCount) throw conflict();
  }
  if (!hunks) throw conflict();
  if (cursor < original.length) trailingNewline = current.endsWith("\n");
  output.push(...original.slice(cursor));
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  return output.join(eol) + (trailingNewline ? eol : "");
}
