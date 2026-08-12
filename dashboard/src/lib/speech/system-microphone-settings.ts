import { spawn } from "node:child_process";

/**
 * Opening the OS microphone privacy page from the server side.
 *
 * The page can offer a `ms-settings:` link, but browsers decide for themselves
 * whether to hand an external protocol to Windows: Firefox generally refuses,
 * and Chromium hides it behind a confirmation that can be permanently silenced
 * by one stray "cancel". The button then does nothing at all, which is worse
 * than the error it was meant to fix.
 *
 * Breadboard runs on the same machine as the browser showing it, so the server
 * can launch the settings page itself and be certain it opened. That only holds
 * for a loopback request — hence the guard, which keeps a remotely served
 * instance from opening windows on the host instead of the viewer's machine.
 */

/** The privacy page each OS registers a protocol handler for. */
export const MICROPHONE_SETTINGS_URI: Partial<Record<NodeJS.Platform, string>> = {
  win32: "ms-settings:privacy-microphone",
  darwin: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
};

export interface MicrophoneSettingsLaunch {
  opened: boolean;
  /** The address the user can still open by hand when the launch fails. */
  uri: string | null;
  reason?: string;
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

export function isLoopbackHostname(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  const bare = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return LOOPBACK_HOSTNAMES.has(bare) || LOOPBACK_HOSTNAMES.has(`[${bare}]`) || bare.startsWith("127.");
}

/** The hostname the request was addressed to, proxies included. */
export function requestHostname(request: Request): string | null {
  const candidates = [request.headers.get("x-forwarded-host"), request.headers.get("host"), null];
  for (const candidate of candidates) {
    const first = candidate?.split(",")[0]?.trim();
    if (!first) continue;
    try {
      return new URL(`http://${first}`).hostname;
    } catch {
      // Try the next candidate.
    }
  }
  try {
    return new URL(request.url).hostname;
  } catch {
    return null;
  }
}

/**
 * Launch the microphone privacy page, detached: Settings has to outlive the
 * request that opened it.
 */
export function openMicrophonePrivacyPage(
  platform: NodeJS.Platform = process.platform,
): Promise<MicrophoneSettingsLaunch> {
  const uri = MICROPHONE_SETTINGS_URI[platform];
  if (!uri) {
    return Promise.resolve({
      opened: false,
      uri: null,
      reason: "This system has no microphone privacy page Breadboard can open.",
    });
  }

  return new Promise((resolve) => {
    const failed = (reason: string) => resolve({ opened: false, uri, reason });
    try {
      // The URI is a constant, so cmd's `start` never sees anything the user
      // typed; the empty string is `start`'s window-title argument.
      const child =
        platform === "darwin"
          ? spawn("open", [uri], { detached: true, stdio: "ignore" })
          : spawn(process.env.ComSpec || "cmd.exe", ["/c", "start", "", uri], {
              detached: true,
              stdio: "ignore",
              windowsHide: true,
            });
      child.once("error", () => failed("Breadboard could not start the settings app."));
      child.once("spawn", () => {
        child.unref();
        resolve({ opened: true, uri });
      });
    } catch {
      failed("Breadboard could not start the settings app.");
    }
  });
}
