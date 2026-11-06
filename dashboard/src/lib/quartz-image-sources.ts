/** Load saved Garden images through the authenticated app, before publication. */
export function quartzImageSources(html: string, slug: string, quartzOrigin: string, dashboardOrigin: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  const base = new URL(`/${slug.replace(/^\/+/, '')}`, quartzOrigin);
  const rewrite = (root: DocumentFragment) => {
    for (const image of root.querySelectorAll<HTMLImageElement>('img[src]')) {
      try {
        const source = new URL(image.getAttribute('src')!, base);
        if (source.origin !== base.origin || !/^\/[^/]+\/assets\/.+\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(source.pathname)) continue;
        image.setAttribute('src', new URL(source.pathname + source.search + source.hash, dashboardOrigin).href);
      } catch { /* Leave non-URL image sources unchanged. */ }
    }
    // Long documents keep later sections in templates until they are visible.
    for (const deferred of root.querySelectorAll<HTMLTemplateElement>('template')) rewrite(deferred.content);
  };
  rewrite(template.content);
  return template.innerHTML;
}
