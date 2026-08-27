import * as fs from "node:fs";
import * as path from "node:path";
import type { RuntimeLaunchMode } from "./runtime-process";

const SERVICE_MANIFEST_RELATIVE_PATH = path.join(
  "runtime-v2",
  "manifests",
  "services.json",
);

/**
 * Runtime V2 readiness timeouts are bounded to seven days by the manifest
 * validator. Electron adds a small host/bootstrap allowance after the longest
 * required eager service deadline so both timers cannot expire simultaneously.
 */
export const MAX_SERVICE_READINESS_TIMEOUT_MS = 7 * 24 * 60 * 60_000;
export const RUNTIME_STARTUP_GRACE_MS = 30_000;
export const MAX_RUNTIME_STARTUP_TIMEOUT_MS =
  MAX_SERVICE_READINESS_TIMEOUT_MS + RUNTIME_STARTUP_GRACE_MS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serviceId(service: Record<string, unknown>, index: number): string {
  const id = service["id"];
  return typeof id === "string" && id.length > 0 ? id : `services[${index}]`;
}

function supportsMode(service: Record<string, unknown>, mode: RuntimeLaunchMode): boolean {
  const profiles = service["launchProfiles"];
  if (!Array.isArray(profiles)) return false;
  return profiles.some(
    (profile) =>
      isRecord(profile) &&
      Array.isArray(profile["modes"]) &&
      profile["modes"].includes(mode),
  );
}

/**
 * Derive Electron's one Runtime V2 startup deadline from the same manifest the
 * native owner will enforce. Only required eager services hold the initial
 * ready handshake closed; on-demand and optional services must not inflate it.
 */
export function runtimeInitialStartupTimeoutMs(
  runtimeRoot: string,
  mode: RuntimeLaunchMode,
): number {
  const manifestPath = path.join(runtimeRoot, SERVICE_MANIFEST_RELATIVE_PATH);
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot derive Runtime V2 startup deadline from ${manifestPath}: ${reason}`);
  }

  if (!isRecord(value) || !Array.isArray(value["services"])) {
    throw new Error("Runtime V2 service manifest cannot derive an initial startup deadline.");
  }

  let longestReadinessTimeoutMs = 0;
  for (const [index, candidate] of value["services"].entries()) {
    if (!isRecord(candidate)) {
      throw new Error(`Runtime V2 services[${index}] is invalid.`);
    }
    if (candidate["requirement"] !== "required" || candidate["startupPolicy"] !== "eager") {
      continue;
    }

    const id = serviceId(candidate, index);
    if (!supportsMode(candidate, mode)) {
      throw new Error(`Required eager Runtime V2 service ${id} has no ${mode} launch profile.`);
    }

    const readiness = candidate["readiness"];
    const timeout = isRecord(readiness) ? readiness["startupTimeoutMs"] : undefined;
    if (
      !Number.isSafeInteger(timeout) ||
      (timeout as number) < 1 ||
      (timeout as number) > MAX_SERVICE_READINESS_TIMEOUT_MS
    ) {
      throw new Error(`Required eager Runtime V2 service ${id} has an invalid startup deadline.`);
    }
    longestReadinessTimeoutMs = Math.max(longestReadinessTimeoutMs, timeout as number);
  }

  if (longestReadinessTimeoutMs === 0) {
    throw new Error(`Runtime V2 has no required eager service for ${mode} startup.`);
  }
  return longestReadinessTimeoutMs + RUNTIME_STARTUP_GRACE_MS;
}
