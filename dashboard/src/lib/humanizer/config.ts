// Where the humanizer service lives, and the secret both sides present.
//
// The same arrangement `colpali/config.ts` uses, for the same reason:
// Breadboard has several ways to start — `npm run dev`, the desktop supervisor,
// `start.bat`, a hand-run `npm run dev:dashboard` — and only some of them can
// hand the dashboard an address and a secret through the environment. A fixed
// loopback port plus a secret file under Breadboard's own data directory means
// the launcher and the dashboard agree without anything being passed between
// them. The environment still wins where it is set, which keeps the desktop
// supervisor's per-install secret and allocated port authoritative.
//
// Everything here is server-only. Nothing in this file may be imported from a
// client component: it resolves a port, a secret and a filesystem path, and the
// browser has no business knowing any of the three.
//
// Imported by the dashboard server and by scripts/start-humanizer.mjs, so it
// must stay free of Next-only imports.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HUMANIZER_DEFAULT_PORT = 7735;

/** The checkpoint the service is expected to be running. */
export const HUMANIZER_DEFAULT_MODEL = "cive202/humanize-ai-text-bart-large";

/**
 * The revision the service pins to.
 *
 * Must match DEFAULT_MODEL_REVISION in `breadboard_humanizer/__init__.py`. The
 * dashboard reports both what it expects and what the service answers, because
 * a mismatch means the reviewed gate behaviour and the running model are two
 * different things.
 */
export const HUMANIZER_DEFAULT_REVISION = "c74c28e03d3e306c8717d9f85cc18edb7d493299";

/** Bound request cost and keep a single rewrite from monopolizing the service. */
export const HUMANIZER_MAX_TEXT_CHARS = 60_000;

/** A cold CPU rewrite of a long answer is minutes; a warm CUDA one is seconds. */
export const HUMANIZER_DEFAULT_TIMEOUT_MS = 120_000;

export type HumanizerMode = "local" | "disabled";
export type HumanizerDevice = "auto" | "cuda" | "cpu";

/** Breadboard's own directory for the humanizer's local state. */
export function humanizerHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BREADBOARD_HUMANIZER_HOME?.trim();
  if (configured) return path.resolve(configured);
  const base = env.BREADBOARD_DATA_DIR?.trim() || path.join(os.homedir(), ".breadboard");
  return path.join(base, "humanizer");
}

/**
 * Where the checkpoint is cached.
 *
 * Under Breadboard's mutable user data, never under the application resources
 * and never in the checkout. That is what makes the download survive an
 * application update and what makes "remove the model" a directory deletion
 * that touches no user content.
 */
export function humanizerModelCache(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(humanizerHome(env), "models");
}

export function humanizerPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.BREADBOARD_HUMANIZER_PORT?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536
    ? parsed
    : HUMANIZER_DEFAULT_PORT;
}

export function humanizerBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.HUMANIZER_SERVICE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `http://127.0.0.1:${humanizerPort(env)}`;
}

export function humanizerModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.BREADBOARD_HUMANIZER_MODEL?.trim() || HUMANIZER_DEFAULT_MODEL;
}

export function humanizerRevision(env: NodeJS.ProcessEnv = process.env): string {
  return env.BREADBOARD_HUMANIZER_REVISION?.trim() || HUMANIZER_DEFAULT_REVISION;
}

export function humanizerDevice(env: NodeJS.ProcessEnv = process.env): HumanizerDevice {
  const raw = env.BREADBOARD_HUMANIZER_DEVICE?.trim();
  return raw === "cuda" || raw === "cpu" ? raw : "auto";
}

export function humanizerTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.BREADBOARD_HUMANIZER_TIMEOUT_MS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 5_000 && parsed <= 600_000
    ? parsed
    : HUMANIZER_DEFAULT_TIMEOUT_MS;
}

/**
 * `local` uses the loopback service. `disabled` never calls it.
 *
 * There is deliberately no third value. The whole point of this feature is that
 * the rewriting happens on this machine; a mode that reached a hosted model
 * when the local one was missing would make "local" a claim rather than a fact.
 * An unavailable service is reported as unavailable.
 */
export function humanizerMode(env: NodeJS.ProcessEnv = process.env): HumanizerMode {
  return env.HUMANIZER_MODE?.trim() === "disabled" ? "disabled" : "local";
}

/**
 * The loopback bearer the service requires.
 *
 * A local shared secret rather than a user secret, but generated per install so
 * another process on the machine cannot guess it and put text through the
 * model. Null only when it can be neither read nor written, which the caller
 * reports as a setup problem rather than serving unauthenticated.
 */
export function humanizerServiceSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = (env.HUMANIZER_SERVICE_SECRET ?? env.BREADBOARD_HUMANIZER_SECRET ?? "").trim();
  if (fromEnv) return fromEnv;

  const home = humanizerHome(env);
  const secretPath = path.join(home, "service-secret");
  try {
    const existing = fs.readFileSync(secretPath, "utf8").trim();
    if (existing) return existing;
  } catch {
    // Fall through and mint one.
  }
  try {
    const secret = crypto.randomBytes(24).toString("hex");
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(secretPath, secret, { encoding: "utf8", mode: 0o600 });
    return secret;
  } catch {
    return null;
  }
}
