// Where the WhatsApp bridge lives, how it is started, and the few knobs that are
// deployment configuration rather than user preference.
//
// Breadboard does not ship its own WhatsApp client: it drives the Baileys bridge
// that already lives in the Hermes checkout (`hermes-agent/scripts/whatsapp-bridge`).
// That bridge speaks two protocols — a one-shot `--pair-only --pair-json` mode
// that streams pairing events (including the QR string) as JSON lines, and a
// long-lived loopback HTTP server (`/messages`, `/send`, `/typing`, `/health`).
// Breadboard owns the process in both modes, which is what lets an inbound
// WhatsApp message become a real Breadboard conversation instead of a private
// Hermes-gateway session the desktop app can never see.

import os from "node:os";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { repositoryRoot } from "../runtime-paths.ts";

/** Default port for the bridge's loopback HTTP server. */
const DEFAULT_BRIDGE_PORT = 8099;

/** A WhatsApp chat that has been quiet this long starts a fresh Breadboard chat. */
const DEFAULT_NEW_CHAT_AFTER_MINUTES = 360;

/**
 * Prefixed onto every outgoing reply. Deliberately non-empty: in self-chat mode
 * our own replies come back as inbound `fromMe` messages, and the prefix is the
 * only echo guard that still works after a bridge restart drops its in-memory
 * set of sent message ids.
 */
const DEFAULT_REPLY_PREFIX = "🌱 *Breadboard*\n────────────\n";

function trimmedEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

/** The integration is on unless a deployment explicitly turns it off. */
export function whatsAppFeatureEnabled(): boolean {
  return trimmedEnv("BREADBOARD_WHATSAPP_ENABLED").toLowerCase() !== "false";
}

/** Directory holding `bridge.js` and its package.json. */
export function whatsAppBridgeDir(): string {
  const configured = trimmedEnv("BREADBOARD_WHATSAPP_BRIDGE_DIR");
  if (configured) return path.resolve(configured);
  const hermesApp = trimmedEnv("HERMES_APP_DIR");
  if (hermesApp) return path.join(path.resolve(hermesApp), "scripts", "whatsapp-bridge");
  return path.join(repositoryRoot(), "hermes-agent", "scripts", "whatsapp-bridge");
}

export function whatsAppBridgeScript(): string {
  return path.join(whatsAppBridgeDir(), "bridge.js");
}

/**
 * Linked-device credentials. Kept in Hermes's private data directory (the same
 * path `hermes whatsapp` uses) so pairing done from either side is interchangeable,
 * and never anywhere the browser can reach.
 */
export function whatsAppSessionDir(): string {
  const configured = trimmedEnv("BREADBOARD_WHATSAPP_SESSION_DIR");
  if (configured) return path.resolve(configured);
  const hermesHome = trimmedEnv("HERMES_HOME");
  const base = hermesHome ? path.resolve(hermesHome) : path.join(os.homedir(), ".hermes");
  return path.join(base, "platforms", "whatsapp", "session");
}

export function whatsAppBridgePort(): number {
  const configured = Number(trimmedEnv("BREADBOARD_WHATSAPP_BRIDGE_PORT"));
  return Number.isInteger(configured) && configured > 0 && configured < 65_536
    ? configured
    : DEFAULT_BRIDGE_PORT;
}

export function whatsAppBridgeBaseUrl(): string {
  return `http://127.0.0.1:${whatsAppBridgePort()}`;
}

/**
 * Node binary used for the bridge. The dashboard server itself runs on Node in
 * both dev and the packaged desktop (the desktop bundles an official runtime),
 * so its own executable is the safest default.
 */
export function whatsAppNodeBinary(): string {
  const configured = trimmedEnv("BREADBOARD_WHATSAPP_NODE");
  if (configured) return configured;
  const own = process.execPath ?? "";
  return path.basename(own).toLowerCase().startsWith("node")
    ? own
    : process.platform === "win32"
      ? "node.exe"
      : "node";
}

export function whatsAppReplyPrefix(): string {
  const configured = process.env.BREADBOARD_WHATSAPP_REPLY_PREFIX;
  if (configured === undefined) return DEFAULT_REPLY_PREFIX;
  return configured.replace(/\\n/g, "\n");
}

export function whatsAppNewChatAfterMs(): number {
  // `Number("")` is 0, so an unset variable must be rejected before parsing —
  // otherwise the window collapses and every message opens a brand-new chat.
  const raw = trimmedEnv("BREADBOARD_WHATSAPP_NEW_CHAT_AFTER_MINUTES");
  const configured = raw ? Number(raw) : Number.NaN;
  const minutes =
    Number.isFinite(configured) && configured >= 0
      ? configured
      : DEFAULT_NEW_CHAT_AFTER_MINUTES;
  return Math.round(minutes * 60_000);
}

export interface WhatsAppTimings {
  /** Gap between `/messages` drains. */
  pollIntervalMs: number;
  /** How long a pairing attempt may sit unscanned before it is abandoned. */
  pairTimeoutMs: number;
  /** How long to wait for the bridge to report `connected` after spawning. */
  startTimeoutMs: number;
  /** Ceiling on a single agent turn before the sender is told it timed out. */
  turnTimeoutMs: number;
  /** `npm install` ceiling for the bridge's own dependencies. */
  installTimeoutMs: number;
}

export function whatsAppTimings(): WhatsAppTimings {
  return {
    pollIntervalMs: 1_200,
    pairTimeoutMs: 180_000,
    startTimeoutMs: 45_000,
    turnTimeoutMs: 300_000,
    installTimeoutMs: 600_000,
  };
}
