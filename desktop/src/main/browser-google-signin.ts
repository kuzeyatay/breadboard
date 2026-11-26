import type { WebContents } from "electron";

const OAUTH_PATH = /^\/(?:o\/oauth2\/(?:v2\/)?auth|signin\/oauth\/[^/]+)\/?$/;
const SIGN_IN_PATH = /^\/(?:v3\/signin\/|signin\/v2\/|ServiceLogin$|AccountChooser$|AddSession$)/;

/**
 * Interactive sign-in pages. Any `passive` value (true, or a max age such as
 * 1209600 that docs.google.com and Forms send) is Google's silent session check,
 * which bounces straight back and stays in the tab; stopping it blanks the page.
 */
export function isGoogleSignInPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    const passive = parsed.searchParams.get("passive");
    return parsed.origin === "https://accounts.google.com" && !parsed.username && !parsed.password
      && (SIGN_IN_PATH.test(parsed.pathname) || OAUTH_PATH.test(parsed.pathname))
      && (passive === null || passive === "false") && parsed.searchParams.get("prompt") !== "none";
  } catch { return false; }
}

/** Third-party OAuth needs the initiating site's session and redirect state in
 * the external browser as well. Start there so it can initiate its own login. */
export function googleSignInDestination(url: string, currentPage?: string): string | null {
  if (!isGoogleSignInPage(url)) return null;
  if (currentPage && OAUTH_PATH.test(new URL(url).pathname)) {
    try {
      const site = new URL(currentPage);
      if (site.protocol === "https:" && !site.username && !site.password && site.hostname !== "accounts.google.com") return site.href;
    } catch { /* No committed website yet. */ }
  }
  return url;
}

/** Cancel at Electron's cancellable navigation boundary. The system browser
 * owns the sign-in, its redirects, and the resulting session. */
export function attachGoogleSignInHandoff(contents: WebContents, open: (url: string) => void,
  currentPage: () => string = () => contents.getURL()): void {
  const handoff = (event: Electron.Event, url: string) => {
    if (event.defaultPrevented || contents.isDestroyed()) return;
    const target = googleSignInDestination(url, currentPage());
    if (!target) return;
    event.preventDefault();
    open(target);
  };
  contents.on("will-navigate", handoff);
  contents.on("will-redirect", (event, url, _inPlace, mainFrame) => {
    if (mainFrame) handoff(event, url);
  });
}
