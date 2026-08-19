// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/lib/core/security/encryption.ts
// folded together with packages/security/src/encryption.ts (the AES-256-GCM primitive it
// wraps); adapted for Breadboard. Only the decrypt half is reachable from the engine:
// the resolved-secret trace registry decrypts provenance entries that a subflow parent
// encrypted. Breadboard never writes those, so decryption only ever runs on values this
// process produced within the same run.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createLogger } from "@/lib/sim/core/logger";
import { getEnv } from "@/lib/sim/core/core/config/env";
import { toError } from "@/lib/sim/core/utils/errors";

const logger = createLogger("Encryption");

/** Process-lifetime fallback: sim requires an operator-set ENCRYPTION_KEY; Breadboard's
 * engine only round-trips secrets inside one run, so an ephemeral key is sufficient and
 * avoids a hard startup dependency. */
let ephemeralKey: Buffer | undefined;

function getEncryptionKey(): Buffer {
  const key = getEnv("ENCRYPTION_KEY");
  if (key && key.length === 64) return Buffer.from(key, "hex");
  if (!ephemeralKey) ephemeralKey = randomBytes(32);
  return ephemeralKey;
}

export async function encryptSecret(secret: string): Promise<{ encrypted: string; iv: string }> {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  let encrypted = cipher.update(secret, "utf8", "hex");
  encrypted += cipher.final("hex");
  const ivHex = iv.toString("hex");
  return {
    encrypted: `${ivHex}:${encrypted}:${cipher.getAuthTag().toString("hex")}`,
    iv: ivHex,
  };
}

export async function decryptSecret(encryptedValue: string): Promise<{ decrypted: string }> {
  try {
    const parts = encryptedValue.split(":");
    if (parts.length < 3) {
      throw new Error('Invalid encrypted value format. Expected "iv:encrypted:authTag"');
    }
    const ivHex = parts[0];
    const authTagHex = parts[parts.length - 1];
    const encrypted = parts.slice(1, -1).join(":");
    if (!ivHex || !authTagHex) {
      throw new Error('Invalid encrypted value format. Expected "iv:encrypted:authTag"');
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(ivHex, "hex"),
      { authTagLength: 16 },
    );
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return { decrypted };
  } catch (error) {
    logger.error("Decryption error:", { error: toError(error).message });
    throw error;
  }
}
