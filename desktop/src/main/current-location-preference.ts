import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "./runtime-config";

export const CURRENT_LOCATION_PREFERENCE_STATE_FILE =
  "current-location-preference.json";

/**
 * Whether this installation may use its current location in relevant answers.
 *
 * The dashboard is served from a different loopback origin after a desktop
 * restart, so localStorage cannot be the durable copy. This file stores only
 * the consent bit in the desktop configuration directory. Coordinates remain
 * in the renderer's device-local store and are refreshed after launch.
 *
 * `null` means this build has not stored a device choice yet. The dashboard
 * uses that distinction once to migrate an explicit account-backed choice;
 * malformed state otherwise remains unusable and can never enable location.
 */
export function readCurrentLocationPreference(
  configDir: string,
): boolean | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(
        path.join(configDir, CURRENT_LOCATION_PREFERENCE_STATE_FILE),
        "utf8",
      ),
    ) as { enabled?: unknown };
    return typeof parsed.enabled === "boolean" ? parsed.enabled : null;
  } catch {
    return null;
  }
}

export function writeCurrentLocationPreference(
  configDir: string,
  enabled: boolean,
): void {
  fs.mkdirSync(configDir, { recursive: true });
  atomicWriteFile(
    path.join(configDir, CURRENT_LOCATION_PREFERENCE_STATE_FILE),
    JSON.stringify({ enabled }, null, 2),
  );
}
