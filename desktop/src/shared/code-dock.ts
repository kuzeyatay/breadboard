/** The renderer can request actions, never an executable, HWND, or command line. */
/** `right` reserves CSS pixels on the right for the page's Bread rail. */
export type CodeDockAction = "status" | "open" | "download" | "choose-installation" | "detach" | { type: "layout"; top: number; right?: number };
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
  const keys = Object.keys(layout).sort().join();
  const inset = (value: unknown, max: number) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
  return (keys === "top,type" || keys === "right,top,type") && layout.type === "layout" && inset(layout.top, 512) && (layout.right === undefined || inset(layout.right, 4096));
}
export function isCodeDockPage(url: string, dashboardUrl: string | null | undefined): boolean {
  try {
    const page = new URL(url);
    return !!dashboardUrl && page.origin === new URL(dashboardUrl).origin && /^\/code\/?$/.test(page.pathname);
  } catch { return false; }
}
