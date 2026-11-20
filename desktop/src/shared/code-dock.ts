/** The renderer can request actions, never an executable, HWND, or command line. */
export type CodeDockAction = "status" | "open" | "download" | "choose-installation" | "detach" | { type: "layout"; top: number };
export interface CodeDockState {
  phase: "checking" | "missing" | "ready" | "downloading" | "extracting" | "opening" | "docked" | "detached" | "error" | "unsupported";
  installation?: "installed" | "managed";
  executable?: string;
  progress?: number;
  error?: string;
  canDownloadFallback?: boolean;
}
export function isCodeDockAction(value: unknown): value is CodeDockAction {
  if (typeof value === "string") return ["status", "open", "download", "choose-installation", "detach"].includes(value);
  if (!value || typeof value !== "object") return false;
  const layout = value as Record<string, unknown>;
  return Object.keys(layout).length === 2 && layout.type === "layout" && typeof layout.top === "number" && Number.isFinite(layout.top) && layout.top >= 0 && layout.top <= 512;
}
export function isCodeDockPage(url: string, dashboardUrl: string | null | undefined): boolean {
  try {
    const page = new URL(url);
    return !!dashboardUrl && page.origin === new URL(dashboardUrl).origin && /^\/code\/?$/.test(page.pathname);
  } catch { return false; }
}
