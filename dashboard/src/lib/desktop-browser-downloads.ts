import type { BrowserDownloadCommand, BrowserDownloadsSnapshot } from "../../../desktop/src/shared/ipc-contract";
export type { BrowserDownload, BrowserDownloadCommand, BrowserDownloadsSnapshot } from "../../../desktop/src/shared/ipc-contract";

interface DownloadsBridge {
  getBrowserDownloads(): Promise<BrowserDownloadsSnapshot>;
  browserDownloadCommand(command: BrowserDownloadCommand): Promise<{ ok: boolean; error?: string }>;
}

export function browserDownloadsControl(): DownloadsBridge | null {
  if (typeof window === "undefined") return null;
  const desktop = (window as Window & { breadboardDesktop?: Partial<DownloadsBridge> }).breadboardDesktop;
  if (typeof desktop?.getBrowserDownloads !== "function" || typeof desktop.browserDownloadCommand !== "function") return null;
  return {
    getBrowserDownloads: () => desktop.getBrowserDownloads!(),
    browserDownloadCommand: (command) => desktop.browserDownloadCommand!(command),
  };
}
