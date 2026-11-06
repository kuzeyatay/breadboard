import crypto from "node:crypto";
import fs from "node:fs";
import readline from "node:readline";

export const VERIFICATION_RECEIPTS = ".breadboard-migration-verified.jsonl";

// Bind to the current file, not just a path or a restored modification time.
// Full precision comes from bigint stat, including Windows file identity.
export function fileIdentity(stat) {
  if (!stat?.isFile() || stat.isSymbolicLink()) return null;
  return crypto.createHash("sha256").update([
    stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.birthtimeNs,
  ].map(value => value.toString()).join(":")).digest("hex");
}

export async function openVerificationLedger({file, source, destination, entries, validatePath, onProgress}) {
  const header = {version: 1, source, destination, algorithm: "sha256", identity: "bigint-stat-v1"};
  const receipts = new Map();
  const hex = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  const metadata = fs.lstatSync(file, {throwIfNoEntry: false});
  let invalidated = false;
  if (metadata) {
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Verification receipts must be a direct file.");
    let first = true, validBytes = 0;
    try {
      const lines = readline.createInterface({input: fs.createReadStream(file), crlfDelay: Infinity});
      for await (const line of lines) {
        const nextBytes = validBytes + Buffer.byteLength(line) + 1;
        if (nextBytes > metadata.size) break;
        const value = JSON.parse(line);
        validBytes = nextBytes;
        if (first) {
          if (JSON.stringify(value) !== JSON.stringify(header)) throw new Error("Receipt identity mismatch.");
          first = false;
        } else {
          validatePath(value.relative);
          if (!hex(value.source) || !hex(value.target) || !hex(value.sha256)) throw new Error("Invalid verification receipt.");
          const entry = entries.get(value.relative);
          if (entry?.kind === "file") receipts.set(entry.relative, value.source + value.target + value.sha256);
        }
      }
      if (first) throw new Error("Missing verification receipt identity.");
      if (validBytes !== metadata.size) fs.truncateSync(file, validBytes);
    } catch {
      // Corrupt or foreign cache data never grants reuse. Preserve it separately
      // and perform full hashes again, including for previously verified files.
      receipts.clear();
      fs.renameSync(file, `${file}.invalid-${Date.now()}`);
      invalidated = true;
    }
  }
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(header) + "\n", {flag: "wx", mode: 0o600});
  const fd = fs.openSync(file, "a");
  let buffer = "", closed = false;
  function flush() {
    if (buffer) { fs.writeSync(fd, buffer); buffer = ""; }
  }
  onProgress({phase: "verification-receipts", reusableFiles: receipts.size, invalidated});
  return {
    lookup(relative, sourceIdentity, targetIdentity) {
      if (!sourceIdentity || !targetIdentity) return null;
      const stored = receipts.get(relative);
      return stored?.startsWith(sourceIdentity + targetIdentity) ? stored.slice(128) : null;
    },
    record(relative, sourceIdentity, targetIdentity, sha256) {
      if (!sourceIdentity || !targetIdentity) return;
      const value = sourceIdentity + targetIdentity + sha256;
      if (receipts.get(relative) === value) return;
      receipts.set(relative, value);
      buffer += JSON.stringify({relative, source: sourceIdentity, target: targetIdentity, sha256}) + "\n";
      if (buffer.length >= 1024 * 1024) flush();
    },
    close() {
      if (closed) return;
      closed = true;
      try { flush(); } finally { fs.closeSync(fd); }
    },
  };
}
