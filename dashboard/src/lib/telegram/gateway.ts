// The Telegram connection Breadboard supervises.
//
// WhatsApp needs a bridge process because its protocol needs a client; Telegram
// does not — the Bot API is HTTPS, so the "bridge" is a long-poll loop in this
// process. What is kept identical is the seam: this module owns the transport
// (state, retries, the inbound queue) and knows nothing about conversations, so
// a Bot API change cannot reach into the chat code and the loop stays testable.

import {
  deleteWebhook,
  getUpdates,
  sendChatAction,
  sendMessage,
  TelegramApiError,
} from "./client.ts";
import { telegramTimings } from "./config.ts";
import { contactHandle, contactLabel, isGroupChat } from "./identity.ts";

export type TelegramGatewayState = "disconnected" | "starting" | "connected" | "error";

export interface TelegramInboundMessage {
  /** Stable per message: `<chat id>:<message id>`. */
  messageId: string;
  updateId: number;
  chatId: string;
  chatType: string;
  chatTitle: string;
  senderId: string;
  senderUsername: string;
  senderName: string;
  isGroup: boolean;
  body: string;
  hasMedia: boolean;
  mediaType: string;
  fileName: string;
  timestamp: number;
}

/** A sender the allowlist turned away, kept so the panel can offer to admit them. */
export interface TelegramBlockedSender {
  senderId: string;
  username: string;
  name: string;
  attempts: number;
  lastAt: string;
}

export interface TelegramGatewaySnapshot {
  state: TelegramGatewayState;
  error: string | null;
  running: boolean;
  offset: number;
  blocked: TelegramBlockedSender[];
  log: string[];
}

const MAX_LOG_LINES = 40;
const MAX_QUEUED = 500;
const MAX_BLOCKED = 8;

/** A sleep that gives up the moment the connection is asked to stop. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

interface RawMessage {
  message_id?: number;
  date?: number;
  text?: string;
  caption?: string;
  from?: { id?: number; username?: string; first_name?: string; last_name?: string };
  chat?: { id?: number; type?: string; title?: string; username?: string; first_name?: string };
  photo?: unknown[];
  document?: { file_name?: string; mime_type?: string };
  voice?: unknown;
  audio?: { file_name?: string };
  video?: unknown;
  video_note?: unknown;
  animation?: unknown;
  sticker?: { emoji?: string };
  location?: unknown;
  contact?: unknown;
  poll?: unknown;
}

function describeMedia(message: RawMessage): { hasMedia: boolean; mediaType: string; fileName: string } {
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    return { hasMedia: true, mediaType: "photo", fileName: "" };
  }
  if (message.document) {
    return {
      hasMedia: true,
      mediaType: message.document.mime_type || "document",
      fileName: message.document.file_name ?? "",
    };
  }
  for (const [key, label] of [
    ["voice", "voice message"],
    ["audio", "audio"],
    ["video", "video"],
    ["video_note", "video note"],
    ["animation", "animation"],
    ["sticker", "sticker"],
    ["location", "location"],
    ["contact", "contact card"],
    ["poll", "poll"],
  ] as const) {
    if (message[key]) return { hasMedia: true, mediaType: label, fileName: "" };
  }
  return { hasMedia: false, mediaType: "", fileName: "" };
}

/**
 * Flatten one update into the shape the rest of Breadboard reads. Returns null
 * for updates there is nothing to answer — a channel post, a service message, a
 * message from another bot.
 */
export function normalizeInbound(update: unknown): TelegramInboundMessage | null {
  const envelope = (update ?? {}) as { update_id?: number; message?: RawMessage };
  const message = envelope.message;
  if (!message || typeof message !== "object") return null;

  const chatId = message.chat?.id === undefined ? "" : String(message.chat.id);
  if (!chatId) return null;

  const from = message.from ?? {};
  if ((from as { is_bot?: boolean }).is_bot) return null;

  const media = describeMedia(message);
  const body = (message.text ?? message.caption ?? "").trim();
  if (!body && !media.hasMedia) return null;

  const senderName = [from.first_name, from.last_name]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ")
    .trim();

  return {
    messageId: `${chatId}:${message.message_id ?? ""}`,
    updateId: Number(envelope.update_id ?? 0),
    chatId,
    chatType: message.chat?.type ?? "private",
    chatTitle: message.chat?.title ?? "",
    senderId: from.id === undefined ? "" : String(from.id),
    senderUsername: from.username ?? "",
    senderName,
    isGroup: isGroupChat(message.chat?.type),
    body,
    hasMedia: media.hasMedia,
    mediaType: media.mediaType,
    fileName: media.fileName,
    timestamp: Number.isFinite(message.date) ? Number(message.date) : Math.floor(Date.now() / 1000),
  };
}

export class TelegramGateway {
  private state: TelegramGatewayState = "disconnected";
  private error: string | null = null;
  private log: string[] = [];
  private queue: TelegramInboundMessage[] = [];
  private blocked = new Map<string, TelegramBlockedSender>();

  private token: string | null = null;
  private offset = 0;
  private onOffset: ((offset: number) => void) | null = null;
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private abort: AbortController | null = null;

  snapshot(): TelegramGatewaySnapshot {
    return {
      state: this.state,
      error: this.error,
      running: this.running,
      offset: this.offset,
      blocked: [...this.blocked.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
      log: [...this.log],
    };
  }

  currentState(): TelegramGatewayState {
    return this.state;
  }

  isRunning(): boolean {
    return this.running;
  }

  private appendLog(line: string): void {
    const text = line.trim();
    if (!text) return;
    this.log.push(`${new Date().toISOString().slice(11, 19)} ${text.slice(0, 300)}`);
    if (this.log.length > MAX_LOG_LINES) this.log.splice(0, this.log.length - MAX_LOG_LINES);
  }

  private setState(state: TelegramGatewayState, error: string | null = null): void {
    this.state = state;
    this.error = error;
  }

  /** Remember a sender the allowlist turned away, so the panel can admit them. */
  noteBlockedSender(message: TelegramInboundMessage): void {
    const key = message.senderId || message.chatId;
    if (!key) return;
    const existing = this.blocked.get(key);
    this.blocked.set(key, {
      senderId: key,
      username: message.senderUsername,
      name: contactLabel(message),
      attempts: (existing?.attempts ?? 0) + 1,
      lastAt: new Date().toISOString(),
    });
    // Keep the newest few; an unlinked bot that leaks can otherwise grow this
    // without bound.
    if (this.blocked.size > MAX_BLOCKED) {
      const oldest = [...this.blocked.values()].sort((a, b) => a.lastAt.localeCompare(b.lastAt))[0];
      if (oldest) this.blocked.delete(oldest.senderId);
    }
    this.appendLog(`Ignored a message from ${existing?.name ?? contactHandle(message)} (not allowed)`);
  }

  clearBlockedSender(senderId: string): void {
    this.blocked.delete(senderId);
  }

  /** Take everything received since the last drain. */
  drainMessages(): TelegramInboundMessage[] {
    const messages = this.queue;
    this.queue = [];
    return messages;
  }

  async sendTyping(chatId: string): Promise<void> {
    if (!this.token) return;
    await sendChatAction(this.token, chatId).catch(() => {
      // Cosmetic only; a failed typing indicator must not stop the reply.
    });
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.token) throw new Error("Telegram is not connected.");
    await sendMessage(this.token, chatId, text);
  }

  /**
   * Bring the connection up. Idempotent: calling it while running restarts the
   * loop onto the new token/offset rather than opening a second poller, which
   * Telegram would answer with a 409 for both.
   */
  async start(options: {
    token: string;
    offset?: number;
    onOffset?: (offset: number) => void;
  }): Promise<void> {
    await this.stop();
    this.token = options.token;
    this.offset = Number.isFinite(options.offset) ? Math.max(0, Number(options.offset)) : 0;
    this.onOffset = options.onOffset ?? null;
    this.running = true;
    this.abort = new AbortController();
    this.setState("starting");
    this.appendLog("Connecting to Telegram");

    // A registered webhook makes long polling impossible. Clearing it is the
    // difference between "connected" and an unexplained 409 loop.
    try {
      await deleteWebhook(options.token, this.abort.signal);
    } catch (cause) {
      if (cause instanceof TelegramApiError && cause.isAuthFailure) {
        // A bad token can only be fixed by linking again, so fail loudly here
        // rather than starting a loop that could never connect.
        this.running = false;
        this.token = null;
        this.setState("error", "Telegram rejected the bot token. Link the bot again.");
        this.appendLog("Token rejected");
        throw cause;
      }
      // Anything else is not fatal: the poll below reports the real problem.
    }

    this.loopPromise = this.pollLoop(options.token, this.abort.signal);
  }

  async stop(): Promise<void> {
    if (!this.running && !this.loopPromise) {
      this.setState("disconnected");
      return;
    }
    this.running = false;
    this.abort?.abort();
    const loop = this.loopPromise;
    this.loopPromise = null;
    this.abort = null;
    await loop?.catch(() => undefined);
    this.token = null;
    this.setState("disconnected");
    this.appendLog("Disconnected");
  }

  private advanceOffset(updateId: number): void {
    if (!Number.isFinite(updateId) || updateId < this.offset) return;
    this.offset = updateId + 1;
    this.onOffset?.(this.offset);
  }

  private async pollLoop(token: string, signal: AbortSignal): Promise<void> {
    let failures = 0;
    const { retryDelayMs } = telegramTimings();

    while (this.running && !signal.aborted) {
      try {
        const updates = await getUpdates(token, this.offset, signal);
        if (!this.running || signal.aborted) break;
        failures = 0;
        if (this.state !== "connected") {
          this.setState("connected");
          this.appendLog("Connected");
        }
        for (const update of updates) {
          const updateId = Number((update as { update_id?: number })?.update_id ?? 0);
          this.advanceOffset(updateId);
          const message = normalizeInbound(update);
          if (!message) continue;
          if (this.queue.length >= MAX_QUEUED) this.queue.shift();
          this.queue.push(message);
        }
      } catch (cause) {
        if (!this.running || signal.aborted) break;
        const apiError = cause instanceof TelegramApiError ? cause : null;

        if (apiError?.isAuthFailure) {
          this.running = false;
          this.setState("error", "Telegram rejected the bot token. Link the bot again.");
          this.appendLog("Token rejected");
          break;
        }
        if (apiError?.isConflict) {
          this.running = false;
          this.setState(
            "error",
            "Another program is already receiving this bot's messages. Stop it, or use a second bot here.",
          );
          this.appendLog("Update stream is owned by another poller");
          break;
        }

        failures += 1;
        const detail = apiError?.message ?? "Telegram poll failed.";
        this.appendLog(detail);
        // A single blip is normal on a long poll; only a run of them is a state
        // worth showing the user.
        if (failures >= 3) this.setState("error", detail);
        // Abortable: a Disconnect must not wait out the backoff.
        await delay(Math.min(retryDelayMs * 2 ** Math.min(failures, 3), retryDelayMs * 8), signal);
      }
    }
  }
}

const globals = globalThis as typeof globalThis & {
  breadboardTelegramGateway?: TelegramGateway;
};

export function getTelegramGateway(): TelegramGateway {
  if (!globals.breadboardTelegramGateway) {
    globals.breadboardTelegramGateway = new TelegramGateway();
  }
  return globals.breadboardTelegramGateway;
}
