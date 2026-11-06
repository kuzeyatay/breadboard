/**
 * Runs before the Next bundles, so a temporary asset outage cannot leave the
 * browser rail unstyled or its controls unhydrated. Styles can fail even when
 * React starts successfully; resource errors also cover network failures that
 * do not expose an HTTP status in resource timing.
 */
export const chunkRecoveryScript = `(() => {
  const key = "breadboard:chunk-retry";
  let tries = 0;
  try {
    const stored = Number(sessionStorage.getItem(key));
    if (Number.isInteger(stored) && stored > 0) tries = stored;
  } catch {}
  const failedScripts = new Set();
  const failedStyles = new Set();
  const isChunk = (value) => {
    try {
      const url = new URL(value, location.href);
      return url.origin === location.origin && url.pathname.startsWith("/_next/static/");
    } catch { return false; }
  };
  const onResourceError = (event) => {
    const target = event.target;
    if (target instanceof HTMLScriptElement && isChunk(target.src)) {
      failedScripts.add(target.src);
    } else if (target instanceof HTMLLinkElement && target.rel === "stylesheet" && isChunk(target.href)) {
      failedStyles.add(target.href);
    }
  };
  const onResourceLoad = (event) => {
    const target = event.target;
    if (target instanceof HTMLScriptElement) failedScripts.delete(target.src);
    else if (target instanceof HTMLLinkElement) failedStyles.delete(target.href);
  };
  addEventListener("error", onResourceError, true);
  addEventListener("load", onResourceLoad, true);
  addEventListener("load", () => setTimeout(() => {
    removeEventListener("error", onResourceError, true);
    removeEventListener("load", onResourceLoad, true);
    const resources = new Map(performance.getEntriesByType("resource").map(entry => [entry.name, entry]));
    const missingStyles = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .some(link => isChunk(link.href) && !link.disabled &&
        (!link.media || matchMedia(link.media).matches) &&
        (!link.sheet || failedStyles.has(link.href) || resources.get(link.href)?.responseStatus >= 400));
    const missingScripts = failedScripts.size > 0 ||
      [...resources.values()].some(entry =>
        isChunk(entry.name) && entry.responseStatus >= 400 &&
        (entry.initiatorType === "script" ||
          (entry.initiatorType === "link" && new URL(entry.name).pathname.endsWith(".js"))));
    const needsReload = missingStyles ||
      (missingScripts && document.documentElement.dataset.breadboardStartup === "loading");
    if (!needsReload) {
      try { sessionStorage.removeItem(key); } catch {}
      return;
    }
    if (tries >= 5) return;
    // Persist before reloading; without storage we cannot enforce the bound.
    try { sessionStorage.setItem(key, String(tries + 1)); } catch { return; }
    location.reload();
  }, 1000 * Math.min(30, 2 ** tries)), { once: true });
})();`;
