import { delay, runHealthProbe, type HealthCheckSpec } from "./health-checker";
import type { ResolvedPaths } from "./path-resolver";
import type { PersistentDesktopConfig } from "./runtime-config";
import { cliproxyApiKey, cliproxyHome } from "./cliproxy";

/**
 * Recognising a Breadboard service that is already running.
 *
 * Startup used to be unconditional: every launch spawned a fresh copy of every
 * service, and `allocatePort` quietly moved anything whose preferred port was
 * taken onto an OS-assigned one. Starting the desktop app while `npm run dev`
 * was up therefore ran two ChatMocks, two Quartz servers and two dev servers
 * against the same data — invisible until the machine ran out of commit.
 *
 * A probe here answers one question: *is the thing already listening on this
 * port an instance of this service that we can actually use?* "Use" is the
 * operative word — every Breadboard service secret is persisted per install
 * (`runtime-config.ts`), so an instance from an earlier desktop launch answers
 * with our credentials while a foreign one (a dev stack, which mints its own)
 * does not. Only the first is adoptable; the second still relocates to a spare
 * port exactly as before, because sharing a port with it is impossible and
 * talking to it would 401 on the first real request.
 *
 * These probes deliberately hit *credential-gated* endpoints wherever the
 * service has one. An open `/health` proves a service of the right kind is
 * there; it does not prove the running instance will accept us.
 */
export interface AdoptionContext {
  persistent: PersistentDesktopConfig;
  paths: ResolvedPaths;
}

const loopback = (port: number): string => `http://127.0.0.1:${port}`;

/**
 * Status codes that mean "the gate let us through". A gated endpoint answers
 * 401 (or 403) to a caller holding the wrong secret and something else — a
 * route-level 404, a validation 400, a method 405 — once the secret matched.
 */
const AUTHENTICATED = [200, 204, 400, 404, 405];

/**
 * The probe that proves an instance of `serviceId` on `port` is ours, or null
 * for services we never adopt (no way to tell one instance from another).
 */
export function adoptionProbe(
  serviceId: string,
  port: number,
  context: AdoptionContext,
): HealthCheckSpec | null {
  const { persistent, paths } = context;
  const base = loopback(port);
  switch (serviceId) {
    case "dashboard":
      // Detection-only. AppLifecycle uses this to refuse an already-running
      // dashboard because adopting it would leave no PID for tree accounting.
      return { type: "http", url: `${base}/api/health`, expectBodyIncludes: '"status":"ok"', timeoutMs: 2_500 };
    case "chatmock":
      return { type: "http", url: `${base}/health`, timeoutMs: 2_500 };
    case "hermes":
      // /api/status is a public liveness probe, so it cannot tell our Hermes
      // from a dev stack's. Any other /api/ path is gated on the session token
      // *before* routing: a wrong token is 401, a right one falls through to a
      // 404 for this deliberately non-existent path.
      return {
        type: "http",
        url: `${base}/api/__breadboard_adoption_probe`,
        headers: { Authorization: `Bearer ${persistent.hermesSessionToken}` },
        acceptStatuses: AUTHENTICATED,
        timeoutMs: 2_500,
      };
    case "quartz":
      return { type: "http", url: `${base}/__health`, expectBodyIncludes: '"ready":true', timeoutMs: 2_500 };
    case "gbrain":
      // /health is unauthenticated; every other route is a POST behind the
      // adapter secret. An empty body reaches the handler only once the bearer
      // matched, and comes back as a 400 rather than a 401.
      return {
        type: "http",
        url: `${base}/search`,
        method: "POST",
        body: "{}",
        headers: {
          Authorization: `Bearer ${persistent.gbrainAdapterSecret}`,
          "Content-Type": "application/json",
        },
        acceptStatuses: AUTHENTICATED,
        timeoutMs: 2_500,
      };
    case "ui-tars":
      return {
        type: "http",
        url: `${base}/health`,
        headers: { Authorization: `Bearer ${persistent.uiTarsAdapterSecret}` },
        timeoutMs: 2_500,
      };
    case "cad":
      return {
        type: "http",
        url: `${base}/health`,
        headers: { Authorization: `Bearer ${persistent.cadServiceSecret}` },
        timeoutMs: 2_500,
      };
    case "colpali":
      return {
        type: "http",
        url: `${base}/health`,
        headers: { Authorization: `Bearer ${persistent.colpaliServiceSecret}` },
        timeoutMs: 2_500,
      };
    case "humanizer":
      return {
        type: "http",
        url: `${base}/health`,
        headers: { Authorization: `Bearer ${persistent.humanizerServiceSecret}` },
        timeoutMs: 2_500,
      };
    case "cliproxy":
      // The proxy's bearer lives in a file under CLIPROXY_HOME and is shared by
      // every launcher on this install, so answering it identifies our instance.
      return {
        type: "http",
        url: `${base}/v1/models`,
        headers: { Authorization: `Bearer ${cliproxyApiKey(cliproxyHome(paths))}` },
        timeoutMs: 2_500,
      };
    case "voicebox":
      return { type: "http", url: `${base}/health`, timeoutMs: 2_500 };
    case "scriberr":
      // Scriberr's account credentials are persisted per install too, but its
      // /health needs none of them and the sidecar is single-purpose: something
      // answering it on Scriberr's port is Scriberr.
      return { type: "http", url: `${base}/health`, timeoutMs: 2_500 };
    default:
      // Postiz's coordinator token is minted per launch, so a running
      // coordinator can never be adopted; the websocket ports have nothing to
      // probe. Anything unlisted starts normally.
      return null;
  }
}

/**
 * How long to keep asking while the occupant is up but has not answered yet.
 *
 * A single short probe is wrong for anything that warms lazily. A cold
 * `next dev` compiles the route on the first request — fifteen seconds is
 * normal — and holds the connection open meanwhile, so a 2.5s probe reads a
 * perfectly good dashboard as a stranger, relocates onto a spare port, and
 * dies there because Next refuses a second dev server for the same directory.
 * That is the exact failure this budget exists to prevent.
 *
 * The budget is only ever spent on a port that is *silent*: an occupant that
 * answers wrongly is a stranger on the first reply, and startup moves on.
 */
const ADOPTION_BUDGET_MS: Record<string, number> = {
  dashboard: 45_000,
  quartz: 20_000,
};
const DEFAULT_ADOPTION_BUDGET_MS = 6_000;

export function adoptionBudgetMs(serviceId: string): number {
  return ADOPTION_BUDGET_MS[serviceId] ?? DEFAULT_ADOPTION_BUDGET_MS;
}

/** True when an instance of `serviceId` that we can use is already on `port`. */
export async function isOurServiceRunning(
  serviceId: string,
  port: number,
  context: AdoptionContext,
): Promise<boolean> {
  const probe = adoptionProbe(serviceId, port, context);
  if (probe === null) return false;
  const deadline = Date.now() + adoptionBudgetMs(serviceId);
  for (;;) {
    const result = await runHealthProbe(probe);
    if (result === "pass") return true;
    // Answered, but not as this service: a stranger holds the port, or a
    // Breadboard instance whose secret we do not have. Either way it is not
    // ours, and no amount of waiting changes that.
    if (result === "answered" || result === "unreachable") return false;
    if (Date.now() >= deadline) return false;
    await delay(500);
  }
}
