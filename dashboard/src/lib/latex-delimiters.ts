import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Node } from "unist";

const parser = unified().use(remarkParse).use(remarkGfm);
type PositionedNode = Pick<Node, "type" | "position"> & { children?: PositionedNode[] };

/** Convert explicit TeX delimiters only. Code, HTML, YAML and existing dollar
 * math are left intact; in particular, aligned row breaks like \\[6pt] must
 * never be mistaken for a display-math opener. */
export function normalizeLatexDelimiters(content: string): string {
  if (!content.includes("\\(") && !content.includes("\\[")) return content;
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? "";
  const body = content.slice(frontmatter.length);
  const protectedRanges: Array<[number, number]> = [];
  const tableRanges: Array<[number, number]> = [];
  function visit(node: PositionedNode): void {
    if (node.type === "table" && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
      tableRanges.push([node.position.start.offset, node.position.end.offset]);
    }
    if (["code", "inlineCode", "html", "definition"].includes(node.type)) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) protectedRanges.push([start, end]);
    } else if (node.children) {
      for (const child of node.children) visit(child);
    }
  }
  visit(parser.parse(body));

  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const converted = body.replace(
    /(?<![\\$])\$\$[\s\S]*?(?<!\\)\$\$|(?<![\\$])\$(?!\$)[^\r\n$]*?(?<!\\)\$|(?<!\\)\\\(([^\r\n]*?)(?<!\\)\\\)|(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g,
    (match, inline: string | undefined, display: string | undefined, offset: number) => {
      if (protectedRanges.some(([start, end]) => offset < end && offset + match.length > start)) return match;
      if (inline !== undefined) {
        let formula = inline.trim();
        // GFM splits cells before parsing math. TeX commands express the same
        // magnitude/norm bars without exposing a literal column separator.
        if (tableRanges.some(([start, end]) => offset >= start && offset < end)) {
          formula = formula.replace(/\\\||(?<!\\)\|/g, bar => bar === "\\|" ? "\\Vert " : "\\vert ");
        }
        return formula ? `$${formula}$` : match;
      }
      if (display === undefined || !display.trim()) return match;
      // Preserve existing block whitespace and Markdown container indentation.
      if (/^[\t ]*\r?\n/.test(display) && /\n[\t >]*$/.test(display)) return `$$${display}$$`;
      const prefix = body.slice(body.lastIndexOf("\n", offset - 1) + 1, offset);
      const continuation = prefix.replace(/(?:[-+*]|\d+[.)])[\t ]+$/, marker => " ".repeat(marker.length));
      const indent = /^[\t >]*$/.test(continuation) ? continuation : "";
      const before = indent === continuation ? "" : `${newline}${newline}`;
      const after = /^(?:[\t ]*\r?\n|$)/.test(body.slice(offset + match.length)) ? "" : `${newline}${newline}`;
      return `${before}$$${newline}${indent}${display.trim()}${newline}${indent}$$${after}`;
    },
  );
  return frontmatter + converted;
}
