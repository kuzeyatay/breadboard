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

export function hardenWindow(window: BrowserWindow, allowed: AllowedOrigins): void {
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (isNavigationAllowed(allowed, targetUrl)) return;
    event.preventDefault();
    if (isSafeExternalUrl(targetUrl)) void shell.openExternal(targetUrl);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    // Local origins may open in-window navigations only; anything else goes to
    // the OS browser. No new Electron windows are ever created from content.
    if (isSafeExternalUrl(url) && !isNavigationAllowed(allowed, url)) {
      void shell.openExternal(url);
    } else if (isNavigationAllowed(allowed, url)) {
      void window.loadURL(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
}

export function hardenSession(targetSession: Session): void {
  targetSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    // Clipboard and fullscreen are reasonable for a local dashboard; everything
    // else (camera, mic, geolocation, notifications, ...) is denied.
    const allowedPermissions = new Set(["clipboard-sanitized-write", "fullscreen"]);
    callback(allowedPermissions.has(permission));
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
  hardenSession(session.defaultSession);
}
