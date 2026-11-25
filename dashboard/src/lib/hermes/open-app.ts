import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import { BreadboardUseError } from "./breadboard-use.ts";

// Opening a desktop app is the one thing the agent's own terminal cannot do:
// Runtime V2 runs every command in a kill-on-close Job Object, so an app
// started by `Start-Process` is killed the moment that command's job closes —
// it "launches" and no window ever survives. The Electron main process sits
// outside that job, so the launch is handed to it over the same private
// loopback bridge Breadboard Use already uses. Credentials never leave this
// module; the model supplies only what to open.

export interface OpenAppArgs {
  /** App name ("Mendix Studio Pro"), an absolute .exe/.lnk path, or a file to open with its default app. */
  target: string;
  /** Extra command-line arguments, for an executable target. */
  args?: string[];
  /** Working directory, for an executable target. */
  cwd?: string;
}

export function normalizeOpenAppArgs(raw: Record<string, unknown>): OpenAppArgs {
  const target = typeof raw.target === "string" ? raw.target.trim() : "";
  if (!target || target.length > 1_024) {
    throw new BreadboardUseError(400, "open_app needs a target: an app name, an absolute .exe or shortcut path, or a file to open.");
  }
  const args = Array.isArray(raw.args)
    ? raw.args.filter((value): value is string => typeof value === "string").slice(0, 32).map((value) => value.slice(0, 2_048))
    : undefined;
  const cwd = typeof raw.cwd === "string" && raw.cwd.trim() ? raw.cwd.trim().slice(0, 1_024) : undefined;
  return { target, ...(args?.length ? { args } : {}), ...(cwd ? { cwd } : {}) };
}

export async function openDesktopApp(args: OpenAppArgs, userId: number): Promise<Record<string, unknown>> {
  let access;
  try {
    access = JSON.parse(fs.readFileSync(path.join(dashboardDataDir(), "breadboard-use.json"), "utf8"));
  } catch {
    throw new BreadboardUseError(503, "Opening apps needs the Breadboard desktop app. If it is already open, restart it to load the app launcher.");
  }
  if (!access || access.protocolVersion !== 1 || !Number.isInteger(access.port) || access.port < 1024 || access.port > 65535 ||
    typeof access.token !== "string" || !/^[a-f0-9]{64}$/.test(access.token)) {
    throw new BreadboardUseError(503, "Breadboard's desktop connection is invalid. Restart the app.");
  }
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${access.port}/open-app`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${access.token}` },
      body: JSON.stringify({ ...args, userId }), redirect: "error", signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new BreadboardUseError(503, "Breadboard's desktop did not respond. Check that it is open, then retry once.");
  }
  let result;
  try { result = await response.json(); }
  catch { throw new BreadboardUseError(502, "Breadboard returned an invalid response to the launch."); }
  if (!response.ok) {
    if (response.status === 404) {
      throw new BreadboardUseError(503, "This Breadboard desktop build predates the app launcher. Restart Breadboard to load it.");
    }
    throw new BreadboardUseError(response.status, typeof result?.error === "string"
      ? result.error.slice(0, 400) : "Breadboard could not open that app.");
  }
  return result;
}
