/** Run a read-only scan in short slices so unrelated HTTP requests can run. */
export async function runCooperatively<T>(task: Generator<void, T>): Promise<T> {
  const started = performance.now();
  let deadline = started + 8;
  try {
    for (;;) {
      const step = task.next();
      if (step.done) return step.value;
      const now = performance.now();
      if (now >= deadline) {
        // Next replaces setImmediate with a render-local microtask scheduler.
        // A timer must yield to the real event loop, including pending sockets.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        // 8 ms slices keep other requests flowing, but on a busy server each
        // yield waits behind everything else: a 2 s scan took 89 s. A task
        // that has waited long gets longer slices (at most 100 ms), so its
        // slowdown stays bounded.
        deadline = performance.now() + Math.min(100, Math.max(8, (now - started) / 20));
      }
    }
  } finally {
    task.return(undefined as T);
  }
}
