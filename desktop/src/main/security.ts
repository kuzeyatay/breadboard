import { app, shell, session, type BrowserWindow, type Session } from "electron";

/**
 * Renderer lockdown:
 *  - navigation restricted to the local service origins we own;
 *  - window.open denied — external links go to the OS browser;
 *  - permission requests denied by default;
 *  - no arbitrary web content is ever loaded in the shell.
 */
export interface AllowedOrigins {
  origins: Set<string>;
}

const themeLocationAllowedWebContents = new Set<number>();

export function allowThemeLocationFor(webContentsId: number): boolean {
  const added = !themeLocationAllowedWebContents.has(webContentsId);
  themeLocationAllowedWebContents.add(webContentsId);
  return added;
}

export function revokeThemeLocationFor(webContentsId: number): void {
  themeLocationAllowedWebContents.delete(webContentsId);
}

export function allowedOriginsFor(urls: string[]): AllowedOrigins {
  const origins = new Set<string>();
  for (const value of urls) {
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Ignore unparseable entries; they simply are not allowed.
    }
  }
  return { origins };
}

export function isNavigationAllowed(allowed: AllowedOrigins, targetUrl: string): boolean {
  try {
    const url = new URL(targetUrl);
    if (url.protocol === "file:") return true; // our own startup screen
    return allowed.origins.has(url.origin);
  } catch {
    return false;
  }
}

export function isSafeExternalUrl(targetUrl: string): boolean {
  try {
    const url = new URL(targetUrl);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

export function isRendererPermissionAllowed(
  allowed: AllowedOrigins,
  permission: string,
  requestingUrl: string | undefined,
  mediaTypes: readonly string[] = [],
  allowGeolocation = false,
): boolean {
  if (!requestingUrl) return false;
  let origin: string;
  try {
    origin = new URL(requestingUrl).origin;
  } catch {
    return false;
  }
  if (!allowed.origins.has(origin)) return false;

  if (permission === "media") {
    // Dictation needs audio only. A compromised local renderer must not turn
    // that narrow grant into camera access.
    return mediaTypes.length > 0 && mediaTypes.every((type) => type === "audio");
  }
  if (permission === "geolocation") return allowGeolocation;
  return permission === "clipboard-sanitized-write" || permission === "fullscreen";
}

export function hardenWindow(
  window: BrowserWindow,
  allowed: AllowedOrigins,
  onOpenLocalWindow?: (url: string) => void,
): void {
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (isNavigationAllowed(allowed, targetUrl)) return;
    event.preventDefault();
    if (isSafeExternalUrl(targetUrl)) void shell.openExternal(targetUrl);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    // External URLs go to the OS browser. A local `target="_blank"` opens a new
    // hardened Breadboard window when a handler is provided (so features like the
    // Work timer get their own instance), otherwise it navigates in-window.
    if (isSafeExternalUrl(url) && !isNavigationAllowed(allowed, url)) {
      void shell.openExternal(url);
    } else if (isNavigationAllowed(allowed, url)) {
      if (onOpenLocalWindow) onOpenLocalWindow(url);
      else void window.loadURL(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
}

export function hardenSession(targetSession: Session, allowed: AllowedOrigins): void {
  targetSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) => {
      const mediaTypes =
        permission === "media" && details.mediaType ? [details.mediaType] : [];
      return isRendererPermissionAllowed(
        allowed,
        permission,
        details.requestingUrl ?? details.securityOrigin ?? requestingOrigin,
        mediaTypes,
        Boolean(
          _webContents &&
            themeLocationAllowedWebContents.has(_webContents.id),
        ),
      );
    },
  );
  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes =
      permission === "media" && "mediaTypes" in details
        ? details.mediaTypes ?? []
        : [];
    const securityOrigin =
      permission === "media" && "securityOrigin" in details
        ? details.securityOrigin
        : undefined;
    callback(
      isRendererPermissionAllowed(
        allowed,
        permission,
        details.requestingUrl || securityOrigin || webContents.getURL(),
        mediaTypes,
        themeLocationAllowedWebContents.has(webContents.id),
      ),
    );
  });
}

// The file:// startup screen carries its CSP via a <meta http-equiv> tag
// (webRequest header injection does not apply to file:// responses).

export function installGlobalSecurity(allowed: AllowedOrigins): void {
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (event, targetUrl) => {
      if (!isNavigationAllowed(allowed, targetUrl)) event.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url) && !isNavigationAllowed(allowed, url)) {
        void shell.openExternal(url);
      }
      return { action: "deny" };
    });
  });
  hardenSession(session.defaultSession, allowed);
}
