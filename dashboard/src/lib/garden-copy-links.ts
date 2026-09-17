import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";
import type { Nodes } from "mdast";

/** Rewrite parsed links while preserving code, equations, and untouched prose. */
export function rewriteGardenCopyLinks(markdown: string, rewrite: (url: string, wiki: boolean) => string): string {
  const header = /^(\uFEFF?---[^\S\r\n]*\r?\n)[\s\S]*?\r?\n---[^\S\r\n]*(?:\r?\n|$)/.exec(markdown)?.[0] ?? "";
  const body = markdown.slice(header.length);
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (node: Nodes): void => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      const original = body.slice(start, end);
      let updated = original;
      if (node.type === "link" || node.type === "image" || node.type === "definition") {
        const url = rewrite(node.url, false);
        if (url !== node.url) updated = toMarkdown({ ...node, url }).trimEnd();
      } else if (node.type === "html") {
        updated = original.replace(/(\b(?:src|href|poster|data)=)(["'])([^"'\n]+)\2/gi,
          (_, attribute, quote, url) => `${attribute}${quote}${rewrite(url, false)}${quote}`);
      } else if (node.type === "text") {
        updated = original.replace(/\[\[([^\]|\n]+)(\|[^\]\n]*)?\]\]/g,
          (_, url, label = "") => `[[${rewrite(url, true)}${label}]]`);
      }
      if (updated !== original) { edits.push({ start, end, text: updated }); return; }
    }
    if ("children" in node) node.children.forEach(visit);
  };
  visit(fromMarkdown(body));
  let result = body;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return header + result;
}
