import type { BrowserWindow, Session, WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { notificationOrigin } from "../shared/browser-preferences";
import type { DesktopNotificationToast } from "../shared/ipc-contract";
import type { BrowserPreferenceStore } from "./browser-preferences";
import { isSafeBrowserUrl } from "./security";

const CHANNEL = "breadboard:web-notification";
interface Notice {
  id: string; localId: string; origin: string; tag: string; contents: WebContents;
}
interface PermissionPrompt {
  id: string;
  origin: string;
  contents: WebContents;
  window: BrowserWindow;
  promise: Promise<NotificationPermission>;
  resolve: (permission: NotificationPermission) => void;
}

/** Narrow web-only IPC. No website receives the authenticated product bridge. */
export class BrowserNotifications {
  private readonly pages = new Set<WebContents>();
  private readonly sessions = new WeakSet<Session>();
  private readonly prompts = new Map<string, PermissionPrompt>();
  private readonly notices = new Map<string, Notice>();
  constructor(
    private readonly preferences: BrowserPreferenceStore,
    private readonly owner: (contents: WebContents) => BrowserWindow | undefined,
    private readonly publish: (contents: WebContents, notice: DesktopNotificationToast) => boolean,
    private readonly activate: (contents: WebContents) => void,
    private readonly changed: () => void,
  ) {}

  installSession(target: Session): void {
    if (this.sessions.has(target)) return;
    this.sessions.add(target);
    target.setPermissionCheckHandler((contents, permission, origin, details) => {
      if (permission === "clipboard-sanitized-write" || permission === "fullscreen") {
        return this.isWebPageRequest(contents, details.requestingUrl || origin);
      }
      return permission === "notifications" &&
        // Worker checks can lack webContents; persisted grants still apply.
        (!contents || this.pages.has(contents)) && this.preferences.permission(origin) === "granted";
    });
    target.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (permission === "clipboard-sanitized-write" || permission === "fullscreen") {
        return callback(this.isWebPageRequest(contents, details.requestingUrl || contents.getURL()));
      }
      if (permission !== "notifications" || !this.pages.has(contents) || details.isMainFrame === false) return callback(false);
      void this.request(contents, details.requestingUrl || contents.getURL()).then(value => callback(value === "granted"), () => callback(false));
    });
  }

  private isWebPageRequest(contents: WebContents | null, requestingUrl: string): boolean {
    // Chromium still enforces user activation and iframe permissions policy for
    // fullscreen and clipboard writes. Other permissions remain denied by default.
    return Boolean(contents && this.pages.has(contents) && !contents.isDestroyed() &&
      isSafeBrowserUrl(contents.getURL()) && isSafeBrowserUrl(requestingUrl));
  }

  private async request(contents: WebContents, url: string): Promise<NotificationPermission> {
    const origin = notificationOrigin(url);
    if (!origin || contents.isDestroyed() || notificationOrigin(contents.getURL()) !== origin) return "denied";
    const permission = this.preferences.permission(origin);
    if (permission !== "default") return permission;
    const pending = this.prompts.get(origin);
    if (pending) return pending.promise;
    const window = this.owner(contents);
    if (!window || window.isDestroyed() || this.prompts.size >= 3) return "default";
    let resolve!: PermissionPrompt["resolve"];
    const promise = new Promise<NotificationPermission>(settle => { resolve = settle; });
    const prompt: PermissionPrompt = { id: randomUUID(), origin, contents, window, promise, resolve };
    this.prompts.set(origin, prompt);
    if (!this.publish(contents, {
      type: "success", title: "Allow notifications?",
      message: "This site wants to send notifications. You can change this in Browser settings.",
      notificationPermission: { id: prompt.id, origin },
    })) this.settlePrompt(prompt, "default");
    return promise;
  }

  respondToPermission(id: string, permission: NotificationPermission, window: BrowserWindow): boolean {
    const prompt = [...this.prompts.values()].find(prompt => prompt.id === id);
    if (!prompt || prompt.window !== window || this.owner(prompt.contents) !== window) return false;
    this.settlePrompt(prompt, permission);
    return true;
  }

  private settlePrompt(prompt: PermissionPrompt, choice: NotificationPermission): void {
    if (this.prompts.get(prompt.origin) !== prompt) return;
    this.prompts.delete(prompt.origin);
    const { contents, origin } = prompt;
    let permission: NotificationPermission = "default";
    let saved = false;
    if (!contents.isDestroyed() && this.owner(contents) === prompt.window &&
        notificationOrigin(contents.getURL()) === origin) {
      // Settings changed while this card was open take precedence.
      permission = this.preferences.permission(origin);
      if (permission === "default" && choice !== "default") {
        saved = this.preferences.update({ type: "browser-notification-permission", origin, permission: choice });
        if (saved) permission = choice;
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
    const mainFrame = (event: { senderFrame: Electron.WebFrameMain | null }) => event.senderFrame === contents.mainFrame;
    contents.ipc.on(`${CHANNEL}:permission`, event => {
      event.returnValue = mainFrame(event) ? this.preferences.permission(event.senderFrame?.url || contents.getURL()) : "denied";
    });
    contents.ipc.handle(`${CHANNEL}:request`, event => mainFrame(event) ? this.request(contents, event.senderFrame?.url || contents.getURL()) : "denied");
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

  /** Dismiss while the page still has an owning overlay, before tab teardown. */
  clearForPage(contents: WebContents): void {
    for (const prompt of this.prompts.values()) if (prompt.contents === contents) this.settlePrompt(prompt, "default");
    for (const notice of this.notices.values()) if (notice.contents === contents) this.close(notice);
  }

  preferencesChanged(): void {
    for (const prompt of this.prompts.values()) {
      if (this.preferences.permission(prompt.origin) !== "default") this.settlePrompt(prompt, "default");
    }
    for (const notice of this.notices.values()) if (this.preferences.permission(notice.origin) !== "granted") this.close(notice);
    for (const contents of this.pages) if (!contents.isDestroyed()) contents.send(`${CHANNEL}:event`, {
      id: "", type: "permissionchange", permission: this.preferences.permission(contents.getURL()),
    });
    this.changed();
  }

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
