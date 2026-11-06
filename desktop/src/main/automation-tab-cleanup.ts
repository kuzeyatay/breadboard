/** Desktop-owned cleanup survives chat unmounts and missed completion messages. */
export class AutomationTabCleanup {
  private timer: ReturnType<typeof setInterval> | undefined;
  private pending: Promise<void> | null = null;
  private controller = new AbortController();

  constructor(private options: {
    owners: () => string[];
    finished: (owners: string[], signal: AbortSignal) => Promise<string[]>;
    release: (owner: string) => void;
  }) {}

  start(): void {
    if (this.timer || this.controller.signal.aborted) return;
    this.timer = setInterval(() => { void this.reconcile().catch(() => {}); }, 5_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.controller.abort();
  }

  reconcile(): Promise<void> {
    if (this.controller.signal.aborted) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = this.check().finally(() => { this.pending = null; });
    return this.pending;
  }

  private async check(): Promise<void> {
    const owners = [...new Set(this.options.owners())];
    for (let offset = 0; offset < owners.length; offset += 64) {
      const batch = owners.slice(offset, offset + 64);
      // Unavailable/unknown is never evidence that a task has finished. Failed
      // requests leave ownership intact so the next tick can retry.
      const finished = await this.options.finished(batch, this.controller.signal);
      if (this.controller.signal.aborted) return;
      for (const owner of new Set(finished)) if (batch.includes(owner)) this.options.release(owner);
    }
  }
}
