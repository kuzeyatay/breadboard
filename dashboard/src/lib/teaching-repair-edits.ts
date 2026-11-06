import type { TeachingDraftPassage } from "./teaching-draft-evidence.ts";
import { dropMismatchedJsonClosers } from "./learn-utils.ts";

/** Apply small repairs to the exact reviewed candidate, never a source or an
 * older page. Untouched characters are preserved by construction. */
export function applyTeachingRepairResponse(
  raw: string,
  markdown: string,
  passages: TeachingDraftPassage[],
  scope?: { immutablePrefix: string; immutableSuffix: string },
): string {
  const text = raw.trim().replace(/^```json\s*|\s*```$/g, "");
  // Older callers/providers can still return a complete Markdown replacement;
  // it must pass the same complete-page review and scope checks afterward.
  if (!text.startsWith("{")) return scope ? raw : raw.trim();
  let parsed: { edits?: unknown };
  try { parsed = JSON.parse(text); }
  catch {
    // Some providers insert an extra } between otherwise complete edits.
    // Remove only closers that cannot match an open container, preserving
    // every quoted character. Truncated or ambiguous responses still fail,
    // and recovered edits must pass all locator and scope checks below.
    try { parsed = JSON.parse(dropMismatchedJsonClosers(text)); }
    catch { throw new Error("Teaching repair returned invalid edit JSON; the previous draft was retained."); }
  }
  if (!parsed || Object.keys(parsed).some(key => key !== "edits") || !Array.isArray(parsed.edits) || !parsed.edits.length || parsed.edits.length > 64) {
    throw new Error("Teaching repair must return 1–64 exact edits; the previous draft was retained.");
  }
  const byId = new Map(passages.map(passage => [passage.id, passage]));
  const edits = parsed.edits.map((edit: unknown) => {
    if (!edit || typeof edit !== "object" || Array.isArray(edit)) throw new Error("Invalid teaching repair edit.");
    const item = edit as Record<string, unknown>;
    if (typeof item.replacement !== "string") throw new Error("Teaching repair replacement must be Markdown text.");
    let start: number, end: number;
    if (item.originalText !== undefined) {
      if (Object.keys(item).some(key => key !== "originalText" && key !== "replacement") ||
          typeof item.originalText !== "string" || !item.originalText.length) throw new Error("Use one exact nonempty originalText or a draft passage reference.");
      start = markdown.indexOf(item.originalText);
      if (start < 0 || markdown.indexOf(item.originalText, start + 1) >= 0) throw new Error("Teaching repair originalText must occur exactly once in the current draft.");
      end = start + item.originalText.length;
    } else {
      if (Object.keys(item).some(key => !["draftPassage", "through", "replacement"].includes(key))) throw new Error("Invalid teaching repair passage fields.");
      const first = typeof item.draftPassage === "string" ? byId.get(item.draftPassage) : undefined;
      const last = item.through === undefined ? first : typeof item.through === "string" ? byId.get(item.through) : undefined;
      if (!first || !last || first.start > last.start) throw new Error("Unknown, stale or reversed teaching repair passage reference.");
      start = first.start; end = last.end;
    }
    if (scope && (!markdown.startsWith(scope.immutablePrefix) || !markdown.endsWith(scope.immutableSuffix) ||
        start < scope.immutablePrefix.length || end > markdown.length - scope.immutableSuffix.length)) {
      throw new Error("Teaching repair crosses the authorized edit scope; the previous draft was retained.");
    }
    return { start, end, replacement: item.replacement };
  }).sort((a, b) => a.start - b.start);
  for (let index = 1; index < edits.length; index++) {
    if (edits[index].start < edits[index - 1].end) throw new Error("Teaching repair edits overlap; the previous draft was retained.");
  }
  let result = markdown;
  for (const edit of edits.toReversed()) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  return result;
}
