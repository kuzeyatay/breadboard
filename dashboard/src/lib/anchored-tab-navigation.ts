import { desktopTabsBridge, getDesktopTabsSnapshot } from "./desktop-browser-tabs";

type Router = {
  push: (href: string, options?: { scroll?: boolean; transitionTypes?: string[] }) => void;
  replace: (href: string, options?: { scroll?: boolean; transitionTypes?: string[] }) => void;
};

type HistoryNavigationEvent = Event & {
  navigationType: string;
  destination: { url: string; key: string };
};
type HistoryNavigation = EventTarget & {
  traverseTo: (key: string) => { finished: Promise<unknown> };
};

/** Check before Next changes its route tree or a BackLink consumes its trail.
 * The shell owns the screen policy, including the error notice. */
export function installAnchoredTabNavigation(router: Router): () => void {
  let disposed = false;
  let revision = 0;
  const replayingLinks = new WeakSet<HTMLAnchorElement>();
  let replayingHistoryKey: string | null = null;
  const navigation = (window as Window & { navigation?: HistoryNavigation }).navigation;

  function needsCheck(href: string): boolean {
    if (!desktopTabsBridge()) return false;
    // External links are opened separately by the desktop shell.
    try {
      if (new URL(href, window.location.href).origin !== window.location.origin) return false;
    } catch { return false; }
    const state = getDesktopTabsSnapshot();
    const self = state?.tabs.find(tab => tab.id === state.selfId);
    return !self || self.anchored === true;
  }

  function check(href: string, proceed: () => void): void {
    const request = ++revision;
    if (!needsCheck(href)) { proceed(); return; }
    const from = window.location.href;
    const desktop = desktopTabsBridge()!;
    void desktop.tabs({ type: "navigation-check", url: new URL(href, from).href }).then(allowed => {
      if (disposed || request !== revision || window.location.href !== from) return;
      if (allowed) proceed();
      else window.dispatchEvent(new Event("breadboard:navigation-cancel"));
    }, () => {
      if (!disposed && request === revision) window.dispatchEvent(new Event("breadboard:navigation-cancel"));
    });
  }

  function handleClick(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!link || replayingLinks.has(link) || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    if (!needsCheck(link.href)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const href = link.href;
    check(href, () => {
      if (!link.isConnected || link.href !== href) return;
      replayingLinks.add(link);
      try { link.click(); } finally { replayingLinks.delete(link); }
    });
  }

  function handleHistory(event: Event) {
    const change = event as HistoryNavigationEvent;
    if (change.navigationType !== "traverse") return;
    if (replayingHistoryKey === change.destination.key) { replayingHistoryKey = null; return; }
    if (!change.cancelable || !needsCheck(change.destination.url)) return;
    change.preventDefault();
    check(change.destination.url, () => {
      const request = revision;
      const from = window.location.href;
      // Let Chromium finish aborting the original traversal before replaying
      // it. A replay in the same microtask can reuse the aborted traversal.
      window.setTimeout(() => {
        if (disposed || revision !== request || window.location.href !== from) return;
        replayingHistoryKey = change.destination.key;
        void navigation?.traverseTo(change.destination.key).finished.catch(() => { replayingHistoryKey = null; });
      }, 0);
    });
  }

  // useRouter returns the shared public router. Guard its imperative methods
  // as well as captured links: cancelling history.pushState is too late for
  // Next, which has already committed the destination's React tree by then.
  const push = router.push;
  const replace = router.replace;
  const guardedPush: Router["push"] = (href, options) => check(href, () => push.call(router, href, options));
  const guardedReplace: Router["replace"] = (href, options) => check(href, () => replace.call(router, href, options));
  router.push = guardedPush;
  router.replace = guardedReplace;
  window.addEventListener("click", handleClick, true);
  navigation?.addEventListener("navigate", handleHistory);
  return () => {
    disposed = true;
    revision += 1;
    if (router.push === guardedPush) router.push = push;
    if (router.replace === guardedReplace) router.replace = replace;
    window.removeEventListener("click", handleClick, true);
    navigation?.removeEventListener("navigate", handleHistory);
  };
}
