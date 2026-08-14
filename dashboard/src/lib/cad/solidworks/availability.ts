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
import fs from "node:fs";
import path from "node:path";
import {
  solidworksInstallPath,
  solidworksPaths,
  solidworksVersionHint,
} from "./config.ts";

export type SolidWorksAvailabilityCode =
  | "available"
  | "unsupported_os"
  | "mcp_not_configured"
  | "python_missing"
  | "dependencies_missing"
  | "solidworks_not_installed";

export interface SolidWorksAvailability {
  /** True when a build may be attempted. Says nothing about it succeeding. */
  available: boolean;
  code: SolidWorksAvailabilityCode;
  /** One sentence naming what is missing and what to do about it. */
  message: string;
  /** The clone's path when it was found. Never sent to a browser. */
  clonePath: string | null;
  /** Whether SOLIDWORKS.EXE is running right now. Null when not determined. */
  running: boolean | null;
  /** The release year, when the install path names one. */
  version: number | null;
}

/** A short label for the settings panel. Safe to show a browser. */
export function describeSolidWorksAvailability(status: {
  available: boolean;
  code: SolidWorksAvailabilityCode;
  running: boolean | null;
}): string {
  if (!status.available) {
    switch (status.code) {
      case "unsupported_os":
        return "Windows only";
      case "solidworks_not_installed":
        return "Not detected";
      case "mcp_not_configured":
        return "Bridge not configured";
      case "python_missing":
      case "dependencies_missing":
        return "Bridge dependencies missing";
      default:
        return "Unavailable";
    }
  }
  return status.running ? "Running" : "Installed, not running";
}

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

/**
 * Are the clone's Windows-only Python dependencies present?
 *
 * Checked by looking for the packages in the clone's own virtual environment
 * rather than by importing them: importing `pywin32` from Breadboard's process
 * is impossible anyway, and spawning a Python just to answer a health check
 * would make a passive probe cost seconds.
 */
function dependenciesInstalled(clone: string): boolean {
  const siteRoots =
    process.platform === "win32"
      ? [path.join(clone, ".venv", "Lib", "site-packages")]
      : [];
  for (const root of siteRoots) {
    // `fastmcp` is the server itself and `win32com` is the COM binding; either
    // one missing means the environment was never fully installed.
    if (fs.existsSync(path.join(root, "fastmcp")) && fs.existsSync(path.join(root, "win32com"))) {
      return true;
    }
  }
  return false;
}

export async function solidworksAvailability(
  env: NodeJS.ProcessEnv = process.env,
  options: { checkRunning?: boolean } = {},
): Promise<SolidWorksAvailability> {
  const base = { clonePath: null, running: null, version: null } as const;

  if (process.platform !== "win32") {
    return {
      ...base,
      available: false,
      code: "unsupported_os",
      message:
        "SolidWorks backend unavailable: SolidWorks runs on Windows only, and this machine is not Windows.",
      running: false,
    };
  }

  const paths = solidworksPaths(env);
  if (!paths.clone) {
    return {
      ...base,
      available: false,
      code: "mcp_not_configured",
      message:
        paths.cloneSource === "env"
          ? "SolidWorks backend unavailable: BREADBOARD_SOLIDWORKS_MCP_PATH does not point at a SolidworksMCP-python checkout."
          : "SolidWorks backend unavailable: configure BREADBOARD_SOLIDWORKS_MCP_PATH with the path to your SolidworksMCP-python checkout.",
    };
  }

  if (!paths.python && !paths.uv) {
    return {
      ...base,
      clonePath: paths.clone,
      available: false,
      code: "python_missing",
      message:
        "SolidWorks backend unavailable: the SolidworksMCP-python checkout has no virtual environment and `uv` was not found. Run `uv sync` in that directory.",
    };
  }

  // Only the clone's own venv can be inspected; when `uv` will create the
  // environment on first run there is nothing to look at yet, and refusing on
  // that basis would refuse a working setup.
  if (paths.python && !dependenciesInstalled(paths.clone)) {
    return {
      ...base,
      clonePath: paths.clone,
      available: false,
      code: "dependencies_missing",
      message:
        "SolidWorks backend unavailable: the SolidworksMCP-python environment is missing fastmcp or pywin32. Run `uv sync` in that directory.",
    };
  }

  const install = solidworksInstallPath(env);
  if (!install) {
    return {
      ...base,
      clonePath: paths.clone,
      available: false,
      code: "solidworks_not_installed",
      message:
        "SolidWorks backend unavailable: SolidWorks was not detected on this Windows machine.",
    };
  }

  const running = options.checkRunning === false ? null : await solidworksRunning();
  return {
    available: true,
    code: "available",
    clonePath: paths.clone,
    running,
    version: solidworksVersionHint(env),
    message: running
      ? "SolidWorks is running; a build attaches to the open session."
      : "SolidWorks is installed. A build starts it when one is needed.",
  };
}
