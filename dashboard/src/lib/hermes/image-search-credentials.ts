import crypto from "node:crypto";

import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { dashboardDataDir } from "../runtime-paths.ts";

if (typeof window !== "undefined") {
  throw new Error("Google image-search credentials are server-only.");
}

const VERSION = "v1";
const MAX_STORE_BYTES = 16 * 1024;

export interface GoogleImageCredentials {
  apiKey: string;
  searchEngineId: string;
}

export interface GoogleImageCredentialsStatus {
  available: boolean;
  configured: boolean;
}

export class GoogleImageCredentialsError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GoogleImageCredentialsError";
    this.status = status;
  }
}

function validUserId(userId: number): number {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new TypeError("Google image-search credential owner is invalid.");
  }
  return userId;
}

function credentialsDirectory(): string {
  const configured = process.env.BREADBOARD_GOOGLE_IMAGES_CREDENTIALS_DIR?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(dashboardDataDir(), "credentials", "google-images");
}

function credentialsFile(userId: number): string {
  return path.join(credentialsDirectory(), `user-${validUserId(userId)}.json`);
}

function vaultKey(): Buffer {
  const explicit = process.env.BREADBOARD_GOOGLE_IMAGES_VAULT_KEY?.trim();
  if (explicit) {
    const decoded = Buffer.from(explicit, "base64");
    if (decoded.length !== 32) {
      throw new GoogleImageCredentialsError(
        503,
        "Google Images settings are unavailable because the credential vault key is invalid.",
      );
    }
    return decoded;
  }

  const applicationSecret = process.env.NEXTAUTH_SECRET?.trim();
  if (!applicationSecret || applicationSecret.length < 16) {
    throw new GoogleImageCredentialsError(
      503,
      "Google Images settings need NEXTAUTH_SECRET before credentials can be stored.",
    );
  }
  return crypto
    .createHash("sha256")
    .update("breadboard-google-images-vault\0")
    .update(applicationSecret)
    .digest();
}

function aad(userId: number): Buffer {
  return Buffer.from(`${VERSION}:google-images:${validUserId(userId)}`, "utf8");
}

function normalizeCredentials(value: unknown): GoogleImageCredentials {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GoogleImageCredentialsError(400, "Enter a Google API key and Search Engine ID.");
  }
  const record = value as Record<string, unknown>;
  const apiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : "";
  const searchEngineId =
    typeof record.searchEngineId === "string" ? record.searchEngineId.trim() : "";
  if (
    apiKey.length < 10 ||
    apiKey.length > 512 ||
    /[\s\p{Cc}]/u.test(apiKey)
  ) {
    throw new GoogleImageCredentialsError(400, "That does not look like a Google API key.");
  }
  if (
    searchEngineId.length < 3 ||
    searchEngineId.length > 256 ||
    !/^[A-Za-z0-9:_-]+$/u.test(searchEngineId)
  ) {
    throw new GoogleImageCredentialsError(
      400,
      "That does not look like a Programmable Search Engine ID.",
    );
  }
  return { apiKey, searchEngineId };
}

function seal(userId: number, credentials: GoogleImageCredentials): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", vaultKey(), iv);
  cipher.setAAD(aad(userId));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function open(userId: number, value: string): GoogleImageCredentials {
  const [version, ivValue, tagValue, encryptedValue, ...extra] = value.split(".");
  if (version !== VERSION || !ivValue || !tagValue || !encryptedValue || extra.length) {
    throw new GoogleImageCredentialsError(
      503,
      "The stored Google Images credentials must be entered again.",
    );
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      vaultKey(),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAAD(aad(userId));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return normalizeCredentials(JSON.parse(plain) as unknown);
  } catch (error) {
    if (error instanceof GoogleImageCredentialsError) throw error;
    throw new GoogleImageCredentialsError(
      503,
      "The stored Google Images credentials must be entered again.",
    );
  }
}

function readEncryptedValue(userId: number): string | null {
  const file = credentialsFile(userId);
  let metadata;
  try {
    metadata = fs.lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > MAX_STORE_BYTES
  ) {
    throw new GoogleImageCredentialsError(
      503,
      "The stored Google Images credentials must be entered again.",
    );
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    const encryptedValue =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).encryptedValue
        : null;
    if (typeof encryptedValue !== "string" || !encryptedValue) throw new Error("invalid store");
    return encryptedValue;
  } catch (error) {
    if (error instanceof GoogleImageCredentialsError) throw error;
    throw new GoogleImageCredentialsError(
      503,
      "The stored Google Images credentials must be entered again.",
    );
  }
}

export function readGoogleImageCredentials(userId: number): GoogleImageCredentials | null {
  const encryptedValue = readEncryptedValue(userId);
  return encryptedValue ? open(userId, encryptedValue) : null;
}

export function googleImageCredentialsStatus(userId: number): GoogleImageCredentialsStatus {
  try {
    vaultKey();
  } catch {
    return { available: false, configured: false };
  }
  try {
    return { available: true, configured: readGoogleImageCredentials(userId) !== null };
  } catch {
    // A stale or damaged value can always be replaced from Profile as long as
    // the vault itself is usable.
    return { available: true, configured: false };
  }
}

export function storeGoogleImageCredentials(userId: number, value: unknown): void {
  const credentials = normalizeCredentials(value);
  const encryptedValue = seal(userId, credentials);
  const directory = credentialsDirectory();
  const file = credentialsFile(userId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const pending = `${file}.pending-${crypto.randomUUID()}`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(pending, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify({ encryptedValue })}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(pending, file);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(pending, { force: true });
  }
}

export function clearGoogleImageCredentials(userId: number): void {
  fs.rmSync(credentialsFile(userId), { force: true });
}
