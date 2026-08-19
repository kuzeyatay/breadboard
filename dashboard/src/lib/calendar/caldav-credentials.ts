import "server-only";

// The password behind a two-way calendar, sealed at rest.
//
// A CalDAV binding needs a reusable secret: unlike OAuth there is no token to
// refresh and no way to sync without replaying the password on every request.
// So it is stored the same way src/lib/connected-apps/vault.ts stores tokens —
// AES-256-GCM, with the calendar it unlocks bound into the additional
// authenticated data, so a sealed value lifted from one row cannot be replayed
// against another calendar or another account.
//
// The key comes from BREADBOARD_CALENDAR_VAULT_KEY when set, and otherwise is
// derived from NEXTAUTH_SECRET, which every deployment already has. Rotating
// either makes existing bindings unreadable, and the panel then asks for the
// password again — which is the correct outcome, not a bug to work around.

import crypto from "node:crypto";

import db from "../db.ts";
import { CalendarError } from "./store.ts";

const VERSION = "v1";

export interface CaldavSecret {
  username: string;
  password: string;
}

function vaultKey(): Buffer {
  const explicit = process.env.BREADBOARD_CALENDAR_VAULT_KEY?.trim();
  if (explicit) {
    const decoded = Buffer.from(explicit, "base64");
    if (decoded.length !== 32) {
      throw new CalendarError(503, "Calendar syncing is unavailable: the vault key is not valid.");
    }
    return decoded;
  }

  const applicationSecret = process.env.NEXTAUTH_SECRET?.trim();
  if (!applicationSecret || applicationSecret.length < 16) {
    throw new CalendarError(
      503,
      "Calendar syncing needs NEXTAUTH_SECRET (or BREADBOARD_CALENDAR_VAULT_KEY) to be set before a password can be stored.",
    );
  }
  return crypto
    .createHash("sha256")
    .update("breadboard-caldav-vault\0")
    .update(applicationSecret)
    .digest();
}

function aad(userId: number, calendarId: number): Buffer {
  return Buffer.from(`${VERSION}:${userId}:${calendarId}`, "utf8");
}

function seal(userId: number, calendarId: number, secret: CaldavSecret): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", vaultKey(), iv);
  cipher.setAAD(aad(userId, calendarId));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(secret), "utf8"),
    cipher.final(),
  ]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function open(userId: number, calendarId: number, value: string): CaldavSecret {
  const [version, ivValue, tagValue, encryptedValue, ...extra] = value.split(".");
  if (version !== VERSION || !ivValue || !tagValue || !encryptedValue || extra.length) {
    throw new CalendarError(503, "That calendar's password must be entered again.");
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      vaultKey(),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAAD(aad(userId, calendarId));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plain) as CaldavSecret;
    if (typeof parsed.password !== "string") throw new Error("missing password");
    return { username: String(parsed.username ?? ""), password: parsed.password };
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    throw new CalendarError(503, "That calendar's password must be entered again.");
  }
}

export function storeCaldavSecret(
  userId: number,
  calendarId: number,
  secret: CaldavSecret,
): void {
  db.prepare(
    `INSERT INTO calendar_caldav_credentials (calendar_id, user_id, encrypted_value)
     VALUES (?, ?, ?)
     ON CONFLICT(calendar_id) DO UPDATE SET
       encrypted_value = excluded.encrypted_value,
       user_id = excluded.user_id,
       updated_at = datetime('now')`,
  ).run(calendarId, userId, seal(userId, calendarId, secret));
}

export function readCaldavSecret(userId: number, calendarId: number): CaldavSecret | null {
  const row = db
    .prepare(
      `SELECT encrypted_value FROM calendar_caldav_credentials
        WHERE calendar_id = ? AND user_id = ?`,
    )
    .get(calendarId, userId) as { encrypted_value: string } | undefined;
  return row ? open(userId, calendarId, row.encrypted_value) : null;
}

export function forgetCaldavSecret(userId: number, calendarId: number): void {
  db.prepare(
    `DELETE FROM calendar_caldav_credentials WHERE calendar_id = ? AND user_id = ?`,
  ).run(calendarId, userId);
}

/** Whether a password can be stored at all, for the panel to check up front. */
export function caldavVaultConfigured(): boolean {
  try {
    vaultKey();
    return true;
  } catch {
    return false;
  }
}
