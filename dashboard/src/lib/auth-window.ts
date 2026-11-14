/**
 * Send a sign-in flow to the window opened for it. The desktop shell refuses
 * `window.open("about:blank")` from Breadboard pages, so `popup` is null
 * there; navigating this page instead would strand the chat tab mid-load.
 * Hand the URL to the shell as a new tab. A plain browser that blocked the
 * popup still falls back to navigating in place.
 */
export function openAuthorizationUrl(popup: Window | null, url: string): void {
  if (popup) popup.location.href = url;
  else if ("breadboardDesktop" in window) window.open(url, "_blank");
  else window.location.assign(url);
}
