// Google Drive as the file carrier for organizations.
//
// A file shared in an organization is encrypted on the sender's machine with a
// key of its own, uploaded to the sender's Google Drive, and shared as "anyone
// with the link". The Drive file id and the key travel inside the organization's
// encrypted message, so the link alone opens nothing and Google holds only
// ciphertext. Recipients need no Google account: they download the ciphertext
// and decrypt it here.
//
// Breadboard asks only for `drive.file`: it sees the files it made and nothing
// else in the person's Drive. Desktop OAuth uses a loopback redirect and PKCE,
// and runs in the system browser, where Google allows it.
import type Database from "better-sqlite3";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_NAME = "Breadboard shared files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
/** The same ceiling as a stored chat file. */
export const MAX_DRIVE_FILE_BYTES = 128 * 1024 * 1024;

export class DriveError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code = "drive_error") { super(message); this.status = status; this.code = code; }
}

/** What a message carries for one file: where the ciphertext is and the key that opens it. */
export interface DriveFileRef { drive: string; key: string; name: string; size: number }

// ---- Encryption ------------------------------------------------------------
// AES-256-GCM with a fresh key per file: 12-byte IV, then ciphertext, then the 16-byte tag.

export function encryptFile(plain: Uint8Array): { ciphertext: Buffer; key: string } {
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { ciphertext: Buffer.concat([iv, body, cipher.getAuthTag()]), key: key.toString("base64url") };
}

export function decryptFile(ciphertext: Uint8Array, key: string): Buffer {
  const bytes = Buffer.from(ciphertext);
  const secret = Buffer.from(key, "base64url");
  if (secret.length !== 32 || bytes.length < 28) throw new DriveError(422, "That file could not be opened.", "drive_file_unreadable");
  const decipher = createDecipheriv("aes-256-gcm", secret, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(bytes.length - 16));
  try { return Buffer.concat([decipher.update(bytes.subarray(12, bytes.length - 16)), decipher.final()]); }
  catch { throw new DriveError(422, "That file was changed or damaged in Google Drive.", "drive_file_tampered"); }
}

// ---- Accounts --------------------------------------------------------------

function ensureSchema(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS drive_accounts (
    user_id INTEGER PRIMARY KEY, refresh_token TEXT NOT NULL, access_token TEXT, expires_at INTEGER NOT NULL DEFAULT 0,
    email TEXT, folder_id TEXT, connected_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}
interface AccountRow { user_id: number; refresh_token: string; access_token: string | null; expires_at: number; email: string | null; folder_id: string | null }

export interface DriveConfig { clientId: string | null; clientSecret: string | null; apiKey: string | null }
export function driveConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DriveConfig {
  return { clientId: env.GOOGLE_DRIVE_CLIENT_ID?.trim() || null, clientSecret: env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() || null, apiKey: env.GOOGLE_DRIVE_API_KEY?.trim() || null };
}

export function createDrive({ db, config = driveConfigFromEnv(), fetcher = fetch }: { db: Database.Database; config?: DriveConfig; fetcher?: typeof fetch }) {
  ensureSchema(db);
  const pending = new Map<string, { userId: number; verifier: string; redirectUri: string; expires: number }>();
  const account = (userId: number) => db.prepare("SELECT * FROM drive_accounts WHERE user_id=?").get(userId) as AccountRow | undefined;
  const configured = () => Boolean(config.clientId && config.clientSecret);

  function status(userId: number) {
    const row = account(userId);
    return { configured: configured(), connected: Boolean(row), email: row?.email ?? null };
  }

  /** The Google consent page for `drive.file`, returning to this server's callback. */
  function authUrl(userId: number, origin: string): string {
    if (!configured()) throw new DriveError(503, "Google Drive is not set up on this Breadboard yet.", "drive_not_configured");
    // A desktop client may return to any loopback port, so the redirect is this server's own address:
    // whatever host it answers on, the system browser reaches it the same way.
    const loopback = new URL(origin);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(loopback.hostname)) throw new DriveError(400, "Google Drive can be connected from the Breadboard app on this computer.", "drive_loopback");
    const redirectUri = `${loopback.origin}/api/drive/oauth/callback`;
    const state = randomBytes(24).toString("base64url"), verifier = randomBytes(48).toString("base64url");
    const now = Date.now();
    for (const [key, value] of pending) if (value.expires < now) pending.delete(key);
    pending.set(state, { userId, verifier, redirectUri, expires: now + 10 * 60_000 });
    const url = new URL(AUTH_URL);
    for (const [key, value] of Object.entries({
      client_id: config.clientId!, redirect_uri: redirectUri, response_type: "code", scope: DRIVE_SCOPE,
      access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    })) url.searchParams.set(key, value);
    return url.toString();
  }

  async function tokenRequest(body: Record<string, string>) {
    const response = await fetcher(TOKEN_URL, { method: "POST", signal: AbortSignal.timeout(15_000), headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
    const data = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
    if (!response.ok || !data.access_token) throw new DriveError(response.status === 400 || response.status === 401 ? 401 : 502, data.error_description || "Google did not accept the sign-in. Try connecting again.", data.error === "invalid_grant" ? "drive_reconnect" : "drive_token");
    return data;
  }

  /** The end of the consent flow: exchange the code, keep the refresh token. */
  async function finish(params: URLSearchParams): Promise<{ userId: number; email: string | null }> {
    const state = params.get("state") ?? "";
    const saved = pending.get(state);
    pending.delete(state);
    if (!saved || saved.expires < Date.now()) throw new DriveError(400, "That sign-in link expired. Connect Google Drive again.", "drive_state");
    if (params.get("error")) throw new DriveError(400, params.get("error") === "access_denied" ? "Google Drive was not connected." : "Google could not finish connecting Drive.", "drive_denied");
    const data = await tokenRequest({ grant_type: "authorization_code", code: params.get("code") ?? "", redirect_uri: saved.redirectUri, client_id: config.clientId!, client_secret: config.clientSecret!, code_verifier: saved.verifier });
    if (!data.refresh_token) throw new DriveError(502, "Google did not grant lasting access. Connect Google Drive again.", "drive_token");
    if (data.scope && !data.scope.split(" ").includes(DRIVE_SCOPE)) throw new DriveError(403, "Breadboard needs permission to the files it creates in your Drive.", "drive_scope");
    db.prepare(`INSERT INTO drive_accounts(user_id, refresh_token, access_token, expires_at) VALUES(?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET refresh_token=excluded.refresh_token, access_token=excluded.access_token, expires_at=excluded.expires_at, folder_id=NULL, connected_at=datetime('now')`)
      .run(saved.userId, data.refresh_token, data.access_token, Date.now() + (data.expires_in ?? 3600) * 1000);
    let email: string | null = null;
    try {
      const about = await api<{ user?: { emailAddress?: string } }>(saved.userId, "GET", `${API}/about?fields=user(emailAddress)`);
      email = about.user?.emailAddress ?? null;
      db.prepare("UPDATE drive_accounts SET email=? WHERE user_id=?").run(email, saved.userId);
    } catch { /* The address is only shown in settings. */ }
    return { userId: saved.userId, email };
  }

  async function disconnect(userId: number) {
    const row = account(userId);
    db.prepare("DELETE FROM drive_accounts WHERE user_id=?").run(userId);
    if (row) await fetcher(`${REVOKE_URL}?token=${encodeURIComponent(row.refresh_token)}`, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  }

  async function accessToken(userId: number): Promise<string> {
    const row = account(userId);
    if (!row) throw new DriveError(409, "Connect Google Drive to share files with members on other machines.", "drive_required");
    if (row.access_token && row.expires_at > Date.now() + 60_000) return row.access_token;
    let data;
    try { data = await tokenRequest({ grant_type: "refresh_token", refresh_token: row.refresh_token, client_id: config.clientId!, client_secret: config.clientSecret! }); }
    catch (error) {
      // Revoked from the Google account page, or expired: the connection is gone.
      if (error instanceof DriveError && error.code === "drive_reconnect") db.prepare("DELETE FROM drive_accounts WHERE user_id=?").run(userId);
      throw error instanceof DriveError && error.code === "drive_reconnect" ? new DriveError(409, "Google Drive was disconnected. Connect it again to share files.", "drive_required") : error;
    }
    db.prepare("UPDATE drive_accounts SET access_token=?, expires_at=? WHERE user_id=?").run(data.access_token, Date.now() + (data.expires_in ?? 3600) * 1000, userId);
    return data.access_token!;
  }

  async function api<T>(userId: number, method: string, url: string, body?: unknown): Promise<T> {
    const response = await fetcher(url, { method, signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${await accessToken(userId)}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: { message?: string; errors?: Array<{ reason?: string }> } };
      const reason = data.error?.errors?.[0]?.reason;
      if (reason === "storageQuotaExceeded") throw new DriveError(507, "Your Google Drive is full. Free up space to share files.", "drive_full");
      throw new DriveError(response.status === 401 || response.status === 403 ? 403 : 502, data.error?.message || "Google Drive did not accept the request.", "drive_api");
    }
    return (response.status === 204 ? {} : await response.json()) as T;
  }

  /** The folder Breadboard keeps shared files in, made once per account. */
  async function folder(userId: number): Promise<string> {
    const known = account(userId)?.folder_id;
    if (known) return known;
    const found = await api<{ files?: Array<{ id: string }> }>(userId, "GET", `${API}/files?q=${encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`)}&fields=files(id)&pageSize=1`);
    const id = found.files?.[0]?.id ?? (await api<{ id: string }>(userId, "POST", `${API}/files?fields=id`, { name: FOLDER_NAME, mimeType: FOLDER_MIME })).id;
    db.prepare("UPDATE drive_accounts SET folder_id=? WHERE user_id=?").run(id, userId);
    return id;
  }

  /**
   * Encrypt and upload one file, readable by anyone holding its link. The name
   * in Drive says nothing about the file; its real name travels encrypted.
   */
  async function uploadEncrypted(userId: number, plain: Uint8Array, name: string): Promise<DriveFileRef> {
    if (plain.byteLength > MAX_DRIVE_FILE_BYTES) throw new DriveError(413, "Files shared through Google Drive must be under 128 MiB.", "drive_too_large");
    const { ciphertext, key } = encryptFile(plain);
    const parent = await folder(userId);
    const token = await accessToken(userId);
    const start = await fetcher(`${UPLOAD}?uploadType=resumable&fields=id`, { method: "POST", signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8", "x-upload-content-type": "application/octet-stream", "x-upload-content-length": String(ciphertext.byteLength) },
      body: JSON.stringify({ name: `breadboard-${randomBytes(9).toString("base64url")}.enc`, parents: [parent], mimeType: "application/octet-stream", description: "Encrypted by Breadboard. Only members of the organization it was shared in can open it." }) });
    const session = start.headers.get("location");
    if (!start.ok || !session) throw new DriveError(start.status === 403 ? 403 : 502, "Google Drive did not start the upload.", "drive_upload");
    const put = await fetcher(session, { method: "PUT", signal: AbortSignal.timeout(10 * 60_000), headers: { "content-type": "application/octet-stream", "content-length": String(ciphertext.byteLength) }, body: new Uint8Array(ciphertext) });
    const uploaded = await put.json().catch(() => ({})) as { id?: string };
    if (!put.ok || !uploaded.id) throw new DriveError(502, "The upload to Google Drive did not finish.", "drive_upload");
    try { await api(userId, "POST", `${API}/files/${encodeURIComponent(uploaded.id)}/permissions?fields=id`, { role: "reader", type: "anyone" }); }
    catch (error) {
      await api(userId, "DELETE", `${API}/files/${encodeURIComponent(uploaded.id)}`).catch(() => undefined);
      // Work and school accounts may forbid link sharing.
      throw new DriveError(403, "Your Google account does not allow sharing files by link, so other members could not open it.", error instanceof DriveError ? "drive_sharing_blocked" : "drive_api");
    }
    return { drive: uploaded.id, key, name: name.slice(0, 240), size: plain.byteLength };
  }

  /**
   * Fetch and decrypt a file another member shared. Tried in order: Google's
   * API with this Breadboard's API key, then the public download address for
   * link-shared files. Neither needs the reader to have Google connected.
   */
  async function downloadDecrypted(ref: DriveFileRef): Promise<Buffer> {
    if (!/^[a-zA-Z0-9_-]{10,200}$/.test(ref.drive)) throw new DriveError(400, "That file reference is not valid.", "drive_ref");
    const sources = [
      ...(config.apiKey ? [`${API}/files/${encodeURIComponent(ref.drive)}?alt=media&acknowledgeAbuse=true&key=${encodeURIComponent(config.apiKey)}`] : []),
      `https://drive.usercontent.google.com/download?id=${encodeURIComponent(ref.drive)}&export=download&confirm=t`,
    ];
    let lastStatus = 0;
    for (const source of sources) {
      const response = await fetcher(source, { signal: AbortSignal.timeout(10 * 60_000), redirect: "follow" }).catch(() => null);
      if (!response) continue;
      lastStatus = response.status;
      if (!response.ok) continue;
      // A page instead of the file (a sign-in or warning page) is not the ciphertext.
      if ((response.headers.get("content-type") ?? "").startsWith("text/html")) { lastStatus = 403; continue; }
      const declared = Number(response.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > MAX_DRIVE_FILE_BYTES + 64) throw new DriveError(413, "That file is too large.", "drive_too_large");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > MAX_DRIVE_FILE_BYTES + 64) throw new DriveError(413, "That file is too large.", "drive_too_large");
      return decryptFile(bytes, ref.key);
    }
    throw new DriveError(lastStatus === 404 ? 404 : 502, lastStatus === 404 ? "The sender removed this file from their Google Drive." : "Google Drive did not send the file. It will be tried again.", lastStatus === 404 ? "drive_gone" : "drive_download");
  }

  return { configured, status, authUrl, finish, disconnect, uploadEncrypted, downloadDecrypted };
}
export type Drive = ReturnType<typeof createDrive>;
