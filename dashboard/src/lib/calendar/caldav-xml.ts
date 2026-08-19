// A very small XML reader for WebDAV `multistatus` documents.
//
// CalDAV replies are XML, and the dashboard has no XML dependency — adding one
// to read four element names would be a poor trade. What is actually needed is
// narrow: elements, attributes, text, CDATA, and the ability to ignore
// namespace prefixes entirely (servers disagree about whether the CalDAV
// namespace is `C:`, `cal:` or the default one, and none of that disagreement
// is meaningful to us).
//
// So: local names, lowercased, prefixes discarded. Anything this parser cannot
// make sense of becomes an absent node, and every caller already has to handle
// a property being missing, because a CalDAV server is free to omit it.

/** One element. `text` is this element's own character data, entities decoded. */
export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

/** Deep enough for any real multistatus; a guard against a hostile document. */
const MAX_DEPTH = 40;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** `C:calendar-data` → `calendar-data`. Case and prefix carry no meaning here. */
function localName(raw: string): string {
  const withoutPrefix = raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw;
  return withoutPrefix.toLowerCase();
}

function readAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    attrs[localName(match[1])] = decodeEntities(match[3] ?? match[4] ?? "");
  }
  return attrs;
}

/** The index just past the tag opening at `start`, quotes respected. */
function endOfTag(source: string, start: number): number {
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === ">") return index;
  }
  return -1;
}

/**
 * Parse a document into its root element, or null if there isn't one.
 *
 * Mismatched closing tags are tolerated by unwinding to the nearest open
 * element of that name and ignoring the tag otherwise: a stray `</D:href>` in
 * one property should not cost us the other forty responses in the document.
 */
export function parseXml(source: string): XmlNode | null {
  const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let index = 0;

  const current = () => stack[stack.length - 1];

  while (index < source.length) {
    const open = source.indexOf("<", index);
    if (open === -1) {
      current().text += decodeEntities(source.slice(index));
      break;
    }
    if (open > index) current().text += decodeEntities(source.slice(index, open));

    if (source.startsWith("<!--", open)) {
      const close = source.indexOf("-->", open);
      index = close === -1 ? source.length : close + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", open)) {
      const close = source.indexOf("]]>", open);
      const end = close === -1 ? source.length : close;
      // CDATA is literal by definition: no entity decoding on the way out.
      current().text += source.slice(open + 9, end);
      index = close === -1 ? source.length : close + 3;
      continue;
    }
    if (source.startsWith("<?", open) || source.startsWith("<!", open)) {
      const close = source.indexOf(">", open);
      index = close === -1 ? source.length : close + 1;
      continue;
    }

    const close = endOfTag(source, open + 1);
    if (close === -1) break;
    const raw = source.slice(open + 1, close).trim();
    index = close + 1;
    if (!raw) continue;

    if (raw.startsWith("/")) {
      const name = localName(raw.slice(1).trim());
      for (let depth = stack.length - 1; depth > 0; depth -= 1) {
        if (stack[depth].name === name) {
          stack.length = depth;
          break;
        }
      }
      continue;
    }

    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameEnd = body.search(/[\s/]/);
    const name = localName(nameEnd === -1 ? body : body.slice(0, nameEnd));
    if (!name) continue;

    const node: XmlNode = {
      name,
      attrs: nameEnd === -1 ? {} : readAttrs(body.slice(nameEnd)),
      children: [],
      text: "",
    };
    current().children.push(node);
    if (!selfClosing && stack.length < MAX_DEPTH) stack.push(node);
  }

  return root.children[0] ?? null;
}

/** The first direct child with this local name. */
export function child(node: XmlNode | null, name: string): XmlNode | null {
  if (!node) return null;
  return node.children.find((candidate) => candidate.name === name) ?? null;
}

/** Every element with this local name at any depth, the node itself included. */
export function descendants(node: XmlNode | null, name: string): XmlNode[] {
  if (!node) return [];
  const found: XmlNode[] = [];
  const walk = (current: XmlNode) => {
    if (current.name === name) found.push(current);
    for (const next of current.children) walk(next);
  };
  walk(node);
  return found;
}

/**
 * All character data under a node, trimmed.
 *
 * Servers wrap property values inconsistently — `<displayname>Work</displayname>`
 * but sometimes with whitespace or a nested element — so text is collected from
 * the whole subtree rather than the element's own run.
 */
export function textOf(node: XmlNode | null): string {
  if (!node) return "";
  let text = node.text;
  for (const next of node.children) text += textOf(next);
  return text.trim();
}

export function childText(node: XmlNode | null, name: string): string {
  return textOf(child(node, name));
}

export interface DavResponse {
  href: string;
  /** Properties that came back with a 2xx status, by local name. */
  props: Map<string, XmlNode>;
  /** The `status` line of the response itself, when it carried one. */
  status: string;
}

/**
 * Flatten a `multistatus` into one entry per `response`.
 *
 * Properties that came back 404 (the server does not implement that property)
 * are dropped rather than reported: to every caller here, "absent" and "the
 * server said it has no such property" mean the same thing.
 */
export function parseMultistatus(source: string): DavResponse[] {
  const root = parseXml(source);
  if (!root) return [];

  return descendants(root, "response").map((response) => {
    const props = new Map<string, XmlNode>();

    for (const propstat of descendants(response, "propstat")) {
      const status = childText(propstat, "status");
      if (status && !/\s2\d\d\s/.test(` ${status} `)) continue;
      for (const prop of descendants(propstat, "prop")) {
        for (const node of prop.children) {
          if (!props.has(node.name)) props.set(node.name, node);
        }
      }
    }

    return {
      href: childText(response, "href"),
      props,
      status: childText(response, "status"),
    };
  });
}
