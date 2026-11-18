import { diffWordsWithSpace } from "diff";
import { isMap, parseDocument } from "yaml";
import {
  applyAuthorshipEdit, classifyAuthorship, editedPageAuthorship, formatAuthorshipChars, pageAuthorship,
  parseAuthorshipChars, seedAuthorshipChars, type AuthorshipEdit,
} from "./page-authorship.ts";

/** What the Garden editor watched the person do since the last save (editor document positions). */
export interface EditorProvenance { typed: number; pasted: number; removed: number }

export function parseEditorProvenance(value: unknown): EditorProvenance | undefined {
  if (!value || typeof value !== "object") return undefined;
  const count = (key: string) => {
    const number = (value as Record<string, unknown>)[key];
    return typeof number === "number" && Number.isFinite(number) && number >= 0 ? Math.min(number, 10_000_000) : undefined;
  };
  const typed = count("typed"), pasted = count("pasted"), removed = count("removed");
  return typed === undefined || pasted === undefined || removed === undefined ? undefined : { typed, pasted, removed };
}

const bodyOf = (content: string) => content.slice(frontmatter(content)?.[0].length ?? 0);

/**
 * Record an edit of `previous` (now `next`): a running tally of typed, pasted
 * and model characters (`authorship_chars`) decides `authorship`. Human saves
 * carry the editor's own typed/pasted counts; other edits are measured by diff.
 */
export function markPageEdit(previous: string, next: string, editor: "human" | "ai", provenance?: EditorProvenance): string {
  const metadata = readQuartzMetadata(previous), origin = pageAuthorship(metadata);
  const previousBody = bodyOf(previous);
  const before = parseAuthorshipChars(metadata.authorship_chars) ?? seedAuthorshipChars(origin, previousBody.length);
  let edit: AuthorshipEdit | undefined = provenance && editor === "human" ? provenance : undefined;
  if (!edit) {
    let inserted = 0, removed = 0;
    for (const part of diffWordsWithSpace(previousBody, bodyOf(next))) {
      if (part.added) inserted += part.value.length; else if (part.removed) removed += part.value.length;
    }
    edit = editor === "ai" ? { removed, ai: inserted } : { typed: inserted, pasted: 0, removed };
  }
  const chars = applyAuthorshipEdit(before, edit);
  const authorship = classifyAuthorship(chars) ?? editedPageAuthorship(origin, editor);
  const current = readQuartzMetadata(next);
  let result = current.authorship === authorship ? next : updateQuartzMetadata(next, "authorship", authorship);
  const tally = formatAuthorshipChars(chars);
  if (current.authorship_chars !== tally) result = updateQuartzMetadata(result, "authorship_chars", tally);
  return result;
}

function frontmatter(content: string) {
  return content.match(/^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?=\r?\n|$))/);
}
export function readQuartzMetadata(content: string): Record<string, unknown> {
  const match = frontmatter(content);
  if (!match) return {};
  const document = parseDocument(match[2]);
  return document.errors.length || !isMap(document.contents) ? {} : document.toJS();
}

/** Change one top-level YAML value, retaining all other source, comments and line endings. */
export function updateQuartzMetadata(content: string, key: string, value: string | string[] | null) {
  const match = frontmatter(content);
  if (!match) return value === null ? content : `---\n${key}: ${JSON.stringify(value)}\n---\n\n${content}`;
  const yaml = match[2], document = parseDocument(yaml);
  if (document.errors.length || !isMap(document.contents)) throw new Error("The page metadata needs valid YAML before its title or tags can be changed.");
  const pair = document.contents.items.find(item => String(item.key) === key);
  const newline = match[1].includes("\r\n") ? "\r\n" : "\n";
  let next: string;
  if (!pair) next = value === null ? yaml : `${yaml}${yaml ? newline : ""}${key}: ${JSON.stringify(value)}`;
  else {
    const start = (pair.key as { range?: number[] }).range?.[0];
    const range = (pair.value as { range?: number[] } | null)?.range;
    if (start === undefined) throw new Error("Could not locate the metadata field.");
    const end = range?.[2] ?? yaml.indexOf("\n", start);
    if (value === null) {
      const lineStart = yaml.lastIndexOf("\n", start - 1) + 1;
      next = yaml.slice(0, lineStart) + yaml.slice(end < 0 ? yaml.length : end);
      if (next.endsWith(newline)) next = next.slice(0, -newline.length);
    } else if (range) {
      const ending = yaml.slice(range[0], range[1]).match(/\r?\n$/)?.[0] ?? "";
      next = yaml.slice(0, range[0]) + JSON.stringify(value) + ending + yaml.slice(range[1]);
    } else {
      const lineEnd = yaml.indexOf("\n", start);
      next = yaml.slice(0, start) + `${key}: ${JSON.stringify(value)}` + (lineEnd < 0 ? "" : yaml.slice(lineEnd));
    }
  }
  return match[1] + next + content.slice(match[1].length + yaml.length);
}
