// Where the Telegram link keeps its credential, and the few knobs that are
// deployment configuration rather than user preference.
//
// Unlike WhatsApp there is no bridge process to supervise: Telegram's Bot API is
// an ordinary HTTPS endpoint, so Breadboard long-polls it from the server process
// itself. What the two integrations share is the shape — a supervised connection
// that turns inbound messages into real Breadboard conversations — not the
// transport.

import os from "node:os";
import path from "node:path";

const DEFAULT_API_BASE = "https://api.telegram.org";

/** A Telegram chat that has been quiet this long starts a fresh Breadboard chat. */
const DEFAULT_NEW_CHAT_AFTER_MINUTES = 360;

function trimmedEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

/** The integration is on unless a deployment explicitly turns it off. */
export function telegramFeatureEnabled(): boolean {
  return trimmedEnv("BREADBOARD_TELEGRAM_ENABLED").toLowerCase() !== "false";
}

/** Overridable so tests (and self-hosted Bot API servers) can point elsewhere. */
export function telegramApiBase(): string {
  const configured = trimmedEnv("BREADBOARD_TELEGRAM_API_BASE");
  return (configured || DEFAULT_API_BASE).replace(/\/+$/, "");
}

/**
 * A bot token is a bearer credential for the whole bot: anyone holding it can
 * read every message the bot receives. It therefore lives in the same private
 * data directory as the WhatsApp linked-device session — on disk, never in
 * SQLite, and never in a payload the browser can read.
 */
export function telegramTokenFile(): string {
  const configured = trimmedEnv("BREADBOARD_TELEGRAM_TOKEN_FILE");
  if (configured) return path.resolve(configured);
  const hermesHome = trimmedEnv("HERMES_HOME");
  const base = hermesHome ? path.resolve(hermesHome) : path.join(os.homedir(), ".hermes");
  return path.join(base, "platforms", "telegram", "bot-token");
}

/**
 * A token supplied by the deployment rather than by the user. It wins over the
 * stored file and cannot be removed from the app — the panel says so instead of
 * offering a delete button that would silently do nothing.
 */
export function telegramEnvToken(): string {
  return trimmedEnv("BREADBOARD_TELEGRAM_BOT_TOKEN");
}

export function telegramNewChatAfterMs(): number {
  // `Number("")` is 0, so an unset variable must be rejected before parsing —
  // otherwise the window collapses and every message opens a brand-new chat.
  const raw = trimmedEnv("BREADBOARD_TELEGRAM_NEW_CHAT_AFTER_MINUTES");
  const configured = raw ? Number(raw) : Number.NaN;
  const minutes =
    Number.isFinite(configured) && configured >= 0
      ? configured
      : DEFAULT_NEW_CHAT_AFTER_MINUTES;
  return Math.round(minutes * 60_000);
}

export interface TelegramTimings {
  /** `getUpdates` long-poll window, in seconds — Telegram's own unit. */
  longPollSeconds: number;
  /** HTTP ceiling for a long poll; must exceed the poll window. */
  longPollTimeoutMs: number;
  /** HTTP ceiling for ordinary calls (`getMe`, `sendMessage`). */
  requestTimeoutMs: number;
  /** Gap between drains of the gateway's inbound queue. */
  drainIntervalMs: number;
  /** Ceiling on a single agent turn before the sender is told it timed out. */
  turnTimeoutMs: number;
  /** Backoff after a failed poll, doubled per consecutive failure up to 8×. */
  retryDelayMs: number;
}

export function telegramTimings(): TelegramTimings {
  return {
    longPollSeconds: 25,
    longPollTimeoutMs: 40_000,
    requestTimeoutMs: 15_000,
    drainIntervalMs: 1_200,
    turnTimeoutMs: 300_000,
    retryDelayMs: 3_000,
  };
}
