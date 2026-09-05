import { dialog, type BrowserWindow, type Session, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { notificationOrigin } from "../shared/browser-preferences";
import type { DesktopNotificationToast } from "../shared/ipc-contract";
import type { BrowserPreferenceStore } from "./browser-preferences";

const CHANNEL = "breadboard:web-notification";
interface Notice {
  id: string; localId: string; origin: string; tag: string; contents: WebContents; documentUrl: string;
}

/** Narrow web-only IPC. No website receives the authenticated product bridge. */
export class BrowserNotifications {
  private readonly pages = new Set<WebContents>();
  private readonly sessions = new WeakSet<Session>();
  private readonly prompts = new Map<string, Promise<NotificationPermission>>();
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
    target.setPermissionCheckHandler((contents, permission, origin) => permission === "notifications" &&
      // Worker checks can lack webContents; persisted grants still apply.
      (!contents || this.pages.has(contents)) && this.preferences.permission(origin) === "granted");
    target.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (permission !== "notifications" || !this.pages.has(contents) || details.isMainFrame === false) return callback(false);
      void this.request(contents, details.requestingUrl || contents.getURL()).then(value => callback(value === "granted"), () => callback(false));
    });
  }

  private async request(contents: WebContents, url: string): Promise<NotificationPermission> {
    const origin = notificationOrigin(url);
    if (!origin || contents.isDestroyed() || notificationOrigin(contents.getURL()) !== origin) return "denied";
    const permission = this.preferences.permission(origin);
    if (permission !== "default") return permission;
    const pending = this.prompts.get(origin);
    if (pending) return pending;
    const window = this.owner(contents);
    if (!window || window.isDestroyed() || this.prompts.size >= 3) return "default";
    const prompt = (async (): Promise<NotificationPermission> => {
      const result = await dialog.showMessageBox(window, {
        type: "question", title: "Website notifications", message: `${origin} wants to send notifications`,
        detail: "Notifications will appear with your Breadboard notifications. You can change this in Browser settings.",
        buttons: ["Allow", "Block", "Not now"], defaultId: 2, cancelId: 2, noLink: true,
      });
      if (contents.isDestroyed() || notificationOrigin(contents.getURL()) !== origin) return "default";
      // A settings change while the prompt was open takes precedence.
      if (this.preferences.permission(origin) !== "default") return this.preferences.permission(origin);
      if (result.response === 2) return "default";
      const permission = result.response === 0 ? "granted" : "denied";
      if (!this.preferences.update({ type: "browser-notification-permission", origin, permission })) return "default";
      this.preferencesChanged();
      return permission;
    })().finally(() => this.prompts.delete(origin));
    this.prompts.set(origin, prompt);
    return prompt;
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
      const notice: Notice = { id: randomUUID(), localId: input.id, origin, tag: input.tag, contents, documentUrl: contents.getURL() };
      this.notices.set(notice.id, notice);
      if (this.publish(contents, { type: "success", title: `${origin} · ${input.title}`.slice(0, 256), message: input.body || input.title || origin, website: { id: notice.id, origin } })) {
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
    const clear = () => { for (const notice of this.notices.values()) if (notice.contents === contents) this.close(notice); };
    contents.on("did-start-navigation", (_event, _url, inPlace, isMainFrame) => { if (isMainFrame && !inPlace) clear(); });
    contents.once("destroyed", () => { clear(); this.pages.delete(contents); });
  }

  preferencesChanged(): void {
    for (const notice of this.notices.values()) if (this.preferences.permission(notice.origin) !== "granted") this.close(notice);
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
