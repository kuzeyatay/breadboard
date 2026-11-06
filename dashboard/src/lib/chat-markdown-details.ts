import type { Root, RootContent } from 'mdast';
import type { Processor } from 'unified';

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
  boundary?: { tag: 'details' | 'summary'; closing: boolean; open: boolean };
}

/** Recognize disclosure markup without enabling arbitrary HTML in chat. */
export function remarkChatDetails(this: Processor) {
  const parse = (value: string) => (this.parse(value) as Root).children as MarkdownNode[];

  function expand(nodes: MarkdownNode[], inline = false): MarkdownNode[] {
    return nodes.flatMap((node): MarkdownNode[] => {
      if (node.type === 'html' && node.value) {
        const match = /^\s*(<\/?(details|summary)\b(?:"[^"]*"|'[^']*'|[^'">])*>)\s*/i.exec(node.value);
        if (!match) return [node];
        const raw = match[1];
        const boundary: MarkdownNode = { type: 'chatDisclosureBoundary', value: raw,
          boundary: { tag: match[2].toLowerCase() as 'details' | 'summary', closing: /^<\//.test(raw),
            // Ignore all supplied HTML attributes except a standalone open.
            open: /^<details\s+open(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?\s*>$/i.test(raw) } };
        const rest = node.value.slice(match[0].length);
        const parsed = rest ? parse(rest) : [];
        const children = inline ? parsed.flatMap(child => child.type === 'paragraph' ? child.children ?? [] : [child]) : parsed;
        return [boundary, ...expand(children, inline)];
      }
      if (!node.children) return [node]; // Code and math remain literal/opaque.
      const children = expand(node.children, node.type === 'paragraph');
      if (node.type === 'paragraph' && children.some(child => child.boundary)) {
        const result: MarkdownNode[] = [];
        let pending: MarkdownNode[] = [];
        const flush = () => {
          if (pending.some(child => child.type !== 'text' || child.value?.trim())) {
            result.push({ ...node, children: pending });
          }
          pending = [];
        };
        for (const child of children) {
          if (child.boundary) { flush(); result.push(child); }
          else pending.push(child);
        }
        flush();
        return result;
      }
      return [{ ...node, children: group(children) }];
    });
  }

  function group(nodes: MarkdownNode[]): MarkdownNode[] {
    const result: MarkdownNode[] = [];
    const stack: Array<{ tag: 'details' | 'summary'; node: MarkdownNode }> = [];
    const append = (node: MarkdownNode) => {
      const current = stack.at(-1);
      const destination = current?.node.children ?? result;
      // A summary is a native button-like label and accepts phrasing content.
      destination.push(...(current?.tag === 'summary' && node.type === 'paragraph' ? node.children ?? [] : [node]));
    };
    for (const node of nodes) {
      const boundary = node.boundary;
      if (!boundary) { append(node); continue; }
      if (boundary.closing) {
        if (stack.at(-1)?.tag === boundary.tag) stack.pop();
        else append({ type: 'html', value: node.value });
      } else if (boundary.tag === 'details' || stack.at(-1)?.tag === 'details') {
        const disclosure: MarkdownNode = { type: 'chatDisclosure', children: [],
          data: { hName: boundary.tag, ...(boundary.tag === 'details' && boundary.open ? { hProperties: { open: true } } : {}) } };
        append(disclosure);
        stack.push({ tag: boundary.tag, node: disclosure });
      } else append({ type: 'html', value: node.value });
    }
    // An unfinished streamed block remains usable while its closing tag arrives.
    return result;
  }

  return (tree: Root) => {
    tree.children = group(expand(tree.children as MarkdownNode[])) as RootContent[];
  };
}
