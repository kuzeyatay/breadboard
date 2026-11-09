import type { CodeDockAction, CodeDockState } from "../../../desktop/src/shared/code-dock";
export type { CodeDockAction, CodeDockState };
export function desktopCodeBridge(): { codeDock(action: CodeDockAction): Promise<CodeDockState> } | null {
  if (typeof window === "undefined") return null;
  const desktop = (window as Window & { breadboardDesktop?: { codeDock?: (action: CodeDockAction) => Promise<CodeDockState> } }).breadboardDesktop;
  return typeof desktop?.codeDock === "function" ? desktop as { codeDock(action: CodeDockAction): Promise<CodeDockState> } : null;
}
