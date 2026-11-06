import { parse, serialize } from "parse5";
import { withCanonicalQuartzReader } from "./quartz-canonical-reader-bridge.mjs";

/** Empty reader chrome for a saved note awaiting publication. The embedded
 * dashboard must authenticate and supply the document through its normal API. */
export function canonicalQuartzReaderShell(html, templatePath, slug) {
  const document = parse(html);
  const attr = (node, name) => node?.attrs?.find(attribute => attribute.name === name)?.value;
  const set = (node, name, value) => {
    const existing = node.attrs?.find(attribute => attribute.name === name);
    if (existing) existing.value = value;
    else (node.attrs ??= []).push({ name, value });
  };
  const hasClass = (node, name) => (attr(node, "class") ?? "").split(/\s+/).includes(name);
  const walk = (node, visit) => {
    visit(node);
    for (const child of node.childNodes ?? []) walk(child, visit);
    if (node.content) walk(node.content, visit);
  };
  let article, actions;
  walk(document, node => {
    if (node.tagName === "article" && hasClass(node, "popover-hint")) article = node;
    if (hasClass(node, "markdown-actions")) actions = node;
  });
  if (!article || !actions) return null;
  article.childNodes = [];
  article.attrs = [{ name: "class", value: "popover-hint" }];
  const base = new URL(templatePath, "http://quartz.local");
  const destination = "/" + slug.split("/").map(encodeURIComponent).join("/");
  const rebase = value => {
    if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) return value;
    const url = new URL(value, base);
    return `${url.pathname}${url.search}${url.hash}`;
  };
  walk(document, node => {
    if (node.tagName === "body") set(node, "data-slug", slug);
    if (attr(node, "data-note-slug") !== undefined) set(node, "data-note-slug", slug);
    if (node.tagName === "title" || hasClass(node, "article-title")) {
      node.childNodes = [{ nodeName: "#text", value: "Note", parentNode: node }];
    }
    if (["content-meta", "tags", "toc-content", "backlinks"].some(name => hasClass(node, name))) node.childNodes = [];
    if (node.tagName === "meta" && ["description", "og:title", "og:description", "og:image", "og:url", "twitter:title", "twitter:description", "twitter:image"].includes(attr(node, "name") ?? attr(node, "property"))) set(node, "content", "");
    for (const attribute of node.attrs ?? []) {
      if (attribute.name === "src" || attribute.name === "href") attribute.value = rebase(attribute.value);
    }
    if (node.tagName === "link" && attr(node, "rel") === "canonical") set(node, "href", destination);
    if (node.tagName === "a" && hasClass(node.parentNode, "breadcrumb-element") && !attr(node, "href")) {
      node.childNodes = [{ nodeName: "#text", value: "Note", parentNode: node }];
    }
    // Quartz's content index uses inline fetches rather than external scripts.
    if (node.tagName === "script" && !attr(node, "src")) {
      for (const child of node.childNodes ?? []) {
        if (child.nodeName === "#text") child.value = child.value.replace(/fetch\((['"])(\.\.?\/[^'"]+)\1\)/g,
          (_match, _quote, url) => `fetch(${JSON.stringify(rebase(url))})`);
      }
    }
  });
  return withCanonicalQuartzReader(serialize(document));
}
