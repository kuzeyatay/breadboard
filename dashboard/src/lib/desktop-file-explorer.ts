// Opening a produced file or folder where it actually lives.
//
// A folder artifact is a ZIP in the store plus the path of the directory the
// turn made. In the desktop app that path can be opened in the system file
// explorer, which is what "open the folder" means to the person who asked for
// it. In an ordinary browser there is no such bridge, and the caller falls
// back to the in-app viewer and the ZIP download.

import type { OpenLocalPathResult } from "../../../desktop/src/shared/ipc-contract";
export type { OpenLocalPathResult } from "../../../desktop/src/shared/ipc-contract";

interface FileExplorerBridge {
  openLocalPath(request: { path: string; reveal?: boolean }): Promise<OpenLocalPathResult>;
}

export function fileExplorerControl(): FileExplorerBridge | null {
  if (typeof window === "undefined") return null;
  const desktop = (window as Window & { breadboardDesktop?: Partial<FileExplorerBridge> })
    .breadboardDesktop;
  if (typeof desktop?.openLocalPath !== "function") return null;
  return {
    openLocalPath: (request) => desktop.openLocalPath!(request),
  };
}

/** The on-disk location an artifact remembers, when it has one. */
export function artifactLocalPath(
  metadata: Record<string, unknown> | undefined,
): { path: string; isFolder: boolean } | null {
  const folderPath = metadata?.folderPath;
  if (typeof folderPath === "string" && folderPath.trim()) {
    return { path: folderPath, isFolder: true };
  }
  const sourcePath = metadata?.sourcePath;
  if (typeof sourcePath === "string" && sourcePath.trim()) {
    return { path: sourcePath, isFolder: false };
  }
  return null;
}

/**
 * Open a folder in the file explorer, or reveal a file in its folder. Resolves
 * to false when there is no desktop bridge or the path is gone, so the caller
 * can fall back to the viewer instead of doing nothing.
 */
export async function openInFileExplorer(
  target: { path: string; isFolder: boolean },
): Promise<boolean> {
  const bridge = fileExplorerControl();
  if (!bridge) return false;
  try {
    const result = await bridge.openLocalPath({
      path: target.path,
      reveal: !target.isFolder,
    });
    return result.ok;
  } catch {
    return false;
  }
}
