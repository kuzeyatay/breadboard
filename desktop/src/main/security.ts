import {
  app,
  BrowserWindow as ElectronBrowserWindow,
  dialog,
  shell,
  session,
  type BrowserWindow,
  type Event as ElectronEvent,
  type HandlerDetails,
  type Session,
  type WebContents,
  type WindowOpenHandlerResponse,
} from "electron";
import {
  confirmOpenApp, handleBeforeUnload, handleBluetoothPicker, handleBrowserLogin, handleBrowserPrompt,
  handleCertificateErrors, installScreenSharePicker, isAppLaunchUrl,
} from "./browser-dialogs";

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
 * browser page is the one deliberate exception: it has a narrow notification
 * preload, no Node integration, a separate session, and its own http(s)-only guard.
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

/** A file the page built in memory (URL.createObjectURL / data URI). */
export function isInPageFileUrl(targetUrl: string): boolean {
  return /^(?:blob|data):/iu.test(targetUrl);
}

export interface ExternalBrowserHandlers {
  /** Install the browser profile's notification and clipboard-write policy. */
  configurePermissions?: (session: Session) => void;
  onOpenWindow: (details: HandlerDetails) => WindowOpenHandlerResponse;
  /** Saved sign-ins for this page; omitted for private and automation pages. */
  passwords?: { attach(contents: WebContents): void };
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
      // Script-built files (Angular/FileSaver "Download" buttons) open or
      // navigate to a blob:/data: URL. Never render it in the page; hand it to
      // the download manager like Chrome and Firefox effectively do.
      if (isInPageFileUrl(targetUrl)) contents.downloadURL(targetUrl);
      // zoommtg:, msteams:, mailto: ... ask, then open the desktop app.
      else if (isAppLaunchUrl(targetUrl)) void confirmOpenApp(contents, targetUrl);
    }
  };
  handleBrowserLogin(contents);
  handleBrowserPrompt(contents);
  handleCertificateErrors(contents);
  handleBeforeUnload(contents);
  handleBluetoothPicker(contents);
  handlers.passwords?.attach(contents);
  contents.on("will-navigate", guardWebUrl);
  contents.on("will-redirect", guardWebUrl);
  contents.setWindowOpenHandler((details) => {
    // Auth providers also open an empty named window before assigning its URL.
    // Preserve Chromium's Window/opener relationship instead of opening an
    // unrelated URL and reporting the popup as blocked to the calling page.
    if (isSafeBrowserUrl(details.url) || details.url === "about:blank") {
      return handlers.onOpenWindow(details);
    }
    if (isInPageFileUrl(details.url)) contents.downloadURL(details.url);
    else if (isAppLaunchUrl(details.url)) void confirmOpenApp(contents, details.url);
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
  embedderUrl: string | undefined = requestingUrl,
): boolean {
  // Fullscreen is judged by the page, not the frame: an embedded player
  // (YouTube's iframe in a chat message) requests it from its own origin,
  // and the page only reaches it there by delegating allow="fullscreen".
  // Every other permission stays with the requesting frame.
  const judgedUrl = permission === "fullscreen" ? embedderUrl : requestingUrl;
  if (!judgedUrl) return false;
  let origin: string;
  try {
    origin = new URL(judgedUrl).origin;
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
   * A tab beside the page that asked. Ordinary links select the new tab;
   * Ctrl- and middle-clicks keep it in the background. Returns false when
   * tabs are switched off, so the request falls through to a window.
   */
  onOpenLocalTab?: (url: string, background: boolean) => boolean;
  /** A sandboxed Breadboard browser tab for an ordinary external web page. */
  onOpenExternalTab?: (url: string, background: boolean) => void;
}

export function hardenWebContents(
  contents: WebContents,
  allowed: AllowedOrigins,
  handlers: LocalOpenHandlers = {},
): void {
  const openExternal = (url: string, background: boolean) => {
    // The account-linking flow returns through a localhost callback. Start
    // it in the system browser so federated sign-in uses that browser session.
    const target = new URL(url);
    // Google Drive's consent page (organization file sharing) returns the same
    // way, and Google refuses OAuth inside an embedded browser anyway.
    const accountLogin = !target.username && !target.password && (
      (target.origin === "https://auth.openai.com" && target.pathname === "/oauth/authorize") ||
      // Both OAuth endpoints: CLIProxy's Google sign-ins use either, and the
      // v1 one used to open in the embedded browser, which Google refuses.
      (target.origin === "https://accounts.google.com" && /^\/o\/oauth2\/(?:v2\/)?auth\/?$/.test(target.pathname)));
    if (!accountLogin && isSafeBrowserUrl(url) && handlers.onOpenExternalTab) {
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
  contents.setWindowOpenHandler(({ url, disposition, features = "" }) => {
    // External http(s) URLs go to Breadboard's sandboxed browser when the page
    // belongs to a tab-capable window. Protocols such as mailto still belong to
    // the operating system. Local blank-target links and window.open requests
    // use managed tabs too, unless an explicit popup asks for its own window.
    // A Ctrl- or middle-click is Chromium's background-tab disposition.
    if (isSafeExternalUrl(url) && !isNavigationAllowed(allowed, url)) {
      openExternal(url, disposition === "background-tab");
    } else if (isNavigationAllowed(allowed, url)) {
      const explicitWindow = /(?:^|,)\s*popup(?:\s*=\s*(?:1|yes|true))?\s*(?:,|$)/i.test(features);
      const inTab = !explicitWindow && handlers.onOpenLocalTab?.(url, disposition === "background-tab") === true;
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
  onOpenLocalTab?: (url: string, background: boolean) => boolean,
  onOpenExternalTab?: (url: string, background: boolean) => void,
): void {
  hardenWebContents(window.webContents, allowed, {
    onOpenLocalWindow,
    onOpenLocalTab,
    onOpenExternalTab,
  });
}

/**
 * Voice mode can let the assistant see the camera. The microphone grant above
 * stays audio-only; the camera is a separate, explicit grant: an owned page
 * asking for video, answered by the person in a native dialog (never by the
 * page itself), and remembered only until the app quits.
 */
export function isRendererCameraRequest(
  allowed: AllowedOrigins,
  permission: string,
  requestingUrl: string | undefined,
  mediaTypes: readonly string[],
): boolean {
  if (permission !== "media" || !mediaTypes.includes("video")) return false;
  if (!mediaTypes.every((type) => type === "audio" || type === "video")) return false;
  try {
    return Boolean(requestingUrl) && allowed.origins.has(new URL(requestingUrl!).origin);
  } catch {
    return false;
  }
}

/** getDisplayMedia's pre-check carries no device types; its picker is the consent. */
export function isRendererDisplayMediaRequest(
  allowed: AllowedOrigins,
  permission: string,
  requestingUrl: string | undefined,
  mediaTypes: readonly string[] | undefined,
): boolean {
  if (permission !== "media" || !mediaTypes || mediaTypes.length) return false;
  try {
    return Boolean(requestingUrl) && allowed.origins.has(new URL(requestingUrl!).origin);
  } catch {
    return false;
  }
}

let cameraGrantedThisRun = false;
let cameraPrompt: Promise<boolean> | null = null;

function askForCamera(webContents: WebContents): Promise<boolean> {
  if (cameraGrantedThisRun) return Promise.resolve(true);
  const owner = ElectronBrowserWindow.fromWebContents(webContents);
  const options: Electron.MessageBoxOptions = {
    type: "question",
    buttons: ["Allow camera", "Don't allow"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    message: "Let Breadboard's voice mode see your camera?",
    detail: "While the camera is on in voice mode, a still from it is sent with each thing you say. You can turn it off from voice mode at any time; Breadboard asks again after it restarts.",
  };
  cameraPrompt ??= (owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options)).then((answer) => {
    cameraGrantedThisRun = answer.response === 0;
    return cameraGrantedThisRun;
  }, () => false).finally(() => { cameraPrompt = null; });
  return cameraPrompt;
}

export function hardenSession(targetSession: Session, allowed: AllowedOrigins): void {
  const ownedPage = (contents: WebContents) => {
    try { return allowed.origins.has(new URL(contents.getURL()).origin); } catch { return false; }
  };
  installScreenSharePicker(targetSession, ownedPage);
  targetSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) => {
      const mediaTypes =
        permission === "media" && details.mediaType ? [details.mediaType] : [];
      const url = details.requestingUrl ?? details.securityOrigin ?? requestingOrigin;
      if (cameraGrantedThisRun && isRendererCameraRequest(allowed, permission, url, mediaTypes)) return true;
      return isRendererPermissionAllowed(
        allowed,
        permission,
        details.requestingUrl ?? details.securityOrigin ?? requestingOrigin,
        mediaTypes,
        Boolean(
          _webContents &&
            themeLocationAllowedWebContents.has(_webContents.id),
        ),
        _webContents?.getURL() || details.embeddingOrigin,
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
    const url = details.requestingUrl || securityOrigin || webContents.getURL();
    if (isRendererDisplayMediaRequest(allowed, permission, url, permission === "media" && "mediaTypes" in details ? details.mediaTypes : undefined)) {
      return callback(true);
    }
    if (isRendererCameraRequest(allowed, permission, url, mediaTypes)) {
      void askForCamera(webContents).then(callback, () => callback(false));
      return;
    }
    callback(
      isRendererPermissionAllowed(
        allowed,
        permission,
        details.requestingUrl || securityOrigin || webContents.getURL(),
        mediaTypes,
        themeLocationAllowedWebContents.has(webContents.id),
        webContents.getURL(),
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
