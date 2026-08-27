// Whether a SolidWorks build could possibly succeed on this machine, asked
// without starting anything.
//
// The states are deliberately distinct rather than one boolean, because each
// one has a different thing a person can do about it: an unsupported OS is
// permanent, a missing clone is a setting, missing dependencies are one install
// command, and "installed but not running" is not a problem at all — the bridge
// launches SolidWorks when a run actually needs it.
//
// Every probe here is a filesystem read or a process listing. Nothing touches
// COM, and nothing starts SOLIDWORKS.EXE, so `/api/cad/health` and the settings
// panel can both call it.

import { execFile } from "node:child_process";
import { inspectSolidWorksConfiguration } from "./configuration.ts";
import type { SolidWorksAvailability } from "./status.ts";

export {
  describeSolidWorksAvailability,
  type SolidWorksAvailability,
  type SolidWorksAvailabilityCode,
} from "./status.ts";

/**
 * Is SOLIDWORKS.EXE up?
 *
 * A process listing rather than a COM query, because every COM route to this
 * answer can start the application it is asking about. Answers null rather than
 * false when the listing itself fails: "we could not tell" and "it is not
 * running" lead to different sentences.
 */
export function solidworksRunning(timeoutMs = 4_000): Promise<boolean | null> {
  if (process.platform !== "win32") return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(
      "tasklist",
      ["/FI", "IMAGENAME eq SLDWORKS.exe", "/NH"],
      { timeout: timeoutMs, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve(/SLDWORKS\.exe/i.test(stdout));
      },
    );
  });
}

export async function solidworksAvailability(
  env: NodeJS.ProcessEnv = process.env,
  options: { checkRunning?: boolean } = {},
): Promise<SolidWorksAvailability> {
  const configured = inspectSolidWorksConfiguration(env);
  if (!configured.available || options.checkRunning === false) return configured;
  const running = await solidworksRunning();
  return {
    ...configured,
    running,
    message: running
      ? "SolidWorks is running; a build attaches to the open session."
      : "SolidWorks is installed. A build starts it when one is needed.",
  };
}
