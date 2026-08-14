/**
 * Getting one coarse fix, from whichever source on this machine can give one.
 *
 * A page has two ways to learn where it is, and which one works depends on
 * where the page is being shown. In a browser, `navigator.geolocation` is the
 * whole answer. In the Electron desktop shell it never succeeds: Chromium
 * resolves position through Google's location service, the key for that call is
 * baked into a browser build, and Electron ships without one. The failure looks
 * exactly like a refusal, which is why the Profile card used to read "Blocked"
 * on a machine whose location was switched on and working.
 *
 * So the shell asks the Breadboard server instead — it runs on this very
 * computer — and the server asks the operating system. Each surface tries the
 * source that can actually answer for it first, and falls back to the other.
 */

export interface CurrentLocationFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  /** Which source answered, so a caller can say so. */
  source: "browser" | "system";
}

/**
 * `blocked` is the one a person can act on: something refused, and the fix is a
 * settings page. `unavailable` means nothing refused and nothing answered.
 */
export type CurrentLocationFailureKind = "blocked" | "unavailable";

export interface CurrentLocationFailure {
  ok: false;
  kind: CurrentLocationFailureKind;
  message: string;
}

export type CurrentLocationAttempt = { ok: true; fix: CurrentLocationFix } | CurrentLocationFailure;

interface DesktopLocationBridge {
  allowThemeLocation?: () => Promise<boolean>;
}

function desktopBridge(): DesktopLocationBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { breadboardDesktop?: DesktopLocationBridge }).breadboardDesktop;
}

/** True inside the Electron shell, where the browser source cannot work. */
export function inDesktopShell(): boolean {
  return typeof desktopBridge()?.allowThemeLocation === "function";
}

const BROWSER_BLOCKED =
  "Allow location in your browser or system settings, then try again.";
const NOTHING_ANSWERED =
  "Breadboard could not determine this device's location. Check location services and try again.";

/**
 * Ask the browser. The shell's permission is opened first: it is granted per
 * request on an explicit click, so no renderer holds geolocation by default.
 */
function browserFix(maxAgeMs: number): Promise<CurrentLocationAttempt> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return Promise.resolve({
      ok: false,
      kind: "unavailable",
      message: "This browser does not provide device location.",
    });
  }
  return new Promise((resolve) => {
    void Promise.resolve(desktopBridge()?.allowThemeLocation?.())
      .catch(() => false)
      .then(() => {
        navigator.geolocation.getCurrentPosition(
          (position) =>
            resolve({
              ok: true,
              fix: {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracyMeters: position.coords.accuracy,
                source: "browser",
              },
            }),
          (failure) =>
            resolve(
              failure.code === failure.PERMISSION_DENIED
                ? { ok: false, kind: "blocked", message: BROWSER_BLOCKED }
                : { ok: false, kind: "unavailable", message: NOTHING_ANSWERED },
            ),
          { enableHighAccuracy: false, maximumAge: maxAgeMs, timeout: 8_000 },
        );
      });
  });
}

/** Ask the operating system, through the server running on this machine. */
async function systemFix(): Promise<CurrentLocationAttempt> {
  try {
    const response = await fetch("/api/profile/device-location", { method: "POST" });
    const result = (await response.json()) as {
      state?: string;
      reason?: string;
      latitude?: number;
      longitude?: number;
      accuracyMeters?: number;
    };
    if (
      result.state === "available" &&
      typeof result.latitude === "number" &&
      typeof result.longitude === "number"
    ) {
      return {
        ok: true,
        fix: {
          latitude: result.latitude,
          longitude: result.longitude,
          accuracyMeters:
            typeof result.accuracyMeters === "number" ? result.accuracyMeters : 50_000,
          source: "system",
        },
      };
    }
    if (result.state === "blocked") {
      return {
        ok: false,
        kind: "blocked",
        message: result.reason || "This computer is blocking location access.",
      };
    }
    return { ok: false, kind: "unavailable", message: result.reason || NOTHING_ANSWERED };
  } catch {
    return { ok: false, kind: "unavailable", message: NOTHING_ANSWERED };
  }
}

/**
 * The first fix either source can produce.
 *
 * When both fail, a refusal is reported over an empty answer: it names
 * something the person can actually go and change.
 */
export async function requestCurrentLocationFix(
  options: { maxAgeMs?: number } = {},
): Promise<CurrentLocationAttempt> {
  const maxAgeMs = options.maxAgeMs ?? 15 * 60_000;
  const sources = inDesktopShell()
    ? [systemFix, () => browserFix(maxAgeMs)]
    : [() => browserFix(maxAgeMs), systemFix];

  let failure: CurrentLocationFailure | null = null;
  for (const source of sources) {
    const attempt = await source();
    if (attempt.ok) return attempt;
    if (!failure || (attempt.kind === "blocked" && failure.kind !== "blocked")) {
      failure = attempt;
    }
  }
  return failure ?? { ok: false, kind: "unavailable", message: NOTHING_ANSWERED };
}
