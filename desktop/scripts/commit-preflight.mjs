import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function strictInteger(raw, fallback, key, min, max) {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${key} must be a whole number.`);
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be between ${min} and ${max}.`);
  }
  return value;
}

export function assertWindowsCommitHeadroom({ operation, estimateMb }) {
  if (process.platform !== "win32") return null;
  const sampled = spawnSync(
    "powershell.exe",
    [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-File",
      path.join(repoRoot, "qa", "memory", "windows-sampler.ps1"),
    ],
    { input: "sample\n", encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
  );
  if (sampled.status !== 0) {
    throw new Error(`Cannot verify Windows commit headroom before ${operation}; refusing the heavy start.`);
  }
  const line = sampled.stdout.split(/\r?\n/).map((value) => value.trim()).find(Boolean);
  const snapshot = line ? JSON.parse(line) : null;
  if (!snapshot || !Number.isFinite(snapshot.commitTotalMb) || !Number.isFinite(snapshot.commitLimitMb)) {
    throw new Error(`Windows returned no valid commit sample before ${operation}; refusing the heavy start.`);
  }
  const reserveDefault = Math.min(12_288, Math.max(1_536, Math.round(snapshot.commitLimitMb * 0.2)));
  const reserveMb = strictInteger(
    process.env.BREADBOARD_MIN_FREE_COMMIT_MB,
    reserveDefault,
    "BREADBOARD_MIN_FREE_COMMIT_MB",
    1_024,
    32_768,
  );
  const freeMb = snapshot.commitLimitMb - snapshot.commitTotalMb;
  const requiredMb = reserveMb + estimateMb;
  if (freeMb < requiredMb) {
    const error = new Error(
      `${operation} denied: ${Math.round(freeMb)} MB free Windows commit cannot preserve ` +
      `the ${reserveMb} MB reserve plus the ${estimateMb} MB build estimate.`,
    );
    error.code = "BREADBOARD_RESOURCE_EXHAUSTED";
    throw error;
  }
  return { freeMb, reserveMb, estimateMb };
}
