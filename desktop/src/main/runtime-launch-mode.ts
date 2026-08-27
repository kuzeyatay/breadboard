import type { DesktopMode } from "./path-resolver";
import type { RuntimeLaunchMode } from "./runtime-process";

/** Preserve the existing explicit hot/standalone development split. */
export function runtimeLaunchMode(
  desktopMode: DesktopMode,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeLaunchMode {
  if (desktopMode === "packaged") return "packaged";
  return env["BREADBOARD_DESKTOP_DASHBOARD_MODE"]?.trim().toLowerCase() === "standalone"
    ? "lean"
    : "hot";
}
