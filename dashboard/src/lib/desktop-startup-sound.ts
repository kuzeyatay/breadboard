/**
 * The chime the desktop app plays while it opens, and the one switch that
 * silences it.
 *
 * The preference cannot live where the rest of the settings live. The startup
 * screen that plays the sound is shown before the dashboard is serving anything
 * and before anyone has signed in, so an account setting is unreadable at the
 * only moment it would be needed. The Electron shell holds it instead, beside
 * the last window theme, and both sides ask the shell for it.
 *
 * That also means the switch has nothing to control in a browser: there is no
 * startup screen there and no shell to ask. Callers check `startupSoundControl`
 * first and leave the setting out entirely when it comes back null.
 */

export interface StartupSoundControl {
  read(): Promise<boolean>;
  write(enabled: boolean): Promise<boolean>;
}

interface DesktopSoundBridge {
  getStartupSound?: () => Promise<boolean>;
  setStartupSound?: (enabled: boolean) => Promise<boolean>;
}

function bridge(): DesktopSoundBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { breadboardDesktop?: DesktopSoundBridge }).breadboardDesktop;
}

/** The control, or null anywhere the startup sound does not exist to be muted. */
export function startupSoundControl(): StartupSoundControl | null {
  const desktop = bridge();
  const read = desktop?.getStartupSound;
  const write = desktop?.setStartupSound;
  if (typeof read !== "function" || typeof write !== "function") return null;
  return {
    // An unanswerable read reports the sound as on, which is what an install
    // that has never been switched off actually does.
    read: () => Promise.resolve(read.call(desktop)).then((enabled) => enabled !== false, () => true),
    write: (enabled) =>
      Promise.resolve(write.call(desktop, enabled)).then((ok) => ok === true, () => false),
  };
}
