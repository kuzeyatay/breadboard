import "server-only";
import crypto from "node:crypto";
import db from "@/lib/db";
import { RouteError } from "@/lib/server-auth";
import type { SpeechCredentialStatus } from "./providers.ts";

db.exec(`CREATE TABLE IF NOT EXISTS speech_elevenlabs_credentials (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_value TEXT NOT NULL
)`);

function vaultKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new RouteError(503, "Set NEXTAUTH_SECRET on the server before saving an ElevenLabs API key, or configure ELEVENLABS_API_KEY on the server.");
  }
  return crypto.createHash("sha256").update("breadboard-elevenlabs-vault\0").update(secret).digest();
}

function storedKey(userId: number): string | undefined {
  return (db.prepare("SELECT encrypted_value FROM speech_elevenlabs_credentials WHERE user_id = ?")
    .get(userId) as { encrypted_value: string } | undefined)?.encrypted_value;
}

export function getElevenLabsApiKey(userId: number): string | null {
  const stored = storedKey(userId);
  if (!stored) return process.env.ELEVENLABS_API_KEY?.trim() || null;
  try {
    const [version, iv, tag, ciphertext, ...extra] = stored.split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext || extra.length) throw new Error("Invalid credential");
    const decipher = crypto.createDecipheriv("aes-256-gcm", vaultKey(), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(`elevenlabs:${userId}`));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new RouteError(503, "Your saved ElevenLabs key could not be opened. Remove it and enter it again in Voice settings.");
  }
}

export function elevenLabsCredentialStatus(userId: number): SpeechCredentialStatus {
  const hasStoredKey = Boolean(storedKey(userId));
  let canStore = false;
  try { vaultKey(); canStore = true; } catch { /* Environment keys remain usable. */ }
  const source = hasStoredKey ? "stored" : process.env.ELEVENLABS_API_KEY?.trim() ? "environment" : null;
  try {
    return { configured: Boolean(getElevenLabsApiKey(userId)), source, hasStoredKey, canStore };
  } catch (error) {
    return { configured: false, source, hasStoredKey, canStore, error: (error as Error).message };
  }
}

export function storeElevenLabsApiKey(userId: number, value: unknown): void {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key || key.length > 512 || /[^\x21-\x7e]/.test(key)) throw new RouteError(400, "Enter a valid ElevenLabs API key.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", vaultKey(), iv);
  cipher.setAAD(Buffer.from(`elevenlabs:${userId}`));
  const ciphertext = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  const encrypted = ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
  db.prepare(`INSERT INTO speech_elevenlabs_credentials (user_id, encrypted_value) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET encrypted_value = excluded.encrypted_value`).run(userId, encrypted);
}

export function forgetElevenLabsApiKey(userId: number): void {
  db.prepare("DELETE FROM speech_elevenlabs_credentials WHERE user_id = ?").run(userId);
}
