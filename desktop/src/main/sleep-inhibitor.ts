export interface PowerSaveBlocker {
  start(type: "prevent-app-suspension"): number;
  stop(id: number): void;
}

/** Keep the computer awake for the lifetime of the Electron application. */
export function inhibitSystemSleepUntilQuit(
  blocker: PowerSaveBlocker,
  onWillQuit: (listener: () => void) => void,
): number {
  const blockerId = blocker.start("prevent-app-suspension");
  onWillQuit(() => blocker.stop(blockerId));
  return blockerId;
}
