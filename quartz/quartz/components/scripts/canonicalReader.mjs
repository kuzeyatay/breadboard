/** Runs in the head, before published article text can paint. Self-contained for fixtures. */
export function installCanonicalQuartzReader() {
  if (window.parent === window) return;
  let parentOrigin;
  try { parentOrigin = new URL(window.location.ancestorOrigins?.[0] || document.referrer).origin; } catch { return; }
  // The frame's first navigation event can precede the host's React effect.
  // Re-announce on request and on every later SPA navigation, including pages
  // restored from an older publication whose router only announces once.
  if (!window.__canonicalQuartzNavigationBridge) {
    window.__canonicalQuartzNavigationBridge = true;
    const announce = () => {
      const slug = document.body?.dataset.slug;
      if (slug) window.parent.postMessage({ type: 'second-brain:navigate', snapshot: true, slug,
        title: document.title, path: window.location.pathname }, parentOrigin);
    };
    window.addEventListener('message', event => {
      if (event.source === window.parent && event.origin === parentOrigin &&
          event.data?.type === 'second-brain:request-navigation') announce();
    });
    document.addEventListener('nav', announce);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', announce, { once: true });
    else announce();
  }
  if (window.__canonicalQuartzReaderMetadata) return;
  window.__canonicalQuartzReader = true;
  // Retain the v2 sentinel so its script in older publications cannot install
  // another bridge over this one. The extra flag identifies this implementation.
  window.__canonicalQuartzReaderVersion = 2;
  window.__canonicalQuartzReaderMetadata = true;
  const cleanups = new Set();
  const cleanup = () => { for (const fn of cleanups) fn(); cleanups.clear(); };
  Object.defineProperty(window, 'addCleanup', { configurable: true, get: () => fn => cleanups.add(fn), set: () => {} });
  document.addEventListener('prenav', cleanup);
  const canonicalHtml = new WeakMap(), pending = new Map();
  const sessionId = crypto.randomUUID();
  const folderSlug = doc => {
    const slug = doc.body?.dataset.slug;
    return slug?.endsWith('/index') && slug.split('/').length > 2 && !slug.startsWith('tags/') ? slug : undefined;
  };
  const pageSlug = doc => doc.querySelector('.markdown-actions')?.dataset.noteSlug || folderSlug(doc);
  const pageBody = doc => doc.querySelector('article.popover-hint') || doc.querySelector('.page-listing')?.parentElement;

  const metadata = (doc, data) => {
    const previous = doc.querySelector('.content-meta');
    if (typeof data.contentMetaHtml === 'string' && previous?.dataset.readingTime !== 'false') {
      const template = doc.createElement('template');
      template.innerHTML = data.contentMetaHtml;
      const next = template.content.querySelector('.content-meta');
      if (next) {
        // Files without frontmatter dates retain their published filesystem date.
        const previousDate = previous?.querySelector('time');
        if (previousDate && !next.querySelector('time')) next.prepend(previousDate.cloneNode(true));
        next.dataset.canonicalSlug = data.slug;
        if (previous) previous.replaceWith(next);
        else doc.querySelector('h1.article-title')?.after(next);
      }
    }
    if (typeof data.title !== 'string') return;
    doc.title = data.title;
    const title = doc.querySelector('h1.article-title');
    // The editor owns its heading, including selection and newer unsaved input.
    if (title && doc.querySelector('article')?.dataset.documentEditor !== 'true') title.textContent = data.title;
    const crumb = doc.querySelector('.breadcrumb-element:last-child a[href=""]');
    if (crumb) crumb.textContent = data.title;
    doc.querySelectorAll(`.explorer a[data-for="${CSS.escape(data.slug)}"]`).forEach(link => { link.textContent = data.title; });
  };
  document.addEventListener('bb:document-title', event => {
    const data = event.detail;
    if (data?.slug === document.querySelector('.markdown-actions')?.dataset.noteSlug) metadata(document, data);
  });
  const populate = (doc, data) => {
    metadata(doc, data);
    const article = pageBody(doc);
    const next = doc.createElement('template');
    next.innerHTML = data.html;
    if (data.kind === 'folder') {
      doc.body.dataset.slug = data.slug;
      if (typeof data.breadcrumbsHtml === 'string') {
        doc.querySelectorAll('.breadcrumb-container').forEach(element => element.remove());
        const breadcrumbs = doc.createElement('template');
        breadcrumbs.innerHTML = data.breadcrumbsHtml;
        doc.querySelector('h1.article-title')?.before(breadcrumbs.content);
      }
      doc.querySelector('.markdown-actions')?.remove();
      doc.querySelectorAll('.folder-pdf-export, .graph, .toc, .backlinks').forEach(element => element.remove());
      const actions = doc.createElement('template');
      actions.innerHTML = data.folderActionsHtml || '';
      article.before(actions.content);
      article.replaceWith(next.content);
      doc.querySelectorAll('.toc-content, .backlinks').forEach(element => element.replaceChildren());
      // Both graph sizes consume this shared index. Replace only this folder's
      // snapshot, retaining known links for notes already in the publication.
      if (typeof fetchData !== 'undefined' && data.index) void fetchData.then(index => {
        const prefix = data.slug.slice(0, -'index'.length);
        const entries = Object.fromEntries(Object.entries(data.index).map(([slug, entry]) =>
          [slug, { ...index[slug], ...entry, links: index[slug]?.links ?? entry.links }]));
        for (const slug of Object.keys(index)) if (slug.startsWith(prefix)) delete index[slug];
        Object.assign(index, entries);
      });
      return;
    }
    article.replaceChildren(next.content);
    canonicalHtml.set(article, data.html);
    if (data.revision) article.dataset.canonicalRevision = data.revision;
    if (Array.isArray(data.toc)) {
      doc.querySelectorAll('.toc .toc-content').forEach(list => {
        list.replaceChildren(...data.toc.map(entry => {
          const item = doc.createElement('li'), link = doc.createElement('a');
          item.className = `depth-${entry.depth}`;
          link.href = `#${entry.slug}`; link.dataset.for = entry.slug; link.textContent = entry.text;
          item.append(link); return item;
        }));
      });
    }
  };

  // Keep the reader controls available; hide only the obsolete document during
  // a hard load. Normal SPA navigation retains the previous page until ready.
  document.documentElement.dataset.canonicalPending = 'true';
  const style = document.createElement('style');
  style.dataset.persist = 'canonical-reader-style';
  style.textContent = 'html[data-canonical-pending] article.popover-hint,html[data-canonical-pending] .page-listing,html[data-canonical-pending] .folder-pdf-export,html[data-canonical-pending] .article-title,html[data-canonical-pending] .content-meta,html[data-canonical-pending] .toc-content,html[data-canonical-pending] .breadcrumb-element:last-child{visibility:hidden}';
  document.head.append(style);
  let initialProgress, initialRetry, initialRequest, initialSlug, initialArticle;
  let initialDone = false, retryDelay = 5_000;
  const reveal = () => {
    initialDone = true;
    clearTimeout(initialRetry);
    delete document.documentElement.dataset.canonicalPending;
    initialProgress?.remove();
    document.querySelector('[data-canonical-error]')?.remove();
  };
  // Prepare the inert destination via the existing authenticated document bridge.
  window.prepareCanonicalQuartzDocument = doc => {
    const slug = pageSlug(doc);
    const article = pageBody(doc);
    if (!slug || !article) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const send = () => window.parent.postMessage({ type: 'second-brain:document-editor', action: folderSlug(doc) ? 'folder' : 'get', slug, sessionId, requestId, payload: { render: true } }, parentOrigin);
      // The host bridge can mount after the frame's DOM. Reuse the request id
      // until it responds instead of waiting for the rest of Quartz to load.
      const retry = setInterval(send, 1_000);
      const timer = setTimeout(() => { clearInterval(retry); pending.delete(requestId); reject(new Error('Could not load the saved page.')); }, 15_000);
      pending.set(requestId, { slug, doc, article, resolve, reject, timer, retry });
      send();
    });
  };
  const showInitialError = cause => {
    initialProgress?.remove();
    // A slow/unavailable host must not leave an already published note blank.
    // Empty unpublished shells have no fallback; explicit access/not-found
    // failures must not expose an obsolete publication either.
    const published = (!cause?.status || cause.status >= 500) &&
      Boolean(initialArticle?.textContent?.trim() || initialArticle?.querySelector('img,video,canvas,svg'));
    if (published) delete document.documentElement.dataset.canonicalPending;
    else document.documentElement.dataset.canonicalPending = 'true';
    document.querySelector('[data-canonical-error]')?.remove();
    const error = document.createElement('div'), retry = document.createElement('button');
    error.dataset.canonicalError = 'true'; error.setAttribute('role', 'alert');
    error.append(published ? 'Showing the published version. Could not refresh the saved page. ' : 'Could not load the saved page. ');
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => { retryDelay = 5_000; void loadInitial(); });
    error.append(retry); pageBody(document)?.before(error);
  };
  const loadInitial = () => {
    if (initialDone || initialRequest || pageSlug(document) !== initialSlug || pageBody(document) !== initialArticle) return;
    clearTimeout(initialRetry);
    const button = document.querySelector('[data-canonical-error] button');
    if (button) button.disabled = true;
    initialRequest = window.prepareCanonicalQuartzDocument(document).then(() => {
      if (initialDone || ![initialSlug, initialSlug + '/index'].includes(pageSlug(document))) return;
      reveal();
      document.dispatchEvent(new CustomEvent('nav', { detail: { url: pageSlug(document) } }));
    }).catch(cause => {
      if (initialDone || pageSlug(document) !== initialSlug || pageBody(document) !== initialArticle) return;
      showInitialError(cause);
      // Startup can outlast the first request. Recover without requiring a
      // reload, including folder pages that do not get the host's note refresh.
      if (!cause?.status || cause.status >= 500) {
        initialRetry = setTimeout(loadInitial, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      }
    }).finally(() => { initialRequest = undefined; if (button) button.disabled = false; });
    return initialRequest;
  };
  document.addEventListener('prenav', () => { initialDone = true; clearTimeout(initialRetry); });
  const initial = () => {
    if (!pageSlug(document)) { reveal(); return; }
    if (!document.documentElement.hasAttribute('data-canonical-pending')) return;
    initialSlug = pageSlug(document); initialArticle = pageBody(document);
    initialProgress = document.createElement('div'); initialProgress.className = 'navigation-progress'; initialProgress.style.width = '80%'; document.body.append(initialProgress);
    void loadInitial();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initial, { once: true }); else initial();

  // Capture before the legacy static-service shim and editor loader. Old
  // publications can retain that shim; only one bridge may replace the article.
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== parentOrigin) return;
    const data = event.data;
    if (data?.type === 'second-brain:document-editor-result' && data.sessionId === sessionId) {
      const request = pending.get(data.requestId);
      if (!request || request.slug !== data.slug) return;
      clearTimeout(request.timer); clearInterval(request.retry); pending.delete(data.requestId);
      if (!data.ok || typeof data.reader?.html !== 'string' || (data.reader.slug !== request.slug &&
          !(data.reader.kind === 'folder' && data.reader.slug === request.slug + '/index'))) {
        request.reject(Object.assign(new Error(data.error || 'Could not load the saved page.'), { status: data.status })); return;
      }
      const reader = { ...data.reader, revision: data.revision };
      if (request.doc === document && document.documentElement.hasAttribute('data-deleting-document')) {
        request.resolve(); return;
      }
      if (request.doc === document && (pageSlug(document) !== request.slug || pageBody(document) !== request.article)) {
        request.resolve(); return;
      }
      if (request.doc === document && document.querySelector('article')?.dataset.documentEditor === 'true') {
        document.dispatchEvent(new CustomEvent('bb:canonical-editor-update', { detail: reader }));
      } else {
        if (request.doc === document) cleanup();
        populate(request.doc, reader);
      }
      request.resolve(); return;
    }
    if (data?.type !== 'second-brain:canonical-document' || typeof data.html !== 'string') return;
    const currentSlug = document.querySelector('.markdown-actions')?.dataset.noteSlug;
    if (!currentSlug || currentSlug !== data.slug) return;
    const article = document.querySelector('article.popover-hint');
    if (!article) return;
    event.stopImmediatePropagation();
    // The host's normal refresh can win the race with the early frame request.
    // It satisfies that request too; do not leave a retry loop behind.
    for (const [id, request] of pending) {
      if (request.doc !== document || request.slug !== currentSlug) continue;
      clearTimeout(request.timer); clearInterval(request.retry); pending.delete(id); request.resolve();
    }
    const acknowledge = () => window.parent.postMessage({ type: 'second-brain:canonical-document-rendered', slug: currentSlug, requestId: data.requestId }, parentOrigin);
    if (document.documentElement.hasAttribute('data-deleting-document')) { acknowledge(); return; }
    if (article.dataset.documentEditor === 'true') {
      reveal();
      document.dispatchEvent(new CustomEvent('bb:canonical-editor-update', { detail: data }));
      acknowledge(); return;
    }
    metadata(document, data);
    document.dispatchEvent(new CustomEvent('bb:document-title', { detail: { slug: currentSlug, title: data.title } }));
    reveal();
    if (canonicalHtml.get(article) === data.html || data.revision && article.dataset.canonicalRevision === data.revision) { acknowledge(); return; }
    cleanup(); populate(document, data);
    document.dispatchEvent(new CustomEvent('nav', { detail: { url: currentSlug } }));
    acknowledge();
  }, true);
}

/** Also inject the current reader into previously published pages and shells. */
export function withCanonicalQuartzReader(html) {
  if (!html.includes('markdown-actions') && !html.includes('page-listing')) return html;
  const script = `<script data-persist="canonical-reader">(${installCanonicalQuartzReader.toString()})();</script>`;
  return /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/i, head => head + script)
    : script + html;
}
