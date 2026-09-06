// This sandboxed preload is deliberately independent of the product preload.
// Its four operations can only request permission, display, or close a notice.
import { contextBridge, ipcRenderer, webFrame } from "electron";

const notificationChannel = "breadboard:web-notification";
let cachedPermission: NotificationPermission = ipcRenderer.sendSync(`${notificationChannel}:permission`);
const notificationListeners = new Set<(value: { id: string; type: string }) => void>();
ipcRenderer.on(`${notificationChannel}:event`, (_event, value) => {
  if (value.type === "permissionchange" && ["default", "granted", "denied"].includes(value.permission)) cachedPermission = value.permission;
  for (const listener of notificationListeners) listener(value);
});
contextBridge.exposeInMainWorld("breadboardWebNotifications", {
  permission: () => cachedPermission,
  request: async () => { cachedPermission = await ipcRenderer.invoke(`${notificationChannel}:request`); return cachedPermission; },
  show: (value: unknown) => ipcRenderer.send(`${notificationChannel}:show`, value),
  close: (id: string) => ipcRenderer.send(`${notificationChannel}:close`, id),
  listen: (callback: (value: { id: string; type: string }) => void) => {
    notificationListeners.add(callback);
  },
});

function installWebNotifications() {
  const bridge = (window as unknown as { breadboardWebNotifications: {
    permission(): NotificationPermission; request(): Promise<NotificationPermission>;
    show(value: unknown): void; close(id: string): void;
    listen(callback: (event: { id: string; type: string }) => void): void;
  } }).breadboardWebNotifications;
  const notices = new Map<string, PageNotification>();
  let serial = 0;
  class PageNotificationPermission extends EventTarget {
    readonly name = "notifications";
    onchange: ((event: Event) => unknown) | null = null;
    get state(): PermissionState { const permission = bridge.permission(); return permission === "default" ? "prompt" : permission; }
    changed() { const event = new Event("change"); this.dispatchEvent(event); this.onchange?.call(this, event); }
  }
  const permissionStatus = new PageNotificationPermission();
  if (navigator.permissions) {
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = descriptor => descriptor?.name === "notifications"
      ? Promise.resolve(permissionStatus as PermissionStatus) : query(descriptor);
  }
  class PageNotification extends EventTarget {
    static get permission() { return bridge.permission(); }
    static get maxActions() { return 0; }
    static async requestPermission(callback?: (permission: NotificationPermission) => void) {
      const permission = await bridge.request();
      callback?.(permission);
      return permission;
    }
    readonly id = `${Date.now()}:${++serial}`;
    readonly title: string;
    readonly body: string;
    readonly tag: string;
    readonly icon: string;
    readonly data: unknown;
    readonly dir: NotificationDirection;
    readonly lang: string;
    readonly silent: boolean | null;
    readonly requireInteraction: boolean;
    onclick: ((event: Event) => unknown) | null = null;
    onclose: ((event: Event) => unknown) | null = null;
    onerror: ((event: Event) => unknown) | null = null;
    onshow: ((event: Event) => unknown) | null = null;
    constructor(title: string, options: NotificationOptions = {}) {
      super();
      this.title = String(title); this.body = String(options.body ?? ""); this.tag = String(options.tag ?? "");
      this.icon = String(options.icon ?? ""); this.data = options.data ?? null;
      this.dir = options.dir ?? "auto"; this.lang = options.lang ?? "";
      this.silent = options.silent ?? null; this.requireInteraction = options.requireInteraction ?? false;
      if (PageNotification.permission !== "granted") {
        setTimeout(() => this.emit("error"), 0);
        return;
      }
      notices.set(this.id, this);
      bridge.show({ id: this.id, title: this.title.slice(0, 256), body: this.body.slice(0, 8000), tag: this.tag.slice(0, 256) });
    }
    close() { bridge.close(this.id); }
    emit(type: string) {
      const event = new Event(type);
      this.dispatchEvent(event);
      const handler = this[`on${type}` as "onclick"];
      if (typeof handler === "function") handler.call(this, event);
    }
  }
  bridge.listen(({ id, type }) => {
    if (type === "permissionchange") { permissionStatus.changed(); return; }
    const notice = notices.get(id);
    if (type === "close" || type === "error") notices.delete(id);
    notice?.emit(type);
  });
  Object.defineProperty(window, "Notification", { value: PageNotification, configurable: true, writable: true });
}

void webFrame.executeJavaScript(`(${installWebNotifications.toString()})()`);
