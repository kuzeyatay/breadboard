// Breadboard stand-in for sim's lib/execution/cancellation.ts (simstudioai/sim,
// Apache-2.0). Sim publishes cancellations over a Redis pub/sub channel so a Stop
// pressed on one web node reaches the worker running the execution, and records a
// durable cancelled-marker key as a backstop. Breadboard runs the executor in-process,
// so the channel is a local emitter and the durable backstop is disabled — an
// in-process caller cancels through `contextExtensions.abortSignal` instead.

export interface ExecutionCancelEvent {
  executionId: string;
}

type Listener = (event: ExecutionCancelEvent) => void;

class LocalCancellationChannel {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: ExecutionCancelEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

const channel = new LocalCancellationChannel();

export function getCancellationChannel(): LocalCancellationChannel {
  return channel;
}

/** Redis-backed durable cancellation is not vendored; the local channel is authoritative. */
export function isRedisCancellationEnabled(): boolean {
  return false;
}

export async function isExecutionCancelled(_executionId: string): Promise<boolean> {
  return false;
}

export async function markExecutionCancelled(executionId: string): Promise<void> {
  channel.publish({ executionId });
}

export async function clearExecutionCancellation(_executionId: string): Promise<void> {}
