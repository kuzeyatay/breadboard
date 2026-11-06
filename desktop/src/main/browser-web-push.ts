import { safeStorage, type WebContents } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "./runtime-config";
import { WebPushClient } from "./web-push-client";
import { WebPushWorker } from "./web-push-worker";
import { notificationOrigin } from "../shared/browser-preferences";

/** Owns the browser profile's subscriptions; private browsing never attaches here. */
export class BrowserWebPush {
  private readonly pages = new Set<WebContents>();
  private readonly worker = new WebPushWorker();
  private readonly client: WebPushClient;
  private storageError = false;
  constructor(directory: string, private readonly permission: (url: string) => NotificationPermission,
    log: (message: string) => void = () => {}, url?: string) {
    const file = path.join(directory, "browser-web-push.encrypted");
    const encryptionAvailable = () => safeStorage.isEncryptionAvailable() &&
      (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");
    this.client = new WebPushClient({ url, log,
      read: () => {
        try {
          if (!fs.existsSync(file)) return;
          if (!encryptionAvailable()) throw Error("Secure push storage is unavailable.");
          const state = JSON.parse(safeStorage.decryptString(Buffer.from(fs.readFileSync(file, "utf8"), "base64")));
          if (!Array.isArray(state.channels) || state.channels.length > 100 || !Array.isArray(state.received) ||
              state.channels.some((channel: any) => typeof channel.scope !== "string" || typeof channel.channelID !== "string" ||
                typeof channel.privateKey !== "string" || typeof channel.applicationServerKey !== "string" ||
                typeof channel.keys?.auth !== "string" || typeof channel.keys?.p256dh !== "string" || new URL(channel.endpoint).protocol !== "https:")) throw Error("Invalid push storage.");
          return state;
        } catch { this.storageError = true; log("Saved website push subscriptions could not be read; receiving is disabled until browser sign-ins are reset."); }
      },
      write: state => {
        if (this.storageError) throw Error("Saved website push subscriptions could not be read.");
        // Linux without a keyring can receive for this app session only.
        if (encryptionAvailable()) atomicWriteFile(file, safeStorage.encryptString(JSON.stringify(state)).toString("base64"));
      },
      allowed: scope => this.permission(scope) === "granted" && Boolean(this.page(scope)),
      deliver: async (scope, payload) => {
        const page = this.page(scope);
        if (!page || this.permission(scope) !== "granted") throw Error("The receiving website is unavailable.");
        await this.worker.deliver(page, scope, payload);
      },
      invalidated: () => {
        for (const page of this.pages) if (!page.isDestroyed()) page.send("breadboard:web-notification:push-reset");
      },
    });
  }
  private page(scope: string): WebContents | undefined {
    const origin = notificationOrigin(scope);
    const pages = [...this.pages].filter(page => !page.isDestroyed() && origin && notificationOrigin(page.getURL()) === origin);
    // A worker can register push from any page on its origin. ChatGPT's
    // /service-worker/ scope, for example, never controls its /c/ pages.
    return pages.find(page => page.getURL().startsWith(scope)) ?? pages[0];
  }
  attach(contents: WebContents): void {
    this.pages.add(contents);
    contents.on("did-finish-load", () => this.refresh());
    contents.once("destroyed", () => { this.pages.delete(contents); this.refresh(); });
  }
  refresh(): void {
    this.client.setActive([...this.pages].some(page => !page.isDestroyed() && this.permission(page.getURL()) === "granted"));
  }
  reset(): void { this.storageError = false; this.client.reset(); }
  async request(contents: WebContents, operation: unknown, scope: unknown, key: unknown): Promise<unknown> {
    try {
      if (this.storageError) throw new Error("Saved website push subscriptions could not be read. Reset browser sign-ins to recover.");
      if (!this.pages.has(contents) || contents.isDestroyed() || typeof scope !== "string" || scope.length > 4096 ||
          !notificationOrigin(scope) || notificationOrigin(scope) !== notificationOrigin(contents.getURL())) throw new DOMException("Invalid service worker scope.", "SecurityError");
      if (this.permission(scope) !== "granted") {
        if (operation === "get") return { value: null };
        throw new DOMException("Notifications are not allowed for this site.", "NotAllowedError");
      }
      if (operation === "get") { this.refresh(); return { value: this.client.get(scope) }; }
      if (operation === "unsubscribe") return { value: await this.client.unsubscribe(scope, typeof key === "string" ? key : undefined) };
      if (operation === "prepare-worker") { await this.worker.prepareEvent(contents, scope); return { value: true }; }
      if (operation !== "subscribe" || typeof key !== "string" || key.length > 100) throw new TypeError("Invalid push request.");
      // A forged scope must not create a push endpoint without a real worker.
      const registered = await contents.executeJavaScriptInIsolatedWorld(1001, [{
        // register() resolves while a new worker is still installing. Unlike
        // serviceWorker.ready, this also works outside the worker's scope.
        code: `(async () => {
          const registration = await navigator.serviceWorker.getRegistration(${JSON.stringify(scope)});
          if (registration?.scope !== ${JSON.stringify(scope)}) return false;
          for (const end = Date.now() + 10000; Date.now() < end;) {
            if (registration.active?.state === "activated") return true;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          return false;
        })()`,
      }]);
      if (!registered) throw new DOMException("The service worker registration is not active.", "InvalidStateError");
      if (contents.isDestroyed() || notificationOrigin(contents.getURL()) !== notificationOrigin(scope) ||
          this.permission(scope) !== "granted") throw new DOMException("The receiving website changed.", "NotAllowedError");
      return { value: await this.client.subscribe(scope, key) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Push operation failed.", name: error instanceof DOMException ? error.name : "AbortError" };
    }
  }
}
