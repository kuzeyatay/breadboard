// Where the CAD service lives, and the secret both sides present.
//
// Breadboard has several ways to start: `npm run dev`, the desktop supervisor,
// `start.bat`, and a hand-run `npm run dev:dashboard`. Only the first two can
// hand the dashboard an address and a secret through the environment, so making
// the CAD agent depend on that meant it silently reported "not configured" on
// the other two.
//
// This module removes the hand-off. The address is a fixed loopback port and
// the secret is a file under Breadboard's own data directory: the launcher and
// the dashboard each read the same file, so they agree without anything being
// passed between them. It is the same arrangement `cliproxy/config.ts` uses,
// for the same reason.
//
// The environment still wins where it is set, which keeps the desktop
// supervisor's per-install secret and dynamically allocated port authoritative.
//
// Imported by both the dashboard server and scripts/start-cad.mjs, so it must
// stay free of Next-only imports.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CAD_DEFAULT_PORT = 7731;

/** Breadboard's own directory for the CAD service's local state. */
export function cadHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BREADBOARD_CAD_HOME?.trim();
  if (configured) return path.resolve(configured);
  const base = env.BREADBOARD_DATA_DIR?.trim() || path.join(os.homedir(), ".breadboard");
  return path.join(base, "cad");
}

export function cadPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.BREADBOARD_CAD_PORT?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : CAD_DEFAULT_PORT;
}

export function cadBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CAD_SERVICE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `http://127.0.0.1:${cadPort(env)}`;
}

/**
 * The loopback bearer the service requires.
 *
 * A local shared secret rather than a user secret, but generated per install
 * rather than hardcoded so another process on the machine cannot guess it and
 * drive the executor. Returns null only when it can be neither read nor
 * written — a read-only home directory, say — which the caller reports as a
 * setup problem rather than silently serving unauthenticated.
 */
export function cadServiceSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = (env.CAD_SERVICE_SECRET ?? env.BREADBOARD_CAD_SECRET ?? "").trim();
  if (fromEnv) return fromEnv;

  const home = cadHome(env);
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

/** Per-execution workspaces. Transient, and never inside the checkout. */
export function cadWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BREADBOARD_CAD_WORKSPACE?.trim();
  if (configured) return path.resolve(configured);
  return path.join(cadHome(env), "workspaces");
}
