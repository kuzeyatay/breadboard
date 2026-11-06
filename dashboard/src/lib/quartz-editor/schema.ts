import { Schema, type NodeSpec } from "@tiptap/pm/model";
import { tableNodes } from "@tiptap/pm/tables";

const source = { sourceId: { default: null } };
const block = (spec: NodeSpec): NodeSpec => ({ ...spec, attrs: { ...source, ...spec.attrs } });
export const editorSchema = new Schema({
  nodes: {
    doc: { content: "block+", attrs: { sourceContext: { default: null } } },
    paragraph: block({ group: "block", content: "inline*", parseDOM: [{ tag: "p" }], toDOM: () => ["p", 0] }),
    text: { group: "inline" },
    heading: block({ group: "block", content: "inline*", defining: true, attrs: { level: { default: 1 } },
      parseDOM: [1,2,3,4,5,6].map(level => ({ tag: `h${level}`, attrs: { level } })), toDOM: n => [`h${n.attrs.level}`, 0] }),
    blockquote: block({ group: "block", content: "block+", defining: true,
      attrs: { callout: { default: "" }, calloutMarker: { default: "" } }, parseDOM: [{ tag: "blockquote" }],
      toDOM: n => ["blockquote", n.attrs.callout ? { class: "callout", "data-callout": n.attrs.callout } : {}, 0] }),
    footnote_definition: block({ group: "block", content: "block+", defining: true, attrs: { identifier: { default: "" } },
      toDOM: n => ["div", { class: "bb-footnote", id: `fn-${n.attrs.identifier}` }, ["span", { contenteditable: "false", "data-no-highlight": "true" }, `[${n.attrs.identifier}] `], ["div", 0]] }),
    bullet_list: block({ group: "block", content: "list_item+", parseDOM: [{ tag: "ul" }], toDOM: () => ["ul", 0] }),
    ordered_list: block({ group: "block", content: "list_item+", attrs: { order: { default: 1 } },
      parseDOM: [{ tag: "ol", getAttrs: el => ({ order: Number(el.getAttribute("start")) || 1 }) }], toDOM: n => ["ol", { start: n.attrs.order }, 0] }),
    list_item: block({ content: "paragraph block*", defining: true, attrs: { checked: { default: null } },
      parseDOM: [{ tag: "li" }], toDOM: n => ["li", n.attrs.checked === null ? {} : { "data-checked": String(n.attrs.checked), class: "bb-task-item" }, 0] }),
    code_block: block({ group: "block", content: "text*", marks: "", code: true, defining: true,
      attrs: { language: { default: "" }, meta: { default: "" } }, parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
      toDOM: n => ["pre", ["code", { "data-language": n.attrs.language }, 0]] }),
    horizontal_rule: block({ group: "block", parseDOM: [{ tag: "hr" }], toDOM: () => ["hr"] }),
    hard_break: { inline: true, group: "inline", selectable: false, parseDOM: [{ tag: "br" }], toDOM: () => ["br"] },
    ...Object.fromEntries(Object.entries(tableNodes({ tableGroup: "block", cellContent: "paragraph", cellAttributes: {} }))
      .map(([key, spec]) => [key, block(key === 'table' ? { ...spec, attrs: { ...spec.attrs, align: { default: [] } } } : spec)])),
    embed: block({ group: "block", atom: true, isolating: true, draggable: false,
      attrs: { raw: { default: "" }, preview: { default: null }, image: { default: null }, localImageId: { default: null }, kind: { default: "source" }, uploadId: { default: null } },
      toDOM: n => ["div", { class: "bb-document-object", "data-no-highlight": "true" }, n.attrs.raw] }),
    inline_object: { inline: true, group: "inline", atom: true,
      attrs: { raw: {}, preview: { default: null }, image: { default: null }, localImageId: { default: null }, kind: { default: "source" }, label: { default: "" } },
      parseDOM: [{ tag: "img", getAttrs: el => ({ raw: el.outerHTML, kind: "image", label: el.getAttribute("alt") ?? "" }) }],
      toDOM: n => ["span", { class: "bb-inline-object", "data-no-highlight": "true", contenteditable: "false" }, n.attrs.label || n.attrs.raw] },
  },
  marks: {
    strong: { parseDOM: [{ tag: "strong" }, { tag: "b" }, { style: "font-weight=bold" }], toDOM: () => ["strong", 0] },
    em: { parseDOM: [{ tag: "em" }, { tag: "i" }, { style: "font-style=italic" }], toDOM: () => ["em", 0] },
    strike: { parseDOM: [{ tag: "s" }, { tag: "del" }], toDOM: () => ["del", 0] },
    code: { code: true, excludes: "_", parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] },
    highlight: { parseDOM: [{ tag: "mark:not(.bb-hl)" }], toDOM: () => ["mark", 0] },
    link: { inclusive: false, attrs: { href: {}, title: { default: null }, wiki: { default: false }, reference: { default: null } },
      parseDOM: [{ tag: "a[href]", getAttrs: el => ({ href: el.getAttribute("href"), title: el.getAttribute("title") }) }],
      toDOM: n => ["a", { href: safeHref(n.attrs.href), title: n.attrs.title }, 0] },
  },
});
export function safeHref(value: string) { return /^(?:javascript|vbscript|data):/i.test(value.trim()) ? "#" : value; }
