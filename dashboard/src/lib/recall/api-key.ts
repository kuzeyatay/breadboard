// The bearer Breadboard and the capture engine agree on.
//
// The engine authenticates every read of captured history — /search,
// /activity-summary, /meetings, /frames/:id/context — and answers 403 without a
// token, on loopback as much as anywhere else. Only /health is open, which is
// exactly why an unauthenticated Recall looks healthy: the settings tab says
// "Recording" from a probe that needs no key, while every question about the
// day fails.
//
// Asking the engine for its key is not an option. `screenpipe auth token`
// resolves from the engine's DEFAULT data directory, not the Breadboard-owned
// one passed with --data-dir, so it reports "no API token found" for an engine
// running happily under Breadboard. So Breadboard mints the key itself, keeps
// it in the Recall home, and hands it to the engine as SCREENPIPE_API_KEY at
// launch — first in the engine's own resolution order, and mirrored by the
// engine into its secret store. One value, one owner, no keychain, no
// discovery that can drift.

import crypto from "crypto";
import fs from "fs";
import path from "path";

import { getRecallConfig, type RecallConfig } from "./config.ts";

/** Where the minted key lives, next to the pid file and the engine log. */
export function recallApiKeyPath(config: RecallConfig): string {
  return path.join(config.home, "api-key");
}

/**
 * Shape a stored key must have to be used. Narrow on purpose: this value
 * becomes both an HTTP header and a child process's environment, so anything
 * with whitespace or control characters in it is treated as a corrupt file
 * rather than passed along.
 */
const KEY_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/** The key previously minted into the Recall home, or null when there is none. */
export function readStoredRecallApiKey(
  config: RecallConfig = getRecallConfig(),
): string | null {
  try {
    const value = fs.readFileSync(recallApiKeyPath(config), "utf8").trim();
    return KEY_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The key a client should present. An explicitly configured key wins, so
 * pointing Breadboard at an engine someone else runs stays possible.
 */
export function resolveRecallApiKey(
  config: RecallConfig = getRecallConfig(),
): string | null {
  return config.apiKey ?? readStoredRecallApiKey(config);
}

/**
 * The key to launch the engine with, minted on first use. Written before the
 * engine starts so the launcher and every later reader see the same value.
 */
export function ensureRecallApiKey(config: RecallConfig = getRecallConfig()): string {
  const existing = resolveRecallApiKey(config);
  if (existing) return existing;

  const minted = `sp-${crypto.randomBytes(16).toString("hex")}`;
  fs.mkdirSync(config.home, { recursive: true });
  fs.writeFileSync(recallApiKeyPath(config), `${minted}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return minted;
}
