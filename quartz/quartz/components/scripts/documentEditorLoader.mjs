/** Serialized into old publications as well as new Quartz pages. Keep self-contained. */
export function installQuartzDocumentEditor() {
  if (window.__quartzDocumentLoader) return;
  window.__quartzDocumentLoader = true;
  let loading;
  const deletedSlugs = new Set();
  const deletionStyle = document.createElement('style');
  deletionStyle.dataset.persist = 'document-deletion';
  deletionStyle.textContent = '[data-document-deleted]{display:none!important}html[data-deleting-document] article.popover-hint,html[data-deleting-document] .article-title,html[data-deleting-document] .content-meta,html[data-deleting-document] .toc-content,html[data-deleting-document] .breadcrumb-element:last-child,html[data-deleting-document] .bb-document-toolbar,html[data-deleting-document] .bb-document-source{display:none!important}';
  document.head.append(deletionStyle);
  const applyDeletions = (root = document) => {
    if (!deletedSlugs.size && !document.querySelector('[data-document-deleted],[data-deleting-document]')) return;
    const current = document.querySelector('.markdown-actions')?.dataset.noteSlug;
    document.documentElement.toggleAttribute('data-deleting-document', deletedSlugs.has(current));
    const links = [...root.querySelectorAll('a[href],a[data-for]')];
    if (root.matches?.('a[href],a[data-for]')) links.unshift(root);
    links.forEach(link => {
      let slug = link.dataset.for;
      if (!slug) {
        try {
          const url = new URL(link.getAttribute('href'), location.href);
          if (url.origin !== location.origin) return;
          slug = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '').replace(/\.(?:html|md)$/, '');
        } catch { return; }
      }
      const row = link.closest('.explorer li') || (link.matches('li.section-li .desc a') ? link.closest('li.section-li') : link);
      row.toggleAttribute('data-document-deleted', deletedSlugs.has(slug));
    });
  };
  const updateDeletion = (slugs, deleted) => {
    for (const slug of slugs) if (typeof slug === 'string') {
      if (deleted) deletedSlugs.add(slug); else deletedSlugs.delete(slug);
    }
    applyDeletions();
    document.dispatchEvent(new CustomEvent('bb:document-deletions', { detail: { slugs: [...deletedSlugs] } }));
  };
  // Explorer/search results and SPA pages can arrive while deletion is pending.
  new MutationObserver(records => {
    if (!deletedSlugs.size) return;
    for (const record of records) for (const node of record.addedNodes) {
      if (node instanceof Element) applyDeletions(node);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('message', event => {
    let origin;
    try { origin = new URL(window.location.ancestorOrigins?.[0] || document.referrer).origin; } catch { return; }
    if (event.source !== window.parent || event.origin !== origin || event.data?.type !== 'second-brain:documents-deleted' || !Array.isArray(event.data.slugs)) return;
    updateDeletion(event.data.slugs, true);
  });
  const bind = () => {
    applyDeletions();
    const actions = document.querySelector('.markdown-actions');
    const button = actions?.querySelector('.markdown-edit-button');
    if (!button || button.dataset.documentEditorBound) return;
    button.dataset.documentEditorBound = 'true';
    const status = actions.querySelector('.markdown-action-status');
    if (status) button.before(status);
    const slug = actions.dataset.noteSlug;
    const title = document.querySelector('h1.article-title');
    if (title && !title.parentElement?.classList.contains('bb-document-heading')) {
      const heading = document.createElement('div'); heading.className = 'bb-document-heading'; title.before(heading); heading.append(title, actions);
    }
    if (window.parent === window) {
      button.textContent = 'Open in Breadboard';
      const base = actions.dataset.dashboardUrl;
      if (base) button.onclick = () => { const [cluster, ...note] = slug.split('/'); location.assign(base.replace(/\/+$/, '') + '/garden/' + encodeURIComponent(cluster) + '?note=' + encodeURIComponent(note.join('/'))); };
      else { button.disabled = true; button.title = 'Open this garden in Breadboard to edit.'; }
      actions.querySelector('.markdown-delete-button')?.remove(); return;
    }
    let origin;
    try { origin = new URL(window.location.ancestorOrigins?.[0] || document.referrer).origin; } catch { return; }
    const canonical = event => {
      const data = event.data;
      if (event.source !== window.parent || event.origin !== origin || data?.type !== 'second-brain:canonical-document' || data.slug !== slug ||
          (!deleting && document.querySelector('article.popover-hint')?.dataset.documentEditor !== 'true')) return;
      event.stopImmediatePropagation();
      if (!deleting) document.dispatchEvent(new CustomEvent('bb:canonical-editor-update', { detail: data }));
      window.parent.postMessage({ type: 'second-brain:canonical-document-rendered', slug, requestId: data.requestId }, origin);
    };
    window.addEventListener('message', canonical, true);
    button.textContent = 'Edit'; button.setAttribute('role', 'switch'); button.setAttribute('aria-checked', 'false');
    button.setAttribute('aria-label', 'Edit page');
    let enabled = false, pending = false, initial;
    const report = value => { if (status) status.textContent = value; };
    const sessionId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const deleteId = crypto.randomUUID();
    const remove = actions.querySelector('.markdown-delete-button');
    let deleting = false, deleteRequested = false, disposed = false, dismissDelete;
    const confirmDelete = () => new Promise(resolve => {
      // Keep the sheet self-contained: existing publications receive this loader
      // without a Quartz rebuild, and deleting must not load the document editor.
      const dialog = document.createElement('dialog');
      dialog.className = 'bb-page-delete-dialog';
      dialog.setAttribute('role', 'alertdialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'bb-page-delete-title');
      dialog.setAttribute('aria-describedby', 'bb-page-delete-subject bb-page-delete-body');
      dialog.innerHTML = `<style>
        .bb-page-delete-dialog {
          --delete-danger: #a45c5c; --delete-danger-hover: #8f4d4d;
          box-sizing: border-box; width: min(26rem, calc(100vw - 2rem)); max-height: calc(100dvh - 3rem);
          margin: auto; padding: 0; overflow: auto; border: 1px solid var(--neu-q-border, var(--lightgray));
          border-radius: 16px; color: var(--dark);
          background: linear-gradient(145deg, var(--neu-q-surface, var(--light)), var(--light));
          font: 14px/1.5 var(--bodyFont, system-ui, sans-serif);
          box-shadow: 0 22px 52px color-mix(in srgb, var(--dark) 23%, transparent),
            0 5px 12px color-mix(in srgb, var(--dark) 14%, transparent),
            inset 0 1px 0 var(--neu-q-highlight, #ffffff88);
        }
        .bb-page-delete-dialog::backdrop { background: color-mix(in srgb, var(--dark) 24%, transparent); }
        :root[saved-theme=dark] .bb-page-delete-dialog {
          --delete-danger: #d48c8b; --delete-danger-hover: #e0a3a2;
          box-shadow: 0 22px 52px #0008, 0 5px 12px #0005, inset 0 1px 0 var(--neu-q-highlight, #ffffff0f);
        }
        :root[saved-theme=dark] .bb-page-delete-dialog::backdrop { background: #0006; }
        .bb-page-delete-dialog .bb-page-delete-content { display: flex; align-items: flex-start; gap: 14px; padding: 24px 24px 20px; }
        .bb-page-delete-dialog .bb-page-delete-icon {
          display: grid; place-items: center; flex: 0 0 40px; height: 40px; box-sizing: border-box;
          border: 1px solid color-mix(in srgb, var(--delete-danger) 45%, transparent); border-radius: 12px;
          background: color-mix(in srgb, var(--delete-danger) 11%, transparent); color: var(--delete-danger);
        }
        .bb-page-delete-dialog .bb-page-delete-copy { min-width: 0; padding-top: 2px; }
        .bb-page-delete-dialog h2 { margin: 0; color: var(--dark); font: 600 18px/24px var(--headerFont, var(--bodyFont, system-ui, sans-serif)); }
        .bb-page-delete-dialog p { margin: 8px 0 0; color: inherit; font-size: 14px; }
        .bb-page-delete-dialog #bb-page-delete-subject { font-weight: 500; line-height: 20px; overflow-wrap: anywhere; }
        .bb-page-delete-dialog #bb-page-delete-body { color: var(--gray); line-height: 24px; }
        .bb-page-delete-dialog form {
          display: flex; justify-content: flex-end; gap: 8px; margin: 0; padding: 16px 24px;
          border-top: 1px solid var(--neu-q-border, var(--lightgray)); background: var(--light);
        }
        .bb-page-delete-dialog button {
          min-height: 40px; margin: 0; padding: 8px 16px; border: 1px solid var(--neu-q-border, var(--lightgray));
          border-radius: 8px; background: var(--neu-q-surface, var(--light)); color: var(--dark);
          font: 500 14px/20px var(--bodyFont, system-ui, sans-serif); cursor: pointer;
          box-shadow: var(--neu-q-soft-shadow, 2px 2px 6px #0001);
        }
        .bb-page-delete-dialog button:hover { background: var(--neu-q-pressed, var(--lightgray)); }
        .bb-page-delete-dialog button:focus-visible { outline: 2px solid var(--secondary); outline-offset: 3px; }
        .bb-page-delete-dialog button[value=delete] {
          border-color: var(--delete-danger-hover); background: var(--delete-danger); color: #fffefb; font-weight: 600;
          box-shadow: 3px 3px 8px color-mix(in srgb, var(--delete-danger) 25%, transparent);
        }
        .bb-page-delete-dialog button[value=delete]:hover { background: var(--delete-danger-hover); }
        :root[saved-theme=dark] .bb-page-delete-dialog button[value=delete] { color: #201b1b; }
        @media (max-width: 480px) { .bb-page-delete-dialog form { flex-direction: column-reverse; } }
      </style>
      <div class="bb-page-delete-content">
        <span class="bb-page-delete-icon" aria-hidden="true">${remove.innerHTML}</span>
        <div class="bb-page-delete-copy">
          <h2 id="bb-page-delete-title">Delete this page?</h2>
          <p id="bb-page-delete-subject"></p>
          <p id="bb-page-delete-body">This Markdown page will be removed from your garden. This cannot be undone.</p>
        </div>
      </div>
      <form method="dialog">
        <button type="submit" value="cancel" autofocus>Cancel</button>
        <button type="submit" value="delete">Delete page</button>
      </form>`;
      dialog.querySelector('#bb-page-delete-subject').textContent = title?.textContent?.trim() || slug;
      const focused = document.activeElement;
      const overflow = document.body.style.overflow;
      let settled = false;
      const settle = answer => {
        if (settled) return;
        settled = true; dismissDelete = undefined;
        dialog.close(); dialog.remove();
        document.body.style.overflow = overflow;
        if (focused?.isConnected) focused.focus({ preventScroll: true });
        resolve(answer);
      };
      dismissDelete = () => settle(false);
      dialog.addEventListener('close', () => settle(dialog.returnValue === 'delete'));
      dialog.addEventListener('cancel', event => { event.preventDefault(); settle(false); });
      dialog.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const [cancel, confirm] = dialog.querySelectorAll('button');
        if (event.shiftKey && document.activeElement === cancel) { event.preventDefault(); confirm.focus(); }
        else if (!event.shiftKey && document.activeElement === confirm) { event.preventDefault(); cancel.focus(); }
      });
      // A drag that starts on the sheet must not become a backdrop dismissal.
      const outside = event => {
        const bounds = dialog.getBoundingClientRect();
        return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
      };
      let backdropDown = false;
      dialog.addEventListener('pointerdown', event => { backdropDown = event.target === dialog && outside(event); });
      dialog.addEventListener('click', event => { if (backdropDown && event.target === dialog && outside(event)) settle(false); });
      document.body.append(dialog);
      document.body.style.overflow = 'hidden';
      dialog.showModal();
    });
    // Upgrade existing publications too; they can still contain the text button.
    if (remove) {
      remove.setAttribute('aria-label', 'Delete page'); remove.title = 'Delete page';
      remove.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7M14 10v7"/></svg>';
    }
    const onDelete = async event => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (deleting || disposed) return;
      deleting = true;
      try {
        if (!await confirmDelete() || disposed) { deleting = false; return; }
        remove.disabled = true;
        button.disabled = true;
        updateDeletion([slug], true);
        report('Deleting…');
        await window.__quartzDocumentEditor?.flush();
        if (disposed) return;
        deleteRequested = true;
        window.parent.postMessage({ type: 'second-brain:document-editor', action: 'delete', slug, sessionId, requestId: deleteId }, origin);
      } catch (error) { deleting = false; remove.disabled = false; button.disabled = false; updateDeletion([slug], false); report(error.message); }
    };
    remove?.addEventListener('click', onDelete, true);
    const probe = () => window.parent.postMessage({ type: 'second-brain:document-editor', action: 'get', slug, sessionId, requestId }, origin);
    const receive = event => {
      const data = event.data;
      if (event.source === window.parent && event.origin === origin && data?.type === 'second-brain:document-editor-result' && data.slug === slug && data.sessionId === sessionId && data.requestId === deleteId) {
        deleteRequested = false;
        deleting = false;
        if (disposed) window.removeEventListener('message', receive);
        if (data.ok) {
          if (disposed) return;
          const destination = new URL('/' + encodeURIComponent(slug.split('/')[0]) + '/', location.href);
          if (window.spaNavigate) void window.spaNavigate(destination); else window.location.assign(destination.href);
        }
        else {
          deleting = false; remove.disabled = false; button.disabled = false; updateDeletion([slug], false);
          const message = data.error || 'Could not delete this page.';
          if (disposed) { const currentStatus = document.querySelector('.markdown-action-status'); if (currentStatus) currentStatus.textContent = message; }
          else report(message);
        }
        return;
      }
      if (event.source !== window.parent || event.origin !== origin || data?.sessionId !== sessionId || data?.requestId !== requestId || data?.slug !== slug) return;
      if (data.ok) { initial = data; button.hidden = data.canEdit === false; if (remove) remove.hidden = data.canEdit === false; }
    };
    window.addEventListener('message', receive);
    probe();
    const onToggle = async event => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (pending || deleting) return;
      pending = true;
      try {
        if (!loading) loading = new Promise((resolve, reject) => {
          const script = document.createElement('script'); script.src = origin + '/quartz-editor/editor.js';
          script.onload = resolve; script.onerror = () => { loading = undefined; script.remove(); reject(new Error('Could not load editing. Click Edit to retry.')); };
          document.head.append(script);
          const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = origin + '/quartz-editor/editor.css'; document.head.append(style);
        });
        report(''); await loading;
        if (!window.__quartzDocumentEditor) await window.BreadboardDocumentEditor.mount({ slug, origin, initial });
        await window.__quartzDocumentEditor.setEditable(!enabled);
        enabled = !enabled;
        button.setAttribute('aria-checked', String(enabled)); button.textContent = enabled ? 'Read' : 'Edit';
      } catch (error) { report(error.message || 'Could not open editing.'); }
      finally { pending = false; }
    };
    button.addEventListener('click', onToggle, true);
    window.addCleanup?.(() => {
      disposed = true;
      dismissDelete?.();
      // Leaving during a save cancels the unsent deletion. Once sent, keep its
      // result listener until it settles so navigation cannot lose a rollback.
      if (deleting && !deleteRequested) updateDeletion([slug], false);
      // Canonical refresh is suppressed once the editor owns the article.
      if (!deleteRequested) window.removeEventListener('message', receive);
      window.removeEventListener('message', canonical, true);
      button.removeEventListener('click', onToggle, true);
      remove?.removeEventListener('click', onDelete, true);
      delete button.dataset.documentEditorBound;
    });
  };
  document.addEventListener('nav', bind);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true }); else bind();
}
