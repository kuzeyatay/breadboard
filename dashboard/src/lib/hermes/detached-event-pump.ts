// A server-owned event pump outlives any one browser SSE connection. Route
// handlers attach lightweight viewers to it; navigating away only removes that
// viewer while the upstream runtime stream keeps running and being persisted.

export interface DetachedEventPumpSink {
  emit(chunk: Uint8Array): void;
  markConnected(): void;
  reuseWhile(check: () => boolean): void;
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
  private reusable: () => boolean = () => true;
  private readonly settledPromise: Promise<void>;
  private resolveSettled!: () => void;

  constructor(key: string, drive: DrivePump) {
    this.key = key;
    this.drive = drive;
    this.settledPromise = new Promise((resolve) => {
      this.resolveSettled = resolve;
    });
  }

  start(onSettled: () => void): void {
    if (this.started) return;
    this.started = true;
    void this.drive({
      emit: (chunk) => this.emit(chunk),
      markConnected: () => this.markConnected(),
      reuseWhile: (check) => { this.reusable = check; },
      close: () => this.close(),
    })
      .catch(() => {
        // The runtime-specific driver emits and audits its own error before it
        // settles. This guard still guarantees that attached responses close.
      })
      .finally(() => {
        this.close();
        onSettled();
        this.resolveSettled();
      });
  }

  /** Join the server-owned driver without attaching an SSE viewer. */
  settled(): Promise<void> {
    return this.settledPromise;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get canReuse(): boolean {
    return !this.closed && this.reusable();
  }

  /** Stop replay immediately when the owning turn is cancelled, even if the
   * upstream iterator is still unwinding. Its cleanup remains joinable. */
  retire(terminalFrame?: Uint8Array): void {
    if (terminalFrame) this.emit(terminalFrame);
    this.close();
    this.chunks.length = 0;
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
  __breadboardSettlingEventPumps?: Set<DetachedEventPump>;
  __breadboardGoalContinuationPromises?: Map<number, Promise<void>>;
  __breadboardTaskRecoveryPromises?: Map<string, Promise<void>>;
};

function registry(): Map<string, DetachedEventPump> {
  const root = globalThis as PumpRegistryGlobal;
  root.__breadboardDetachedEventPumps ??= new Map();
  return root.__breadboardDetachedEventPumps;
}

function settlingPumps(): Set<DetachedEventPump> {
  const root = globalThis as PumpRegistryGlobal;
  root.__breadboardSettlingEventPumps ??= new Set();
  return root.__breadboardSettlingEventPumps;
}

/** Capture the current producer before asynchronous cancellation. A newer
 * turn can replace it while cleanup waits; never retire that replacement. */
export function captureEventPumpRetirement(key: string): (terminalFrame?: Uint8Array) => void {
  const pump = registry().get(key);
  return (terminalFrame) => pump?.retire(terminalFrame);
}

export function acquireDetachedEventPump(
  key: string,
  drive: DrivePump,
): DetachedEventPump {
  const pumps = registry();
  const existing = pumps.get(key);
  // A terminal frame closes the viewers before upstream iterator cleanup
  // finishes. A quick follow-up needs a fresh pump, not the preceding answer's
  // replay buffer. Live reconnects still share the current pump.
  if (existing?.canReuse) return existing;
  existing?.retire();

  const created = new DetachedEventPump(key, drive);
  pumps.set(key, created);
  settlingPumps().add(created);
  created.start(() => {
    if (pumps.get(key) === created) pumps.delete(key);
    settlingPumps().delete(created);
  });
  return created;
}

/**
 * Wait until every pump currently owned by this process has settled.
 *
 * Runtime V2 finite workers use this after dispatching unattended turns. The
 * old coordinator could return from a tick while its process-global pump kept
 * running; a disposable worker must explicitly join that same durable work
 * before its native owner lets the process exit.
 */
export async function waitForDetachedEventPumps(): Promise<void> {
  const goals = () => (globalThis as PumpRegistryGlobal).__breadboardGoalContinuationPromises;
  const recoveries = () => (globalThis as PumpRegistryGlobal).__breadboardTaskRecoveryPromises;
  while (registry().size > 0 || settlingPumps().size > 0 || goals()?.size || recoveries()?.size) {
    await Promise.allSettled([
      // A replaced terminal pump may still schedule a goal or task recovery
      // during cleanup. Finite workers must keep joining that work too.
      ...[...new Set([...registry().values(), ...settlingPumps()])].map((pump) => pump.settled()),
      ...[...(goals()?.values() ?? [])],
      ...[...(recoveries()?.values() ?? [])],
    ]);
  }
}
