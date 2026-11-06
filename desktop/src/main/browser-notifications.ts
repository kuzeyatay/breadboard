import type { BrowserWindow, Session, WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { isBrowserMediaPermission, notificationOrigin, type BrowserMediaPermission } from "../shared/browser-preferences";
import type { DesktopNotificationToast } from "../shared/ipc-contract";
import type { BrowserPreferenceStore } from "./browser-preferences";
import { isSafeBrowserUrl } from "./security";
import type { BrowserWebPush } from "./browser-web-push";

const CHANNEL = "breadboard:web-notification";
interface Notice {
  id: string; localId: string; origin: string; tag: string; contents: WebContents;
}
interface PermissionPrompt {
  id: string;
  key: string;
  origin: string;
  media?: BrowserMediaPermission[];
  requestedMedia?: BrowserMediaPermission[];
  contents: WebContents;
  window: BrowserWindow;
  promise: Promise<NotificationPermission>;
  resolve: (permission: NotificationPermission) => void;
}

/** Narrow web-only IPC. No website receives the authenticated product bridge. */
export class BrowserNotifications {
  private readonly pages = new Set<WebContents>();
  private readonly backgroundPages = new WeakSet<WebContents>();
  /** Pages lent the microphone outside the ordinary prompt: ChatGPT voice. */
  private readonly microphonePages = new Map<WebContents, string>();
  private readonly sessions = new WeakSet<Session>();
  private readonly prompts = new Map<string, PermissionPrompt>();
  private readonly notices = new Map<string, Notice>();
  constructor(
    private readonly preferences: BrowserPreferenceStore,
    private readonly owner: (contents: WebContents) => BrowserWindow | undefined,
    private readonly publish: (contents: WebContents, notice: DesktopNotificationToast) => boolean,
    private readonly activate: (contents: WebContents) => void,
    private readonly changed: () => void,
    private readonly webPush?: BrowserWebPush,
  ) {}

  installSession(target: Session): void {
    if (this.sessions.has(target)) return;
    this.sessions.add(target);
    target.setPermissionCheckHandler((contents, permission, origin, details) => {
      if (permission === "media" && details.mediaType === "audio" && this.lentMicrophone(contents, origin)) return true;
      if (permission === "media") {
        const kind = details.mediaType === "audio" ? "microphone" : details.mediaType === "video" ? "camera" : null;
        // A microphone grant never implies camera access or an unspecified grant.
        return Boolean(kind && this.isMediaRequest(contents, origin) &&
          (!details.securityOrigin || this.isMediaRequest(contents, details.securityOrigin)) &&
          (!details.requestingUrl || this.isMediaRequest(contents, details.requestingUrl)) &&
          this.preferences.mediaPermission(origin, kind) === "granted");
      }
      if (permission === "clipboard-sanitized-write" || permission === "fullscreen") {
        return this.isWebPageRequest(contents, details.requestingUrl || origin);
      }
      return permission === "notifications" &&
        // Worker checks can lack webContents; persisted grants still apply.
        (!contents || this.pages.has(contents)) && this.preferences.permission(origin) === "granted";
    });
    target.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (permission === "media") {
        const url = details.requestingUrl;
        const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
        if (mediaTypes?.length && mediaTypes.every(kind => kind === "audio") && this.lentMicrophone(contents, url)) {
          return callback(true);
        }
        if (!this.isMediaRequest(contents, url) || !mediaTypes?.length ||
            mediaTypes.some(kind => kind !== "audio" && kind !== "video")) return callback(false);
        const media: BrowserMediaPermission[] = [];
        if (mediaTypes.includes("audio")) media.push("microphone");
        if (mediaTypes.includes("video")) media.push("camera");
        void this.request(contents, url, media).then(value => callback(value === "granted"), () => callback(false));
        return;
      }
      if (permission === "clipboard-sanitized-write" || permission === "fullscreen") {
        return callback(this.isWebPageRequest(contents, details.requestingUrl || contents.getURL()));
      }
      if (permission !== "notifications" || !this.pages.has(contents) || details.isMainFrame === false) return callback(false);
      void this.request(contents, details.requestingUrl || contents.getURL()).then(value => callback(value === "granted"), () => callback(false));
    });
  }

  /**
   * Let one page use the microphone without the person's prompt, or take it
   * back. Only for a page Breadboard itself drives and only while it asks:
   * the ChatGPT page during a voice conversation.
   */
  allowMicrophone(contents: WebContents, origin: string, allowed: boolean): void {
    if (!allowed || contents.isDestroyed()) {
      this.microphonePages.delete(contents);
      return;
    }
    if (!this.microphonePages.has(contents)) {
      contents.once("destroyed", () => this.microphonePages.delete(contents));
    }
    this.microphonePages.set(contents, origin);
  }

  private lentMicrophone(contents: WebContents | null, url: string | undefined): boolean {
    if (!contents || contents.isDestroyed()) return false;
    const origin = this.microphonePages.get(contents);
    return Boolean(origin && url && notificationOrigin(url) === origin && notificationOrigin(contents.getURL()) === origin);
  }

  private isWebPageRequest(contents: WebContents | null, requestingUrl: string): boolean {
    // Chromium still enforces user activation and iframe permissions policy for
    // fullscreen and clipboard writes. Other permissions remain denied by default.
    return Boolean(contents && this.pages.has(contents) && !this.backgroundPages.has(contents) && !contents.isDestroyed() &&
      isSafeBrowserUrl(contents.getURL()) && isSafeBrowserUrl(requestingUrl));
  }

  private isMediaRequest(contents: WebContents | null, url: string): boolean {
    const origin = notificationOrigin(url);
    // Same-origin frames follow the site's choice. A third-party frame cannot
    // borrow its embedding site's grant; Chromium also enforces Permissions Policy.
    return Boolean(origin && contents && this.pages.has(contents) && !this.backgroundPages.has(contents) && !contents.isDestroyed() &&
      notificationOrigin(contents.getURL()) === origin);
  }

  private permission(origin: string, media?: BrowserMediaPermission[]): NotificationPermission {
    if (!media) return this.preferences.permission(origin);
    const choices = media.map(kind => this.preferences.mediaPermission(origin, kind));
    return choices.includes("denied") ? "denied" : choices.every(choice => choice === "granted") ? "granted" : "default";
  }

  private async request(contents: WebContents, url: string, media?: BrowserMediaPermission[]): Promise<NotificationPermission> {
    const origin = notificationOrigin(url);
    if (!origin || contents.isDestroyed() || notificationOrigin(contents.getURL()) !== origin) return "denied";
    const permission = this.permission(origin, media);
    if (this.backgroundPages.has(contents)) return media ? "denied" : permission;
    if (permission !== "default") return permission;
    const key = `${contents.id}:${origin}:${media?.join(",") ?? "notifications"}`;
    const pending = this.prompts.get(key);
    if (pending) return pending.promise;
    const window = this.owner(contents);
    if (!window || window.isDestroyed() || this.prompts.size >= 3) return "default";
    let resolve!: PermissionPrompt["resolve"];
    const promise = new Promise<NotificationPermission>(settle => { resolve = settle; });
    // Only ask about devices that do not already have a saved choice.
    const requestedMedia = media?.filter(kind => this.preferences.mediaPermission(origin, kind) === "default");
    const prompt: PermissionPrompt = { id: randomUUID(), key, origin, media, requestedMedia, contents, window, promise, resolve };
    this.prompts.set(key, prompt);
    const devices = requestedMedia?.join(" and ");
    if (!this.publish(contents, {
      type: "success", title: devices ? `Allow ${devices}?` : "Allow notifications?",
      message: devices ? `This site wants to use your ${devices}. You can change this in Browser settings.`
        : "This site wants to send notifications. You can change this in Browser settings.",
      notificationPermission: { id: prompt.id, origin, ...(requestedMedia ? { media: requestedMedia } : {}) },
    })) this.settlePrompt(prompt, "default");
    return promise;
  }

  respondToPermission(id: string, permission: NotificationPermission, window: BrowserWindow): boolean {
    const prompt = [...this.prompts.values()].find(prompt => prompt.id === id);
    if (!prompt || prompt.window !== window || this.owner(prompt.contents) !== window) return false;
    this.settlePrompt(prompt, permission);
    return true;
  }

  private settlePrompt(prompt: PermissionPrompt, choice: NotificationPermission, cancelled = false): void {
    if (this.prompts.get(prompt.key) !== prompt) return;
    this.prompts.delete(prompt.key);
    const { contents, origin, media } = prompt;
    let permission: NotificationPermission = "default";
    let saved = false;
    if (!cancelled && !contents.isDestroyed() && this.owner(contents) === prompt.window &&
        notificationOrigin(contents.getURL()) === origin) {
      // Settings changed while this card was open take precedence.
      permission = this.permission(origin, media);
      if (permission === "default" && choice !== "default") {
        saved = this.preferences.update(media
          ? { type: "browser-media-permission", origin, media: prompt.requestedMedia!.filter(kind => this.preferences.mediaPermission(origin, kind) === "default"), permission: choice }
          : { type: "browser-notification-permission", origin, permission: choice });
        if (saved) permission = this.permission(origin, media);
      }
    }
    this.publish(contents, {
      type: "success", message: "Dismissed", dismissed: true,
      notificationPermission: { id: prompt.id, origin },
    });
    prompt.resolve(permission);
    if (saved) this.preferencesChanged();
  }

  attach(contents: WebContents): void {
    this.pages.add(contents);
    this.webPush?.attach(contents);
    const mainFrame = (event: { senderFrame: Electron.WebFrameMain | null }) => event.senderFrame === contents.mainFrame;
    contents.ipc.on(`${CHANNEL}:permission`, event => {
      event.returnValue = mainFrame(event) ? this.preferences.permission(event.senderFrame?.url || contents.getURL()) : "denied";
    });
    contents.ipc.on(`${CHANNEL}:background`, event => {
      event.returnValue = !mainFrame(event) || this.backgroundPages.has(contents);
    });
    contents.ipc.handle(`${CHANNEL}:request`, event => mainFrame(event) ? this.request(contents, event.senderFrame?.url || contents.getURL()) : "denied");
    contents.ipc.handle(`${CHANNEL}:push`, (event, operation: unknown, scope: unknown, key: unknown) =>
      mainFrame(event) && this.webPush ? this.webPush.request(contents, operation, scope, key)
        : { error: "Push is unavailable in this context.", name: "NotAllowedError" });
    // Electron's check handler is boolean, so Chromium reports an undecided
    // device as denied. Expose the real three-state choice without granting access.
    contents.ipc.handle(`${CHANNEL}:media-permission`, (event, kind: unknown) =>
      mainFrame(event) && !this.backgroundPages.has(contents) && isBrowserMediaPermission(kind)
        ? this.preferences.mediaPermission(event.senderFrame?.url || contents.getURL(), kind) : "denied");
    contents.ipc.on(`${CHANNEL}:show`, (event, value: unknown) => {
      if (!mainFrame(event) || !value || typeof value !== "object") return;
      const input = value as Record<string, unknown>;
      const origin = notificationOrigin(event.senderFrame?.url);
      if (!origin || this.preferences.permission(origin) !== "granted" ||
          typeof input.id !== "string" || input.id.length > 100 || typeof input.title !== "string" || input.title.length > 256 ||
          typeof input.body !== "string" || input.body.length > 8000 || typeof input.tag !== "string" || input.tag.length > 256) return;
      const existing = [...this.notices.values()].find(notice => notice.origin === origin && input.tag && notice.tag === input.tag);
      if (existing) this.close(existing);
      // Bound one site's visible cards and memory, including a page spamming tags.
      const own = [...this.notices.values()].filter(notice => notice.origin === origin);
      if (own.length >= 5) this.close(own[0]!);
      if (this.notices.size >= 50) this.close(this.notices.values().next().value!);
      const notice: Notice = { id: randomUUID(), localId: input.id, origin, tag: input.tag, contents };
      this.notices.set(notice.id, notice);
      if (this.publish(contents, { type: "success", title: input.title, message: input.body || input.title || origin, website: { id: notice.id, origin } })) {
        contents.send(`${CHANNEL}:event`, { id: notice.localId, type: "show" });
      } else {
        this.notices.delete(notice.id);
        contents.send(`${CHANNEL}:event`, { id: notice.localId, type: "error" });
      }
    });
    contents.ipc.on(`${CHANNEL}:close`, (event, localId: unknown) => {
      if (!mainFrame(event) || typeof localId !== "string") return;
      for (const notice of this.notices.values()) if (notice.contents === contents && notice.localId === localId) this.close(notice);
    });
    const clear = () => this.clearForPage(contents);
    contents.on("did-start-navigation", (_event, _url, inPlace, isMainFrame) => { if (isMainFrame && !inPlace) clear(); });
    contents.on("render-process-gone", clear);
    contents.once("destroyed", () => { clear(); this.pages.delete(contents); });
  }

  /** A closed site may receive notices, but cannot keep devices or prompt. */
  setBackground(contents: WebContents, background: boolean): void {
    if (background) {
      this.backgroundPages.add(contents);
      for (const prompt of this.prompts.values()) {
        if (prompt.contents === contents) this.settlePrompt(prompt, "default", true);
      }
    } else this.backgroundPages.delete(contents);
    if (!contents.isDestroyed()) contents.send(`${CHANNEL}:event`, { id: "", type: "backgroundchange", background });
  }

  /** Dismiss while the page still has an owning overlay, before tab teardown. */
  clearForPage(contents: WebContents): void {
    for (const prompt of this.prompts.values()) if (prompt.contents === contents) this.settlePrompt(prompt, "default", true);
    for (const notice of this.notices.values()) if (notice.contents === contents) this.close(notice);
  }

  preferencesChanged(): void {
    this.webPush?.refresh();
    for (const prompt of this.prompts.values()) {
      if (this.permission(prompt.origin, prompt.media) !== "default") this.settlePrompt(prompt, "default");
    }
    for (const notice of this.notices.values()) if (this.preferences.permission(notice.origin) !== "granted") this.close(notice);
    for (const contents of this.pages) if (!contents.isDestroyed()) contents.send(`${CHANNEL}:event`, {
      id: "", type: "permissionchange", permission: this.preferences.permission(contents.getURL()),
      media: { microphone: this.preferences.mediaPermission(contents.getURL(), "microphone"), camera: this.preferences.mediaPermission(contents.getURL(), "camera") },
    });
    this.changed();
  }

  resetPushSubscriptions(): void { this.webPush?.reset(); }

  action(id: string, action: "click" | "close", window: BrowserWindow): boolean {
    const notice = this.notices.get(id);
    if (!notice || this.owner(notice.contents) !== window) return false;
    if (action === "click" && !notice.contents.isDestroyed() && this.preferences.permission(notice.origin) === "granted") {
      this.activate(notice.contents);
      notice.contents.send(`${CHANNEL}:event`, { id: notice.localId, type: "click" });
    }
    this.close(notice);
    return true;
  }

  private close(notice: Notice): void {
    this.notices.delete(notice.id);
    this.publish(notice.contents, { type: "success", message: "Dismissed", website: { id: notice.id, origin: notice.origin }, dismissed: true });
    if (!notice.contents.isDestroyed()) notice.contents.send(`${CHANNEL}:event`, { id: notice.localId, type: "close" });
  }
}
