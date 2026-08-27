/**
 * Describing the OS microphone privacy page for the browser fallback.
 *
 * Electron opens the page through its narrow, sender-checked IPC handler. A
 * plain browser has no equivalent trusted desktop authority, so its loopback
 * route returns the constant URI for the existing manual instructions without
 * pretending that the server opened anything.
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

/** Truthful browser fallback when no trusted desktop shell is attached. */
export function microphonePrivacyPageFallback(
  platform: NodeJS.Platform = process.platform,
): MicrophoneSettingsLaunch {
  const uri = MICROPHONE_SETTINGS_URI[platform];
  if (!uri) {
    return {
      opened: false,
      uri: null,
      reason: "This system has no microphone privacy page Breadboard can open.",
    };
  }
  return {
    opened: false,
    uri,
    reason: "Open this privacy page from the system settings instructions.",
  };
}
