// A server-owned event pump outlives any one browser SSE connection. Route
// handlers attach lightweight viewers to it; navigating away only removes that
// viewer while the upstream runtime stream keeps running and being persisted.

export interface DetachedEventPumpSink {
  emit(chunk: Uint8Array): void;
  markConnected(): void;
  close(): void;
}

type Subscriber = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  signal: AbortSignal;
  onAbort: () => void;
};

type DrivePump = (sink: DetachedEventPumpSink) => Promise<void>;

class DetachedEventPump {
  readonly key: string;
  private readonly drive: DrivePump;
  private readonly chunks: Uint8Array[] = [];
  private readonly subscribers = new Set<Subscriber>();
  private connected = false;
  private closed = false;
  private started = false;

  constructor(key: string, drive: DrivePump) {
    this.key = key;
    this.drive = drive;
  }

  start(onSettled: () => void): void {
    if (this.started) return;
    this.started = true;
    void this.drive({
      emit: (chunk) => this.emit(chunk),
      markConnected: () => this.markConnected(),
      close: () => this.close(),
    })
      .catch(() => {
        // The runtime-specific driver emits and audits its own error before it
        // settles. This guard still guarantees that attached responses close.
      })
      .finally(() => {
        this.close();
        onSettled();
      });
  }

  response(
    signal: AbortSignal,
    extraHeaders: Record<string, string>,
  ): Response {
    let subscriber: Subscriber | null = null;
    const readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const onAbort = () => {
          if (subscriber) this.detach(subscriber);
        };
        subscriber = { controller, signal, onAbort };

        if (this.connected) {
          controller.enqueue(new TextEncoder().encode(": connected\n\n"));
        }
        for (const chunk of this.chunks) controller.enqueue(chunk);

        if (this.closed) {
          controller.close();
          subscriber = null;
          return;
        }

        this.subscribers.add(subscriber);
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      },
      cancel: () => {
        if (subscriber) this.detach(subscriber);
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        ...extraHeaders,
      },
    });
  }

  private emit(chunk: Uint8Array): void {
    if (this.closed) return;
    this.chunks.push(chunk);
    for (const subscriber of [...this.subscribers]) {
      try {
        subscriber.controller.enqueue(chunk);
      } catch {
        this.detach(subscriber);
      }
    }
  }

  private markConnected(): void {
    if (this.closed || this.connected) return;
    this.connected = true;
    const frame = new TextEncoder().encode(": connected\n\n");
    for (const subscriber of [...this.subscribers]) {
      try {
        subscriber.controller.enqueue(frame);
      } catch {
        this.detach(subscriber);
      }
    }
  }

  private detach(subscriber: Subscriber): void {
    if (!this.subscribers.delete(subscriber)) return;
    subscriber.signal.removeEventListener("abort", subscriber.onAbort);
    // Deliberately do not stop the driver. The Hermes run belongs to the
    // durable conversation, not to whichever React page happens to be open.
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const subscriber of [...this.subscribers]) {
      subscriber.signal.removeEventListener("abort", subscriber.onAbort);
      try {
        subscriber.controller.close();
      } catch {
        // A browser can disappear between the terminal frame and close().
      }
    }
    this.subscribers.clear();
  }
}

type PumpRegistryGlobal = typeof globalThis & {
  __breadboardDetachedEventPumps?: Map<string, DetachedEventPump>;
};

function registry(): Map<string, DetachedEventPump> {
  const root = globalThis as PumpRegistryGlobal;
  root.__breadboardDetachedEventPumps ??= new Map();
  return root.__breadboardDetachedEventPumps;
}

export function acquireDetachedEventPump(
  key: string,
  drive: DrivePump,
): DetachedEventPump {
  const pumps = registry();
  const existing = pumps.get(key);
  if (existing) return existing;

  const created = new DetachedEventPump(key, drive);
  pumps.set(key, created);
  created.start(() => {
    if (pumps.get(key) === created) pumps.delete(key);
  });
  return created;
}
