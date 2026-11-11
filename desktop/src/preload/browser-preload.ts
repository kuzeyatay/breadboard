// This sandboxed preload is deliberately independent of the product preload.
// Its bridge handles web notices and the restored page's media interaction.
import { contextBridge, ipcRenderer, webFrame } from "electron";

/** Chromium's autoplay policy still permits muted video. Restored documents
 * must leave those players paused too until the person interacts with them. */
function installRestoredMediaPolicy() {
  const nativePlay = HTMLMediaElement.prototype.play;
  const allowed = () => navigator.userActivation.hasBeenActive;
  const suppressAutoplay = (node: Node) => {
    if (!(node instanceof Element)) return;
    if (node instanceof HTMLMediaElement) node.removeAttribute("autoplay");
    for (const media of Array.from(node.querySelectorAll("video[autoplay], audio[autoplay]"))) media.removeAttribute("autoplay");
  };
  // Remove declarative autoplay while the parser/site adds players, before
  // Chromium can start even a muted frame. The play listener is a fallback.
  const observer = new MutationObserver(records => {
    if (allowed()) { release(); return; }
    for (const record of records) {
      if (record.type === "attributes") suppressAutoplay(record.target);
      else for (const node of Array.from(record.addedNodes)) suppressAutoplay(node);
    }
  });
  const guardedPlay = function (this: HTMLMediaElement) {
    if (!allowed()) return Promise.reject(new DOMException(
      "Interact with the restored page before playing media.", "NotAllowedError",
    ));
    release();
    return nativePlay.call(this);
  };
  const pauseAutoplay = (event: Event) => {
    if (allowed()) { release(); return; }
    if (event.target instanceof HTMLMediaElement) event.target.pause();
  };
  const release = () => {
    observer.disconnect();
    if (HTMLMediaElement.prototype.play === guardedPlay) HTMLMediaElement.prototype.play = nativePlay;
    document.removeEventListener("play", pauseAutoplay, true);
    document.removeEventListener("playing", pauseAutoplay, true);
  };
  HTMLMediaElement.prototype.play = guardedPlay;
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["autoplay"] });
  if (document.documentElement) suppressAutoplay(document.documentElement);
  document.addEventListener("play", pauseAutoplay, true);
  document.addEventListener("playing", pauseAutoplay, true);
}

if (process.argv.includes("--breadboard-restored-media") &&
    ipcRenderer.sendSync("breadboard:restored-media-blocked")) {
  void webFrame.executeJavaScript(`(${installRestoredMediaPolicy.toString()})()`);
  const interacted = (event: Event) => {
    if (!event.isTrusted || !navigator.userActivation.hasBeenActive) return;
    ipcRenderer.send("breadboard:restored-media-interaction");
    for (const type of ["pointerdown", "pointerup", "keydown", "click"]) window.removeEventListener(type, interacted, true);
  };
  for (const type of ["pointerdown", "pointerup", "keydown", "click"]) window.addEventListener(type, interacted, true);
}

/** Electron allows script popups without Chromium's usual activation check.
 * Keep window.open synchronous (including OAuth's returned Window/opener), but
 * require a gesture when a script creates a new browsing context. */
function installScriptPopupPolicy() {
  const nativeOpen = window.open;
  const activation = navigator.userActivation;
  const namedWindows = new Map<string, Window>();
  window.open = function open(url?: string | URL, target?: string, features?: string) {
    const name = target === undefined ? "_blank" : String(target);
    const special = name.toLowerCase();
    const existing = namedWindows.get(name);
    const named = name !== "" && !["_blank", "_self", "_top", "_parent"].includes(special);
    const reusesContext = ["_self", "_top", "_parent"].includes(special) || (named && (
      name === window.name || (existing && !existing.closed) ||
      Array.from(document.querySelectorAll("iframe[name], frame[name]")).some(frame => frame.getAttribute("name") === name)
    ));
    if (!reusesContext && !activation.isActive) return null;
    const opened = nativeOpen.call(window, url, target, features);
    if (opened && named) namedWindows.set(name, opened);
    return opened;
  };
}

// Install before page scripts run, without synthesizing a user gesture.
void webFrame.executeJavaScript(`(${installScriptPopupPolicy.toString()})()`);

// Saved passwords. This runs in the preload's isolated world: it reads and
// fills login fields through the shared DOM, and page scripts never see the
// bridge or a stored password until the person focuses a login field.
function installPasswordManager() {
  if (window.top !== window) return;
  const isPassword = (node: unknown): node is HTMLInputElement =>
    node instanceof HTMLInputElement && node.type === "password";
  const isUsername = (node: unknown): node is HTMLInputElement =>
    node instanceof HTMLInputElement && ["text", "email", "tel", ""].includes(node.type) &&
    (/user|login|email|account|name|id/iu.test(`${node.name} ${node.id} ${node.autocomplete}`) || node.type === "email");
  const scope = (field: HTMLInputElement): ParentNode => field.form ?? document;
  const usernameFor = (password: HTMLInputElement) => {
    const inputs = Array.from(scope(password).querySelectorAll("input"));
    const before = inputs.slice(0, inputs.indexOf(password)).reverse();
    return before.find(isUsername) ?? before.find(input => ["text", "email"].includes(input.type) && input.value) ?? null;
  };
  const visiblePassword = (root: ParentNode) =>
    Array.from(root.querySelectorAll("input[type=password]")).find(input => (input as HTMLInputElement).offsetParent !== null) as HTMLInputElement | undefined;

  let lastSent = "";
  const capture = (root: ParentNode) => {
    const password = visiblePassword(root);
    if (!password?.value) return;
    // Sign-up and change-password forms have several password fields; save the last (new) one.
    const all = Array.from(root.querySelectorAll("input[type=password]")) as HTMLInputElement[];
    const value = all.length > 1 ? all[all.length - 1]!.value || password.value : password.value;
    const username = usernameFor(password)?.value ?? "";
    const key = `${username}\u0000${value}`;
    if (key === lastSent) return;
    lastSent = key;
    ipcRenderer.send("breadboard:web-password:submitted", username, value);
  };
  document.addEventListener("submit", event => capture(event.target as HTMLFormElement), true);
  // Script-driven logins rarely submit a form: also treat Enter in a password
  // field or a click on the form's button as the sign-in.
  document.addEventListener("keydown", event => {
    if (event.key === "Enter" && isPassword(event.target)) capture(scope(event.target));
  }, true);
  document.addEventListener("click", event => {
    const button = (event.target as Element | null)?.closest?.("button, input[type=submit], [role=button]");
    if (!button) return;
    const root = (button as HTMLButtonElement).form ?? button.closest("form") ?? document;
    if (visiblePassword(root)) capture(root);
  }, true);

  // First page of a two-step sign-in: only a username, the password comes later.
  document.addEventListener("change", event => {
    const field = event.target;
    if (isUsername(field) && field.value && !visiblePassword(scope(field))) {
      ipcRenderer.send("breadboard:web-password:username", field.value);
    }
  }, true);

  let saved: Promise<Array<{ username: string; password: string }>> | null = null;
  const setValue = (input: HTMLInputElement, value: string) => {
    if (input.value === value) return;
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  document.addEventListener("focusin", event => {
    const field = event.target;
    if (!isPassword(field) && !isUsername(field)) return;
    const password = isPassword(field) ? field : visiblePassword(scope(field as HTMLInputElement));
    if (!password || password.value) return;
    saved ??= ipcRenderer.invoke("breadboard:web-password:get").catch(() => []);
    void saved.then(credentials => {
      if (!credentials.length || password.value) return;
      const username = usernameFor(password);
      // ponytail: fills the typed-username match or the first sign-in; no chooser for several accounts.
      const match = credentials.find(item => username?.value && item.username === username.value) ?? credentials[0]!;
      if (username && !username.value && match.username) setValue(username, match.username);
      setValue(password, match.password);
      (field as HTMLInputElement).focus();
    });
  }, true);
}
installPasswordManager();

// Electron never implemented window.prompt(); answer it like Chrome does.
contextBridge.exposeInMainWorld("breadboardWebDialogs", {
  prompt: (message: unknown, value: unknown): string | null =>
    ipcRenderer.sendSync("breadboard:web-dialog:prompt", String(message ?? ""), String(value ?? "")),
});
void webFrame.executeJavaScript(`(${(() => {
  const bridge = (window as unknown as { breadboardWebDialogs: { prompt(message: string, value: string): string | null } }).breadboardWebDialogs;
  window.prompt = function prompt(message?: string, value?: string) {
    return bridge.prompt(message === undefined ? "" : String(message), value === undefined ? "" : String(value));
  };
}).toString()})()`);

const notificationChannel = "breadboard:web-notification";
let cachedPermission: NotificationPermission = ipcRenderer.sendSync(`${notificationChannel}:permission`);
let backgroundNotificationPage = ipcRenderer.sendSync(`${notificationChannel}:background`) === true;
const notificationListeners = new Set<(value: { id: string; type: string }) => void>();
ipcRenderer.on(`${notificationChannel}:push-reset`, () => {
  for (const listener of notificationListeners) listener({ id: "", type: "push-reset" });
});
ipcRenderer.on(`${notificationChannel}:event`, (_event, value) => {
  if (value.type === "backgroundchange") backgroundNotificationPage = value.background === true;
  if (value.type === "permissionchange" && ["default", "granted", "denied"].includes(value.permission)) cachedPermission = value.permission;
  for (const listener of notificationListeners) listener(value);
});
contextBridge.exposeInMainWorld("breadboardWebNotifications", {
  permission: () => cachedPermission,
  background: () => backgroundNotificationPage,
  mediaPermission: (kind: "microphone" | "camera") => ipcRenderer.invoke(`${notificationChannel}:media-permission`, kind),
  request: async () => { cachedPermission = await ipcRenderer.invoke(`${notificationChannel}:request`); return cachedPermission; },
  show: (value: unknown) => ipcRenderer.send(`${notificationChannel}:show`, value),
  close: (id: string) => ipcRenderer.send(`${notificationChannel}:close`, id),
  push: (operation: string, scope: string, key?: string) => ipcRenderer.invoke(`${notificationChannel}:push`, operation, scope, key),
  listen: (callback: (value: { id: string; type: string }) => void) => {
    notificationListeners.add(callback);
  },
});

function installWebNotifications() {
  const bridge = (window as unknown as { breadboardWebNotifications: {
    permission(): NotificationPermission; request(): Promise<NotificationPermission>;
    background(): boolean;
    mediaPermission(kind: "microphone" | "camera"): Promise<NotificationPermission>;
    show(value: unknown): void; close(id: string): void;
    listen(callback: (event: { id: string; type: string; background?: boolean; media?: { microphone: NotificationPermission; camera: NotificationPermission } }) => void): void;
  } }).breadboardWebNotifications;
  const notices = new Map<string, PageNotification>();
  // Closing an opted-in tab keeps its network connection, not its microphone,
  // camera or playback. Also stop streams whose permission promise resolves
  // after the tab was closed.
  const tracks = new Set<MediaStreamTrack>();
  if (navigator.mediaDevices) {
    for (const name of ["getUserMedia", "getDisplayMedia"] as const) {
      const acquire = navigator.mediaDevices[name]?.bind(navigator.mediaDevices);
      if (!acquire) continue;
      navigator.mediaDevices[name] = async options => {
        if (bridge.background()) throw new DOMException("The website tab is closed.", "NotAllowedError");
        const stream = await acquire(options);
        if (bridge.background()) {
          stream.getTracks().forEach(track => track.stop());
          throw new DOMException("The website tab is closed.", "NotAllowedError");
        }
        for (const track of stream.getTracks()) {
          tracks.add(track);
          track.addEventListener("ended", () => tracks.delete(track), { once: true });
        }
        return stream;
      };
    }
  }
  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    return bridge.background() ? Promise.reject(new DOMException("The website tab is closed.", "NotAllowedError")) : nativePlay.call(this);
  };
  let serial = 0;
  class PageNotificationPermission extends EventTarget {
    readonly name = "notifications";
    onchange: ((event: Event) => unknown) | null = null;
    get state(): PermissionState { const permission = bridge.permission(); return permission === "default" ? "prompt" : permission; }
    changed() { const event = new Event("change"); this.dispatchEvent(event); this.onchange?.call(this, event); }
  }
  const permissionStatus = new PageNotificationPermission();
  class PageMediaPermission extends EventTarget {
    onchange: ((event: Event) => unknown) | null = null;
    constructor(readonly name: "microphone" | "camera", public state: PermissionState) { super(); }
    update(permission: NotificationPermission) {
      const next = permission === "default" ? "prompt" : permission;
      if (next === this.state) return;
      this.state = next;
      const event = new Event("change");
      this.dispatchEvent(event); this.onchange?.call(this, event);
    }
  }
  const mediaStatuses = new Map<"microphone" | "camera", PageMediaPermission>();
  if (navigator.permissions) {
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = async descriptor => {
      if (descriptor?.name === "notifications") return permissionStatus as PermissionStatus;
      if ((descriptor?.name === "microphone" || descriptor?.name === "camera") &&
          !(descriptor as PermissionDescriptor & { panTiltZoom?: boolean }).panTiltZoom) {
        const kind = descriptor.name;
        const permission = await bridge.mediaPermission(kind);
        let status = mediaStatuses.get(kind);
        if (!status) {
          status = new PageMediaPermission(kind, permission === "default" ? "prompt" : permission);
          mediaStatuses.set(kind, status);
        } else status.update(permission);
        return status as PermissionStatus;
      }
      return query(descriptor);
    };
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
  bridge.listen(({ id, type, media, background }) => {
    if (type === "backgroundchange") {
      if (background) {
        for (const track of tracks) track.stop();
        tracks.clear();
        document.querySelectorAll("video, audio").forEach(element => (element as HTMLMediaElement).pause());
      }
      return;
    }
    if (type === "permissionchange") {
      permissionStatus.changed();
      if (media) for (const [kind, status] of mediaStatuses) status.update(media[kind]);
      return;
    }
    const notice = notices.get(id);
    if (type === "close" || type === "error") notices.delete(id);
    notice?.emit(type);
  });
  Object.defineProperty(window, "Notification", { value: PageNotification, configurable: true, writable: true });
}

/** Electron 33 does not implement Chromium's persistent notification store.
 * Apps such as Snapchat await getNotifications before showNotification, so
 * leaving either native method in place can stall their entire delivery path.
 * Closed opted-in pages are retained by TabManager, giving these registrations
 * the same lifetime and click/close delivery as ordinary website notices. */
function installServiceWorkerNotifications() {
  if (typeof ServiceWorkerRegistration === "undefined") return;
  const prototype = ServiceWorkerRegistration.prototype;
  const installed = Symbol.for("breadboard.serviceWorkerNotifications");
  if ((prototype as unknown as Record<symbol, boolean>)[installed]) return;
  Object.defineProperty(prototype, installed, { value: true });
  const registrations = new Map<string, Set<Notification>>();
  const scopeGetter = Object.getOwnPropertyDescriptor(prototype, "scope")!.get!;
  const activeGetter = Object.getOwnPropertyDescriptor(prototype, "active")!.get!;
  const channel = "breadboard:service-worker-notifications";
  const snapshot = (notice: Notification) => ({
    id: (notice as Notification & { id: string }).id,
    title: notice.title, body: notice.body, tag: notice.tag, data: notice.data,
    icon: notice.icon, dir: notice.dir, lang: notice.lang, silent: notice.silent,
    requireInteraction: notice.requireInteraction,
  });
  navigator.serviceWorker.addEventListener("message", event => {
    if (event.data?.channel !== channel || !event.ports[0] || typeof event.data.scope !== "string") return;
    const port = event.ports[0];
    void (async () => {
      const { scope, operation, value } = event.data;
      if (new URL(scope).origin !== location.origin) throw new DOMException("Invalid scope.", "SecurityError");
      const registration = await navigator.serviceWorker.getRegistration(scope);
      if (!registration || registration.scope !== scope || event.source !== registration.active) throw new DOMException("Invalid worker.", "SecurityError");
      if (operation === "push") {
        // Workers use the same transport/subscription as their page, including
        // SDKs that inspect or renew a subscription while handling a push.
        if (value?.operation === "permission") return registration.pushManager.permissionState();
        if (!["get", "subscribe", "unsubscribe"].includes(value?.operation)) throw new TypeError("Unknown push operation.");
        const result = await (window as any).breadboardWebNotifications.push(value.operation, scope, value.key);
        if (result.error) throw new DOMException(result.error, result.name ?? "AbortError");
        return result.value;
      }
      if (operation === "get") return (await registration.getNotifications(value)).map(snapshot);
      if (operation === "show") return registration.showNotification(value.title, value.options);
      if (operation === "close") {
        for (const notice of registrations.get(scope) ?? []) if ((notice as Notification & { id: string }).id === value?.id) notice.close();
        return;
      }
      throw new TypeError("Unknown notification operation.");
    })().then(value => { port.postMessage({ value }); port.close(); }, error => {
      port.postMessage({ error: error instanceof Error ? error.message : "Notification operation failed.", name: error?.name }); port.close();
    });
  });

  Object.defineProperty(prototype, "getNotifications", {
    configurable: true, writable: true,
    value: async function (this: ServiceWorkerRegistration, filter: GetNotificationOptions = {}): Promise<Notification[]> {
      const scope = scopeGetter.call(this) as string;
      return [...registrations.get(scope) ?? []].filter(notice => !filter.tag || notice.tag === String(filter.tag));
    },
  });
  Object.defineProperty(prototype, "showNotification", {
    configurable: true, writable: true,
    value: async function (this: ServiceWorkerRegistration, title: string, options: NotificationOptions = {}): Promise<void> {
      const scope = scopeGetter.call(this) as string;
      if (Notification.permission !== "granted") throw new TypeError("Notifications are not allowed for this site.");
      if (!activeGetter.call(this)) throw new TypeError("The service worker registration has no active worker.");
      // Keep Maps, Sets and other structured notification data intact. Snapchat
      // reads this back when grouping incoming messages and replacing call alerts.
      const data = structuredClone(options.data ?? null);
      const tag = String(options.tag ?? "");
      let notices = registrations.get(scope);
      if (!notices) { notices = new Set(); registrations.set(scope, notices); }
      for (const old of notices) if (tag && old.tag === tag) old.close();
      const notice = new Notification(String(title), { ...options, data, tag });
      notice.addEventListener("click", () => {
        const bridge = (window as any).breadboardWebNotifications;
        // Idle workers may have stopped since the push arrived. Prepare the
        // restarted worker before forwarding its notification interaction.
        void bridge.push("prepare-worker", scope).then((result: { error?: string }) => {
          if (result.error) return;
          const worker = activeGetter.call(this) as ServiceWorker | null;
          worker?.postMessage({ channel, scope, operation: "notificationclick", value: snapshot(notice) });
        }).catch(() => {});
      });
      notices.add(notice);
      const remove = () => { notices!.delete(notice); };
      const close = notice.close.bind(notice);
      notice.close = () => { remove(); close(); };
      notice.addEventListener("close", remove, { once: true });
      notice.addEventListener("error", remove, { once: true });
      // Settle only after the native owner accepts or rejects the card. Sites
      // can then query/replace it without racing an unacknowledged IPC send.
      await new Promise<void>((resolve, reject) => {
        notice.addEventListener("show", () => resolve(), { once: true });
        notice.addEventListener("error", () => reject(new Error("The notification could not be delivered.")), { once: true });
      });
    },
  });
}

/** Replace the absent native push transport while retaining the site's worker. */
function installWebPush() {
  if (typeof ServiceWorkerRegistration === "undefined" || typeof PushManager === "undefined") return;
  const bridge = (window as unknown as { breadboardWebNotifications: {
    permission(): NotificationPermission; request(): Promise<NotificationPermission>;
    push(operation: string, scope: string, key?: string): Promise<{ value?: any; error?: string; name?: string }>;
    listen(callback: (event: { type: string }) => void): void;
  } }).breadboardWebNotifications;
  const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), character => character.charCodeAt(0)).buffer;
  const encode = (value: ArrayBuffer | ArrayBufferView | string): string => {
    if (typeof value === "string") return value.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const bytes = ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
    if (bytes.length !== 65) throw new DOMException("Invalid application server key.", "InvalidAccessError");
    return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  };
  async function request(operation: string, scope: string, key?: string): Promise<any> {
    const result = await bridge.push(operation, scope, key);
    if (result.error) throw new DOMException(result.error, result.name ?? "AbortError");
    return result.value;
  }
  class SitePushSubscription {
    readonly endpoint: string;
    readonly expirationTime = null;
    readonly options: { userVisibleOnly: true; applicationServerKey: ArrayBuffer };
    constructor(private readonly scope: string, private readonly value: any) {
      this.endpoint = value.endpoint;
      this.options = { userVisibleOnly: true, applicationServerKey: decode(value.applicationServerKey) };
    }
    getKey(name: string): ArrayBuffer | null { return name === "auth" || name === "p256dh" ? decode(this.value.keys[name]) : null; }
    unsubscribe(): Promise<boolean> { return request("unsubscribe", this.scope, this.endpoint); }
    toJSON() { return { endpoint: this.endpoint, expirationTime: null, keys: { ...this.value.keys } }; }
  }
  const scopeGetter = Object.getOwnPropertyDescriptor(ServiceWorkerRegistration.prototype, "scope")!.get!;
  const managers = new WeakMap<ServiceWorkerRegistration, SitePushManager>();
  class SitePushManager {
    constructor(private readonly registration: ServiceWorkerRegistration) {}
    private get scope(): string { return scopeGetter.call(this.registration); }
    async getSubscription(): Promise<PushSubscription | null> {
      if (bridge.permission() !== "granted") return null;
      const value = await request("get", this.scope);
      return value ? new SitePushSubscription(this.scope, value) as PushSubscription : null;
    }
    async permissionState(): Promise<PermissionState> {
      const permission = bridge.permission(); return permission === "default" ? "prompt" : permission;
    }
    async subscribe(options: PushSubscriptionOptionsInit = {}): Promise<PushSubscription> {
      if (!options.userVisibleOnly) throw new DOMException("Push notifications must be user-visible.", "NotSupportedError");
      if (!options.applicationServerKey) throw new DOMException("An application server key is required.", "NotSupportedError");
      const key = encode(options.applicationServerKey);
      if (bridge.permission() === "default") await bridge.request();
      if (bridge.permission() !== "granted") throw new DOMException("Notifications are not allowed.", "NotAllowedError");
      return new SitePushSubscription(this.scope, await request("subscribe", this.scope, key)) as PushSubscription;
    }
  }
  Object.setPrototypeOf(SitePushManager.prototype, PushManager.prototype);
  Object.setPrototypeOf(SitePushSubscription.prototype, PushSubscription.prototype);
  Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", {
    configurable: true,
    get(this: ServiceWorkerRegistration) {
      scopeGetter.call(this);
      let manager = managers.get(this);
      if (!manager) { manager = new SitePushManager(this); managers.set(this, manager); }
      return manager;
    },
  });
  bridge.listen(event => {
    if (event.type !== "push-reset") return;
    void navigator.serviceWorker.getRegistrations().then(registrations => {
      for (const registration of registrations) registration.active?.postMessage({
        channel: "breadboard:service-worker-notifications", scope: registration.scope, operation: "pushsubscriptionchange",
      });
    });
  });
}

void webFrame.executeJavaScript(`(${installWebNotifications.toString()})(); (${installServiceWorkerNotifications.toString()})(); (${installWebPush.toString()})()`);
