// Where the ColPali service lives, and the secret both sides present.
//
// The same arrangement `cad/config.ts` uses, for the same reason: Breadboard
// has several ways to start — `npm run dev`, the desktop supervisor,
// `start.bat`, a hand-run `npm run dev:dashboard` — and only some of them can
// hand the dashboard an address and a secret through the environment. A fixed
// loopback port plus a secret file under Breadboard's own data directory means
// the launcher and the dashboard agree without anything being passed between
// them. The environment still wins where it is set, which keeps the desktop
// supervisor's per-install secret and allocated port authoritative.
//
// Imported by the dashboard server and by scripts/start-colpali.mjs, so it must
// stay free of Next-only imports.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const COLPALI_DEFAULT_PORT = 7733;

/** The checkpoint the service is expected to be running. */
export const COLPALI_DEFAULT_MODEL = "vidore/colSmol-500M";

/**
 * Pages handed to the model for one question.
 *
 * Six 1200px page images is already a substantial vision payload, and this is
 * also what makes "retrieve for every attachment" safe: a document with six
 * pages or fewer has all of them retrieved, so a short contract still arrives
 * whole. Nothing special-cases small documents — this is just what top-k does
 * when k exceeds the page count.
 */
export const COLPALI_DEFAULT_TOP_K = 6;

export type ColpaliMode = "auto" | "disabled";

/** Breadboard's own directory for the ColPali service's local state. */
export function colpaliHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BREADBOARD_COLPALI_HOME?.trim();
  if (configured) return path.resolve(configured);
  const base = env.BREADBOARD_DATA_DIR?.trim() || path.join(os.homedir(), ".breadboard");
  return path.join(base, "colpali");
}

export function colpaliPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.BREADBOARD_COLPALI_PORT?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : COLPALI_DEFAULT_PORT;
}

export function colpaliBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.COLPALI_SERVICE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `http://127.0.0.1:${colpaliPort(env)}`;
}

export function colpaliModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.BREADBOARD_COLPALI_MODEL?.trim() || COLPALI_DEFAULT_MODEL;
}

export function colpaliTopK(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.BREADBOARD_COLPALI_TOP_K?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 50 ? parsed : COLPALI_DEFAULT_TOP_K;
}

/**
 * `auto` uses the service when it is healthy and falls back to inlining the
 * whole document when it is not. `disabled` never calls it at all.
 *
 * The default is `auto` rather than `on` because a machine that never ran
 * `npm run setup:colpali` has no service to call, and that must behave exactly
 * as Breadboard did before this existed rather than failing an upload.
 */
export function colpaliMode(env: NodeJS.ProcessEnv = process.env): ColpaliMode {
  return env.COLPALI_MODE?.trim() === "disabled" ? "disabled" : "auto";
}

/**
 * The loopback bearer the service requires.
 *
 * A local shared secret rather than a user secret, but generated per install so
 * another process on the machine cannot guess it and read documents out of the
 * index. Null only when it can be neither read nor written, which the caller
 * reports as a setup problem rather than serving unauthenticated.
 */
export function colpaliServiceSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = (env.COLPALI_SERVICE_SECRET ?? env.BREADBOARD_COLPALI_SECRET ?? "").trim();
  if (fromEnv) return fromEnv;

  const home = colpaliHome(env);
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
