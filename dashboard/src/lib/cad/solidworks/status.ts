export type SolidWorksAvailabilityCode =
  | "available"
  | "unsupported_os"
  | "mcp_not_configured"
  | "python_missing"
  | "dependencies_missing"
  | "solidworks_not_installed";

export interface SolidWorksAvailability {
  available: boolean;
  code: SolidWorksAvailabilityCode;
  message: string;
  clonePath: string | null;
  running: boolean | null;
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
