/** Forward embedded Quartz loading to the dashboard's shared top bar. */
export function installQuartzNavigationProgress() {
  if (window.parent === window || window.__quartzNavigationProgress) return;
  let parentOrigin;
  try { parentOrigin = new URL(window.location.ancestorOrigins?.[0] || document.referrer).origin; } catch { return; }
  window.__quartzNavigationProgress = true;

  // Both the SPA router and canonical reader append their bars directly to the
  // body. Mirror that lifecycle into the shell without observing article edits.
  const style = document.createElement('style');
  style.dataset.persist = 'navigation-progress-bridge';
  style.textContent = 'body > .navigation-progress{display:none!important}';
  document.head.append(style);
  let previous;
  const report = (force = false) => {
    const pending = Boolean(document.querySelector('body > .navigation-progress'));
    if (!force && pending === previous) return;
    previous = pending;
    window.parent.postMessage({ type: 'second-brain:navigation-progress', pending }, parentOrigin);
  };
  const observe = () => {
    new MutationObserver(() => report()).observe(document.body, { childList: true });
    report(true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe, { once: true });
  else observe();
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== parentOrigin) return;
    if (event.data?.type === 'second-brain:navigation-progress-request') report(true);
  });
}
