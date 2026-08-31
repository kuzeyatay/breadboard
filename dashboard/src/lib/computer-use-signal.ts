import "server-only";

import fs from "node:fs";
import path from "node:path";

import { dashboardDataDir } from "./runtime-paths.ts";

const CANCEL_FILENAME = "computer-use-cancel";
const HEARTBEAT_MS = 1_000;
const CANCEL_POLL_MS = 100;

export interface ComputerUseSignalOptions {
  producer: string;
  onCancel: () => void;
  appearance?: "green" | "red";
  dataDir?: string;
  now?: () => number;
}

/**
 * Multi-run signal for a dashboard-owned desktop controller. Producer-specific
 * state files coexist; the shared Escape marker is observed independently by
 * every producer, so one cannot consume cancellation on another's behalf.
 */
export class ComputerUseSignal {
  private readonly statePath: string;
  private readonly cancelPath: string;
  private readonly onCancel: () => void;
  private readonly appearance: "green" | "red";
  private readonly now: () => number;
  private readonly activeRuns = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private lastPublishedAt = 0;
  private lastCancelMarker = "";

  constructor(options: ComputerUseSignalOptions) {
    if (!/^[a-z0-9-]{1,40}$/u.test(options.producer)) {
      throw new Error("Invalid computer-use signal producer.");
    }
    if (options.appearance !== undefined && options.appearance !== "green" && options.appearance !== "red") {
      throw new Error("Invalid computer-use signal appearance.");
    }
    const dataDir = options.dataDir ?? path.join(dashboardDataDir(), "ui-tars");
    fs.mkdirSync(dataDir, { recursive: true });
    this.statePath = path.join(dataDir, `computer-use-state.${options.producer}.json`);
    this.cancelPath = path.join(dataDir, CANCEL_FILENAME);
    this.onCancel = options.onCancel;
    this.appearance = options.appearance ?? "green";
    this.now = options.now ?? Date.now;
    this.lastCancelMarker = this.readCancelMarker();
    this.publish(false);
  }

  setRunActive(runId: string, active: boolean): void {
    if (active) this.activeRuns.add(runId);
    else this.activeRuns.delete(runId);
    const isActive = this.activeRuns.size > 0;
    this.publish(isActive);
    if (isActive && !this.timer) {
      this.timer = setInterval(() => this.tick(), CANCEL_POLL_MS);
      this.timer.unref?.();
    } else if (!isActive) {
      this.clearTimer();
    }
  }

  stop(): void {
    this.activeRuns.clear();
    this.clearTimer();
    this.publish(false);
  }

  private tick(): void {
    if (this.activeRuns.size === 0) return;
    const now = this.now();
    if (now - this.lastPublishedAt >= HEARTBEAT_MS) this.publish(true, now);
    const marker = this.readCancelMarker();
    if (!marker || marker === this.lastCancelMarker) return;
    this.lastCancelMarker = marker;
    this.onCancel();
  }

  private readCancelMarker(): string {
    try {
      return fs.readFileSync(this.cancelPath, "utf8").trim();
    } catch {
      return "";
    }
  }

  private publish(active: boolean, updatedAt = this.now()): void {
    const temporary = `${this.statePath}.${process.pid}.tmp`;
    fs.writeFileSync(
      temporary,
      JSON.stringify({ version: 1, active, updatedAt, appearance: this.appearance }),
      { encoding: "utf8", mode: 0o600 },
    );
    fs.renameSync(temporary, this.statePath);
    this.lastPublishedAt = updatedAt;
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
