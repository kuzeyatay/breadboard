export const WORKFLOWS_RETURN_PATH_KEY = "breadboard:workflows:return-path";

export type NavigationClick = {
  button: number;
  defaultPrevented: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

export function isSameTabNavigationClick(event: NavigationClick): boolean {
  return !event.defaultPrevented
    && event.button === 0
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey;
}

export function rememberWorkflowReturnPath(): void {
  try {
    const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (returnPath.startsWith("/") && !returnPath.startsWith("//") && !returnPath.startsWith("/workflows")) {
      window.sessionStorage.setItem(WORKFLOWS_RETURN_PATH_KEY, returnPath);
    }
  } catch {
    // Opening workflows must not depend on browser storage being available.
  }
}

function readWorkflowReturnPath(): string | null {
  try {
    const storedPath = window.sessionStorage.getItem(WORKFLOWS_RETURN_PATH_KEY);
    if (
      storedPath
      && storedPath.startsWith("/")
      && !storedPath.startsWith("//")
      && !storedPath.startsWith("/workflows")
    ) {
      return storedPath;
    }
  } catch {
    // The caller provides a safe fallback when browser storage is unavailable.
  }
  return null;
}

/** Read the return path without spending it, so the back control can name its destination. */
export function peekWorkflowReturnPath(): string | null {
  return readWorkflowReturnPath();
}

export function consumeWorkflowReturnPath(): string | null {
  const returnPath = readWorkflowReturnPath();
  try {
    window.sessionStorage.removeItem(WORKFLOWS_RETURN_PATH_KEY);
  } catch {
    // Storage failures only cost us the cleanup, never the navigation.
  }
  return returnPath;
}
