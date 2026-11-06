import { createECDH, ECDH, randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";

const ece = require("http_ece") as { decrypt(data: Buffer, options: Record<string, unknown>): Buffer };
export const WEB_PUSH_URL = "wss://push.services.mozilla.com/";
export interface WebPushSubscription {
  endpoint: string;
  expirationTime: null;
  keys: { p256dh: string; auth: string };
  applicationServerKey: string;
}
interface Channel extends WebPushSubscription { scope: string; channelID: string; privateKey: string }
export interface WebPushState { uaid?: string; channels: Channel[]; received: string[] }
interface Options {
  url?: string;
  read(): WebPushState | undefined;
  write(state: WebPushState): void;
  allowed(scope: string): boolean;
  deliver(scope: string, payload: string): Promise<void>;
  invalidated?(): void;
  log?(message: string): void;
}

/** A Web Push user agent. Payloads remain encrypted until they reach this process. */
export class WebPushClient {
  private state: WebPushState;
  private socket?: WebSocket;
  private ready?: Promise<void>;
  private connected = false;
  private active = false;
  private reconnect?: NodeJS.Timeout;
  private heartbeat?: NodeJS.Timeout;
  private retries = 0;
  private readonly pending = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private readonly subscribing = new Map<string, Promise<WebPushSubscription>>();
  private deliveries = Promise.resolve();
  constructor(private readonly options: Options) {
    this.state = options.read() ?? { channels: [], received: [] };
  }
  private save(): void { this.options.write(this.state); }
  private public(channel: Channel): WebPushSubscription {
    return { endpoint: channel.endpoint, expirationTime: null, keys: { ...channel.keys }, applicationServerKey: channel.applicationServerKey };
  }
  get(scope: string): WebPushSubscription | null {
    const channel = this.state.channels.find(item => item.scope === scope);
    return channel ? this.public(channel) : null;
  }
  setActive(active: boolean): void {
    this.active = active;
    if (!active) { this.disconnect(); return; }
    if (this.state.channels.some(item => this.options.allowed(item.scope))) void this.connect().catch(() => {});
    else if (!this.subscribing.size) this.disconnect();
  }
  async subscribe(scope: string, key: string): Promise<WebPushSubscription> {
    const bytes = Buffer.from(key, "base64url");
    try {
      if (bytes.length !== 65 || bytes[0] !== 4) throw Error();
      ECDH.convertKey(bytes, "prime256v1");
    } catch { throw new DOMException("Invalid application server key.", "InvalidAccessError"); }
    if (!this.options.allowed(scope)) throw new DOMException("Notifications are not allowed for this site.", "NotAllowedError");
    const existing = this.get(scope);
    if (existing) {
      if (existing.applicationServerKey !== key) throw new DOMException("Unsubscribe before changing the application server key.", "InvalidStateError");
      return existing;
    }
    const pending = this.subscribing.get(scope);
    if (pending) {
      const value = await pending;
      if (value.applicationServerKey !== key) throw new DOMException("A different subscription already exists.", "InvalidStateError");
      return value;
    }
    if (this.state.channels.length + this.subscribing.size >= 100) throw new DOMException("Too many push subscriptions.", "QuotaExceededError");
    const operation = this.createSubscription(scope, key);
    this.subscribing.set(scope, operation);
    try { return await operation; } finally { this.subscribing.delete(scope); }
  }
  private async createSubscription(scope: string, key: string): Promise<WebPushSubscription> {
    await this.connect();
    const channelID = randomUUID();
    const result = await this.request("register", channelID, { key });
    if (result.status !== 200 || typeof result.pushEndpoint !== "string" ||
        new URL(result.pushEndpoint).protocol !== "https:") throw new Error("Push registration failed.");
    if (!this.options.allowed(scope)) {
      void this.request("unregister", channelID, { code: 200 }).catch(() => {});
      throw new DOMException("Notifications are no longer allowed.", "NotAllowedError");
    }
    const pair = createECDH("prime256v1"); pair.generateKeys();
    const channel: Channel = { channelID, scope, applicationServerKey: key, endpoint: result.pushEndpoint,
      expirationTime: null, privateKey: pair.getPrivateKey().toString("base64url"),
      keys: { p256dh: pair.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
    this.state.channels.push(channel);
    try { this.save(); } catch (error) {
      this.state.channels = this.state.channels.filter(item => item !== channel);
      void this.request("unregister", channelID, { code: 200 }).catch(() => {});
      throw error;
    }
    return this.public(channel);
  }
  async unsubscribe(scope: string, endpoint?: string): Promise<boolean> {
    const channel = this.state.channels.find(item => item.scope === scope);
    if (!channel || (endpoint && channel.endpoint !== endpoint)) return false;
    this.state.channels = this.state.channels.filter(item => item !== channel);
    this.save();
    if (this.connected) await this.request("unregister", channel.channelID, { code: 200 }).catch(() => {});
    return true;
  }
  reset(): void {
    for (const channel of this.state.channels) if (this.connected) this.socket?.send(JSON.stringify({ messageType: "unregister", channelID: channel.channelID, code: 200 }));
    this.state = { channels: [], received: [] }; this.save(); this.disconnect();
  }
  private disconnect(): void {
    clearTimeout(this.reconnect); clearInterval(this.heartbeat);
    this.reconnect = undefined; this.heartbeat = undefined;
    const socket = this.socket; this.socket = undefined; this.ready = undefined; this.connected = false;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error("Push connection closed.")); }
    this.pending.clear(); socket?.terminate();
  }
  private connect(): Promise<void> {
    if (this.ready) return this.ready;
    clearTimeout(this.reconnect);
    this.active = true;
    const socket = new WebSocket(this.options.url ?? WEB_PUSH_URL, { handshakeTimeout: 10000, maxPayload: 256 * 1024 });
    this.socket = socket;
    this.ready = new Promise<void>((resolve, reject) => {
      let alive = true;
      socket.on("pong", () => { alive = true; });
      const timeout = setTimeout(() => { reject(new Error("Push connection timed out.")); socket.terminate(); }, 15000);
      socket.on("open", () => socket.send(JSON.stringify({ messageType: "hello", use_webpush: true,
        ...(this.state.uaid ? { uaid: this.state.uaid } : {}), channelIDs: this.state.channels.map(item => item.channelID) })));
      socket.on("error", () => { /* close below rejects and reconnects without logging credentials */ });
      socket.on("close", () => {
        clearTimeout(timeout); reject(new Error("Push service disconnected."));
        if (this.socket !== socket) return;
        this.disconnect();
        if (this.active && (this.subscribing.size || this.state.channels.some(item => this.options.allowed(item.scope)))) {
          this.reconnect = setTimeout(() => { void this.connect().catch(() => {}); }, Math.min(60000, 1000 * 2 ** Math.min(6, this.retries++)));
          this.reconnect.unref();
        }
      });
      socket.on("message", raw => {
        if (this.socket !== socket) return;
        let message: any;
        try { message = JSON.parse(raw.toString()); } catch { socket.terminate(); return; }
        if (message.messageType === "hello") {
          if (message.status !== 200 || typeof message.uaid !== "string") { socket.terminate(); return; }
          const invalidated = this.state.uaid && this.state.uaid !== message.uaid;
          if (invalidated) { this.state.channels = []; this.state.received = []; }
          this.state.uaid = message.uaid;
          try { this.save(); } catch { socket.terminate(); return; }
          clearTimeout(timeout); this.connected = true; this.retries = 0;
          this.heartbeat = setInterval(() => {
            // A dead connection must reconnect so queued notifications can arrive.
            if (!alive) { socket.terminate(); return; }
            alive = false;
            if (socket.readyState === WebSocket.OPEN) socket.ping();
          }, 60000); this.heartbeat.unref();
          resolve(); if (invalidated) this.options.invalidated?.();
        } else if (message.messageType === "notification") {
          this.deliveries = this.deliveries.then(() => this.receive(message, socket)).catch(() => {
            this.options.log?.("Website push delivery will retry after reconnecting."); socket.terminate();
          });
        } else {
          const key = `${message.messageType}:${message.channelID}`;
          const pending = this.pending.get(key);
          if (pending) { clearTimeout(pending.timer); this.pending.delete(key); pending.resolve(message); }
        }
      });
    });
    return this.ready;
  }
  private request(type: string, channelID: string, args: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) return reject(new Error("Push service is disconnected."));
      const key = `${type}:${channelID}`;
      const timer = setTimeout(() => { this.pending.delete(key); reject(new Error("Push request timed out.")); }, 10000);
      this.pending.set(key, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ messageType: type, channelID, ...args }));
    });
  }
  private async receive(message: any, socket: WebSocket): Promise<void> {
    if (typeof message.channelID !== "string" || typeof message.version !== "string") return;
    const channel = this.state.channels.find(item => item.channelID === message.channelID);
    const receivedId = `${message.channelID}:${message.version}`;
    let code = 100;
    if (!channel || !this.options.allowed(channel.scope)) code = 102;
    else if (!this.state.received.includes(receivedId)) {
      let payload: string;
      try {
        if (!message.data) payload = "";
        else {
          if (typeof message.data !== "string" || message.data.length > 128 * 1024) throw Error();
          const version = message.headers?.encoding;
          if (version !== "aes128gcm" && version !== "aesgcm") throw Error();
          const pair = createECDH("prime256v1"); pair.setPrivateKey(Buffer.from(channel.privateKey, "base64url"));
          const parameter = (header: unknown, name: string) => typeof header === "string"
            ? new RegExp(`(?:^|[;,]\\s*)${name}=\"?([^\";,\\s]+)`).exec(header)?.[1] : undefined;
          payload = ece.decrypt(Buffer.from(message.data, "base64url"), { version, privateKey: pair,
            authSecret: Buffer.from(channel.keys.auth, "base64url"),
            ...(version === "aesgcm" ? { salt: parameter(message.headers.encryption, "salt"), dh: parameter(message.headers.crypto_key ?? message.headers["crypto-key"], "dh") } : {}),
          }).toString("utf8");
        }
      } catch { code = 101; payload = ""; }
      if (code === 100) {
        await this.options.deliver(channel.scope, payload);
        this.state.received.push(receivedId); this.state.received = this.state.received.slice(-256); this.save();
      }
    }
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ messageType: "ack", updates: [{ channelID: message.channelID, version: message.version, code }] }));
  }
}
