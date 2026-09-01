import fs from "node:fs";

const WINDOWS_EXECUTABLE_LOCK_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);

function errorCode(error) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Windows can retain an executable lock briefly after its process exits. Retry
 * only the lock-shaped failures; missing inputs and other copy errors still
 * fail immediately.
 */
export async function copyFileWithLockRetry(
  source,
  destination,
  {
    timeoutMs = 10_000,
    intervalMs = 100,
    copyFile = fs.promises.copyFile,
    now = Date.now,
    wait = delay,
    onRetry = () => undefined,
  } = {},
) {
  const deadline = now() + timeoutMs;
  let retryReported = false;

  while (true) {
    try {
      await copyFile(source, destination);
      return;
    } catch (error) {
      const code = errorCode(error);
      if (!WINDOWS_EXECUTABLE_LOCK_CODES.has(code)) throw error;

      const remainingMs = deadline - now();
      if (remainingMs <= 0) {
        const locked = new Error(
          `Could not replace ${destination} because a previous Breadboard desktop process is still using it. ` +
            "Close the existing Breadboard dev window, wait for it to exit, and retry.",
          { cause: error },
        );
        locked.code = code;
        throw locked;
      }

      if (!retryReported) {
        retryReported = true;
        onRetry();
      }
      await wait(Math.min(intervalMs, remainingMs));
    }
  }
}
