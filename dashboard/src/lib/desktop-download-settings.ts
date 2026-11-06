import type { DownloadSettingsState, DownloadSettingsResult } from "../../../desktop/src/shared/ipc-contract";
export type { DownloadSettingsState } from "../../../desktop/src/shared/ipc-contract";

interface DownloadSettingsBridge {
  getDownloadSettings(): Promise<DownloadSettingsState>;
  setDownloadPrompt(enabled: boolean): Promise<DownloadSettingsResult>;
  chooseDownloadDirectory(): Promise<DownloadSettingsResult>;
}

export function downloadSettingsControl(): DownloadSettingsBridge | null {
  if (typeof window === "undefined") return null;
  const desktop = (window as Window & { breadboardDesktop?: Partial<DownloadSettingsBridge> }).breadboardDesktop;
  if (typeof desktop?.getDownloadSettings !== "function" || typeof desktop.setDownloadPrompt !== "function" ||
      typeof desktop.chooseDownloadDirectory !== "function") return null;
  return {
    getDownloadSettings: () => desktop.getDownloadSettings!(),
    setDownloadPrompt: enabled => desktop.setDownloadPrompt!(enabled),
    chooseDownloadDirectory: () => desktop.chooseDownloadDirectory!(),
  };
}
