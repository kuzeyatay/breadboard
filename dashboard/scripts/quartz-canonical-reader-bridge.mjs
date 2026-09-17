/** Installed before Quartz's scripts, including on previously published pages.
 * The static service serializes this self-contained function into the page. */
export function installCanonicalQuartzReader() {
  if (window.parent === window || window.__canonicalQuartzReader) return;
  window.__canonicalQuartzReader = true;
  // Own the existing addCleanup contract before the SPA assigns it. Both a
  // real navigation and an in-place article update dispose the same listeners,
  // so rehydrating math/visuals cannot duplicate toolbar or selection handlers.
  const cleanups = new Set();
  const cleanup = () => { for (const fn of cleanups) fn(); cleanups.clear(); };
  Object.defineProperty(window, "addCleanup", {
    configurable: true,
    get: () => fn => cleanups.add(fn),
    set: () => {},
  });
  document.addEventListener("prenav", cleanup);
  const canonicalHtml = new WeakMap();
  window.addEventListener("message", event => {
    if (event.source !== window.parent) return;
    let parentOrigin;
    // In-frame navigation changes the referrer to a Quartz URL. Chromium's
    // embedding origin continues to identify the dashboard after reloads.
    try { parentOrigin = new URL(window.location.ancestorOrigins?.[0] || document.referrer).origin; } catch { return; }
    if (event.origin !== parentOrigin) return;
    const data = event.data;
    if (data?.type !== "second-brain:canonical-document" || typeof data.html !== "string") return;
    const currentSlug = document.querySelector(".markdown-actions")?.dataset.noteSlug;
    if (!currentSlug || currentSlug !== data.slug) return;
    const article = document.querySelector("article.popover-hint");
    if (!article) return;
    const acknowledge = () => window.parent.postMessage({ type: "second-brain:canonical-document-rendered", slug: currentSlug, requestId: data.requestId }, parentOrigin);
    if (canonicalHtml.get(article) === data.html) { acknowledge(); return; }
    cleanup();
    const next = document.createElement("template");
    next.innerHTML = data.html;
    article.replaceChildren(next.content);
    canonicalHtml.set(article, data.html);
    if (typeof data.title === "string") {
      const title = document.querySelector("h1.article-title");
      if (title) title.textContent = data.title;
    }
    if (Array.isArray(data.toc)) {
      document.querySelectorAll(".toc .toc-content").forEach(list => {
        list.replaceChildren(...data.toc.map(entry => {
          const item = document.createElement("li"), link = document.createElement("a");
          item.className = `depth-${entry.depth}`;
          link.href = `#${entry.slug}`; link.dataset.for = entry.slug; link.textContent = entry.text;
          item.append(link);
          return item;
        }));
      });
    }
    document.dispatchEvent(new CustomEvent("nav", { detail: { url: currentSlug } }));
    acknowledge();
  });
}

export function withCanonicalQuartzReader(html) {
  if (!html.includes("markdown-actions")) return html;
  const script = `<script data-persist="canonical-reader">(${installCanonicalQuartzReader.toString()})();</script>`;
  // Run before the deferred Quartz bundle on both new and old publications.
  return /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/i, head => head + script)
    : script + html;
}
