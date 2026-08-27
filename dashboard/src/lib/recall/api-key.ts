// The bearer Breadboard and the capture engine agree on.
//
// The engine authenticates every read of captured history — /search,
// /activity-summary, /meetings, /frames/:id/context — and answers 403 without a
// token, on loopback as much as anywhere else. Only /health is open, which is
// exactly why an unauthenticated Recall looks healthy: the settings tab says
// "Recording" from a probe that needs no key, while every question about the
// day fails.
//
// The Rust Runtime is the sole minting and process-environment owner. It keeps
// the key in the Recall home, injects SCREENPIPE_API_KEY only into the recorder,
// and injects the same value into Next's server-only RECALL_API_KEY. Reading the
// persisted file remains useful for an explicitly external/manual endpoint;
// Next never mints, rotates, or sends this secret through Runtime control.

import fs from "fs";
import path from "path";

import { getRecallConfig, type RecallConfig } from "./config.ts";

/** Where the Runtime-owned key lives inside the Recall home. */
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
