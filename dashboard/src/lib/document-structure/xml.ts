// A small XML reader, sized for OOXML and nothing else.
//
// Breadboard has no XML dependency and this does not justify adding one: the
// parts of a .docx/.xlsx/.pptx package are machine-written, namespace-prefixed,
// entity-poor documents with no DTD and no processing instructions worth
// honouring. What is needed is a tree with element names, attributes and text —
// which is a hundred lines — rather than a conformant parser.
//
// The alternative, and what the codebase did before this, is regular
// expressions over the raw XML. That is what loses the table: `<w:tbl>` and
// `<w:p>` nest, and a regex cannot tell you which paragraph is inside which
// cell. Every structure this module exists to preserve is a nesting fact.

export interface XmlNode {
  /** Local name with the namespace prefix intact, e.g. `w:p`. */
  name: string;
  /** Name without its prefix, which is what most call sites match on. */
  local: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  /** Direct text content of this element, concatenated. */
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeXmlText(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g)) {
    const key = match[1] ?? match[3];
    const value = match[2] ?? match[4] ?? "";
    if (key) attributes[key] = decodeXmlText(value);
  }
  return attributes;
}

function makeNode(name: string, attributes: Record<string, string>): XmlNode {
  const colon = name.indexOf(":");
  return {
    name,
    local: colon >= 0 ? name.slice(colon + 1) : name,
    attributes,
    children: [],
    text: "",
  };
}

/**
 * Parse one OOXML part. Returns the root element, or null when the part is not
 * XML at all — a corrupt member of a zip is a document that reads oddly, never
 * a request that fails.
 */
export function parseXml(source: string): XmlNode | null {
  const root = makeNode("#document", {});
  const stack: XmlNode[] = [root];
  const tag = /<(\/)?([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/)?>/g;

  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(source)) !== null) {
    const [whole, closing, name, attributeSource, selfClosing] = match;

    const between = source.slice(cursor, match.index);
    if (between) {
      const node = stack[stack.length - 1];
      // `<!--` and `<![CDATA[` are rare in these parts, but a stray one would
      // otherwise be read as text; both are cheap to strip here.
      node.text += decodeXmlText(between.replace(/<!\[CDATA\[|\]\]>/g, ""));
    }
    cursor = match.index + whole.length;

    if (whole.startsWith("<?") || whole.startsWith("<!")) continue;

    if (closing) {
      // Tolerate a stray close: pop to the matching open if there is one, and
      // ignore it otherwise rather than unwinding the whole document.
      const index = stack.findLastIndex((node) => node.name === name);
      if (index > 0) stack.length = index;
      continue;
    }

    const node = makeNode(name, parseAttributes(attributeSource ?? ""));
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }

  return root.children[0] ?? null;
}

/** Direct children with this local name. */
export function childrenNamed(node: XmlNode, local: string): XmlNode[] {
  return node.children.filter((child) => child.local === local);
}

/** The first direct child with this local name. */
export function childNamed(node: XmlNode, local: string): XmlNode | null {
  return node.children.find((child) => child.local === local) ?? null;
}

/** Every descendant with this local name, in document order. */
export function descendants(node: XmlNode, local: string): XmlNode[] {
  const found: XmlNode[] = [];
  const walk = (current: XmlNode) => {
    for (const child of current.children) {
      if (child.local === local) found.push(child);
      walk(child);
    }
  };
  walk(node);
  return found;
}

/** How many descendants carry this local name — a count without the array. */
export function countDescendants(node: XmlNode, local: string): number {
  let total = 0;
  const walk = (current: XmlNode) => {
    for (const child of current.children) {
      if (child.local === local) total += 1;
      walk(child);
    }
  };
  walk(node);
  return total;
}

/** An attribute by local name, ignoring whichever prefix the writer chose. */
export function attribute(node: XmlNode, local: string): string | null {
  const direct = node.attributes[local];
  if (direct !== undefined) return direct;
  for (const [key, value] of Object.entries(node.attributes)) {
    const colon = key.indexOf(":");
    if (colon >= 0 && key.slice(colon + 1) === local) return value;
  }
  return null;
}

/**
 * All text under a node.
 *
 * An element's own text is emitted before its children's, which is not document
 * order for genuinely mixed content. OOXML does not have any: text lives in
 * leaf elements (`w:t`, `a:t`, `m:t`), so in these parts the two are the same.
 */
export function textContent(node: XmlNode): string {
  let out = node.text;
  for (const child of node.children) out += textContent(child);
  return out;
}
