// The shared secret the arena presents when it asks Breadboard for a decision.
//
// The arena is a separate process that reaches back into the dashboard over
// loopback HTTP, so the decision endpoint cannot use the session cookie every
// other route relies on — there is no browser in that call. It gets a bearer
// token instead: minted once, kept in the desk's own runtime directory with the
// rest of its state, and never sent to the browser.
//
// Loopback is not on its own a permission. Anything else running on this machine
// can also reach 127.0.0.1, and the decision endpoint is what moves a portfolio.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { stateHome } from "./runtime.ts";

function tokenPath(): string {
  return path.join(stateHome(), "callback-token");
}

/** The desk's token, minted on first use. */
export function deskToken(): string {
  const file = tokenPath();
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch {
    // Not minted yet.
  }
  const minted = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, minted, { encoding: "utf8", mode: 0o600 });
  return minted;
}

/** Constant-time comparison, so a wrong token cannot be found one byte at a time. */
export function tokenMatches(candidate: string | null | undefined): boolean {
  const presented = (candidate ?? "").trim();
  if (!presented) return false;
  const expected = deskToken();
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Read the bearer token out of an inbound request's headers. */
export function bearerFrom(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}
