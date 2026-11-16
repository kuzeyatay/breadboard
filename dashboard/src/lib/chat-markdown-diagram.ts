import type { Element, ElementContent, Properties } from 'hast';
import type { Root } from 'mdast';
import JSON5 from 'json5';
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import type { VFile } from 'vfile';

const maxSourceLength = 64_000;
const elements = new Set('svg g path rect line circle ellipse polygon polyline text tspan title desc'.split(' '));
const attributes = new Map<string, string>();
for (const name of (
  'viewBox preserveAspectRatio x y x1 y1 x2 y2 cx cy r rx ry width height d points dx dy ' +
  'fill stroke color opacity fillOpacity strokeOpacity strokeWidth strokeLinecap strokeLinejoin ' +
  'strokeDasharray fillRule transform fontSize fontFamily fontWeight textAnchor dominantBaseline aria-label'
).split(' ')) {
  // SVG replies use both JSX (strokeWidth) and XML (stroke-width) spellings.
  attributes.set(name.replaceAll('-', '').toLowerCase(), name);
}
const paint = /^(?:#[\da-f]{3,8}|[a-z]+|(?:rgb|hsl)a?\([\d.,%\s/+-]+\))$/i;
const field = /^\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)(?:\s*([+-])\s*(\d+(?:\.\d+)?))?\s*$/;
type Row = Record<string, unknown>;
type Binding = { name: string; row: Row };

function fieldValue(expression: string, binding: Binding): string {
  const match = field.exec(expression);
  if (!match || match[1] !== binding.name || !Object.hasOwn(binding.row, match[2])) {
    throw new Error('Unknown diagram field');
  }
  const item = binding.row[match[2]];
  if (typeof item === 'string' && !match[3]) return item;
  if (typeof item !== 'number') throw new Error('Expected a numeric diagram field');
  const offset = Number(match[4] ?? 0);
  const result = match[3] === '-' ? item - offset : item + offset;
  if (!Number.isFinite(result)) throw new Error('Invalid diagram coordinate');
  return String(result);
}

/** Build static SVG nodes. Reply text and record values never become executable markup. */
function diagram(source: string): Element | null {
  const loops: { name: string; rows: Row[] }[] = [];
  if (/bb-diagram-each/i.test(source)) return null;
  const markup = source.replace(
    /\{#each\s+(\[[^\[\]]*\])\s+as\s+([A-Za-z_]\w*)\s*\}([\s\S]*?)\{\/each\}/g,
    (_, literal: string, name: string, body: string) => {
      const rows: unknown = JSON5.parse(literal);
      if (!Array.isArray(rows) || rows.length > 128 ||
          !rows.every(row => row && typeof row === 'object' && !Array.isArray(row))) {
        throw new Error('Expected a bounded array of diagram records');
      }
      const index = loops.push({ name, rows }) - 1;
      return '<bb-diagram-each index="' + index + '">' + body + '</bb-diagram-each>';
    },
  );
  if (markup.includes('{#each') || markup.includes('{/each}')) return null;
  // HTML's unquoted attributes would otherwise consume whitespace or the slash in "/>".
  const quoted = markup.replace(/<[a-z][^<>]*>/gi, tag =>
    tag.replace(/"[^"]*"|'[^']*'|=(\{[\w.\s+-]+\})/g, (attribute, expr) => expr ? '="' + expr + '"' : attribute));
  const significant = (nodes: DefaultTreeAdapterTypes.ChildNode[]) =>
    nodes.filter(node => !('value' in node && !node.value.trim()) && node.nodeName !== '#comment');
  let roots = significant(parseFragment(quoted).childNodes);
  const wrapper = roots[0];
  if (roots.length === 1 && 'tagName' in wrapper && wrapper.tagName === 'box') {
    roots = significant(wrapper.childNodes);
  }
  const root = roots[0];
  if (roots.length !== 1 || !('tagName' in root) || root.tagName !== 'svg') return null;

  let remainingNodes = 4096;
  let remainingChars = 256_000;
  const labels: string[] = [];
  function bounded(value: string) {
    remainingChars -= value.length;
    if (remainingChars < 0) throw new Error('Diagram expansion too large');
    return value;
  }
  function valueOf(raw: string, binding?: Binding) {
    bounded(raw);
    return binding ? raw.replace(/\{([^{}]*)\}/g, (_, expr: string) => bounded(fieldValue(expr, binding))) : raw;
  }
  function render(node: DefaultTreeAdapterTypes.ChildNode, depth: number, binding?: Binding): ElementContent[] {
    if (--remainingNodes < 0 || depth > 40) throw new Error('Diagram too complex');
    if ('value' in node) {
      const value = valueOf(node.value, binding);
      if (value.trim()) labels.push(value.trim());
      return [{ type: 'text', value }];
    }
    if (!('tagName' in node)) return [];
    if (node.tagName === 'bb-diagram-each') {
      const loop = loops[Number(node.attrs[0]?.value)];
      if (!loop || binding) throw new Error('Invalid diagram loop');
      return loop.rows.flatMap(row =>
        node.childNodes.flatMap(child => render(child, depth + 1, { name: loop.name, row })));
    }
    if (!elements.has(node.tagName)) throw new Error('Unsupported SVG element');
    const properties: Properties = {};
    for (const attr of node.attrs) {
      const name = attributes.get(attr.name.replaceAll('-', '').toLowerCase());
      if (!name || attr.namespace) continue;
      const value = valueOf(attr.value, binding);
      if (/[{}]/.test(value)) throw new Error('Unsupported SVG attribute expression');
      if (['fill', 'stroke', 'color'].includes(name) && !paint.test(value)) {
        throw new Error('Unsupported SVG paint');
      }
      properties[name] = value;
    }
    return [{ type: 'element', tagName: node.tagName, properties,
      children: node.childNodes.flatMap(child => render(child, depth + 1, binding)) }];
  }
  const svg = render(root, 0)[0] as Element;
  if (!svg.properties.viewBox && Number(svg.properties.width) > 0 && Number(svg.properties.height) > 0) {
    svg.properties.viewBox = '0 0 ' + svg.properties.width + ' ' + svg.properties.height;
  }
  svg.properties.role = 'img';
  svg.properties['aria-label'] ||= labels.join(' · ') || 'Diagram';
  return svg;
}

/** Only standalone raw SVG (optionally inside a model's <box>) is a diagram.
 * Markdown's own parser identifies code examples and their boundaries first. */
export function remarkChatDiagrams() {
  return (tree: Root, file: VFile) => {
    const source = String(file);
    if (!/<svg[\s>]/i.test(source)) return;
    const nodes = tree.children;
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      const first = node.type === 'paragraph' ? node.children[0] : node;
      if (first?.type !== 'html') continue;
      const tag = /^<(svg|box)(?=[\s>])/i.exec(first.value)?.[1];
      const start = node.position?.start.offset;
      if (!tag || start === undefined) continue;
      const candidate = source.slice(start, start + maxSourceLength);
      const endTag = new RegExp('</' + tag + '\\s*>', 'i').exec(candidate);
      if (!endTag) continue;
      const length = endTag.index + endTag[0].length;
      let last = index;
      while (last < nodes.length - 1 && (nodes[last].position?.end.offset ?? Infinity) < start + length) last++;
      const end = nodes[last].position?.end.offset;
      if (end === undefined || end < start + length || source.slice(start + length, end).trim()) continue;
      try {
        const svg = diagram(candidate.slice(0, length));
        if (svg) nodes.splice(index, last - index + 1, {
          type: 'paragraph', children: [], data: { hName: 'figure',
            hProperties: { 'data-chat-diagram': '', 'data-selection-exclude': '' }, hChildren: [svg] },
        });
      } catch {
        // Unsupported or unfinished templates retain the normal Markdown fallback.
      }
    }
  };
}
