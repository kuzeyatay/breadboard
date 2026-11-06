import { fromMarkdown } from "mdast-util-from-markdown";
import type { Root, RootContent } from "mdast";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

export interface SourceImageReference {
  imagePath: string;
  caption: string;
  context: string;
  pageNumber?: number;
  timestamp?: string;
}

interface Section {
  heading: string;
  start: number;
  end: number;
  text: string;
  pageNumber?: number;
  timestamp?: string;
}

function words(node: Root | RootContent): string {
  if (node.type === "code" || node.type === "image" || node.type === "imageReference" || node.type === "html") return "";
  if ("value" in node) return node.value;
  return "children" in node ? node.children.map(words).join(" ") : "";
}

export function compactVisualText(value: string, limit = 2400): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function genericVisualCaption(caption: string): boolean {
  return !caption.trim() || /^(?:(?:source|embedded)?\s*(?:image|figure|diagram|graph|table)(?:\s*\d+)?|fig\.?\s*\d+|page \d+(?: (?:figure \d+|snapshot))?|frame at .*)$/i.test(caption.trim());
}

function isTrackingPixel(imagePath: string): boolean {
  try {
    const url = new URL(imagePath);
    return url.hostname === "pixel.wp.com" && url.pathname === "/g.gif";
  } catch { return false; }
}

/** Keep OCR/transcript context inside its own page/section, never the whole book. */
export function sourceImageReferences(content: string, sourceImages: readonly string[] = []) {
  const tree = fromMarkdown(content);
  const definitions = new Map<string, string>();
  const sections: Section[] = [];
  let current: Section = { heading: "", start: 0, end: content.length, text: "" };
  let pageNumber: number | undefined;
  let timestamp: string | undefined;
  const headings: string[] = [];
  for (const block of tree.children) {
    if (block.type === "definition") definitions.set(block.identifier, block.url);
    if (block.type === "heading") {
      current.end = block.position?.start.offset ?? content.length;
      sections.push(current);
      const heading = words(block);
      const page = /^(?:page|frame)\s+(\d+)\b/i.exec(heading.trim());
      if (page) {
        pageNumber = Number(page[1]);
        timestamp = /\b\d{1,2}:\d{2}(?::\d{2})?\b/.exec(heading)?.[0];
      } else if (block.depth <= 2) {
        pageNumber = undefined;
        timestamp = undefined;
      }
      headings.length = block.depth - 1;
      headings[block.depth - 1] = heading;
      current = { heading: headings.filter(Boolean).join(" / "), start: block.position?.start.offset ?? 0,
        end: content.length, text: "", pageNumber, timestamp };
    } else if (block.type !== "definition") {
      current.text += `${words(block)}\n`;
    }
  }
  sections.push(current);
  const images: SourceImageReference[] = [];
  const add = (imagePath: string, caption: string, offset: number, extra = "") => {
    if (isTrackingPixel(imagePath)) return;
    const section = sections.find(item => offset >= item.start && offset < item.end) ?? sections.at(-1)!;
    // A short section is useful in full; long OCR pages use the image's local text.
    const local = section.text.length <= 2400 ? section.text
      : words(fromMarkdown(content.slice(Math.max(section.start, offset - 1000), Math.min(section.end, offset + 1400))));
    const pathPage = /-page-(\d+)(?:[-.]|$)/i.exec(imagePath)?.[1];
    images.push({ imagePath, caption: caption || "Source image",
      context: compactVisualText(`${section.heading}\n${extra}\n${local}`),
      pageNumber: pathPage ? Number(pathPage) : section.pageNumber,
      timestamp: section.timestamp });
  };
  const htmlImages = (html: string, offset: number) => {
    type HtmlNode = DefaultTreeAdapterMap["node"];
    const htmlText = (node: HtmlNode): string => "value" in node ? node.value
      : "childNodes" in node ? node.childNodes.map(htmlText).join(" ") : "";
    const walk = (node: HtmlNode, caption = "") => {
      if ("tagName" in node && ["script", "style", "pre", "code"].includes(node.tagName)) return;
      if ("tagName" in node && node.tagName === "figure") caption = htmlText(node);
      if ("tagName" in node && node.tagName === "img") {
        const attr = (name: string) => node.attrs.find(item => item.name === name)?.value ?? "";
        if (attr("src")) add(attr("src"), attr("alt"), offset, caption);
      }
      if ("childNodes" in node) for (const child of node.childNodes) walk(child, caption);
    };
    walk(parseFragment(html));
  };
  const walk = (node: Root | RootContent) => {
    if (node.type === "code" || node.type === "inlineCode") return;
    const offset = node.position?.start.offset ?? 0;
    if (node.type === "image" || node.type === "imageReference") {
      const url = node.type === "image" ? node.url : definitions.get(node.identifier);
      if (url) add(url, node.alt ?? "", offset);
    } else if (node.type === "html") htmlImages(node.value, offset);
    if ("children" in node) for (const child of node.children) walk(child);
  };
  walk(tree);
  for (const imagePath of sourceImages) {
    if (isTrackingPixel(imagePath)) continue;
    if (images.some(image => image.imagePath === imagePath)) continue;
    const page = /-page-(\d+)(?:[-.]|$)/i.exec(imagePath)?.[1];
    const matching = page ? sections.filter(section => section.pageNumber === Number(page)) : [];
    images.push({ imagePath, caption: page ? `Page ${Number(page)} snapshot` : "Source image",
      pageNumber: page ? Number(page) : undefined, timestamp: matching[0]?.timestamp,
      context: compactVisualText(matching.map(section => `${section.heading}\n${section.text}`).join("\n")) });
  }
  return { images, pageContext: (page: number) => compactVisualText(sections
    .filter(section => section.pageNumber === page).map(section => `${section.heading}\n${section.text}`).join("\n")) };
}

export function visualSearchTerms(query: string): string[] {
  const stop = new Set(["a", "an", "the", "of", "for", "to", "in", "on", "and", "me", "my", "show", "find", "what", "does", "do", "is", "look", "looks", "like", "image", "images", "picture", "pictures", "please"]);
  return [...new Set(query.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .split(/[^\p{L}\p{N}]+/u).filter(term => term && !stop.has(term)))];
}

export function normalizeVisualSearchText(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
}
