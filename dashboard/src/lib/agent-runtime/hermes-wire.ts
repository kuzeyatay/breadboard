import { WebSocket } from "undici";
import type { RawHermesEvent } from "./hermes-events.ts";

interface HermesRpcError {
  code?: number;
  message?: string;
  data?: unknown;
}

interface HermesRpcFrame {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: RawHermesEvent;
  result?: unknown;
  error?: HermesRpcError;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface HermesRpcClientOptions {
  baseUrl: string;
  sessionToken: string;
  requestTimeoutMs: number;
}

export class HermesRpcErrorResponse extends Error {
  readonly code: number | undefined;
  readonly data?: unknown;

  constructor(
    code: number | undefined,
    message: string,
    data?: unknown,
  ) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

function websocketUrl(baseUrl: string, token: string): string {
  const url = new URL("/api/ws", `${baseUrl}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

function messageText(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data));
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  }
  return null;
}

/**
 * Small server-only JSON-RPC client for Hermes's loopback WebSocket gateway.
 * It deliberately exposes only request/response and session-filtered events;
 * the WebSocket URL and dashboard token never cross a Breadboard API route.
 */
export class HermesRpcClient {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private requestSequence = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<(event: RawHermesEvent) => void>();
  private readonly closeListeners = new Set<(error: Error) => void>();
  private readonly eventJournals = new Map<string, RawHermesEvent[]>();
  private readonly options: HermesRpcClientOptions;

  constructor(options: HermesRpcClientOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(
        websocketUrl(this.options.baseUrl, this.options.sessionToken),
      );
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new Error("Hermes gateway connection timed out."));
      }, Math.min(this.options.requestTimeoutMs, 15_000));

      const cleanupHandshake = () => {
        clearTimeout(timeout);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
      };
      const onOpen = () => {
        if (settled) return;
        settled = true;
        cleanupHandshake();
        this.socket = socket;
        resolve();
      };
      const onError = () => {
        if (settled) return;
        settled = true;
        cleanupHandshake();
        reject(new Error("Hermes gateway connection failed."));
      };

      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onError, { once: true });
      socket.addEventListener("message", (event) => {
        const text = messageText(event.data);
        if (text) this.handleFrame(text);
      });
      socket.addEventListener("close", () => {
        if (this.socket === socket) this.socket = null;
        const error = new Error("Hermes gateway connection closed.");
        this.rejectPending(error);
        for (const listener of this.closeListeners) listener(error);
      });
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  async request<T>(
    method: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    await this.connect();
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Hermes gateway is not connected.");
    }

    const id = `breadboard-${++this.requestSequence}`;
    return new Promise<T>((resolve, reject) => {
      let onAbort: (() => void) | undefined;
      const finish = () => {
        const pending = this.pending.get(id);
        if (pending?.timer) clearTimeout(pending.timer);
        this.pending.delete(id);
        if (onAbort && signal) signal.removeEventListener("abort", onAbort);
      };
      const pending: PendingRequest = {
        resolve: (value) => {
          finish();
          resolve(value as T);
        },
        reject: (error) => {
          finish();
          reject(error);
        },
      };
      pending.timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        finish();
        reject(new Error(`Hermes request timed out: ${method}`));
      }, this.options.requestTimeoutMs);
      if (signal) {
        onAbort = () => {
          if (!this.pending.has(id)) return;
          finish();
          reject(new DOMException("Aborted", "AbortError"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.pending.set(id, pending);
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  async *events(
    liveSessionId: string,
    signal?: AbortSignal,
    onConnected?: () => void,
  ): AsyncIterable<RawHermesEvent> {
    await this.connect();
    const queue: RawHermesEvent[] = [];
    let wake: (() => void) | null = null;
    let closedError: Error | null = null;
    const notify = () => {
      const current = wake;
      wake = null;
      current?.();
    };
    const onEvent = (event: RawHermesEvent) => {
      if (event.session_id && event.session_id !== liveSessionId) return;
      queue.push(event);
      notify();
    };
    const onClose = (error: Error) => {
      closedError = error;
      notify();
    };
    const onAbort = () => notify();
    queue.push(...(this.eventJournals.get(liveSessionId) ?? []));
    this.listeners.add(onEvent);
    this.closeListeners.add(onClose);
    signal?.addEventListener("abort", onAbort, { once: true });
    onConnected?.();

    try {
      while (!signal?.aborted) {
        const next = queue.shift();
        if (next) {
          yield next;
          continue;
        }
        if (closedError) throw closedError;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      this.listeners.delete(onEvent);
      this.closeListeners.delete(onClose);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  clearSession(liveSessionId: string): void {
    this.eventJournals.delete(liveSessionId);
  }

  private handleFrame(text: string): void {
    let frame: HermesRpcFrame;
    try {
      frame = JSON.parse(text) as HermesRpcFrame;
    } catch {
      return;
    }
    if (frame.id !== undefined && frame.id !== null) {
      const pending = this.pending.get(String(frame.id));
      if (!pending) return;
      if (frame.error) {
        pending.reject(
          new HermesRpcErrorResponse(
            frame.error.code,
            frame.error.message || "Hermes RPC failed.",
            frame.error.data,
          ),
        );
      } else {
        pending.resolve(frame.result);
      }
      return;
    }
    if (frame.method === "event" && frame.params?.type) {
      const sessionId = frame.params.session_id;
      if (sessionId) {
        const journal =
          frame.params.type === "message.start"
            ? []
            : this.eventJournals.get(sessionId) ?? [];
        journal.push(frame.params);
        if (journal.length > 2_048) {
          journal.splice(0, journal.length - 2_048);
        }
        this.eventJournals.set(sessionId, journal);
      }
      for (const listener of this.listeners) listener(frame.params);
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of [...this.pending.values()]) {
      pending.reject(error);
    }
  }
}
