import type { Session, WebContents } from "electron";

/**
 * Google rejects sign-in from embedded Chromium ("This browser or app may not
 * be secure") even with a clean Chrome user agent. Presenting Firefox on the
 * sign-in host alone gets the ordinary flow; every other site keeps Chromium.
 */
const GOOGLE_SIGN_IN_HOST = "accounts.google.com";

export function isGoogleSignInUrl(url: string): boolean {
  try { return new URL(url).hostname === GOOGLE_SIGN_IN_HOST; } catch { return false; }
}

/** Firefox ships every four weeks; derive a current version so the identity never ages. */
export function firefoxUserAgent(chromiumUserAgent: string, now = Date.now()): string {
  // ponytail: release cadence estimate from Firefox 128 (2024-07-09); refresh the anchor if Mozilla changes cadence.
  const version = 128 + Math.floor((now - Date.UTC(2024, 6, 9)) / (28 * 86_400_000));
  const platform = /Windows/.test(chromiumUserAgent) ? "Windows NT 10.0; Win64; x64"
    : /Mac OS X/.test(chromiumUserAgent) ? "Macintosh; Intel Mac OS X 10.15"
    : "X11; Linux x86_64";
  return `Mozilla/5.0 (${platform}; rv:${version}.0) Gecko/20100101 Firefox/${version}.0`;
}

const hookedSessions = new WeakSet<Session>();

/** Request headers: Firefox identity and no Chromium client hints for the sign-in host. */
export function attachGoogleSignInSession(browserSession: Session): void {
  if (hookedSessions.has(browserSession)) return;
  hookedSessions.add(browserSession);
  const firefox = firefoxUserAgent(browserSession.getUserAgent());
  // Electron allows one onBeforeSendHeaders listener per session; this is the only one.
  browserSession.webRequest.onBeforeSendHeaders({ urls: [`https://${GOOGLE_SIGN_IN_HOST}/*`] }, (details, callback) => {
    const headers: Record<string, string> = { ...details.requestHeaders, "User-Agent": firefox };
    for (const name of Object.keys(headers)) if (/^sec-ch-ua/i.test(name)) delete headers[name];
    callback({ requestHeaders: headers });
  });
}

/** Page identity: navigator.userAgent must agree with the request headers. */
export function attachGoogleSignInPage(contents: WebContents, chromiumUserAgent: string): void {
  const firefox = firefoxUserAgent(chromiumUserAgent);
  const follow = (_event: unknown, url: string, _inPlace: boolean, isMainFrame: boolean) => {
    if (!isMainFrame || contents.isDestroyed()) return;
    const wanted = isGoogleSignInUrl(url) ? firefox : chromiumUserAgent;
    if (contents.getUserAgent() !== wanted) contents.setUserAgent(wanted);
  };
  contents.on("did-start-navigation", follow);
  contents.on("did-redirect-navigation", follow);
}
