import fs from "node:fs";
import path from "node:path";

export const COMPUTER_USE_STATE_FILENAME = "computer-use-state.ui-tars.json";
export const COMPUTER_USE_CANCEL_FILENAME = "computer-use-cancel";
export const COMPUTER_USE_HEARTBEAT_MS = 1_000;
export const COMPUTER_USE_CANCEL_POLL_MS = 100;

interface ComputerUseSignalOptions {
  dataDir: string;
  onCancel: () => void;
  now?: () => number;
}

/**
 * Narrow file-backed signal between the supervised UI-TARS sidecar and the
 * Electron shell. The state contains no user or task data. A heartbeat makes
 * the visible indicator fail closed when this process exits unexpectedly.
 */
export class ComputerUseSignal {
  private readonly statePath: string;
  private readonly cancelPath: string;
  private readonly onCancel: () => void;
  private readonly now: () => number;
  private heartbeat: NodeJS.Timeout | null = null;
  private active = false;
  private lastCancelMarker = "";

  constructor(options: ComputerUseSignalOptions) {
    fs.mkdirSync(options.dataDir, { recursive: true });
    this.statePath = path.join(options.dataDir, COMPUTER_USE_STATE_FILENAME);
    this.cancelPath = path.join(options.dataDir, COMPUTER_USE_CANCEL_FILENAME);
    this.onCancel = options.onCancel;
    this.now = options.now ?? Date.now;
    // A marker already present belongs to a previous Escape press. Remembering
    // rather than deleting it lets multiple desktop-control producers consume
    // the same future marker independently.
    this.lastCancelMarker = this.readCancelMarker();
    this.publish(false);
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.publish(active);
    if (active) {
      this.heartbeat = setInterval(() => this.tick(), COMPUTER_USE_CANCEL_POLL_MS);
      this.heartbeat.unref?.();
      return;
    }
    this.clearHeartbeat();
  }

  stop(): void {
    this.active = false;
    this.clearHeartbeat();
    this.publish(false);
  }

  private tick(): void {
    if (!this.active) return;
    const now = this.now();
    const lastHeartbeat = this.lastHeartbeatAt();
    if (now - lastHeartbeat >= COMPUTER_USE_HEARTBEAT_MS) this.publish(true, now);
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

  private lastPublishedAt = 0;

  private lastHeartbeatAt(): number {
    return this.lastPublishedAt;
  }

  private publish(active: boolean, updatedAt = this.now()): void {
    const temporary = `${this.statePath}.${process.pid}.tmp`;
    const state = JSON.stringify({ version: 1, active, updatedAt, appearance: "green" });
    fs.writeFileSync(temporary, state, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.statePath);
    this.lastPublishedAt = updatedAt;
  }

  private clearHeartbeat(): void {
    if (!this.heartbeat) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
