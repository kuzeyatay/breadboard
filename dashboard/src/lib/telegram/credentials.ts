// The bot token on disk.
//
// Kept out of the store (and therefore out of every status payload) on purpose:
// the token is the bot. The browser only ever learns whether one is present and
// which bot it resolved to.

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { telegramEnvToken, telegramTokenFile } from "./config.ts";

/** BotFather issues `<numeric id>:<35-char secret>`. */
const TOKEN_PATTERN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

export function looksLikeBotToken(value: unknown): boolean {
  return TOKEN_PATTERN.test(String(value ?? "").trim());
}

/** True when the deployment supplied the token, so the app must not delete it. */
export function tokenIsFromEnvironment(): boolean {
  return telegramEnvToken().length > 0;
}

export function readBotToken(): string | null {
  const fromEnv = telegramEnvToken();
  if (fromEnv) return fromEnv;
  const file = telegramTokenFile();
  if (!existsSync(file)) return null;
  try {
    const token = readFileSync(file, "utf8").trim();
    return token || null;
  } catch {
    return null;
  }
}

export function hasBotToken(): boolean {
  return readBotToken() !== null;
}

export function writeBotToken(token: string): void {
  const trimmed = token.trim();
  if (!looksLikeBotToken(trimmed)) {
    throw new Error("That does not look like a bot token from BotFather.");
  }
  const file = telegramTokenFile();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${trimmed}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    // A fresh write honours `mode`, but an existing file keeps its old bits.
    chmodSync(file, 0o600);
  } catch {
    // Windows has no POSIX mode; the file already sits in a per-user directory.
  }
}

export function clearBotToken(): void {
  rmSync(telegramTokenFile(), { force: true });
}
