// What Crumbs keeps on this machine: the linked account and its tokens, the
// device keys, and the organization keys this device has been given. Secrets
// are sealed with a key derived from the server secret, like other credentials.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { DpopKey, PendingAuthorization, TokenSet } from "./atproto-oauth.ts";
import type { DeviceKeys } from "./crypto.ts";

export type CrumbsVisibility = "private" | "public" | `org:${string}`;
export interface CrumbsAccount extends TokenSet { userId: number; handle: string | null; displayName: string | null; avatar: string | null; defaultVisibility: CrumbsVisibility; needsSignIn: boolean }

const initialized = new WeakSet<Database.Database>();
export function ensureCrumbsSchema(db: Database.Database) {
  if (initialized.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS crumbs_accounts (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, did TEXT NOT NULL, handle TEXT, display_name TEXT, avatar TEXT,
      pds TEXT NOT NULL, issuer TEXT NOT NULL, client_id TEXT NOT NULL, secrets TEXT NOT NULL, expires_at INTEGER NOT NULL, scope TEXT NOT NULL,
      default_visibility TEXT NOT NULL DEFAULT 'private', needs_sign_in INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS crumbs_oauth_states (
      state TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, pending TEXT NOT NULL, return_to TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS crumbs_devices (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, device_id TEXT NOT NULL, keys TEXT NOT NULL, published_for TEXT
    );
    CREATE TABLE IF NOT EXISTS crumbs_org_keys (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, org_id TEXT NOT NULL, epoch INTEGER NOT NULL, key TEXT NOT NULL, PRIMARY KEY(user_id, org_id, epoch)
    );
    CREATE TABLE IF NOT EXISTS crumbs_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  initialized.add(db);
}

function vaultKey() {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret || secret.length < 16) throw new Error("Set NEXTAUTH_SECRET on the server before linking a Crumbs account.");
  return createHash("sha256").update("breadboard-crumbs-vault\0").update(secret).digest();
}
export function sealSecret(value: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", vaultKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}
export function openSecret(sealed: string, context: string) {
  const [version, iv, tag, body, ...extra] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || body === undefined || extra.length) throw new Error("Unreadable Crumbs secret.");
  const decipher = createDecipheriv("aes-256-gcm", vaultKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

interface AccountRow { user_id: number; did: string; handle: string | null; display_name: string | null; avatar: string | null; pds: string; issuer: string; client_id: string; secrets: string; expires_at: number; scope: string; default_visibility: string; needs_sign_in: number }
export function getAccount(db: Database.Database, userId: number): CrumbsAccount | null {
  ensureCrumbsSchema(db);
  const row = db.prepare("SELECT * FROM crumbs_accounts WHERE user_id=?").get(userId) as AccountRow | undefined;
  if (!row) return null;
  let secrets: { dpopKey: DpopKey; accessToken: string; refreshToken: string | null };
  try { secrets = JSON.parse(openSecret(row.secrets, `account:${userId}`)); }
  catch { db.prepare("DELETE FROM crumbs_accounts WHERE user_id=?").run(userId); return null; }
  return { userId, did: row.did, handle: row.handle, displayName: row.display_name, avatar: row.avatar, pds: row.pds, issuer: row.issuer, clientId: row.client_id, ...secrets,
    expiresAt: row.expires_at, scope: row.scope, defaultVisibility: row.default_visibility as CrumbsVisibility, needsSignIn: row.needs_sign_in === 1 };
}
/** The linked account's public face. Breadboard shows this name and photo as the user's own. */
export function getIdentity(db: Database.Database, userId: number): { did: string; handle: string | null; displayName: string | null; avatar: string | null } | null {
  ensureCrumbsSchema(db);
  const row = db.prepare("SELECT did, handle, display_name, avatar FROM crumbs_accounts WHERE user_id=?").get(userId) as { did: string; handle: string | null; display_name: string | null; avatar: string | null } | undefined;
  return row ? { did: row.did, handle: row.handle, displayName: row.display_name, avatar: row.avatar } : null;
}
export function saveAccount(db: Database.Database, userId: number, tokens: TokenSet, profile: { handle: string | null; displayName: string | null; avatar: string | null }) {
  ensureCrumbsSchema(db);
  const secrets = sealSecret(JSON.stringify({ dpopKey: tokens.dpopKey, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }), `account:${userId}`);
  db.prepare(`INSERT INTO crumbs_accounts(user_id,did,handle,display_name,avatar,pds,issuer,client_id,secrets,expires_at,scope) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET did=excluded.did,handle=excluded.handle,display_name=excluded.display_name,avatar=excluded.avatar,pds=excluded.pds,issuer=excluded.issuer,
      client_id=excluded.client_id,secrets=excluded.secrets,expires_at=excluded.expires_at,scope=excluded.scope,needs_sign_in=0,
      default_visibility=CASE WHEN crumbs_accounts.did=excluded.did THEN crumbs_accounts.default_visibility ELSE 'private' END`)
    .run(userId, tokens.did, profile.handle, profile.displayName, profile.avatar, tokens.pds, tokens.issuer, tokens.clientId, secrets, tokens.expiresAt, tokens.scope);
}
export function saveTokens(db: Database.Database, userId: number, tokens: TokenSet) {
  const secrets = sealSecret(JSON.stringify({ dpopKey: tokens.dpopKey, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }), `account:${userId}`);
  db.prepare("UPDATE crumbs_accounts SET secrets=?, expires_at=?, scope=?, needs_sign_in=0 WHERE user_id=? AND did=?").run(secrets, tokens.expiresAt, tokens.scope, userId, tokens.did);
}
export function markNeedsSignIn(db: Database.Database, userId: number) { db.prepare("UPDATE crumbs_accounts SET needs_sign_in=1 WHERE user_id=?").run(userId); }
export function setDefaultVisibility(db: Database.Database, userId: number, value: CrumbsVisibility) { db.prepare("UPDATE crumbs_accounts SET default_visibility=? WHERE user_id=?").run(value, userId); }
/** Sign out. Device and organization keys stay so that signing back in keeps organization history readable. */
export function deleteAccount(db: Database.Database, userId: number) { ensureCrumbsSchema(db); db.prepare("DELETE FROM crumbs_accounts WHERE user_id=?").run(userId); }

export function savePending(db: Database.Database, userId: number, pending: PendingAuthorization, returnTo: string) {
  ensureCrumbsSchema(db);
  db.prepare("DELETE FROM crumbs_oauth_states WHERE created_at<?").run(Date.now() - 15 * 60_000);
  db.prepare("INSERT INTO crumbs_oauth_states(state,user_id,pending,return_to,created_at) VALUES(?,?,?,?,?)").run(pending.state, userId, sealSecret(JSON.stringify(pending), `state:${pending.state}`), returnTo, Date.now());
}
/** A sign-in attempt can be finished once, within fifteen minutes. */
export function takePending(db: Database.Database, state: string): { userId: number; pending: PendingAuthorization; returnTo: string } | null {
  ensureCrumbsSchema(db);
  const row = db.prepare("DELETE FROM crumbs_oauth_states WHERE state=? RETURNING user_id, pending, return_to, created_at").get(state) as { user_id: number; pending: string; return_to: string; created_at: number } | undefined;
  if (!row || row.created_at < Date.now() - 15 * 60_000) return null;
  try { return { userId: row.user_id, pending: JSON.parse(openSecret(row.pending, `state:${state}`)), returnTo: row.return_to }; } catch { return null; }
}

export function getDevice(db: Database.Database, userId: number): { keys: DeviceKeys; publishedFor: string | null } | null {
  ensureCrumbsSchema(db);
  const row = db.prepare("SELECT keys, published_for FROM crumbs_devices WHERE user_id=?").get(userId) as { keys: string; published_for: string | null } | undefined;
  if (!row) return null;
  try { return { keys: JSON.parse(openSecret(row.keys, `device:${userId}`)), publishedFor: row.published_for }; } catch { return null; }
}
export function saveDevice(db: Database.Database, userId: number, keys: DeviceKeys, publishedFor: string | null) {
  ensureCrumbsSchema(db);
  db.prepare("INSERT INTO crumbs_devices(user_id,device_id,keys,published_for) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET device_id=excluded.device_id,keys=excluded.keys,published_for=excluded.published_for")
    .run(userId, keys.deviceId, sealSecret(JSON.stringify(keys), `device:${userId}`), publishedFor);
}

export function getOrgKeys(db: Database.Database, userId: number, orgId: string): Map<number, Buffer> {
  ensureCrumbsSchema(db);
  const keys = new Map<number, Buffer>();
  for (const row of db.prepare("SELECT epoch, key FROM crumbs_org_keys WHERE user_id=? AND org_id=?").all(userId, orgId) as Array<{ epoch: number; key: string }>) {
    try { keys.set(row.epoch, Buffer.from(openSecret(row.key, `org:${userId}:${orgId}:${row.epoch}`), "base64url")); } catch { /* Fetched again from the store. */ }
  }
  return keys;
}
export function saveOrgKey(db: Database.Database, userId: number, orgId: string, epoch: number, key: Buffer) {
  ensureCrumbsSchema(db);
  db.prepare("INSERT INTO crumbs_org_keys(user_id,org_id,epoch,key) VALUES(?,?,?,?) ON CONFLICT(user_id,org_id,epoch) DO UPDATE SET key=excluded.key")
    .run(userId, orgId, epoch, sealSecret(key.toString("base64url"), `org:${userId}:${orgId}:${epoch}`));
}
export function forgetOrgKeys(db: Database.Database, userId: number, orgId: string) { ensureCrumbsSchema(db); db.prepare("DELETE FROM crumbs_org_keys WHERE user_id=? AND org_id=?").run(userId, orgId); }

export function getSetting(db: Database.Database, key: string): string | null {
  ensureCrumbsSchema(db);
  return (db.prepare("SELECT value FROM crumbs_settings WHERE key=?").get(key) as { value: string } | undefined)?.value ?? null;
}
export function setSetting(db: Database.Database, key: string, value: string | null) {
  ensureCrumbsSchema(db);
  if (value === null) db.prepare("DELETE FROM crumbs_settings WHERE key=?").run(key);
  else db.prepare("INSERT INTO crumbs_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}
