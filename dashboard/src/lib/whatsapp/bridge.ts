// Supervisor for the Hermes WhatsApp bridge process.
//
// The bridge (`hermes-agent/scripts/whatsapp-bridge/bridge.js`) has two modes and
// this module owns both:
//
//   pairing  `node bridge.js --pair-only --pair-json --session <dir>`
//            emits one JSON object per line (`started`, `qr`, `connected`,
//            `disconnected`, `error`) and exits once credentials are saved.
//   gateway  `node bridge.js --port <p> --session <dir> --mode <mode>`
//            serves a loopback HTTP API: GET /messages drains inbound events,
//            POST /send delivers a reply, GET /health reports the link state.
//
// Nothing here talks to Breadboard's conversation pipeline — that is inbound.ts.
// Keeping the process concerns separate is what makes the supervisor testable and
// what keeps a WhatsApp protocol change from reaching into the chat code.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import {
  whatsAppBridgeBaseUrl,
  whatsAppBridgeDir,
  whatsAppBridgePort,
  whatsAppBridgeScript,
  whatsAppNodeBinary,
  whatsAppReplyPrefix,
  whatsAppSessionDir,
  whatsAppTimings,
} from "./config.ts";
import { formatAllowedNumbers, type WhatsAppMode } from "./identity.ts";

export type WhatsAppBridgeState =
  | "disconnected"
  | "installing"
  | "pairing"
  | "starting"
  | "connected"
  | "error";

export interface WhatsAppInboundMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  senderName: string;
  chatName: string;
  isGroup: boolean;
  body: string;
  hasMedia: boolean;
  mediaType: string;
  fileName: string;
  timestamp: number;
}

export interface WhatsAppBridgeSnapshot {
  state: WhatsAppBridgeState;
  /** Raw pairing payload; the route turns it into an image. */
  qr: string | null;
  qrAt: string | null;
  error: string | null;
  /** Credentials exist on disk, so a gateway start needs no new QR scan. */
  paired: boolean;
  linkedNumber: string | null;
  linkedName: string | null;
  bridgeInstalled: boolean;
  bridgeAvailable: boolean;
  sessionDir: string;
  port: number;
  /** Last few process log lines, for the "why did it fail" case. */
  log: string[];
}

const MAX_LOG_LINES = 40;

function nodeModulesDir(): string {
  return path.join(whatsAppBridgeDir(), "node_modules");
}

/** The pairing/gateway processes need Baileys; `hermes whatsapp` installs it too. */
export function bridgeDependenciesInstalled(): boolean {
  return existsSync(path.join(nodeModulesDir(), "@whiskeysockets", "baileys"));
}

export function bridgeScriptAvailable(): boolean {
  return existsSync(whatsAppBridgeScript());
}

export function credentialsPresent(): boolean {
  return existsSync(path.join(whatsAppSessionDir(), "creds.json"));
}

interface PairEvent {
  event?: string;
  qr?: string;
  error?: string;
  reason?: number;
  user?: { id?: string | null; name?: string | null } | null;
}

export interface PairingOutcome {
  status: "connected" | "cancelled" | "failed";
  number: string | null;
  name: string | null;
  error: string | null;
}

export class WhatsAppBridge {
  private state: WhatsAppBridgeState = "disconnected";
  private qr: string | null = null;
  private qrAt: string | null = null;
  private error: string | null = null;
  private linkedNumber: string | null = null;
  private linkedName: string | null = null;
  private log: string[] = [];

  private pairProcess: ChildProcess | null = null;
  private pairCancelled = false;
  private gatewayProcess: ChildProcess | null = null;
  private installPromise: Promise<void> | null = null;
  private pairingPromise: Promise<PairingOutcome> | null = null;
  private onPaired: ((outcome: PairingOutcome) => void) | null = null;

  snapshot(): WhatsAppBridgeSnapshot {
    return {
      state: this.state,
      qr: this.qr,
      qrAt: this.qrAt,
      error: this.error,
      paired: credentialsPresent(),
      linkedNumber: this.linkedNumber,
      linkedName: this.linkedName,
      bridgeInstalled: bridgeDependenciesInstalled(),
      bridgeAvailable: bridgeScriptAvailable(),
      sessionDir: whatsAppSessionDir(),
      port: whatsAppBridgePort(),
      log: [...this.log],
    };
  }

  currentState(): WhatsAppBridgeState {
    return this.state;
  }

  isRunning(): boolean {
    return this.gatewayProcess !== null && this.gatewayProcess.exitCode === null;
  }

  /** Notified when a pairing attempt reaches a terminal state. */
  setPairedListener(listener: ((outcome: PairingOutcome) => void) | null): void {
    this.onPaired = listener;
  }

  private appendLog(line: string): void {
    const text = line.trim();
    if (!text) return;
    this.log.push(text.slice(0, 500));
    if (this.log.length > MAX_LOG_LINES) this.log.splice(0, this.log.length - MAX_LOG_LINES);
  }

  private setState(state: WhatsAppBridgeState, error: string | null = null): void {
    this.state = state;
    this.error = error;
  }

  private bridgeEnv(mode: WhatsAppMode, allowedNumbers: readonly string[]): NodeJS.ProcessEnv {
    return {
      ...process.env,
      WHATSAPP_MODE: mode,
      WHATSAPP_ALLOWED_USERS: formatAllowedNumbers(allowedNumbers),
      WHATSAPP_REPLY_PREFIX: whatsAppReplyPrefix(),
      // Breadboard answers every message itself; the bridge must never run the
      // Hermes gateway's own pairing-code reply path.
      WHATSAPP_DM_POLICY: "open",
    };
  }

  /**
   * Install the bridge's npm dependencies. This is what `hermes whatsapp` does
   * before showing a QR code, and it is the slow part of a first connect.
   */
  async ensureDependencies(): Promise<void> {
    if (bridgeDependenciesInstalled()) return;
    if (!bridgeScriptAvailable()) {
      throw new Error(
        `The Hermes WhatsApp bridge was not found at ${whatsAppBridgeScript()}.`,
      );
    }
    if (this.installPromise) return this.installPromise;

    this.setState("installing");
    this.installPromise = new Promise<void>((resolve, reject) => {
      const command = process.platform === "win32" ? "npm.cmd" : "npm";
      // Fixed arguments only — nothing here is derived from user input.
      const child = spawn(command, ["install", "--omit=dev", "--no-audit", "--no-fund"], {
        cwd: whatsAppBridgeDir(),
        env: process.env,
        windowsHide: true,
        shell: process.platform === "win32",
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("Installing the WhatsApp bridge dependencies timed out."));
      }, whatsAppTimings().installTimeoutMs);
      timer.unref?.();

      child.stdout?.on("data", (chunk: Buffer) => this.appendLog(String(chunk)));
      child.stderr?.on("data", (chunk: Buffer) => this.appendLog(String(chunk)));
      child.on("error", (cause) => {
        clearTimeout(timer);
        reject(new Error(`npm could not be started: ${cause.message}`));
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0 && bridgeDependenciesInstalled()) resolve();
        else reject(new Error(`Installing the WhatsApp bridge failed (npm exit ${code}).`));
      });
    })
      .finally(() => {
        this.installPromise = null;
      });

    try {
      await this.installPromise;
    } catch (cause) {
      this.setState("error", cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }

  /**
   * Begin a pairing attempt. Resolves when the QR is scanned (or the attempt is
   * cancelled or times out); the caller normally does not await it, and reads the
   * evolving QR out of `snapshot()` instead.
   */
  async startPairing(): Promise<PairingOutcome> {
    if (this.pairingPromise) return this.pairingPromise;
    // A running gateway holds the linked-device socket; pairing needs it free.
    await this.stopGateway();
    await this.ensureDependencies();

    this.qr = null;
    this.qrAt = null;
    this.pairCancelled = false;
    this.setState("pairing");

    this.pairingPromise = new Promise<PairingOutcome>((resolve) => {
      const timings = whatsAppTimings();
      let settled = false;
      const child = spawn(
        whatsAppNodeBinary(),
        [
          whatsAppBridgeScript(),
          "--pair-only",
          "--pair-json",
          "--session",
          whatsAppSessionDir(),
        ],
        {
          cwd: whatsAppBridgeDir(),
          env: { ...process.env, WHATSAPP_MODE: "self-chat" },
          windowsHide: true,
        },
      );
      this.pairProcess = child;

      const settle = (outcome: PairingOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pairProcess = null;
        this.pairingPromise = null;
        this.qr = null;
        this.qrAt = null;
        if (outcome.status === "connected") {
          this.linkedNumber = outcome.number;
          this.linkedName = outcome.name;
          this.setState("disconnected");
        } else if (outcome.status === "failed") {
          this.setState("error", outcome.error);
        } else {
          this.setState("disconnected");
        }
        try {
          this.onPaired?.(outcome);
        } catch {
          // A listener failure must not strand the pairing state machine.
        }
        resolve(outcome);
      };

      const timer = setTimeout(() => {
        child.kill();
        settle({
          status: "failed",
          number: null,
          name: null,
          error: "The QR code was not scanned in time. Start pairing again.",
        });
      }, timings.pairTimeoutMs);
      timer.unref?.();

      const lines = readline.createInterface({ input: child.stdout! });
      lines.on("line", (line) => {
        let event: PairEvent | null = null;
        try {
          event = JSON.parse(line) as PairEvent;
        } catch {
          this.appendLog(line);
          return;
        }
        if (event.event === "qr" && typeof event.qr === "string") {
          this.qr = event.qr;
          this.qrAt = new Date().toISOString();
          return;
        }
        if (event.event === "connected") {
          const id = typeof event.user?.id === "string" ? event.user.id : "";
          settle({
            status: "connected",
            number: id ? id.replace(/:.*@/, "@").replace(/@.*/, "") : null,
            name: typeof event.user?.name === "string" ? event.user.name : null,
            error: null,
          });
          return;
        }
        if (event.event === "error") {
          settle({
            status: "failed",
            number: null,
            name: null,
            error:
              event.error === "logged_out"
                ? "WhatsApp rejected the saved session. Unlink and pair again."
                : (event.error ?? "The WhatsApp bridge reported an error."),
          });
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => this.appendLog(String(chunk)));
      child.on("error", (cause) => {
        settle({
          status: "failed",
          number: null,
          name: null,
          error: `The WhatsApp bridge could not be started: ${cause.message}`,
        });
      });
      child.on("exit", (code, signal) => {
        lines.close();
        // A cancel kills the process, so it exits on a signal with a null code.
        // That is a cancellation, not a failure the user needs to see.
        const stopped = this.pairCancelled || signal !== null;
        settle(
          code === 0 || stopped
            ? { status: "cancelled", number: null, name: null, error: null }
            : {
                status: "failed",
                number: null,
                name: null,
                error: `The pairing process exited with code ${code}.`,
              },
        );
      });
    });

    return this.pairingPromise;
  }

  async cancelPairing(): Promise<void> {
    const child = this.pairProcess;
    if (!child) return;
    this.pairCancelled = true;
    child.kill();
    await this.pairingPromise?.catch(() => undefined);
  }

  /** Start the long-lived bridge and wait until WhatsApp reports it connected. */
  async startGateway(mode: WhatsAppMode, allowedNumbers: readonly string[]): Promise<void> {
    if (this.isRunning() && this.state === "connected") return;
    if (!credentialsPresent()) {
      throw new Error("WhatsApp is not linked yet. Scan the QR code first.");
    }
    await this.cancelPairing();
    await this.stopGateway();
    await this.ensureDependencies();

    this.setState("starting");
    const child = spawn(
      whatsAppNodeBinary(),
      [
        whatsAppBridgeScript(),
        "--port",
        String(whatsAppBridgePort()),
        "--session",
        whatsAppSessionDir(),
        "--mode",
        mode,
      ],
      {
        cwd: whatsAppBridgeDir(),
        env: this.bridgeEnv(mode, allowedNumbers),
        windowsHide: true,
      },
    );
    this.gatewayProcess = child;
    child.stdout?.on("data", (chunk: Buffer) => this.appendLog(String(chunk)));
    child.stderr?.on("data", (chunk: Buffer) => this.appendLog(String(chunk)));
    child.on("error", (cause) => {
      this.gatewayProcess = null;
      this.setState("error", `The WhatsApp bridge could not be started: ${cause.message}`);
    });
    child.on("exit", (code) => {
      if (this.gatewayProcess === child) this.gatewayProcess = null;
      if (this.state !== "disconnected") {
        this.setState(
          "error",
          code === 0 ? "The WhatsApp bridge stopped." : `The WhatsApp bridge exited (code ${code}).`,
        );
      }
    });

    const deadline = Date.now() + whatsAppTimings().startTimeoutMs;
    while (Date.now() < deadline) {
      if (this.gatewayProcess === null) {
        throw new Error(this.error ?? "The WhatsApp bridge stopped while starting.");
      }
      const health = await this.health();
      if (health?.status === "connected") {
        this.setState("connected");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    await this.stopGateway();
    this.setState("error", "The WhatsApp bridge did not connect in time.");
    throw new Error("The WhatsApp bridge did not connect in time.");
  }

  async stopGateway(): Promise<void> {
    const child = this.gatewayProcess;
    this.gatewayProcess = null;
    if (this.state === "connected" || this.state === "starting") this.setState("disconnected");
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 4_000);
      timer.unref?.();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill();
    });
  }

  /**
   * Stop everything and delete the linked-device credentials, so the next connect
   * needs a fresh QR scan. This is the "remove the linked device" half of a
   * disconnect; the phone-side entry is removed from WhatsApp → Linked Devices.
   */
  async unlink(): Promise<void> {
    await this.cancelPairing();
    await this.stopGateway();
    this.linkedNumber = null;
    this.linkedName = null;
    await rm(whatsAppSessionDir(), { recursive: true, force: true });
    this.setState("disconnected");
  }

  async health(): Promise<{ status: string } | null> {
    try {
      const response = await fetch(`${whatsAppBridgeBaseUrl()}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) return null;
      return (await response.json()) as { status: string };
    } catch {
      return null;
    }
  }

  /** Drain everything WhatsApp has delivered since the last call. */
  async drainMessages(): Promise<WhatsAppInboundMessage[]> {
    const response = await fetch(`${whatsAppBridgeBaseUrl()}/messages`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`The WhatsApp bridge returned ${response.status}.`);
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) return [];
    return payload.map((entry) => normalizeInbound(entry as Record<string, unknown>));
  }

  async sendMessage(chatId: string, message: string): Promise<void> {
    const response = await fetch(`${whatsAppBridgeBaseUrl()}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId, message }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Sending the WhatsApp reply failed (${response.status}). ${detail}`.trim());
    }
  }

  /**
   * Send a file. The bridge reads `filePath` from disk itself, which is safe
   * because it runs on this machine under Breadboard's supervisor — but it also
   * means the caller is responsible for the path being one Breadboard is
   * willing to disclose. Only the artifact store resolves paths for this.
   */
  async sendMedia(
    chatId: string,
    file: { filePath: string; fileName?: string; caption?: string; mediaType?: string },
  ): Promise<void> {
    const response = await fetch(`${whatsAppBridgeBaseUrl()}/send-media`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId, ...file }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Sending the WhatsApp attachment failed (${response.status}). ${detail}`.trim(),
      );
    }
  }

  async sendTyping(chatId: string): Promise<void> {
    try {
      await fetch(`${whatsAppBridgeBaseUrl()}/typing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // A missing typing indicator is never worth failing a turn over.
    }
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normalizeInbound(entry: Record<string, unknown>): WhatsAppInboundMessage {
  const timestamp = Number(entry.timestamp);
  return {
    messageId: text(entry.messageId),
    chatId: text(entry.chatId),
    senderId: text(entry.senderId),
    senderName: text(entry.senderName),
    chatName: text(entry.chatName),
    isGroup: entry.isGroup === true,
    body: text(entry.body),
    hasMedia: entry.hasMedia === true,
    mediaType: text(entry.mediaType),
    fileName: text(entry.fileName),
    timestamp: Number.isFinite(timestamp) ? timestamp : Math.floor(Date.now() / 1000),
  };
}

const globals = globalThis as typeof globalThis & {
  breadboardWhatsAppBridge?: WhatsAppBridge;
};

export function getWhatsAppBridge(): WhatsAppBridge {
  if (!globals.breadboardWhatsAppBridge) {
    globals.breadboardWhatsAppBridge = new WhatsAppBridge();
  }
  return globals.breadboardWhatsAppBridge;
}
