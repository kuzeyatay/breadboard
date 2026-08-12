import { shell, systemPreferences } from "electron";

export interface MicrophoneSettingsDependencies {
  platform?: NodeJS.Platform;
  openExternal?: (url: string) => Promise<void>;
  requestMacAccess?: () => Promise<boolean>;
}

/**
 * Ask the operating system for microphone access, or open the closest privacy
 * settings page when the decision has already been denied.
 */
export async function openMicrophoneSettings(
  dependencies: MicrophoneSettingsDependencies = {},
): Promise<boolean> {
  const platform = dependencies.platform ?? process.platform;
  const openExternal =
    dependencies.openExternal ?? ((url: string) => shell.openExternal(url));

  if (platform === "darwin") {
    const requestAccess =
      dependencies.requestMacAccess ??
      (() => systemPreferences.askForMediaAccess("microphone"));
    try {
      if (await requestAccess()) return true;
    } catch {
      // A denied or unavailable prompt falls through to System Settings.
    }
  }

  const settingsUrl =
    platform === "win32"
      ? "ms-settings:privacy-microphone"
      : platform === "darwin"
        ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        : null;
  if (!settingsUrl) return false;

  try {
    await openExternal(settingsUrl);
    return true;
  } catch {
    return false;
  }
}
