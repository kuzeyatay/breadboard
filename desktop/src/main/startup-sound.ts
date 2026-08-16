import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "./runtime-config";

export const STARTUP_SOUND_STATE_FILE = "startup-sound.json";

/**
 * Whether the startup screen's chime may sound.
 *
 * This lives beside the window theme rather than with the rest of the settings
 * because of when it is needed: the startup screen is shown before the
 * dashboard is running and before anyone has signed in, so nothing stored
 * per-account is reachable at the moment the question is asked. It is a
 * property of this installation, the same way the last window theme is.
 *
 * Anything unreadable, missing, or malformed leaves the sound on. Muting is a
 * deliberate choice, and a file that cannot be parsed is not one.
 */
export function readStartupSoundEnabled(configDir: string): boolean {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(configDir, STARTUP_SOUND_STATE_FILE), "utf8"),
    ) as { enabled?: unknown };
    return parsed.enabled !== false;
  } catch {
    return true;
  }
}

export function writeStartupSoundEnabled(configDir: string, enabled: boolean): void {
  fs.mkdirSync(configDir, { recursive: true });
  atomicWriteFile(
    path.join(configDir, STARTUP_SOUND_STATE_FILE),
    JSON.stringify({ enabled }, null, 2),
  );
}
