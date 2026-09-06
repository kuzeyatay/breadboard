import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { dashboardDataDir } from "../runtime-paths.ts";

/** Expected desktop failures must survive the route's secret-safe error mapper. */
export class BreadboardUseError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BreadboardUseError";
    this.status = status;
  }
}

/** Credentials remain between the dashboard and its Electron owner. They
 * never enter the model context, tool arguments, or a browser renderer. */
export async function useBreadboard(args: Record<string, unknown>, sessionId: string, userId: number) {
  let access;
  try {
    access = JSON.parse(fs.readFileSync(path.join(dashboardDataDir(), "breadboard-use.json"), "utf8"));
  } catch {
    throw new BreadboardUseError(503, "Open the Breadboard desktop app to use breadboard-use. If it is already open, restart it to load the new skill bridge.");
  }
  if (!access || access.protocolVersion !== 1 || !Number.isInteger(access.port) || access.port < 1024 || access.port > 65535 ||
    typeof access.token !== "string" || !/^[a-f0-9]{64}$/.test(access.token)) {
    throw new BreadboardUseError(503, "Breadboard's desktop connection is invalid. Restart the app.");
  }
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${access.port}/breadboard-use`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${access.token}` },
      body: JSON.stringify({ args, sessionId, userId }), redirect: "error", signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new BreadboardUseError(503, "Breadboard's desktop did not respond. Check that it is open; inspect state before retrying an action.");
  }
  let result;
  try { result = await response.json(); }
  catch { throw new BreadboardUseError(502, "Breadboard returned an invalid response. Read fresh state before retrying."); }
  if (!response.ok) {
    throw new BreadboardUseError(response.status, typeof result?.error === "string"
      ? result.error.slice(0, 200) : "Breadboard could not perform this action.");
  }
  return result;
}
