import { type Node as PMNode, type Mark } from "@tiptap/pm/model";
import { parseEditorMarkdown } from "../../../../quartz/quartz/util/editorMarkdown";
import { editorSchema as s } from "./schema";
import { embedAdapter, serializeEmbed } from "./registry";

type Ast = { type: string; value?: string; children?: Ast[]; position?: { start: { offset?: number }; end: { offset?: number } }; [key: string]: unknown };
type Source = { raw: string; node: PMNode; gap: string };
const escape = (text: string) => text.replace(/([\\`*_[\]<>~#])/g, "\\$1").replace(/(^|\n)(\s*)([-+]|\d+\.)(?=\s)/g, '$1$2\\$3');
let codecSequence = 0;
export function embedKind(raw: string) {
  return embedAdapter(raw).kind;
}

/** Raw source belongs to immutable document nodes, not the rendered widget DOM. */
export class MarkdownCodec {
  private identity = ++codecSequence;
  private sources = new Map<string, Source>();
  private sequence = 0;
  private prefix = "";
  private documents = new Map<string, { source: string; prefix: string; doc: PMNode }>();
  private blocks = new WeakMap<PMNode, string>();
  private lastDocument?: PMNode;
  private lastMarkdown = "";

  parse(text: string): PMNode {
    const tree = parseEditorMarkdown(text) as unknown as Ast;
    const children: Ast[] = [];
    const input = tree.children ?? [];
    const definitions = new Map(input.filter(n => n.type === 'definition').map(n => [String(n.identifier).toLowerCase(), n]));
    for (let i = 0; i < input.length; i++) {
      const node = input[i], caption = input[i + 1];
      const image = node.type === "paragraph" && node.children?.length === 1 && node.children[0].type === "image" ? node.children[0] : null;
      if (image && /\/assets\/source-visuals\//.test(String(image.url)) && caption?.type === "paragraph" && caption.children?.every(n => n.type === "emphasis")) {
        children.push({ type: "sourceFigure", position: { start: node.position!.start, end: caption.position!.end } }); i++;
      } else children.push(node);
    }
    this.prefix = text.slice(0, children[0]?.position?.start.offset ?? text.length);
    const raw = (n: Ast) => {
      const start = n.position?.start.offset ?? 0, value = text.slice(start, n.position?.end.offset ?? 0);
      const container = text.slice(text.lastIndexOf('\n', start - 1) + 1, start);
      if (!container || !/^[\s>]*(?:[-+*] |\d+[.)] )?$/.test(container)) return value;
      // AST ranges include outer list/quote prefixes on continuation lines.
      // A fragment reused inside an edited parent must not duplicate them.
      const width = container.length;
      return value.replace(/(\r?\n)([ >\t]*)/g, (_match, newline: string, prefix: string) => newline + prefix.slice(Math.min(width, prefix.length)));
    };
    const remember = (n: Ast, node: PMNode, gap = "") => {
      const id = `source-${this.identity}-${++this.sequence}`;
      const next = node.type.create({ ...node.attrs, sourceId: id }, node.content, node.marks);
      this.sources.set(id, { raw: raw(n), node: next, gap });
      return next;
    };
    const object = (n: Ast, inline = false) => {
      const definition = n.type === 'imageReference' ? definitions.get(String(n.identifier).toLowerCase()) : undefined;
      const image = n.type === 'image' ? { src: n.url, alt: n.alt ?? '', title: n.title ?? '' }
        : definition ? { src: definition.url, alt: n.alt ?? '', title: definition.title ?? '' } : null;
      return s.nodes[inline ? "inline_object" : "embed"].create({ raw: raw(n),
        image,
        preview: definition ? `![${String(n.alt ?? '').replace(/\]/g, '\\]')}](<${String(definition.url).replace(/>/g, '%3E')}>)` : null,
        kind: n.type === "inlineMath" ? "math" : embedKind(raw(n)), label: n.value ?? raw(n) });
    };
    const inline = (nodes: Ast[], marks: readonly Mark[] = []): PMNode[] => nodes.flatMap(n => {
      if (n.type === "text") {
        // OFM tokens are kept out of the normal Markdown parser's lossy transforms.
        const value = n.value ?? "";
        const pattern = /!\[\[[\s\S]*?\]\]|\[\[([^\]]+)\]\]|%%[\s\S]*?%%|==([^=]+)==|(?:^|\s)(\^[\w-]+)\s*$/g;
        const result: PMNode[] = []; let last = 0;
        for (const match of value.matchAll(pattern)) {
          const at = match.index!;
          if (at > last) result.push(s.text(value.slice(last, at), marks));
          if (match[1]) {
            const [href, ...alias] = match[1].split("|");
            result.push(s.text(alias.join("|") || href, [...marks, s.marks.link.create({ href, wiki: true })]));
          } else if (match[2]) result.push(s.text(match[2], [...marks, s.marks.highlight.create()]));
          else result.push(s.nodes.inline_object.create({ raw: match[0], label: match[0], kind: match[0].startsWith("![[") ? embedKind(match[0]) : "source" }));
          last = at + match[0].length;
        }
        if (last < value.length) result.push(s.text(value.slice(last), marks));
        return result;
      }
      const mark = ({ strong: "strong", emphasis: "em", delete: "strike" } as Record<string,string>)[n.type];
      if (mark) return inline(n.children ?? [], [...marks, s.marks[mark].create()]);
      if (n.type === "inlineCode") return n.value ? [s.text(n.value, [s.marks.code.create()])] : [];
      if (n.type === "link") return inline(n.children ?? [], [...marks, s.marks.link.create({ href: n.url, title: n.title })]);
      if (n.type === 'linkReference') {
        const definition = definitions.get(String(n.identifier).toLowerCase());
        return inline(n.children ?? [], [...marks, s.marks.link.create({ href: definition?.url ?? '#', title: definition?.title, reference: String(n.label ?? n.identifier) })]);
      }
      if (n.type === "break") return [s.nodes.hard_break.create()];
      if (n.type === "footnoteReference") return [s.nodes.inline_object.create({ raw: raw(n), kind: "footnote", label: String(n.identifier) })];
      return [object(n, true)];
    });
    const convert = (n: Ast): PMNode => {
      let node: PMNode;
      switch (n.type) {
        case "paragraph": {
          const value = raw(n);
          node = n.children?.length === 1 && ['image', 'imageReference'].includes(n.children[0].type)
            ? object(n.children[0])
            : /^(?:!\[[\s\S]*\]|!\[\[[\s\S]*\]\])\s*$/.test(value) && (n.children?.length === 1 || value.startsWith("![["))
            ? object(n.children?.[0]?.type === 'imageReference' ? n.children[0] : n) : s.nodes.paragraph.create(null, inline(n.children ?? [])); break;
        }
        case "heading": node = s.nodes.heading.create({ level: n.depth }, inline(n.children ?? [])); break;
        case "blockquote": {
          const callout = raw(n).match(/^>\s*(\[!([^\]]+)\][+-]?)\s*/);
          const content = (n.children ?? []).map(convert);
          if (callout && content[0]?.type === s.nodes.paragraph) {
            const length = content[0].textContent.match(/^\[![^\]]+\][+-]?\s*/)?.[0].length ?? 0;
            content[0] = content[0].copy(content[0].content.cut(length));
          }
          node = s.nodes.blockquote.create({ callout: callout?.[2] ?? "", calloutMarker: callout?.[1] ?? "" }, content); break;
        }
        case "footnoteDefinition": node = s.nodes.footnote_definition.create({ identifier: n.identifier }, (n.children ?? []).map(convert)); break;
        case "list": node = s.nodes[n.ordered ? "ordered_list" : "bullet_list"].create({ order: n.start ?? 1 }, (n.children ?? []).map(convert)); break;
        case "listItem": node = s.nodes.list_item.create({ checked: n.checked ?? null }, (n.children ?? []).map(convert)); break;
        case "thematicBreak": node = s.nodes.horizontal_rule.create(); break;
        case "code": node = /^(?:penecho|artifact|breadboard-.*|mermaid)$/.test(String(n.lang)) ? object(n)
          : s.nodes.code_block.create({ language: n.lang ?? "", meta: n.meta ?? "" }, n.value ? s.text(n.value) : null); break;
        case "table": node = s.nodes.table.create({ align: n.align ?? [] }, (n.children ?? []).map((row, rowIndex) => s.nodes.table_row.create(null,
          (row.children ?? []).map(cell => s.nodes[rowIndex === 0 ? "table_header" : "table_cell"].create(null,
            s.nodes.paragraph.create(null, inline(cell.children ?? []))))))); break;
        default: node = object(n);
      }
      return remember(n, node);
    };
    const blocks = children.map((n, index) => {
      const node = convert(n), source = this.sources.get(node.attrs.sourceId)!;
      source.gap = text.slice(n.position?.end.offset ?? 0, children[index + 1]?.position?.start.offset ?? text.length);
      return node;
    });
    const context = `document-${this.identity}-${++this.sequence}`;
    const doc = s.nodes.doc.create({ sourceContext: context }, blocks.length ? blocks : [s.nodes.paragraph.create()]);
    this.documents.set(context, { source: text, prefix: this.prefix, doc });
    return doc;
  }

  serialize(doc: PMNode): string {
    // ProseMirror nodes are immutable. Selection changes, save acknowledgements,
    // metadata edits and repeated flushes can all reuse the current body.
    if (doc === this.lastDocument) return this.lastMarkdown;
    const markdown = this.serializeDocument(doc);
    this.lastDocument = doc;
    this.lastMarkdown = markdown;
    return markdown;
  }

  private serializeDocument(doc: PMNode): string {
    const document = this.documents.get(doc.attrs.sourceContext);
    if (document && (doc === document.doc || doc.eq(document.doc))) return document.source;
    const nodes: PMNode[] = []; doc.forEach(n => nodes.push(n));
    return (document?.prefix ?? "") + nodes.map((node, index) => {
      if (node.attrs.uploadId) return "";
      const source = this.sources.get(node.attrs.sourceId);
      const value = this.block(node);
      const gap = index === nodes.length - 1 ? (source?.gap ?? "") : (source?.gap || "\n\n");
      return value + gap;
    }).join("");
  }

  block(node: PMNode): string {
    const cached = this.blocks.get(node);
    if (cached !== undefined) return cached;
    const markdown = this.serializeBlock(node);
    this.blocks.set(node, markdown);
    return markdown;
  }

  private serializeBlock(node: PMNode): string {
    const source = this.sources.get(node.attrs.sourceId);
    if (source?.node.eq(node)) return source.raw;
    const children: PMNode[] = []; node.forEach(n => children.push(n));
    switch (node.type.name) {
      case "paragraph": return this.inline(node);
      case "heading": return "#".repeat(node.attrs.level) + " " + this.inline(node);
      case "blockquote": return ((node.attrs.calloutMarker ? node.attrs.calloutMarker + " " : "") + children.map(n => this.block(n)).join("\n\n")).split("\n").map(line => "> " + line).join("\n");
      case "footnote_definition": return `[^${node.attrs.identifier}]: ` + children.map(n => this.block(n)).join("\n\n").replace(/\n/g, "\n    ");
      case "bullet_list": case "ordered_list": return children.map((item, i) => {
        const parts: string[] = []; item.forEach(n => parts.push(this.block(n)));
        const marker = node.type.name === "ordered_list" ? `${node.attrs.order + i}. ` : "- ";
        const check = item.attrs.checked === null ? "" : item.attrs.checked ? "[x] " : "[ ] ";
        const lines = parts.join("\n\n").split("\n");
        return marker + check + lines[0] + lines.slice(1).map(line => "\n" + " ".repeat(marker.length) + line).join("");
      }).join("\n");
      case "code_block": {
        const fence = "`".repeat(Math.max(3, ...[...node.textContent.matchAll(/`+/g)].map(m => m[0].length + 1)));
        return `${fence}${node.attrs.language}${node.attrs.meta ? " " + node.attrs.meta : ""}\n${node.textContent}\n${fence}`;
      }
      case "horizontal_rule": return "---";
      case "table": return children.map((row, index) => {
        const cells: string[] = []; row.forEach(cell => cells.push(this.inline(cell.firstChild!).replace(/\|/g, "\\|").replace(/\n/g, "<br>")));
        return "| " + cells.join(" | ") + " |" + (index === 0 ? "\n| " + cells.map((_, i) => ({ left: ':---', right: '---:', center: ':---:' }[String(node.attrs.align?.[i])] ?? '---')).join(" | ") + " |" : "");
      }).join("\n");
      case "embed": return serializeEmbed(node.attrs as { raw: string });
      default: return node.textContent;
    }
  }

  private inline(node: PMNode): string {
    let output = "";
    node.forEach(n => {
      if (n.type.name === "inline_object") { output += n.attrs.raw; return; }
      if (n.type.name === "hard_break") { output += "  \n"; return; }
      let value = escape(n.text ?? "");
      for (const mark of [...n.marks].reverse()) {
        if (mark.type.name === "code") {
          const fence = "`".repeat(Math.max(1, ...[...(n.text ?? "").matchAll(/`+/g)].map(m => m[0].length + 1)));
          value = fence + (/^`|`$/.test(n.text ?? "") ? " " + n.text + " " : n.text) + fence;
        } else if (mark.type.name === "link") value = mark.attrs.reference ? `[${value}][${mark.attrs.reference}]` : mark.attrs.wiki ? `[[${mark.attrs.href}|${n.text}]]`
          : `[${value}](<${String(mark.attrs.href).replace(/>/g, "%3E")}>${mark.attrs.title ? ` "${String(mark.attrs.title).replace(/"/g, '\\"')}"` : ""})`;
        else { const delimiter = ({ strong: "**", em: "*", strike: "~~", highlight: "==" } as Record<string,string>)[mark.type.name]; if (delimiter) value = delimiter + value + delimiter; }
      }
      output += value;
    });
    return output;
  }
}
