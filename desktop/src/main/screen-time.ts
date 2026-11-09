import { spawn, type ChildProcess } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { observedScreenTime, sameScreenTimeActivity, screenTimeActivity, screenTimePreferences,
  type ScreenTimeContext, type ScreenTimeSample, type ScreenTimeSlice, type ScreenTimePreferences } from "./screen-time-policy";

/** A single desktop-owned sampler survives tab navigation. Files are isolated by signed-in account. */
export class ScreenTimeTracker {
  private helper: ChildProcess | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closing = false;
  private userId: string | null = null;
  private preferences: ScreenTimePreferences = { enabled: true, excluded: [] };
  private previous: { at: number; activity: Omit<ScreenTimeSlice, "start" | "end"> } | null = null;
  private pending: ScreenTimeSlice | null = null;
  private queue: Promise<void> = Promise.resolve();
  private lastSample = 0;
  private state = "waiting";
  private storageError = false;
  private retryAt = 0;
  private prunedUser: string | null = null;
  private readonly root: string;

  constructor(private readonly options: { dataRoot: string; moduleDir: string; context: () => ScreenTimeContext; log?: (line: string) => void }) {
    this.root = path.join(options.dataRoot, "screen-time");
  }

  start(): void { if (!this.timer && !this.closing) void this.tick(); }

  private async tick(): Promise<void> {
    if (this.closing) return;
    try {
      const context = this.options.context();
      const nextUser = context.userId && /^[1-9]\d*$/.test(context.userId) ? context.userId : null;
      if (nextUser !== this.userId) {
        this.stopHelper();
        this.flush();
        await this.queue;
        this.userId = nextUser;
        this.prunedUser = null;
      }
      if (this.closing) return;
      if (this.userId) {
        const dir = path.join(this.root, this.userId);
        await mkdir(dir, { recursive: true });
        try { this.preferences = screenTimePreferences(JSON.parse(await readFile(path.join(dir, "settings.json"), "utf8"))); }
        catch (error) {
          // Missing preferences use the documented default; unreadable settings fail closed.
          this.preferences = (error as NodeJS.ErrnoException).code === "ENOENT" ? { enabled: true, excluded: [] } : { enabled: false, excluded: [] };
        }
        // Shutdown can arrive while the settings read is pending. Never revive the helper afterwards.
        if (this.closing) return;
        if (!this.preferences.enabled) { this.stopHelper(); this.state = "paused"; }
        else if (process.platform !== "win32") this.state = "unsupported";
        else if (!this.helper && Date.now() >= this.retryAt) this.launch();
        else if (this.helper && this.lastSample && Date.now() - this.lastSample > 15000) { this.stopHelper(); this.state = "error"; this.retryAt = Date.now() + 15000; }
        this.flush();
        const status = { version: 1, updatedAt: Date.now(), state: this.storageError ? "error" : this.state, lastSampleAt: this.lastSample || null, enabled: this.preferences.enabled };
        this.enqueue(async () => {
          const target = path.join(dir, "status.json");
          await writeFile(`${target}.tmp`, JSON.stringify(status));
          await rename(`${target}.tmp`, target);
        });
        const retentionDay = `${this.userId}:${new Date().toISOString().slice(0, 10)}`;
        if (this.prunedUser !== retentionDay) {
          this.prunedUser = retentionDay;
          const oldest = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
          for (const name of await readdir(dir)) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) && name.slice(0, 10) < oldest) await unlink(path.join(dir, name));
        }
      } else this.stopHelper();
    } catch { this.state = "error"; this.options.log?.("[screen-time] Activity storage is unavailable."); }
    finally { if (!this.closing) this.timer = setTimeout(() => { this.timer = null; void this.tick(); }, 5000); }
  }

  private launch(): void {
    const child = spawn(path.join(this.options.moduleDir, "..", "native", "windows-screen-time.exe"), [String(process.pid)],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    this.helper = child;
    this.state = "starting";
    this.lastSample = Date.now();
    const lines = createInterface({ input: child.stdout! });
    lines.on("line", line => {
      if (this.closing || this.helper !== child || line.length > 12000) return;
      try { this.consume(JSON.parse(line) as ScreenTimeSample); } catch { this.previous = null; }
    });
    const failed = () => {
      lines.close();
      if (this.helper !== child) return;
      this.helper = null;
      this.previous = null;
      this.flush();
      this.state = "error";
      this.retryAt = Date.now() + 30000;
    };
    child.on("error", failed);
    child.on("exit", failed);
  }

  private consume(sample: ScreenTimeSample): void {
    const now = Date.now(), context = this.options.context();
    this.lastSample = now;
    // Authentication transitions must never put another account's observations in this file.
    if (context.userId !== this.userId) { this.previous = null; this.flush(); return; }
    const activity = screenTimeActivity(sample, context, this.preferences, process.pid);
    const slice = observedScreenTime(this.previous, now);
    if (slice && activity) {
      if (this.pending && sameScreenTimeActivity(this.pending, slice) && this.pending.end === slice.start) this.pending.end = slice.end;
      else { this.flush(); this.pending = slice; }
    } else this.flush();
    this.previous = activity ? { at: now, activity } : null;
    this.state = sample.idleSeconds >= 300 ? "idle" : activity ? "tracking" : "excluded";
  }

  private enqueue(operation: () => Promise<void>): void {
    this.queue = this.queue.then(operation).catch(() => { this.storageError = true; this.state = "error"; this.options.log?.("[screen-time] Could not save activity."); });
  }

  private flush(): void {
    const slice = this.pending, userId = this.userId;
    this.pending = null;
    if (!slice || !userId) return;
    // A slice spanning UTC midnight is stored in its start-day file; reads include the preceding day.
    const file = path.join(this.root, userId, `${new Date(slice.start).toISOString().slice(0, 10)}.jsonl`);
    this.enqueue(async () => { await appendFile(file, JSON.stringify(slice) + "\n", "utf8"); this.storageError = false; });
  }

  private stopHelper(): void {
    const child = this.helper;
    this.helper = null;
    this.previous = null;
    this.flush();
    child?.kill();
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.timer) clearTimeout(this.timer);
    this.stopHelper();
    await this.queue;
  }
}
