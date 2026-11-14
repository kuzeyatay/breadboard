import { isMap, parseDocument } from "yaml";
import { editedPageAuthorship, pageAuthorship } from "./page-authorship.ts";

/** Record an edit of `previous` (now `next`) in the page's `authorship` field. */
export function markPageEdit(previous: string, next: string, editor: "human" | "ai"): string {
  const authorship = editedPageAuthorship(pageAuthorship(readQuartzMetadata(previous)), editor);
  return readQuartzMetadata(next).authorship === authorship ? next : updateQuartzMetadata(next, "authorship", authorship);
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
