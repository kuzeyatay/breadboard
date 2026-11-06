import type { WebContents } from "electron";

/** Runs in the site's existing worker, without Node, IPC, or cross-origin access. */
function installWorkerNotificationBridge() {
  const worker = globalThis as any;
  if (worker.__breadboardWorkerNotifications) return;
  worker.__breadboardWorkerNotifications = true;
  const scope: string = worker.registration.scope;
  const channel = "breadboard:service-worker-notifications";
  async function request(operation: string, value?: unknown): Promise<any> {
    const clients = (await worker.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .filter((client: any) => new URL(client.url).origin === worker.location.origin)
      .sort((a: any, b: any) => Number(b.url.startsWith(scope)) - Number(a.url.startsWith(scope)));
    let lastError: unknown;
    for (const client of clients) {
      try {
        return await new Promise((resolve, reject) => {
          const ports = new MessageChannel();
          const timer = setTimeout(() => { ports.port1.close(); reject(Error("Notification client timed out.")); }, 5000);
          ports.port1.onmessage = event => {
            clearTimeout(timer); ports.port1.close();
            event.data?.error ? reject(new DOMException(event.data.error, event.data.name ?? "OperationError")) : resolve(event.data?.value);
          };
          client.postMessage({ channel, scope, operation, value }, [ports.port2]);
        });
      } catch (error) { lastError = error; /* Another same-origin client may still be running. */ }
    }
    throw lastError ?? new Error("No notification client is available for this registration.");
  }
  const notification = (record: any) => {
    const notice = Object.assign(new EventTarget(), record);
    notice.close = () => { void request("close", { id: record.id }).catch(() => {}); };
    return notice;
  };
  const prototype = worker.ServiceWorkerRegistration.prototype;
  const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)).buffer;
  const encode = (value: ArrayBuffer | ArrayBufferView | string): string => {
    if (typeof value === "string") return value.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const bytes = ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
    if (bytes.length !== 65) throw new DOMException("Invalid application server key.", "InvalidAccessError");
    return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  };
  const push = (operation: string, key?: string) => request("push", { operation, key });
  class WorkerPushSubscription {
    readonly endpoint: string;
    readonly expirationTime = null;
    readonly options: { userVisibleOnly: true; applicationServerKey: ArrayBuffer };
    constructor(private readonly value: any) {
      this.endpoint = value.endpoint;
      this.options = { userVisibleOnly: true, applicationServerKey: decode(value.applicationServerKey) };
    }
    getKey(name: string): ArrayBuffer | null { return name === "auth" || name === "p256dh" ? decode(this.value.keys[name]) : null; }
    unsubscribe(): Promise<boolean> { return push("unsubscribe", this.endpoint); }
    toJSON() { return { endpoint: this.endpoint, expirationTime: null, keys: { ...this.value.keys } }; }
  }
  class WorkerPushManager {
    async getSubscription() {
      const value = await push("get");
      return value ? new WorkerPushSubscription(value) : null;
    }
    permissionState(): Promise<PermissionState> { return push("permission"); }
    async subscribe(options: PushSubscriptionOptionsInit = {}) {
      if (!options.userVisibleOnly) throw new DOMException("Push notifications must be user-visible.", "NotSupportedError");
      if (!options.applicationServerKey) throw new DOMException("An application server key is required.", "NotSupportedError");
      return new WorkerPushSubscription(await push("subscribe", encode(options.applicationServerKey)));
    }
  }
  Object.setPrototypeOf(WorkerPushManager.prototype, worker.PushManager.prototype);
  Object.setPrototypeOf(WorkerPushSubscription.prototype, worker.PushSubscription.prototype);
  const pushManager = new WorkerPushManager();
  const scopeGetter = Object.getOwnPropertyDescriptor(prototype, "scope")!.get!;
  Object.defineProperty(prototype, "pushManager", {
    configurable: true,
    get() {
      if (scopeGetter.call(this) !== scope) throw new DOMException("Invalid registration.", "SecurityError");
      return pushManager;
    },
  });
  prototype.getNotifications = async function (filter: unknown) {
    return (await request("get", filter)).map(notification);
  };
  prototype.showNotification = async function (title: string, options: unknown) {
    await request("show", { title, options });
  };
  worker.addEventListener("message", (event: any) => {
    if (event.data?.channel !== channel || event.data.scope !== scope || !event.source?.url ||
        new URL(event.source.url).origin !== worker.location.origin ||
        !["notificationclick", "notificationclose", "pushsubscriptionchange"].includes(event.data.operation)) return;
    const action = new Event(event.data.operation);
    const pending: Promise<unknown>[] = [];
    Object.defineProperties(action, {
      notification: { value: notification(event.data.value ?? {}) },
      action: { value: "" },
      waitUntil: { value: (promise: Promise<unknown>) => { pending.push(Promise.resolve(promise)); } },
    });
    worker.dispatchEvent(action);
    event.waitUntil(Promise.allSettled(pending));
  });
}

interface Registration { registrationId: string; scopeURL: string; isDeleted: boolean }
interface Version { registrationId: string; versionId: string; targetId?: string; status: string; runningStatus: string }
interface Connection { registrations: Map<string, Registration>; versions: Map<string, Version> }

/** Electron 33 exposes push dispatch via Chromium's protocol, but has no push transport. */
export class WebPushWorker {
  private readonly connections = new WeakMap<WebContents, Connection>();
  private readonly operations = new WeakMap<WebContents, Promise<unknown>>();
  private async connection(contents: WebContents): Promise<Connection> {
    let connection = this.connections.get(contents);
    if (connection) return connection;
    // Do not take an existing debugger connection from another feature.
    if (contents.debugger.isAttached()) throw new Error("The site's debugger is in use.");
    contents.debugger.attach("1.3");
    connection = { registrations: new Map(), versions: new Map() };
    this.connections.set(contents, connection);
    const state = connection;
    const message = (_event: Electron.Event, method: string, params: any) => {
      if (method === "ServiceWorker.workerRegistrationUpdated") {
        for (const item of params.registrations as Registration[]) {
          if (item.isDeleted) state.registrations.delete(item.scopeURL); else state.registrations.set(item.scopeURL, item);
        }
      }
      if (method === "ServiceWorker.workerVersionUpdated") for (const version of params.versions as Version[]) state.versions.set(version.versionId, version);
    };
    contents.debugger.on("message", message);
    contents.debugger.once("detach", () => { contents.debugger.removeListener("message", message); this.connections.delete(contents); });
    await contents.debugger.sendCommand("ServiceWorker.enable");
    return connection;
  }
  private async prepare(contents: WebContents, scope: string): Promise<string> {
    const state = await this.connection(contents);
    await contents.debugger.sendCommand("ServiceWorker.startWorker", { scopeURL: scope });
    for (const end = Date.now() + 5000; Date.now() < end;) {
      const registration = state.registrations.get(scope);
      const version = registration && [...state.versions.values()].find(item => item.registrationId === registration.registrationId && item.status === "activated" && item.runningStatus === "running" && item.targetId);
      if (registration && version?.targetId) {
        const attached = await contents.debugger.sendCommand("Target.attachToTarget", { targetId: version.targetId, flatten: true });
        try {
          const result = await contents.debugger.sendCommand("Runtime.evaluate", {
            expression: `(${installWorkerNotificationBridge.toString()})()`, awaitPromise: true,
          }, attached.sessionId);
          if (result.exceptionDetails) throw new Error("Could not initialize worker notifications.");
        } finally { await contents.debugger.sendCommand("Target.detachFromTarget", { sessionId: attached.sessionId }).catch(() => {}); }
        return registration.registrationId;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error("The site's service worker did not become ready.");
  }
  private run(contents: WebContents, scope: string, action: (registrationId: string) => Promise<void>): Promise<void> {
    const result = (this.operations.get(contents) ?? Promise.resolve()).catch(() => {}).then(async () => {
      try { await action(await this.prepare(contents, scope)); }
      finally {
        // Only own the debugger while dispatching; leave it available for the
        // site's developer tools and other browser features between pushes.
        if (this.connections.has(contents) && !contents.isDestroyed() && contents.debugger.isAttached()) contents.debugger.detach();
      }
    });
    this.operations.set(contents, result);
    return result;
  }
  prepareEvent(contents: WebContents, scope: string): Promise<void> { return this.run(contents, scope, async () => {}); }
  async deliver(contents: WebContents, scope: string, data: string): Promise<void> {
    return this.run(contents, scope, async registrationId => {
      await contents.debugger.sendCommand("ServiceWorker.deliverPushMessage", { origin: new URL(scope).origin, registrationId, data });
    });
  }
}
