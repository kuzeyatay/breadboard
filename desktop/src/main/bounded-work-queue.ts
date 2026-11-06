/** Bound expensive cold-start work without charging queued jobs a network timeout. */
export class BoundedWorkQueue {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly concurrency: number) {}

  run<T>(work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.running += 1;
        void Promise.resolve().then(work).then(resolve, reject).finally(() => {
          this.running -= 1;
          this.waiting.shift()?.();
        });
      };
      if (this.running < this.concurrency) start();
      else this.waiting.push(start);
    });
  }
}
