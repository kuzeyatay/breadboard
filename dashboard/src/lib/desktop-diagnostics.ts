/**
 * The desktop-only control behind the Profile page's "Export diagnostics"
 * button. The shell writes a zip of its redacted report, rotated logs and
 * recent crash dumps wherever the person chooses; nothing leaves the machine.
 */
export interface BreadboardDiagnosticsControl {
  /** Resolves with the saved path, or null when the person cancelled. */
  exportBundle(): Promise<string | null>;
}

interface DesktopDiagnosticsBridge {
  exportDiagnostics?: () => Promise<string | null>;
}

function bridge(): DesktopDiagnosticsBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { breadboardDesktop?: DesktopDiagnosticsBridge })
    .breadboardDesktop;
}

/** Null in an ordinary browser, which has no access to the shell's logs. */
export function breadboardDiagnosticsControl(): BreadboardDiagnosticsControl | null {
  const desktop = bridge();
  const exportDiagnostics = desktop?.exportDiagnostics;
  if (typeof exportDiagnostics !== "function") return null;
  return {
    exportBundle: () =>
      Promise.resolve(exportDiagnostics.call(desktop)).then((saved) =>
        typeof saved === "string" && saved ? saved : null,
      ),
  };
}
