import crypto from "node:crypto";

import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { dashboardDataDir } from "../runtime-paths.ts";

if (typeof window !== "undefined") {
  throw new Error("Google image-generation credentials are server-only.");
}

const VERSION = "v1";
const MAX_STORE_BYTES = 16 * 1024;

export interface GoogleImageGenerationCredentials {
  apiKey: string;
}

export interface GoogleImageGenerationCredentialsStatus {
  available: boolean;
  configured: boolean;
}

export class GoogleImageGenerationCredentialsError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GoogleImageGenerationCredentialsError";
    this.status = status;
  }
}

function validUserId(userId: number): number {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new TypeError("Google image-generation credential owner is invalid.");
  }
  return userId;
}

function credentialsDirectory(): string {
  const configured = process.env.BREADBOARD_GOOGLE_IMAGE_GENERATION_CREDENTIALS_DIR?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(dashboardDataDir(), "credentials", "google-image-generation");
}

function credentialsFile(userId: number): string {
  return path.join(credentialsDirectory(), `user-${validUserId(userId)}.json`);
}

function vaultKey(): Buffer {
  const explicit = process.env.BREADBOARD_GOOGLE_IMAGE_GENERATION_VAULT_KEY?.trim();
  if (explicit) {
    const decoded = Buffer.from(explicit, "base64");
    if (decoded.length !== 32) {
      throw new GoogleImageGenerationCredentialsError(
        503,
        "Google image-generation settings are unavailable because the credential vault key is invalid.",
      );
    }
    return decoded;
  }

  const applicationSecret = process.env.NEXTAUTH_SECRET?.trim();
  if (!applicationSecret || applicationSecret.length < 16) {
    throw new GoogleImageGenerationCredentialsError(
      503,
      "Google image-generation settings need NEXTAUTH_SECRET before an API key can be stored.",
    );
  }
  return crypto
    .createHash("sha256")
    .update("breadboard-google-image-generation-vault\0")
    .update(applicationSecret)
    .digest();
}

function aad(userId: number): Buffer {
  return Buffer.from(`${VERSION}:google-image-generation:${validUserId(userId)}`, "utf8");
}

function normalizeCredentials(value: unknown): GoogleImageGenerationCredentials {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GoogleImageGenerationCredentialsError(400, "Enter a Google Gemini API key.");
  }
  const record = value as Record<string, unknown>;
  const apiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : "";
  if (apiKey.length < 10 || apiKey.length > 512 || /[\s\p{Cc}]/u.test(apiKey)) {
    throw new GoogleImageGenerationCredentialsError(
      400,
      "That does not look like a Google Gemini API key.",
    );
  }
  return { apiKey };
}

function seal(userId: number, credentials: GoogleImageGenerationCredentials): string {
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

function open(userId: number, value: string): GoogleImageGenerationCredentials {
  const [version, ivValue, tagValue, encryptedValue, ...extra] = value.split(".");
  if (version !== VERSION || !ivValue || !tagValue || !encryptedValue || extra.length) {
    throw new GoogleImageGenerationCredentialsError(
      503,
      "The stored Google image-generation API key must be entered again.",
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
    if (error instanceof GoogleImageGenerationCredentialsError) throw error;
    throw new GoogleImageGenerationCredentialsError(
      503,
      "The stored Google image-generation API key must be entered again.",
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
    throw new GoogleImageGenerationCredentialsError(
      503,
      "The stored Google image-generation API key must be entered again.",
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
    if (error instanceof GoogleImageGenerationCredentialsError) throw error;
    throw new GoogleImageGenerationCredentialsError(
      503,
      "The stored Google image-generation API key must be entered again.",
    );
  }
}

export function readGoogleImageGenerationCredentials(
  userId: number,
): GoogleImageGenerationCredentials | null {
  const encryptedValue = readEncryptedValue(userId);
  return encryptedValue ? open(userId, encryptedValue) : null;
}

export function googleImageGenerationCredentialsStatus(
  userId: number,
): GoogleImageGenerationCredentialsStatus {
  try {
    vaultKey();
  } catch {
    return { available: false, configured: false };
  }
  try {
    return {
      available: true,
      configured: readGoogleImageGenerationCredentials(userId) !== null,
    };
  } catch {
    return { available: true, configured: false };
  }
}

export function storeGoogleImageGenerationCredentials(userId: number, value: unknown): void {
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

export function clearGoogleImageGenerationCredentials(userId: number): void {
  fs.rmSync(credentialsFile(userId), { force: true });
}
