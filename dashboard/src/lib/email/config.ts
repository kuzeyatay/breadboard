// Where the mail account's credentials live, and how often the channel looks.
//
// The password never touches SQLite and never reaches the browser, exactly as
// the Telegram bot token does not: it sits in a 0600 file inside Hermes's own
// private directory, and every status payload reports only whether one is set.
// A mail password is usually the password to a great deal more than mail.

import os from "node:os";
import path from "node:path";

function trimmedEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function emailFeatureEnabled(): boolean {
  return trimmedEnv("BREADBOARD_EMAIL_DISABLED") !== "1";
}

/** The private directory the credentials file sits in. */
export function emailCredentialsFile(): string {
  const configured = trimmedEnv("BREADBOARD_EMAIL_CREDENTIALS_FILE");
  if (configured) return path.resolve(configured);
  const hermesHome = trimmedEnv("HERMES_HOME");
  const base = hermesHome ? path.resolve(hermesHome) : path.join(os.homedir(), ".hermes");
  return path.join(base, "platforms", "email", "account.json");
}

export interface EmailTimings {
  /** How often the inbox is checked. */
  pollIntervalMs: number;
  /** How long to wait for the assistant before apologising by mail. */
  turnTimeoutMs: number;
  /** A mail thread stays on one conversation for this long after the last message. */
  newThreadAfterMs: number;
}

function positiveMs(name: string, fallback: number): number {
  const raw = Number.parseInt(trimmedEnv(name), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function emailTimings(): EmailTimings {
  return {
    // Slower than a chat channel on purpose. Mail is not an instant medium,
    // nobody is watching for the reply, and a tight poll on someone's real
    // mailbox is a good way to get rate-limited by their provider.
    pollIntervalMs: positiveMs("BREADBOARD_EMAIL_POLL_MS", 120_000),
    turnTimeoutMs: positiveMs("BREADBOARD_EMAIL_TURN_TIMEOUT_MS", 240_000),
    newThreadAfterMs: positiveMs("BREADBOARD_EMAIL_NEW_THREAD_MS", 12 * 60 * 60_000),
  };
}

/** Longest reply we will send. Past this a mail is a document, not an answer. */
export const MAX_REPLY_CHARS = 20_000;
