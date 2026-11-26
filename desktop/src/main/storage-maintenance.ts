import { powerMonitor, type Session } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Must match the dashboard's `MAINTENANCE_KEY_HEADER` and key file. */
export const MAINTENANCE_KEY_HEADER = "x-breadboard-maintenance-key";
export const MAINTENANCE_KEY_FILE = "storage-maintenance.key";

/**
 * Every launch signs the dashboard out, so idle maintenance on a locked app
 * was refused on every tick. A fresh random key per launch, kept in the data
 * folder's config directory, lets the lifecycle owner run idle ticks without a
 * session. Written to a temporary name and renamed, so a reader never sees a
 * partial key; a key from an earlier launch stops working at once.
 */
export function issueMaintenanceKey(configDir: string): string | null {
  try {
    const key = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(configDir, { recursive: true });
    const target = path.join(configDir, MAINTENANCE_KEY_FILE);
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, key, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, target);
    return key;
  } catch {
    // Without a key the signed-in path still works exactly as before.
    return null;
  }
}

export interface StorageCoordinatorOptions {
  dashboardUrl: () => string | null;
  session: Pick<Session, "cookies">;
  idleSeconds?: () => number;
  fetch?: typeof fetch;
  afterMaintenance?: (result: { housekeepingAllowed: boolean }) => void | Promise<void>;
  maintenanceKey?: () => string | null;
}

/** One lifecycle-owned loop; no runtime job or renderer timer is created. */
export function startStorageMaintenance(options: StorageCoordinatorOptions): () => void {
  const idleSeconds = options.idleSeconds ?? (() => powerMonitor.getSystemIdleTime());
  const request = options.fetch ?? fetch;
  let running = false, stopped = false, nextTick = Date.now()+15_000;
  let pending: AbortController | null = null;
  const tick = async () => {
    const base = options.dashboardUrl();
    if (stopped || running || !base || idleSeconds() < 120 || Date.now()<nextTick) return;
    nextTick=Date.now()+15_000;
    const url = new URL("/api/storage/maintenance", base);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password) return;
    running = true; pending = new AbortController();
    const interrupt = setInterval(() => { if (idleSeconds() < 120) pending?.abort(); }, 250);
    try {
      const cookies = await options.session.cookies.get({ url: url.href });
      if (stopped || idleSeconds() < 120) return;
      const response = await request(url, {
        method: "POST", redirect: "error", cache: "no-store",
        signal: AbortSignal.any([pending.signal, AbortSignal.timeout(10_000)]),
        headers: {
          "Content-Type": "application/json",
          Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; "),
          ...(options.maintenanceKey?.() ? { [MAINTENANCE_KEY_HEADER]: options.maintenanceKey()! } : {}),
        },
        body: JSON.stringify({ action: "tick", idleMs: idleSeconds() * 1000 }),
      });
      if (response.ok) {
        const result = await response.json() as { housekeepingAllowed?: boolean; continueSoon?:boolean };
        if (result.continueSoon) nextTick=Date.now()+1000;
        if (idleSeconds() >= 120) await options.afterMaintenance?.({ housekeepingAllowed: result.housekeepingAllowed === true });
      } else await response.body?.cancel();
    } catch { /* The next idle slice retries; diagnostics are bounded server-side. */ }
    finally { clearInterval(interrupt); pending = null; running = false; }
  };
  // Startup never waits for a scan or cleanup. The OS idle check is repeated on
  // every tick and during a request, including when the app was opened idle.
  const timer = setInterval(() => void tick(), 1000);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); pending?.abort(); };
}
