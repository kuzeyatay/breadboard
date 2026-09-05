/** The desktop-only control used by the Profile page's restart button. */
export interface BreadboardRestartControl {
  restart(): Promise<boolean>;
}

interface DesktopRestartBridge {
  restartBreadboard?: () => Promise<boolean>;
}

function bridge(): DesktopRestartBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { breadboardDesktop?: DesktopRestartBridge })
    .breadboardDesktop;
}

/**
 * Returns null in an ordinary browser, where a page cannot restart the local
 * Breadboard application and should not pretend that reloading is equivalent.
 */
export function breadboardRestartControl(): BreadboardRestartControl | null {
  const desktop = bridge();
  const restart = desktop?.restartBreadboard;
  if (typeof restart !== "function") return null;
  return {
    restart: () =>
      Promise.resolve(restart.call(desktop)).then(
        (accepted) => accepted === true,
        () => false,
      ),
  };
}
