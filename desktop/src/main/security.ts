import {
  app,
  shell,
  session,
  type BrowserWindow,
  type Event as ElectronEvent,
  type HandlerDetails,
  type Session,
  type WebContents,
  type WindowOpenHandlerResponse,
} from "electron";

/**
 * Renderer lockdown:
 *  - navigation restricted to the local service origins we own;
 *  - window.open denied — web links may be handed to the built-in browser;
 *  - permission requests denied by default;
 *  - no arbitrary web content is ever loaded in the shell.
 */
export interface AllowedOrigins {
  origins: Set<string>;
  /** Exact product-owned file URLs; omitted means no local file is trusted. */
  localFiles?: Set<string>;
}

const themeLocationAllowedWebContents = new Set<number>();
const externalBrowserWebContents = new Set<number>();

export function allowThemeLocationFor(webContentsId: number): boolean {
  const added = !themeLocationAllowedWebContents.has(webContentsId);
  themeLocationAllowedWebContents.add(webContentsId);
  return added;
}

export function revokeThemeLocationFor(webContentsId: number): void {
  themeLocationAllowedWebContents.delete(webContentsId);
}

/**
 * Mark a sandboxed WebContentsView as the in-app browser's untrusted page.
 *
 * The process-wide navigation guard protects product renderers by default. A
 * browser page is the one deliberate exception: it has no preload, no Node
 * integration, a separate session partition, and its own http(s)-only guard.
 */
export function allowExternalBrowserNavigationFor(webContentsId: number): void {
  externalBrowserWebContents.add(webContentsId);
}

export function revokeExternalBrowserNavigationFor(webContentsId: number): void {
  externalBrowserWebContents.delete(webContentsId);
}

export function isExternalBrowserWebContents(webContentsId: number): boolean {
  return externalBrowserWebContents.has(webContentsId);
}

export function allowedOriginsFor(urls: string[]): AllowedOrigins {
  const origins = new Set<string>();
  const localFiles = new Set<string>();
  for (const value of urls) {
    try {
      const url = new URL(value);
      if (url.protocol === "file:") localFiles.add(normalizedLocalFileUrl(url));
      else origins.add(url.origin);
    } catch {
      // Ignore unparseable entries; they simply are not allowed.
    }
  }
  return { origins, localFiles };
}

export function isNavigationAllowed(allowed: AllowedOrigins, targetUrl: string): boolean {
  try {
    const url = new URL(targetUrl);
    if (url.protocol === "file:") {
      return allowed.localFiles?.has(normalizedLocalFileUrl(url)) === true;
    }
    return allowed.origins.has(url.origin);
  } catch {
    return false;
  }
}

function normalizedLocalFileUrl(url: URL): string {
  // loadFile adds a theme query to the product-owned startup/recovery pages.
  // Navigation authority belongs to the exact local file, never its query or
  // fragment and never every other file on the machine.
  const normalized = new URL(url.toString());
  normalized.search = "";
  normalized.hash = "";
  return normalized.toString();
}

export function isSafeExternalUrl(targetUrl: string): boolean {
  try {
    const url = new URL(targetUrl);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

/** The embedded browser deliberately supports only ordinary web pages. */
export function isSafeBrowserUrl(targetUrl: string): boolean {
  try {
    const url = new URL(targetUrl);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export interface ExternalBrowserHandlers {
  /** Install the shared browser profile's narrow notification policy. */
  configurePermissions?: (session: Session) => void;
  onOpenWindow: (details: HandlerDetails) => WindowOpenHandlerResponse;
  /** One inert shell-owned document used to identify an automation target. */
  isTrustedBootstrapUrl?: (url: string) => boolean;
}

/**
 * Lock down an untrusted page shown by Breadboard's embedded Chromium browser.
 * Product pages use {@link hardenWebContents}; browser pages intentionally
 * navigate across origins but never receive the product preload bridge.
 */
export function hardenExternalBrowserWebContents(
  contents: WebContents,
  handlers: ExternalBrowserHandlers,
): void {
  allowExternalBrowserNavigationFor(contents.id);
  contents.once("destroyed", () => revokeExternalBrowserNavigationFor(contents.id));
  const guardWebUrl = (event: ElectronEvent, targetUrl: string) => {
    if (
      !isSafeBrowserUrl(targetUrl) &&
      handlers.isTrustedBootstrapUrl?.(targetUrl) !== true
    ) {
      event.preventDefault();
    }
  };
  contents.on("will-navigate", guardWebUrl);
  contents.on("will-redirect", guardWebUrl);
  contents.setWindowOpenHandler((details) => {
    // Auth providers also open an empty named window before assigning its URL.
    // Preserve Chromium's Window/opener relationship instead of opening an
    // unrelated URL and reporting the popup as blocked to the calling page.
    if (isSafeBrowserUrl(details.url) || details.url === "about:blank") {
      return handlers.onOpenWindow(details);
    }
    return { action: "deny" };
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());

  if (handlers.configurePermissions) handlers.configurePermissions(contents.session);
  else {
    contents.session.setPermissionCheckHandler(() => false);
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
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

export interface LocalOpenHandlers {
  /** A new hardened Breadboard window. Without it the page navigates in place. */
  onOpenLocalWindow?: (url: string) => void;
  /**
   * A tab beside the page that asked, for the gesture a browser answers that
   * way (a Ctrl- or middle-click). Returns false when tabs are switched off,
   * in which case the request falls through to a window.
   */
  onOpenLocalTab?: (url: string) => boolean;
  /** A sandboxed Breadboard browser tab for an ordinary external web page. */
  onOpenExternalTab?: (url: string, background: boolean) => void;
}

export function hardenWebContents(
  contents: WebContents,
  allowed: AllowedOrigins,
  handlers: LocalOpenHandlers = {},
): void {
  const openExternal = (url: string, background: boolean) => {
    if (isSafeBrowserUrl(url) && handlers.onOpenExternalTab) {
      handlers.onOpenExternalTab(url, background);
      return;
    }
    void shell.openExternal(url);
  };
  contents.on("will-navigate", (event, targetUrl) => {
    if (isNavigationAllowed(allowed, targetUrl)) return;
    event.preventDefault();
    if (isSafeExternalUrl(targetUrl)) openExternal(targetUrl, false);
  });
  contents.setWindowOpenHandler(({ url, disposition }) => {
    // External http(s) URLs go to Breadboard's sandboxed browser when the page
    // belongs to a tab-capable window. Protocols such as mailto still belong to
    // the operating system. A local `target="_blank"` opens a new hardened
    // Breadboard window when a handler is provided (so features like the Work
    // timer get their own instance), otherwise it navigates in-window. A Ctrl-
    // or middle-click is Chromium's background-tab disposition.
    if (isSafeExternalUrl(url) && !isNavigationAllowed(allowed, url)) {
      openExternal(url, disposition === "background-tab");
    } else if (isNavigationAllowed(allowed, url)) {
      const inTab =
        disposition === "background-tab" && handlers.onOpenLocalTab?.(url) === true;
      if (!inTab) {
        if (handlers.onOpenLocalWindow) handlers.onOpenLocalWindow(url);
        else void contents.loadURL(url);
      }
    }
    return { action: "deny" };
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
}

export function hardenWindow(
  window: BrowserWindow,
  allowed: AllowedOrigins,
  onOpenLocalWindow?: (url: string) => void,
  onOpenLocalTab?: (url: string) => boolean,
  onOpenExternalTab?: (url: string, background: boolean) => void,
): void {
  hardenWebContents(window.webContents, allowed, {
    onOpenLocalWindow,
    onOpenLocalTab,
    onOpenExternalTab,
  });
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
      if (isExternalBrowserWebContents(contents.id)) return;
      if (!isNavigationAllowed(allowed, targetUrl)) event.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (isExternalBrowserWebContents(contents.id)) return { action: "deny" };
      if (isSafeExternalUrl(url) && !isNavigationAllowed(allowed, url)) {
        void shell.openExternal(url);
      }
      return { action: "deny" };
    });
  });
  hardenSession(session.defaultSession, allowed);
}
